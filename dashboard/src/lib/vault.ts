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
};

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
