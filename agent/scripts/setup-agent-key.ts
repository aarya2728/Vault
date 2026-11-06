import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, KeyPair, actions } from "near-api-js";
import type { JsonRpcProvider, KeyPairString } from "near-api-js";
import {
  AGENT_ROOT,
  accountExists,
  type AccessKeyEntry,
  assertSubAccount,
  bool,
  createProvider,
  describeKey,
  errorMessage,
  formatNear,
  getSummary,
  isFullAccess,
  listAccessKeys,
  loadEnv,
  optional,
  optionalEmpty,
  required,
  secretFromEnv,
  txHash,
  txUrl,
  vaultAccountFromEnv,
  yoctoFromNear,
} from "./lib.js";

const KEY_FILE = resolve(AGENT_ROOT, ".env.agent-key");
const ALLOWED_METHODS = new Set(["rebalance_out", "rebalance_in"]);
const DEFAULT_METHODS = "rebalance_out,rebalance_in";

interface AgentKeyState {
  key: KeyPair;
  generated: boolean;
}

function parseMethodNames(): string[] {
  const methodNames = [...new Set(
    optional("AGENT_METHOD_NAMES", DEFAULT_METHODS)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  )];
  if (methodNames.length === 0) {
    throw new Error("AGENT_METHOD_NAMES must include at least one method");
  }
  for (const method of methodNames) {
    if (!ALLOWED_METHODS.has(method)) {
      throw new Error(
        `refusing to grant method ${method}; allowed methods: ${[...ALLOWED_METHODS].join(", ")}`,
      );
    }
  }
  return methodNames;
}

function readKeyFile(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("AGENT_PRIVATE_KEY="));
  return line ? line.slice("AGENT_PRIVATE_KEY=".length).trim() : "";
}

function writeKeyFile(key: KeyPair): void {
  writeFileSync(KEY_FILE, `AGENT_PRIVATE_KEY=${key.toString()}\n`, { mode: 0o600 });
}

function loadAgentKey(): AgentKeyState {
  const serialized = secretFromEnv("AGENT_PRIVATE_KEY") || readKeyFile(KEY_FILE);
  if (serialized) {
    return { key: KeyPair.fromString(serialized as KeyPairString), generated: false };
  }
  return { key: KeyPair.fromRandom("ed25519"), generated: true };
}

async function verifyAgentKey(
  provider: JsonRpcProvider,
  agentAccountId: string,
  agentPublicKeyString: string,
  vaultContract: string,
  methodNames: string[],
): Promise<AccessKeyEntry[]> {
  const keys = await listAccessKeys(provider, agentAccountId);
  const entry = keys.find((item) => item.public_key === agentPublicKeyString);
  if (!entry) {
    throw new Error(`the agent key ${agentPublicKeyString} is not on ${agentAccountId}`);
  }
  const scope = describeKey(entry);
  if (scope.fullAccess) {
    throw new Error("the agent key has full access; refusing to continue");
  }
  if (scope.receiverId !== vaultContract) {
    throw new Error(
      `the agent key is scoped to ${scope.receiverId}, expected ${vaultContract}; rotate the agent account`,
    );
  }
  const missingMethods = methodNames.filter((method) => !scope.methodNames.includes(method));
  if (missingMethods.length > 0) {
    throw new Error(`the agent key is missing methods: ${missingMethods.join(", ")}`);
  }
  const extraMethods = scope.methodNames.filter((method) => !methodNames.includes(method));
  if (extraMethods.length > 0) {
    throw new Error(
      `the agent key has extra methods: ${extraMethods.join(", ")}; rotate the agent account`,
    );
  }
  return keys;
}

