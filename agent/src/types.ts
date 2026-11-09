export type Amount = string | number;

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
  kind: "rebalance_out" | "rebalance_in" | string;
  amount: Amount;
  destination_asset: string;
  deposit_address: string | null;
  min_out: Amount;
  reason: string;
  executor: string;
}

export interface TokenInfo {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string | null;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  deadline: string;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeEstimate?: number;
  timeWhenInactive?: number;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export interface StatusResponse {
  status:
    | "KNOWN_DEPOSIT_TX"
    | "PENDING_DEPOSIT"
    | "INCOMPLETE_DEPOSIT"
    | "PROCESSING"
    | "SUCCESS"
    | "REFUNDED"
    | "FAILED";
  updatedAt?: string;
  quoteResponse?: QuoteResponse;
  swapDetails?: {
    intentHashes?: string[];
    nearTxHashes?: string[];
    originChainTxHashes?: string[];
    destinationChainTxHashes?: string[];
    amountIn?: string;
    amountInFormatted?: string;
    amountOut?: string;
    amountOutFormatted?: string;
    refundedAmount?: string;
    refundedAmountFormatted?: string;
  };
}

export interface PositionState {
  depositAddress: string;
  destinationAsset: string;
  amount: string;
  minOut: string;
  expectedOut: string;
  openedAtMs: number;
  correlationId: string;
  quoteTimestamp: string;
  amountInUsd: string;
  amountOutUsd: string;
}

export interface AgentState {
  version: 1;
  lastRunMs: number | null;
  lastAction: string | null;
  position: PositionState | null;
}

export interface AgentConfig {
  nearNetwork: string;
  rpcUrl: string;
  vaultContract: string;
  agentAccount: string;
  agentPrivateKey: string;
  oneClickBaseUrl: string;
  oneClickJwt: string;
  quoteDry: boolean;
  originAsset: string;
  destinationAsset: string;
  destinationRecipient: string;
  originDecimals: number;
  destinationDecimals: number;
  rebalanceAmount: bigint;
  slippageBps: number;
  minSpreadBps: number;
  nearApyBps: number;
  externalApyBps: number;
  holdDays: number;
  nearUsd: number;
  gasUnits: bigint;
  pollIntervalMs: number;
  positionMaxMs: number;
  dryRun: boolean;
  autoCloseMock: boolean;
  mockYieldBps: number;
  logFile: string;
  stateFile: string;
}

export interface StrategyInput {
  summary: VaultSummary;
  amount: bigint;
  quote: Quote;
  gasPriceYoctoPerGas: bigint;
  nearApyBps: number;
  externalApyBps: number;
  holdDays: number;
  minSpreadBps: number;
  nearUsd: number;
  gasUnits: bigint;
}

export interface StrategyDecision {
  enter: boolean;
  reason: string;
  costBps: number;
  gasCostBps: number;
  annualizedCostBps: number;
  netSpreadBps: number;
  amountOut: bigint;
  minAmountOut: bigint;
  amountInUsd: number;
  amountOutUsd: number;
}
