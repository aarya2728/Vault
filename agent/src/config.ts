import { resolve } from "node:path";
import dotenv from "dotenv";
import type { AgentConfig } from "./types.js";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`missing required env var ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`env var ${name} must be a boolean`);
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`env var ${name} must be an integer`);
  return parsed;
}

function bigintEnv(name: string, fallback: string): bigint {
  const value = optional(name, fallback);
  try {
    return BigInt(value);
  } catch {
    throw new Error(`env var ${name} must be an integer string`);
  }
}

export function loadConfig(): AgentConfig {
  const dryRun = bool("DRY_RUN", true);
  const nearNetwork = optional("NEAR_NETWORK", "testnet");
  const rpcUrl = optional(
    "NEAR_RPC_URL",
    nearNetwork === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org",
  );

  const quoteDry = bool("QUOTE_DRY", false);
  if (!dryRun && quoteDry) {
    throw new Error("QUOTE_DRY must be false when DRY_RUN=false (a dry quote has no deposit address)");
  }
  if (!dryRun && nearNetwork !== "mainnet") {
    throw new Error("live Intents execution requires NEAR_NETWORK=mainnet; 1Click has no testnet");
  }

  const agentPrivateKey = optional("AGENT_PRIVATE_KEY", "");
  if (!dryRun && agentPrivateKey === "") {
    throw new Error("AGENT_PRIVATE_KEY is required when DRY_RUN=false");
  }
  if (agentPrivateKey && !agentPrivateKey.startsWith("ed25519:")) {
    throw new Error("AGENT_PRIVATE_KEY must be an ed25519 function-call key");
  }

  const rebalanceAmount = bigintEnv("REBALANCE_AMOUNT", "1000000");
  if (rebalanceAmount <= 0n) throw new Error("REBALANCE_AMOUNT must be > 0");

  return {
    nearNetwork,
    rpcUrl,
    vaultContract: required("VAULT_CONTRACT"),
    agentAccount: required("AGENT_ACCOUNT"),
    agentPrivateKey,
    oneClickBaseUrl: optional("ONECLICK_BASE_URL", "https://1click.chaindefuser.com").replace(
      /\/$/,
      "",
    ),
    oneClickJwt: optional("ONECLICK_JWT", ""),
    quoteDry,
    originAsset: required("ORIGIN_ASSET"),
    destinationAsset: required("DESTINATION_ASSET"),
    destinationRecipient: required("DESTINATION_RECIPIENT"),
    originDecimals: integer("ORIGIN_DECIMALS", 6),
    destinationDecimals: integer("DESTINATION_DECIMALS", 6),
    rebalanceAmount,
    slippageBps: integer("SLIPPAGE_BPS", 100),
    minSpreadBps: integer("MIN_SPREAD_BPS", 150),
    nearApyBps: integer("NEAR_APY_BPS", 450),
    externalApyBps: integer("EXTERNAL_APY_BPS", 1200),
    holdDays: integer("HOLD_DAYS", 30),
    nearUsd: Number(optional("NEAR_USD", "5")),
    gasUnits: bigintEnv("GAS_UNITS", "100000000000000"),
    pollIntervalMs: integer("POLL_INTERVAL_MS", 3_600_000),
    positionMaxMs: integer("POSITION_MAX_MS", 21_600_000),
    dryRun,
    autoCloseMock: bool("AUTO_CLOSE_MOCK", false),
    mockYieldBps: integer("MOCK_YIELD_BPS", 100),
    logFile: resolve(process.cwd(), optional("LOG_FILE", "data/rebalances.jsonl")),
    stateFile: resolve(process.cwd(), optional("STATE_FILE", "data/state.json")),
    statusPollIntervalMs: integer("STATUS_POLL_INTERVAL_MS", 30_000),
    statusPollMaxRetries: integer("STATUS_POLL_MAX_RETRIES", 120),
    circuitBreakerThreshold: Math.max(1, integer("CIRCUIT_BREAKER_THRESHOLD", 3)),
    circuitBreakerCooldownMs: integer("CIRCUIT_BREAKER_COOLDOWN_MS", 21_600_000),
    anomalyCostBps: integer("ANOMALY_COST_BPS", 350),
    anomalyGasCostBps: integer("ANOMALY_GAS_COST_BPS", 150),
  };
}
