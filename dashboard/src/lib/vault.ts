export type Amount = string | number | bigint;

export interface Policy {
  min_move: Amount;
  max_per_move: Amount;
  daily_cap: Amount;
  max_slippage_bps: number;
  allowed_destination_assets: string[];
}

export interface PendingMove {
  id: number;
  amount: Amount;
  destination_asset: string;
  deposit_address: string;
  min_out: Amount;
  opened_at_ms: number;
  status: string;
}

export interface Position {
  id: number;
  amount: Amount;
  destination_asset: string;
  venue: string;
  deposit_address: string;
  recipient_evm_address: string;
  min_out: Amount;
  opened_at_ms: number;
  status: string;
  chain_badge?: string;
  expected_apy?: string;
  collateral_route?: string;
  realized_24h_yield?: string;
  health_factor?: string;
  rewards_accrued?: string;
  mpc_path?: string;
  rebalanced_label?: string;
  intent_hash?: string;
  settlement_tx?: string;
  solver_spread?: string;
  sig_latency?: string;
}

export interface QueuedWithdrawal {
  account_id: string;
  shares: Amount;
  requested_at_ms: number;
  epoch: number;
  status: "pending" | "ready" | string;
  assets_allocated: Amount;
}

export interface TimelockedPolicyProposal {
  policy: Policy;
  proposed_at_ms: number;
  eta_ms: number;
  proposer: string;
}

export interface VaultSummary {
  owner: string;
  token: string;
  agent: string;
  agent_enabled: boolean;
  paused: boolean;
  total_shares: Amount;
  total_assets: Amount;
  idle_assets: Amount;
  deployed_assets: Amount;
  share_price: Amount;
  daily_moved: Amount;
  daily_remaining: Amount;
  today_bucket: number;
  last_move_ms: number;
  pending_move: PendingMove | null;
  policy: Policy;
  current_epoch?: number;
  queued_shares?: Amount;
  pending_policy_proposal?: TimelockedPolicyProposal | null;
  active_positions?: Position[];
  mpc_derived_address?: string;
}

export interface RebalanceRecord {
  id: number;
  timestamp_ms: number;
  kind: string;
  amount: Amount;
  destination_asset: string;
  deposit_address: string | null;
  min_out: Amount;
  reason: string;
  executor: string;
}

export const config = {
  rpcUrl: import.meta.env.VITE_NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
  vaultContract: import.meta.env.VITE_VAULT_CONTRACT ?? "",
  tokenSymbol: import.meta.env.VITE_TOKEN_SYMBOL ?? "USDC",
  tokenDecimals: Number(import.meta.env.VITE_TOKEN_DECIMALS ?? 6),
  network: import.meta.env.VITE_NEAR_NETWORK ?? "testnet",
  oneClickBaseUrl: import.meta.env.VITE_ONECLICK_BASE_URL ?? "https://1click.chaindefuser.com",
  agentLogUrl: import.meta.env.VITE_AGENT_LOG_URL ?? "",
};

export interface ChainTransactionDetails {
  hash: string;
  explorerUrl?: string;
}

export interface OneClickStatus {
  status:
    | "KNOWN_DEPOSIT_TX"
    | "PENDING_DEPOSIT"
    | "INCOMPLETE_DEPOSIT"
    | "PROCESSING"
    | "SUCCESS"
    | "REFUNDED"
    | "FAILED";
  updatedAt?: string;
  swapDetails?: {
    intentHashes?: string[];
    nearTxHashes?: string[];
    originChainTxHashes?: Array<ChainTransactionDetails | string>;
    destinationChainTxHashes?: Array<ChainTransactionDetails | string>;
    amountIn?: string;
    amountInFormatted?: string;
    amountOut?: string;
    amountOutFormatted?: string;
    refundedAmount?: string;
    refundedAmountFormatted?: string;
  };
}

export const ONE_CLICK_DRY_RECIPIENT = "0x1111111111111111111111111111111111111111";
export const ONE_CLICK_DRY_REFUND_TO = "wrap.near";
export const NEAR_INTENTS_EXPLORER_TX = "https://explorer.near-intents.org/transactions";

export interface OneClickQuote {
  depositAddress?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate?: number;
}

export interface OneClickQuoteResult {
  correlationId: string;
  timestamp: string;
  quote: OneClickQuote;
}

