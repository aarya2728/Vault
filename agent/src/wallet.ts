import { KeyPair, type JsonRpcProvider } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import type { AgentConfig } from "./types.js";

export interface KeyScope {
  publicKey: string;
  receiverId: string | null;
  methodNames: string[];
  allowance: string | null;
  fullAccess: boolean;
}

export async function inspectAgentKey(
  config: AgentConfig,
  provider: JsonRpcProvider,
): Promise<KeyScope | null> {
  if (!config.agentPrivateKey) return null;

  const publicKey = KeyPair.fromString(config.agentPrivateKey as KeyPairString).getPublicKey().toString();
  const { keys } = await provider.viewAccessKeyList({ accountId: config.agentAccount });
  const match = keys.find((entry) => entry.public_key === publicKey);
  if (!match) {
    throw new Error(
      `key ${publicKey} is not an access key on ${config.agentAccount}; add it or fix AGENT_PRIVATE_KEY`,
    );
  }

  const permission = match.access_key.permission;
  if (permission === "FullAccess") {
    return {
      publicKey,
      receiverId: null,
      methodNames: [],
      allowance: null,
      fullAccess: true,
    };
  }

  const functionCall =
    "FunctionCall" in permission
      ? permission.FunctionCall
      : "GasKeyFunctionCall" in permission
        ? permission.GasKeyFunctionCall
        : null;

  if (!functionCall) {
    throw new Error(`unsupported access key permission for ${publicKey}`);
  }

  return {
    publicKey,
    receiverId: functionCall.receiver_id,
    methodNames: functionCall.method_names,
    allowance: functionCall.allowance ?? null,
    fullAccess: false,
  };
}

export function assertScopedKey(config: AgentConfig, scope: KeyScope | null): void {
  if (scope === null) {
    if (!config.dryRun) throw new Error("no agent key configured");
    return;
  }
  if (scope.fullAccess) {
    throw new Error(
      `AGENT_PRIVATE_KEY has full access to ${config.agentAccount}; use a function-call key`,
    );
  }
  if (scope.receiverId !== config.vaultContract) {
    throw new Error(
      `agent key is scoped to ${scope.receiverId ?? "nothing"}, expected ${config.vaultContract}`,
    );
  }
  for (const method of ["rebalance_out", "rebalance_in"]) {
    if (!scope.methodNames.includes(method)) {
      throw new Error(`agent key is missing method permission ${method}`);
    }
  }
}
