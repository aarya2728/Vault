import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, KeyPair, actions } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import {
  AGENT_ROOT,
  REPO_ROOT,
  accountExists,
  assertSubAccount,
  bool,
  createProvider,
  errorMessage,
  getSummary,
  isFullAccess,
  listAccessKeys,
  loadEnv,
  optional,
  optionalEmpty,
  required,
  requiredSecret,
  secretFromEnv,
  txHash,
  txUrl,
  vaultAccountFromEnv,
  yoctoFromNear,
} from "./lib.js";

interface Policy {
  min_move: string;
  max_per_move: string;
  daily_cap: string;
  max_slippage_bps: number;
  allowed_destination_assets: string[];
}

const WASM_CANDIDATES = [
  resolve(REPO_ROOT, "contracts/target/near/vault_pilot_contract.wasm"),
  resolve(REPO_ROOT, "contracts/target/wasm32-unknown-unknown/release/vault_pilot_contract.wasm"),
];

function u128(name: string, value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer string, got ${value}`);
  }
  return BigInt(value);
}

function validatePolicy(policy: Policy): Policy {
  const minMove = u128("min_move", String(policy.min_move));
  const maxPerMove = u128("max_per_move", String(policy.max_per_move));
  const dailyCap = u128("daily_cap", String(policy.daily_cap));
  if (minMove <= 0n || maxPerMove <= 0n || dailyCap <= 0n) {
    throw new Error("policy amounts must be greater than zero");
  }
  if (minMove > maxPerMove) {
    throw new Error("policy min_move must be <= max_per_move");
  }
  if (dailyCap < maxPerMove) {
    throw new Error("policy daily_cap must be >= max_per_move");
  }
  const slippage = Number(policy.max_slippage_bps);
  if (!Number.isInteger(slippage) || slippage < 0 || slippage > 10000) {
    throw new Error("policy max_slippage_bps must be an integer between 0 and 10000");
  }
  if (!Array.isArray(policy.allowed_destination_assets)) {
    throw new Error("policy allowed_destination_assets must be an array");
  }
  const assets = [...new Set(policy.allowed_destination_assets)];
  if (assets.length < 1 || assets.length > 16) {
    throw new Error("policy allowed_destination_assets must contain 1 to 16 assets");
  }
  for (const asset of assets) {
    if (typeof asset !== "string" || asset.length === 0 || Buffer.byteLength(asset, "utf8") > 128) {
      throw new Error("each allowed destination asset must be a non-empty string of at most 128 bytes");
    }
  }
  return {
    min_move: String(policy.min_move),
    max_per_move: String(policy.max_per_move),
    daily_cap: String(policy.daily_cap),
    max_slippage_bps: slippage,
    allowed_destination_assets: assets,
  };
}

function buildPolicy(): Policy {
  const fromJson = optionalEmpty("POLICY_JSON");
  if (fromJson) {
    return validatePolicy(JSON.parse(fromJson) as Policy);
  }
  const assets = optional("POLICY_ALLOWED_ASSETS", "")
    .split(",")
    .map((asset) => asset.trim())
    .filter(Boolean);
  if (assets.length === 0) {
    throw new Error("set POLICY_ALLOWED_ASSETS or POLICY_JSON");
  }
  return validatePolicy({
    min_move: optional("POLICY_MIN_MOVE", "1000000"),
    max_per_move: optional("POLICY_MAX_PER_MOVE", "10000000"),
    daily_cap: optional("POLICY_DAILY_CAP", "50000000"),
    max_slippage_bps: Number(optional("POLICY_MAX_SLIPPAGE_BPS", "100")),
    allowed_destination_assets: assets,
  });
}

function resolveWasmPath(): string {
  const configured = optionalEmpty("WASM_PATH");
  if (configured) {
    return resolve(AGENT_ROOT, configured);
  }
  return WASM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? WASM_CANDIDATES[0];
}

async function main(): Promise<void> {
  loadEnv();

  const network = optional("NEAR_NETWORK", "testnet");
  const provider = createProvider();
  const ownerAccountId = required("OWNER_ACCOUNT");
  const vaultAccountId = vaultAccountFromEnv();
  const vaultAlias = optionalEmpty("VAULT_CONTRACT");
  if (vaultAlias && vaultAlias !== vaultAccountId) {
    console.log(`WARNING: VAULT_CONTRACT is ${vaultAlias}, using ${vaultAccountId}`);
  }
  const tokenAccountId = required("VAULT_TOKEN");
  const agentAccountId = required("AGENT_ACCOUNT");
  if (vaultAccountId === ownerAccountId) {
    throw new Error("VAULT_ACCOUNT must be different from OWNER_ACCOUNT");
  }
  if (vaultAccountId === tokenAccountId) {
    throw new Error("VAULT_ACCOUNT must be different from VAULT_TOKEN");
  }
  if (agentAccountId === vaultAccountId) {
    throw new Error("AGENT_ACCOUNT must be different from VAULT_ACCOUNT");
  }
  const vaultPrivateKey = requiredSecret("VAULT_PRIVATE_KEY");
  const ownerPrivateKey = secretFromEnv("OWNER_PRIVATE_KEY");
  const initialNear = yoctoFromNear(optional("VAULT_INITIAL_NEAR", "5"));
  if (initialNear <= 0n) {
    throw new Error("VAULT_INITIAL_NEAR must be greater than zero");
  }
  const init = bool("INIT", true);
  const policy = buildPolicy();

  const wasmPath = resolveWasmPath();
  if (!existsSync(wasmPath)) {
    throw new Error(
      `wasm not found at ${wasmPath}; build it with cargo near build or set WASM_PATH`,
    );
  }
  const code = readFileSync(wasmPath);

  const vaultKeyPair = KeyPair.fromString(vaultPrivateKey as KeyPairString);
  const vaultPublicKey = vaultKeyPair.getPublicKey();
  const vaultAccount = new Account(vaultAccountId, provider, vaultPrivateKey as KeyPairString);

  const vaultExists = await accountExists(provider, vaultAccountId);
  if (!vaultExists) {
    if (!ownerPrivateKey) {
      throw new Error("OWNER_PRIVATE_KEY is required to create VAULT_ACCOUNT");
    }
    assertSubAccount(vaultAccountId, ownerAccountId);
    const owner = new Account(ownerAccountId, provider, ownerPrivateKey as KeyPairString);
    const response = await owner.signAndSendTransaction({
      receiverId: vaultAccountId,
      actions: [
        actions.createAccount(),
        actions.transfer(initialNear),
        actions.addFullAccessKey(vaultPublicKey),
      ],
      waitUntil: "FINAL",
    });
    console.log(`created ${vaultAccountId}: ${txUrl(network, txHash(response))}`);
  }

  const keys = await listAccessKeys(provider, vaultAccountId);
  const vaultKey = keys.find((entry) => entry.public_key === vaultPublicKey.toString());
  if (!vaultKey) {
    throw new Error(`VAULT_PRIVATE_KEY is not an access key on ${vaultAccountId}`);
  }
  if (!isFullAccess(vaultKey.access_key.permission)) {
    throw new Error("VAULT_PRIVATE_KEY must be a full-access key to deploy and initialize");
  }

  const deployResponse = await vaultAccount.signAndSendTransaction({
    receiverId: vaultAccountId,
    actions: [actions.deployContract(code)],
    waitUntil: "FINAL",
  });
  console.log(
    `deployed ${code.length} bytes to ${vaultAccountId}: ${txUrl(network, txHash(deployResponse))}`,
  );

  const state = await provider.viewContractState({ contractId: vaultAccountId, prefix: "" });
  const initialized = state.values.length > 0;
  if (initialized) {
    console.log(`${vaultAccountId} is already initialized; skipping new()`);
  } else if (init) {
    const initResponse = await vaultAccount.signAndSendTransaction({
      receiverId: vaultAccountId,
      actions: [
        actions.functionCall(
          "new",
          {
            owner: ownerAccountId,
            token: tokenAccountId,
            agent: agentAccountId,
            policy,
          },
          100_000_000_000_000n,
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });
    console.log(`initialized vault: ${txUrl(network, txHash(initResponse))}`);
  } else {
    console.log("INIT=false and the vault is not initialized; call new() manually");
  }

  try {
    const summary = await getSummary(provider, vaultAccountId);
    console.log("");
    console.log(`vault: ${vaultAccountId}`);
    console.log(`owner: ${summary.owner}`);
    console.log(`token: ${summary.token}`);
    console.log(`agent: ${summary.agent}`);
    if (summary.owner !== ownerAccountId) {
      console.log(`WARNING: owner is ${summary.owner}, expected ${ownerAccountId}`);
    }
    if (summary.token !== tokenAccountId) {
      console.log(`WARNING: token is ${summary.token}, expected ${tokenAccountId}`);
    }
    if (summary.agent !== agentAccountId) {
      console.log(`WARNING: agent is ${summary.agent}, expected ${agentAccountId}`);
    }
  } catch (error) {
    console.log(`could not read get_summary: ${errorMessage(error)}`);
  }

  console.log("");
  console.log("next:");
  console.log("  1. register the vault with the token if it enforces NEP-145 storage:");
  console.log(
    `     near call ${tokenAccountId} storage_deposit '{"account_id":"${vaultAccountId}"}' --accountId ${ownerAccountId} --deposit 0.00125`,
  );
  console.log("  2. install the scoped agent key: cd agent && npm run setup:agent");
  console.log(`  3. keep a small NEAR balance on ${vaultAccountId} for transfer and callback gas`);
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