export async function fetchOneClickStatus(depositAddress: string): Promise<OneClickStatus> {
  const url = `${config.oneClickBaseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`1Click status returned HTTP ${res.status}`);
  }
  return res.json() as Promise<OneClickStatus>;
}

export async function fetchOneClickQuote(params: {
  amount: string;
  originAsset: string;
  destinationAsset: string;
  recipient?: string;
  slippageTolerance?: number;
}): Promise<OneClickQuoteResult> {
  const deadline = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const url = `${config.oneClickBaseUrl}/v0/quote`;
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: params.slippageTolerance ?? 100,
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    recipient: params.recipient ?? ONE_CLICK_DRY_RECIPIENT,
    recipientType: "DESTINATION_CHAIN",
    refundTo:
      config.network === "mainnet" && config.vaultContract
        ? config.vaultContract
        : ONE_CLICK_DRY_REFUND_TO,
    refundType: "ORIGIN_CHAIN",
    deadline,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`1Click quote error (${res.status}): ${text.slice(0, 150)}`);
  }
  return res.json() as Promise<OneClickQuoteResult>;
}

interface RpcResponse {
  result?: {
    result?: number[];
    error?: string;
  };
  error?: {
    message?: string;
    data?: unknown;
  };
}

function encodeArgs(args: Record<string, unknown>): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
}

async function viewAt<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!contractId) {
    throw new Error("contract id is not configured");
  }

  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vaultpilot-dashboard",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: encodeArgs(args),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const body = (await response.json()) as RpcResponse;
  if (body.error) {
    throw new Error(body.error.message ?? "RPC error");
  }
  if (body.result?.error) {
    throw new Error(body.result.error);
  }

  const bytes = body.result?.result;
  if (!bytes || bytes.length === 0) {
    throw new Error(`${method} returned no value`);
  }

  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return JSON.parse(text) as T;
}

async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!config.vaultContract) {
    throw new Error("VITE_VAULT_CONTRACT is not set");
  }
  return viewAt<T>(config.vaultContract, method, args);
}

export function fetchSummary(): Promise<VaultSummary> {
  return view<VaultSummary>("get_summary");
}

export function fetchRebalances(fromIndex = 0, limit = 25): Promise<RebalanceRecord[]> {
  return view<RebalanceRecord[]>("get_rebalances", { from_index: fromIndex, limit });
}

export function fetchShares(accountId: string): Promise<string> {
  return view<string>("get_shares", { account_id: accountId });
}

export function fetchWithdrawalRequest(accountId: string): Promise<QueuedWithdrawal | null> {
  return view<QueuedWithdrawal | null>("get_withdrawal_request", { account_id: accountId });
}

export function fetchPolicyProposal(): Promise<TimelockedPolicyProposal | null> {
  return view<TimelockedPolicyProposal | null>("get_policy_proposal");
}

export function fetchActivePositions(): Promise<Position[]> {
  return view<Position[]>("get_active_positions");
}

export function fetchDerivedEvmAddress(path?: string): Promise<string> {
  return view<string>("get_derived_evm_address", { path });
}

export function fetchFtBalance(token: string, accountId: string): Promise<string> {
  return viewAt<string>(token, "ft_balance_of", { account_id: accountId });
}

export interface StorageBalance {
  total: string;
  available: string;
}

export function fetchStorageBalance(
  token: string,
  accountId: string,
): Promise<StorageBalance | null> {
  return viewAt<StorageBalance | null>(token, "storage_balance_of", { account_id: accountId });
}

export function formatAmount(value: Amount, decimals = config.tokenDecimals): string {
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function formatUsd(value: Amount, decimals = config.tokenDecimals): string {
  return `$${formatAmount(value, decimals)}`;
}

export function formatPrettyAmount(
  value: Amount,
  decimals = config.tokenDecimals,
  fractionDigits = 2,
): string {
  const num = Number(BigInt(value)) / 10 ** decimals;
  if (!Number.isFinite(num)) return formatAmount(value, decimals);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPrettyUsd(
  value: Amount,
  decimals = config.tokenDecimals,
  fractionDigits = 2,
): string {
  return `$${formatPrettyAmount(value, decimals, fractionDigits)}`;
}

export function formatSharePrice(value: Amount): string {
  return (Number(value) / 1e24).toFixed(4);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatTime(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

export function shorten(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export const VIRTUAL_SHARES = 1_000_000n;
export const VIRTUAL_ASSETS = 1_000_000n;

export function assetsForShares(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (totalShares <= 0n) return 0n;
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

export function sharesForAssets(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (totalAssets <= 0n) return 0n;
  return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS);
}

export function parseAmount(input: string, decimals = config.tokenDecimals): bigint {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed)) {
    throw new Error("enter a valid number");
  }

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  if (wholePart === "" && fractionPart === "") {
    throw new Error("enter an amount");
  }
  if (fractionPart.length > decimals) {
    throw new Error(`use at most ${decimals} decimal places`);
  }

  const whole = wholePart === "" ? 0n : BigInt(wholePart);
  const fraction = fractionPart === "" ? 0n : BigInt(fractionPart.padEnd(decimals, "0"));
  return whole * 10n ** BigInt(decimals) + fraction;
}

export function explorerTxUrl(hash: string): string {
  const base =
    config.network === "mainnet"
      ? "https://explorer.near.org"
      : "https://explorer.testnet.near.org";
  return `${base}/transactions/${hash}`;
}
