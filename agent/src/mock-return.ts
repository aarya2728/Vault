import { Account, JsonRpcProvider } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { loadConfig } from "./config.js";
import { getFtBalance, getSummary } from "./rpc.js";
import { loadState, saveState } from "./state.js";

/**
 * Demo helper, not part of the agent's trust boundary.
 *
 * The external venue is simulated. This script uses a separate treasury
 * account (full-access key) to send principal + simulated yield back to the
 * vault, so `rebalance_in` can recognize the return from the real FT balance.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const accountId = process.env.MOCK_RETURN_ACCOUNT?.trim();
  const privateKey = process.env.MOCK_RETURN_PRIVATE_KEY?.trim();

  if (!accountId || !privateKey) {
    throw new Error("set MOCK_RETURN_ACCOUNT and MOCK_RETURN_PRIVATE_KEY (treasury, full access)");
  }
  if (accountId === config.agentAccount) {
    throw new Error("MOCK_RETURN_ACCOUNT must be a treasury account, not the scoped agent");
  }

  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const state = await loadState(config.stateFile);
  if (!state.position) {
    throw new Error(`no open position in ${config.stateFile}; nothing to return`);
  }

  const summary = await getSummary(provider, config.vaultContract);
  if (BigInt(summary.deployed_assets) === 0n) {
    throw new Error("vault reports no deployed assets; position may already be closed");
  }

  const principal = BigInt(state.position.amount);
  const simulatedYield = (principal * BigInt(config.mockYieldBps)) / 10_000n;
  const amount = principal + simulatedYield;
  const before = await getFtBalance(provider, summary.token, config.vaultContract);

  const treasury = new Account(accountId, provider, privateKey as KeyPairString);
  const result = await treasury.callFunction({
    contractId: summary.token,
    methodName: "ft_transfer",
    args: {
      receiver_id: config.vaultContract,
      amount: amount.toString(),
      memo: "VaultPilot simulated external return",
    },
    gas: 30_000_000_000_000n,
    deposit: 1n,
  });

  const after = await getFtBalance(provider, summary.token, config.vaultContract);

  state.lastAction = "mock_return_sent";
  await saveState(config.stateFile, state);

  console.log(
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        event: "mock_return_sent",
        from: accountId,
        to: config.vaultContract,
        token: summary.token,
        principal: principal.toString(),
        simulatedYield: simulatedYield.toString(),
        mockYieldBps: config.mockYieldBps,
        amount: amount.toString(),
        vaultBalanceBefore: before.toString(),
        vaultBalanceAfter: after.toString(),
        depositAddress: state.position.depositAddress,
        result,
        next: "run the agent once to call rebalance_in (AUTO_CLOSE_MOCK=true), or wait for its next cycle",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "mock_return_failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
