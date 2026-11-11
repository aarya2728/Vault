export type Amount = string | number;

export type PositionPhase =
  | "outbound_pending"    // rebalance_out done, polling 1Click status
  | "outbound_completed"  // 1Click confirmed the outbound swap succeeded
  | "awaiting_return"     // hold period elapsed, waiting for tokens to return to vault
  | "settling";           // tokens back in vault, ready for rebalance_in

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

export interface OutboundSwapDetails {
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
}

export interface ReturnQuoteInfo {
  depositAddress: string;
  correlationId: string;
  amountOut: string;
  minAmountOut: string;
  timestamp: string;
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
  /** Phase in the real settlement lifecycle. Defaults to "outbound_pending" for backward compat. */
  phase?: PositionPhase;
  /** Number of times 1Click status has been polled for the outbound swap. */
  statusPollCount?: number;
  /** Swap details populated when the outbound 1Click swap succeeds. */
  outboundSwapDetails?: OutboundSwapDetails;
  /** Return quote info populated when the return path is computed. */
  returnQuote?: ReturnQuoteInfo;
}

export interface AgentState {
  version: 1;
  lastRunMs: number | null;
  lastAction: string | null;
  position: PositionState | null;
  /** Consecutive abnormal quote/gas observations. Reset by a normal cycle. */
  anomalyStreak?: number;
  /** When the self-protective circuit breaker tripped (ms since epoch). */
  breakerTrippedAtMs?: number | null;
  /** Human-readable reason for the last circuit-breaker trip. */
  breakerReason?: string | null;
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
  /** How often to poll 1Click status during outbound_pending phase (ms). */
  statusPollIntervalMs: number;
  /** Max status polls before logging a timeout warning. */
  statusPollMaxRetries: number;
  /** Consecutive abnormal cycles required to trip the circuit breaker. */
  circuitBreakerThreshold: number;
  /** How long the breaker stays open before the agent self-resumes (ms). */
  circuitBreakerCooldownMs: number;
  /** Quote/route cost above this is considered anomalous (bps). */
  anomalyCostBps: number;
  /** Gas cost above this is considered anomalous (bps). */
  anomalyGasCostBps: number;
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