async function main(): Promise<void> {
  loadEnv();

  const network = optional("NEAR_NETWORK", "testnet");
  const provider = createProvider();
  const ownerAccountId = required("OWNER_ACCOUNT");
  const agentAccountId = required("AGENT_ACCOUNT");
  const vaultContract = vaultAccountFromEnv();
  const vaultAlias = optionalEmpty("VAULT_CONTRACT");
  if (vaultAlias && vaultAlias !== vaultContract) {
    console.log(`WARNING: VAULT_CONTRACT is ${vaultAlias}, using ${vaultContract}`);
  }
  if (agentAccountId === ownerAccountId) {
    throw new Error("AGENT_ACCOUNT must be different from OWNER_ACCOUNT");
  }
  if (agentAccountId === vaultContract) {
    throw new Error("AGENT_ACCOUNT must be different from the vault account");
  }

  const methodNames = parseMethodNames();
  const allowance = yoctoFromNear(optional("AGENT_ALLOWANCE_NEAR", "0.25"));
  if (allowance <= 0n) {
    throw new Error("AGENT_ALLOWANCE_NEAR must be greater than zero");
  }
  const initialNear = yoctoFromNear(optional("AGENT_INITIAL_NEAR", "0.5"));
  if (initialNear <= 0n) {
    throw new Error("AGENT_INITIAL_NEAR must be greater than zero");
  }
  const setAgent = bool("SET_AGENT", true);
  const revokeFullAccess = bool("REVOKE_FULL_ACCESS_KEY", true);

  const summary = await getSummary(provider, vaultContract).catch((error) => {
    throw new Error(
      `cannot read ${vaultContract}.get_summary; deploy and initialize the vault first (npm run deploy): ${errorMessage(error)}`,
    );
  });
  if (setAgent && summary.owner !== ownerAccountId) {
    throw new Error(
      `vault owner is ${summary.owner}, not ${ownerAccountId}; use the owner key or set SET_AGENT=false`,
    );
  }

  const agentKey = loadAgentKey();
  if (agentKey.generated) {
    writeKeyFile(agentKey.key);
    console.log("generated agent key written to agent/.env.agent-key");
  }
  const agentPublicKey = agentKey.key.getPublicKey();
  const agentPublicKeyString = agentPublicKey.toString();

  const ownerPrivateKey = secretFromEnv("OWNER_PRIVATE_KEY");
  const owner = ownerPrivateKey
    ? new Account(ownerAccountId, provider, ownerPrivateKey as KeyPairString)
    : null;
  const requireOwner = (): Account => {
    if (!owner) {
      throw new Error("OWNER_PRIVATE_KEY is required to create the agent account or call set_agent");
    }
    return owner;
  };

  const fullAccessPrivateKey = secretFromEnv("AGENT_FULL_ACCESS_PRIVATE_KEY");
  const fullAccessKeyPair = fullAccessPrivateKey
    ? KeyPair.fromString(fullAccessPrivateKey as KeyPairString)
    : null;
  const fullAccessSigner = fullAccessPrivateKey
    ? new Account(agentAccountId, provider, fullAccessPrivateKey as KeyPairString)
    : null;
  const requireFullAccessSigner = (): Account => {
    if (!fullAccessSigner) {
      throw new Error(
        "AGENT_FULL_ACCESS_PRIVATE_KEY is required to add or delete a key on an existing agent account",
      );
    }
    return fullAccessSigner;
  };

  const agentExists = await accountExists(provider, agentAccountId);
  if (!agentExists) {
    assertSubAccount(agentAccountId, ownerAccountId);
    const response = await requireOwner().signAndSendTransaction({
      receiverId: agentAccountId,
      actions: [
        actions.createAccount(),
        actions.transfer(initialNear),
        actions.addFunctionCallAccessKey(agentPublicKey, vaultContract, methodNames, allowance),
      ],
      waitUntil: "FINAL",
    });
    console.log(
      `created ${agentAccountId} with only a scoped key: ${txUrl(network, txHash(response))}`,
    );
  } else {
    const keys = await listAccessKeys(provider, agentAccountId);
    const currentKey = keys.find((entry) => entry.public_key === agentPublicKeyString);
    if (currentKey) {
      console.log(`${agentAccountId} already has the agent key`);
    } else {
      const signer = requireFullAccessSigner();
      if (!fullAccessKeyPair) {
        throw new Error("AGENT_FULL_ACCESS_PRIVATE_KEY is required to add a key");
      }
      const fullAccessPublicKey = fullAccessKeyPair.getPublicKey().toString();
      const signerEntry = keys.find((entry) => entry.public_key === fullAccessPublicKey);
      if (!signerEntry || !isFullAccess(signerEntry.access_key.permission)) {
        throw new Error(
          "AGENT_FULL_ACCESS_PRIVATE_KEY is not a full-access key on the agent account",
        );
      }
      const response = await signer.signAndSendTransaction({
        receiverId: agentAccountId,
        actions: [
          actions.addFunctionCallAccessKey(agentPublicKey, vaultContract, methodNames, allowance),
        ],
        waitUntil: "FINAL",
      });
      console.log(
        `added scoped key to ${agentAccountId}: ${txUrl(network, txHash(response))}`,
      );
    }
  }

  await verifyAgentKey(provider, agentAccountId, agentPublicKeyString, vaultContract, methodNames);

  if (revokeFullAccess) {
    if (!fullAccessSigner || !fullAccessKeyPair) {
      console.log(
        "REVOKE_FULL_ACCESS_KEY=true but AGENT_FULL_ACCESS_PRIVATE_KEY is unset; skipping key deletion",
      );
    } else {
      const fullAccessPublicKey = fullAccessKeyPair.getPublicKey().toString();
      if (fullAccessPublicKey === agentPublicKeyString) {
        throw new Error(
          "AGENT_FULL_ACCESS_PRIVATE_KEY is the agent key; refusing to delete it",
        );
      }
      const keys = await listAccessKeys(provider, agentAccountId);
      const entry = keys.find((item) => item.public_key === fullAccessPublicKey);
      if (!entry) {
        console.log(`${fullAccessPublicKey} is not a key on ${agentAccountId}; nothing to revoke`);
      } else if (!isFullAccess(entry.access_key.permission)) {
        console.log(`${fullAccessPublicKey} is already scoped; not deleting`);
      } else {
        const response = await fullAccessSigner.signAndSendTransaction({
          receiverId: agentAccountId,
          actions: [actions.deleteKey(fullAccessKeyPair.getPublicKey())],
          waitUntil: "FINAL",
        });
        console.log(
          `deleted full-access key from ${agentAccountId}: ${txUrl(network, txHash(response))}`,
        );
      }
    }
  }

  if (setAgent) {
    const current = await getSummary(provider, vaultContract);
    if (current.agent === agentAccountId) {
      console.log(`vault already points at ${agentAccountId}`);
    } else {
      const response = await requireOwner().signAndSendTransaction({
        receiverId: vaultContract,
        actions: [
          actions.functionCall("set_agent", { agent: agentAccountId }, 50_000_000_000_000n, 0n),
        ],
        waitUntil: "FINAL",
      });
      console.log(`set vault agent: ${txUrl(network, txHash(response))}`);
    }
    const updated = await getSummary(provider, vaultContract);
    if (updated.agent !== agentAccountId) {
      throw new Error(`vault agent is ${updated.agent}, expected ${agentAccountId}`);
    }
    if (!updated.agent_enabled) {
      console.log("WARNING: the vault has the agent disabled; call set_agent_enabled to enable it");
    }
  }

  const finalKeys = await verifyAgentKey(
    provider,
    agentAccountId,
    agentPublicKeyString,
    vaultContract,
    methodNames,
  );

  const remainingFullAccess = finalKeys.filter((entry) =>
    isFullAccess(entry.access_key.permission),
  );
  if (remainingFullAccess.length > 0) {
    console.log("");
    console.log("WARNING: the agent account still has full-access keys:");
    for (const entry of remainingFullAccess) {
      console.log(`  ${entry.public_key}`);
    }
    console.log("Delete them so a leaked agent key cannot rotate itself:");
    console.log(
      `  near delete-key ${agentAccountId} <public-key> --accountId ${agentAccountId}`,
    );
  }

  console.log("");
  console.log(`agent account: ${agentAccountId}`);
  console.log(`vault: ${vaultContract}`);
  console.log(`key scope: ${vaultContract} :: ${methodNames.join(", ")}`);
  console.log(`allowance: ${formatNear(allowance)} NEAR`);
  if (agentKey.generated) {
    console.log(
      "move AGENT_PRIVATE_KEY from agent/.env.agent-key into agent/.env, then delete the key file",
    );
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
