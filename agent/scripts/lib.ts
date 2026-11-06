import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { JsonRpcProvider, formatNearAmount } from "near-api-js";
import type { Account } from "near-api-js";

export const AGENT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const REPO_ROOT = resolve(AGENT_ROOT, "..");

type TxResponse = Awaited<ReturnType<Account["signAndSendTransaction"]>>;

export interface VaultSummary {
  owner: string;
  token: string;
  agent: string;
  agent_enabled: boolean;
  paused: boolean;
}

export interface AccessKeyEntry {
  public_key: string;
  access_key: { permission: unknown };
}

export interface KeyScope {
  publicKey: string;
  fullAccess: boolean;
  receiverId: string | null;
  methodNames: string[];
  allowance: string | null;
}

interface FunctionCallView {
  receiver_id: string;
  method_names: string[];
  allowance?: string | null;
}

const NEAR_DECIMALS = 24n;

export function loadEnv(): void {
  dotenv.config({ path: resolve(AGENT_ROOT, ".env") });
  dotenv.config({ path: resolve(AGENT_ROOT, ".env.setup") });
}

export function required(name: string): string {
  const value = optionalEmpty(name);
  if (!value) {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
}

export function optional(name: string, fallback: string): string {
  return optionalEmpty(name) || fallback;
}

export function optionalEmpty(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function bool(name: string, fallback: boolean): boolean {
  const value = optionalEmpty(name).toLowerCase();
  if (!value) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

export function secretFromEnv(name: string): string {
  const value = optionalEmpty(name);
  return value.includes("replace_me") ? "" : value;
}

export function requiredSecret(name: string): string {
  const value = secretFromEnv(name);
  if (!value) {
    throw new Error(`${name} must be a real ed25519 private key`);
  }
  return value;
}

export function vaultAccountFromEnv(): string {
  const value = optionalEmpty("VAULT_ACCOUNT") || optionalEmpty("VAULT_CONTRACT");
  if (!value) {
    throw new Error("set VAULT_ACCOUNT (or VAULT_CONTRACT)");
  }
  return value;
}

export function defaultRpcUrl(network: string): string {
  return network === "mainnet"
    ? "https://rpc.mainnet.near.org"
    : "https://rpc.testnet.near.org";
}

export function createProvider(): JsonRpcProvider {
  return new JsonRpcProvider({ url: optional("NEAR_RPC_URL", defaultRpcUrl(optional("NEAR_NETWORK", "testnet"))) });
}

export function yoctoFromNear(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid NEAR amount: ${value}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > Number(NEAR_DECIMALS)) {
    throw new Error(`NEAR amount has more than ${NEAR_DECIMALS} decimals: ${value}`);
  }
  return BigInt(whole) * 10n ** NEAR_DECIMALS + BigInt(fraction.padEnd(Number(NEAR_DECIMALS), "0"));
}

export function formatNear(value: bigint): string {
  return formatNearAmount(value);
}

export function txHash(response: TxResponse): string {
  return response.transaction_outcome.id;
}

export function txUrl(network: string, hash: string): string {
  return network === "mainnet"
    ? `https://nearblocks.io/txns/${hash}`
    : `https://testnet.nearblocks.io/txns/${hash}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertSubAccount(accountId: string, parentId: string): void {
  if (!accountId.endsWith(`.${parentId}`)) {
    throw new Error(
      `${accountId} is not a subaccount of ${parentId}; create it separately, then re-run this script`,
    );
  }
}

function isMissingAccount(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const candidate = error as Error & { name?: string; type?: string };
  return (
    candidate.name === "AccountDoesNotExistError" ||
    candidate.type === "AccountDoesNotExist" ||
    /UNKNOWN_ACCOUNT|does not exist/i.test(candidate.message)
  );
}

export async function accountExists(provider: JsonRpcProvider, accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch (error) {
    if (isMissingAccount(error)) {
      return false;
    }
    throw error;
  }
}

export async function listAccessKeys(
  provider: JsonRpcProvider,
  accountId: string,
): Promise<AccessKeyEntry[]> {
  const response = await provider.viewAccessKeyList({ accountId });
  return response.keys as AccessKeyEntry[];
}

export function isFullAccess(permission: unknown): boolean {
  return (
    permission === "FullAccess" ||
    (typeof permission === "object" && permission !== null && "FullAccess" in permission)
  );
}

export function describeKey(entry: AccessKeyEntry): KeyScope {
  const permission = entry.access_key.permission;
  if (isFullAccess(permission)) {
    return {
      publicKey: entry.public_key,
      fullAccess: true,
      receiverId: null,
      methodNames: [],
      allowance: null,
    };
  }
  if (permission && typeof permission === "object") {
    const record = permission as Record<string, unknown>;
    const call = (record.FunctionCall ?? record.GasKeyFunctionCall) as FunctionCallView | undefined;
    if (
      call &&
      typeof call === "object" &&
      typeof call.receiver_id === "string" &&
      Array.isArray(call.method_names)
    ) {
      return {
        publicKey: entry.public_key,
        fullAccess: false,
        receiverId: call.receiver_id,
        methodNames: call.method_names,
        allowance: call.allowance ?? null,
      };
    }
  }
  throw new Error(`unsupported access key permission for ${entry.public_key}`);
}

export async function getSummary(
  provider: JsonRpcProvider,
  contractId: string,
): Promise<VaultSummary> {
  const result = await provider.callFunction({
    contractId,
    method: "get_summary",
    args: {},
  });
  if (result === undefined) {
    throw new Error(`${contractId}.get_summary returned no value`);
  }
  return result as VaultSummary;
}
