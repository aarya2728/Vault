import type { RebalanceRecord, VaultSummary } from "./vault.js";

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ARB_USDC = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const BASE_USDC =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

const now = Date.now();
const today = Math.floor(now / 86_400_000);

export const DEMO_OWNER = "roundvest2883.testnet";
export const DEMO_AGENT = "agent.roundvest2883.testnet";

export const DEMO_SUMMARY: VaultSummary = {
  owner: DEMO_OWNER,
  token: NEAR_USDC,
  agent: DEMO_AGENT,
  agent_enabled: true,
  paused: false,
  total_shares: "125000000000",
  total_assets: "128450000000",
  idle_assets: "45950000000",
  deployed_assets: "82500000000",
  share_price: "1027600000000000000000000",
  daily_moved: "15000000000",
  daily_remaining: "10000000000",
  today_bucket: today,
  last_move_ms: now - 3 * 60 * 60 * 1000,
  pending_move: {
    id: 42,
    amount: "25000000000",
    destination_asset: ARB_USDC,
    deposit_address: "0x9f2c7a6b1e4d8c3f5a0b2d7e9c1f4a6b8d3e5c70",
    min_out: "24875000000",
    opened_at_ms: now - 12 * 60 * 1000,
    status: "PROCESSING",
  },
  policy: {
    min_move: "10000000",
    max_per_move: "50000000000",
    daily_cap: "25000000000",
    max_slippage_bps: 100,
    allowed_destination_assets: [ARB_USDC, BASE_USDC],
  },
};

const seedRecords: Array<Omit<RebalanceRecord, "id" | "timestamp_ms">> = [
  {
    kind: "rebalance_out",
    amount: "25000000000",
    destination_asset: ARB_USDC,
    deposit_address: "0x9f2c7a6b1e4d8c3f5a0b2d7e9c1f4a6b8d3e5c70",
    min_out: "24875000000",
    reason:
      "1Click round-trip: intents:8xpy4eGJ7bH4Qm9qk3ZfN2wYcV6tR1sL5uP0aD8mK4T18w; tx:6XqqDwoaopgg39QsEiFGs9HfwP2Vum9tCCyqHDYXWBBH; out:24,962.11; 0.0d",
    executor: DEMO_AGENT,
  },
  {
    kind: "rebalance_in",
    amount: "24962110000",
    destination_asset: ARB_USDC,
    deposit_address: "0x71b3d9a04e6c8f2a5d7b9e1c3a5f7b9d1e3c5a70",
    min_out: "0",
    reason:
      "1Click round-trip: intents:GnGk38hvi92tTWDYMMS8CWYnVT4fixmfBrnqSErCDMTu; tx:EVcgKukwf38XsYcgvkEgiMPWR7qwLfLK5rsVtjgctPBn; out:24,962.11; 2.1d; return-quote:9b2c4d6e",
    executor: DEMO_AGENT,
  },
  {
    kind: "rebalance_out",
    amount: "18000000000",
    destination_asset: BASE_USDC,
    deposit_address: "0x4d8a2f6b0c3e5d7a9f1b2c4d6e8a0b2c4d6e8a0b",
    min_out: "17982000000",
    reason:
      "1Click round-trip: intents:5nRJPjFQ4cV7bM2xT9zL1wY6uK3sD8aP0oI4eR7tH2qW9; tx:C9yV3mQ7pL1sX5aD8fG2hJ6kM0nP4qR8tU1vW3xZ; out:17,991.42; 0.0d",
    executor: DEMO_AGENT,
  },
  {
    kind: "rebalance_in",
    amount: "17991420000",
    destination_asset: BASE_USDC,
    deposit_address: "0x2a6c9e1b4d7f0a3c6e9b2d5f8a1c4e7b0d3f6a90",
    min_out: "0",
    reason:
      "1Click round-trip: intents:9tYk3mN8bV2cX6zA1sD4fG7hJ0kL5qW9eR3tY6uI2oP8; tx:4ZrT7yU1iO5pA9sD3fG7hJ1kL5zX9cV3bN7mQ2wE6rT; out:17,991.42; 4.4d; return-quote:7c1f3a9d",
    executor: DEMO_AGENT,
  },
  {
    kind: "rebalance_out",
    amount: "12000000000",
    destination_asset: ARB_USDC,
    deposit_address: "0x8b1e4f7a0c3d6b9e2f5a8c1d4e7b0f3a6c9d2e50",
    min_out: "11970000000",
    reason:
      "1Click round-trip: intents:2mK8pL4qR9sT3uV7wX1yZ5aB0cD6eF2gH8jK4mN9oP3q; tx:7HnR2sV6yB1cF5jL9pQ3tW8xZ4aD7eG0kM6nP2rT5vU; out:11,994.05; 0.0d",
    executor: DEMO_AGENT,
  },
];

export const DEMO_RECORDS: RebalanceRecord[] = seedRecords.map((record, index) => ({
  ...record,
  id: 41 - index,
  timestamp_ms: now - (index + 1) * 7 * 60 * 60 * 1000,
}));

export interface DecisionMetrics {
  nearApyBps: number;
  externalApyBps: number;
  annualizedCostBps: number;
  netSpreadBps: number;
  action: "APPROVED" | "HOLD" | "BLOCKED";
  amount?: string;
  quoteId?: string;
}

export interface DecisionLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  metrics?: DecisionMetrics;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const DEMO_DECISIONS: DecisionLogEntry[] = [
  {
    ts: minutesAgo(2),
    level: "info",
    event: "strategy_decision",
    message: "Spread cleared the hurdle; dispatching outbound leg through 1Click.",
    metrics: {
      nearApyBps: 320,
      externalApyBps: 850,
      annualizedCostBps: 110,
      netSpreadBps: 420,
      action: "APPROVED",
      amount: "25,000 USDC",
      quoteId: "8xpy4eGJ…4T18w",
    },
  },
  {
    ts: minutesAgo(14),
    level: "info",
    event: "outbound_status_poll",
    message: "1Click solver selected a route through Arbitrum; deposit confirmed.",
    metrics: {
      nearApyBps: 320,
      externalApyBps: 850,
      annualizedCostBps: 110,
      netSpreadBps: 420,
      action: "APPROVED",
      quoteId: "8xpy4eGJ…4T18w",
    },
  },
  {
    ts: minutesAgo(63),
    level: "info",
    event: "vault_snapshot",
    message: "Policy checked: idle 45,950 USDC, deployed 82,500 USDC, headroom 10,000 USDC.",
  },
  {
    ts: minutesAgo(120),
    level: "warn",
    event: "quote_slippage_spike",
    message: "1Click route slippage widened to 0.74%; loop held this cycle.",
    metrics: {
      nearApyBps: 318,
      externalApyBps: 842,
      annualizedCostBps: 129,
      netSpreadBps: 395,
      action: "HOLD",
    },
  },
  {
    ts: minutesAgo(180),
    level: "info",
    event: "rebalance_in_sent",
    message: "Return leg settled on-chain. Principal + 1.9% yield credited to the vault.",
    metrics: {
      nearApyBps: 320,
      externalApyBps: 850,
      annualizedCostBps: 110,
      netSpreadBps: 420,
      action: "APPROVED",
      amount: "24,962.11 USDC",
    },
  },
];
