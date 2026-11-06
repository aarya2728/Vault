import { Account, JsonRpcProvider } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import type { AgentConfig, Policy, RebalanceRecord, VaultSummary } from "./types.js";

export function createProvider(config: AgentConfig): JsonRpcProvider {
  return new JsonRpcProvider({ url: config.rpcUrl });
}

export function createAgentAccount(
  config: AgentConfig,
  provider: JsonRpcProvider,
): Account | null {
  if (!config.agentPrivateKey) return null;
  return new Account(config.agentAccount, provider, config.agentPrivateKey as KeyPairString);
}

async function view<T>(
  provider: JsonRpcProvider,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await provider.callFunction({ contractId, method, args });
  if (result === undefined) {
    throw new Error(`${contractId}.${method} returned no value`);
  }
  return result as T;
}

export function getSummary(provider: JsonRpcProvider, vault: string): Promise<VaultSummary> {
  return view<VaultSummary>(provider, vault, "get_summary");
}

export function getPolicy(provider: JsonRpcProvider, vault: string): Promise<Policy> {
  return view<Policy>(provider, vault, "get_policy");
}

export function getRebalances(
  provider: JsonRpcProvider,
  vault: string,
  fromIndex = 0,
  limit = 20,
): Promise<RebalanceRecord[]> {
  return view<RebalanceRecord[]>(provider, vault, "get_rebalances", {
    from_index: fromIndex,
    limit,
  });
}

export async function getFtBalance(
  provider: JsonRpcProvider,
  token: string,
  accountId: string,
): Promise<bigint> {
  const raw = await view<string>(provider, token, "ft_balance_of", { account_id: accountId });
  return BigInt(raw);
}

export async function getGasPrice(provider: JsonRpcProvider): Promise<bigint> {
  const response = await provider.viewGasPrice();
  return BigInt(response.gas_price);
}

export interface RebalanceOutArgs {
  amount: bigint;
  destinationAsset: string;
  depositAddress: string;
  minOut: bigint;
  reason: string;
}

export async function callRebalanceOut(
  account: Account,
  vault: string,
  args: RebalanceOutArgs,
): Promise<unknown> {
  return account.callFunction({
    contractId: vault,
    methodName: "rebalance_out",
    args: {
      amount: args.amount.toString(),
      destination_asset: args.destinationAsset,
      deposit_address: args.depositAddress,
      min_out: args.minOut.toString(),
      reason: args.reason,
    },
    gas: 100_000_000_000_000n,
    deposit: 0n,
  });
}

export async function callRebalanceIn(
  account: Account,
  vault: string,
  reason: string,
): Promise<unknown> {
  return account.callFunction({
    contractId: vault,
    methodName: "rebalance_in",
    args: { reason },
    gas: 100_000_000_000_000n,
    deposit: 0n,
  });
}
