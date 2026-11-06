import { loadConfig } from "./config.js";
import {
  callRebalanceIn,
  callRebalanceOut,
  createAgentAccount,
  createProvider,
  getFtBalance,
  getGasPrice,
  getSummary,
} from "./rpc.js";
import { requestQuote } from "./intents.js";
import { Logger } from "./logger.js";
import { loadState, saveState } from "./state.js";
import { computeDecision } from "./strategy.js";
import { expectedReturn, accruedYield, holdDays } from "./venue.js";
import { assertScopedKey, inspectAgentKey } from "./wallet.js";

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfig();
  const logger = new Logger(config.logFile);
  const provider = createProvider(config);

  await logger.info("agent_start", {
    network: config.nearNetwork,
    vault: config.vaultContract,
    agent: config.agentAccount,
    dryRun: config.dryRun,
    quoteDry: config.quoteDry,
    originAsset: config.originAsset,
    destinationAsset: config.destinationAsset,
    rebalanceAmount: config.rebalanceAmount.toString(),
    pollIntervalMs: config.pollIntervalMs,
  });

  if (!config.dryRun) {
    const scope = await inspectAgentKey(config, provider);
    assertScopedKey(config, scope);
    await logger.info("agent_key_ok", {
      publicKey: scope?.publicKey,
      receiverId: scope?.receiverId,
      methodNames: scope?.methodNames,
      allowance: scope?.allowance,
    });
  } else {
    await logger.warn("dry_run_enabled", {
      note: "No transactions will be sent. Quotes are real mainnet quotes.",
    });
  }

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    try {
      await runOnce(config, provider, logger);
    } catch (error) {
      await logger.error("cycle_failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (once) process.exitCode = 1;
    }

    if (once) break;
    await sleep(config.pollIntervalMs);
  }

  await logger.info("agent_stop");
}

async function runOnce(
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: ReturnType<typeof createProvider>,
  logger: Logger,
): Promise<void> {
  const state = await loadState(config.stateFile);
  const [summary, gasPrice] = await Promise.all([
    getSummary(provider, config.vaultContract),
    getGasPrice(provider),
  ]);

  const idle = BigInt(summary.idle_assets);
  const deployed = BigInt(summary.deployed_assets);
  state.lastRunMs = Date.now();

  await logger.info("vault_snapshot", {
    paused: summary.paused,
    agentEnabled: summary.agent_enabled,
    totalAssets: summary.total_assets,
    idleAssets: summary.idle_assets,
    deployedAssets: summary.deployed_assets,
    dailyMoved: summary.daily_moved,
    gasPriceYoctoPerGas: gasPrice.toString(),
  });

  if (summary.paused || !summary.agent_enabled) {
    await logger.warn("agent_inactive", {
      paused: summary.paused,
      agentEnabled: summary.agent_enabled,
      hint: "owner must unpause or enable the agent",
    });
    await saveState(config.stateFile, state);
    return;
  }

  if (deployed > 0n) {
    await handleOpenPosition(config, provider, logger, state, summary.token, idle);
    await saveState(config.stateFile, state);
    return;
  }

  const policyMin = BigInt(summary.policy.min_move);
  const policyMax = BigInt(summary.policy.max_per_move);
  const dailyCap = BigInt(summary.policy.daily_cap);
  const today = Math.floor(Date.now() / 86_400_000);
  const dailyRemaining =
    summary.today_bucket === today
      ? dailyCap > BigInt(summary.daily_moved)
        ? dailyCap - BigInt(summary.daily_moved)
        : 0n
      : dailyCap;

  let amount = config.rebalanceAmount;
  for (const limit of [idle, policyMax, dailyRemaining]) {
    if (amount > limit) amount = limit;
  }

  if (amount < policyMin) {
    await logger.warn("skip_small_balance", {
      idle: idle.toString(),
      amount: amount.toString(),
      minMove: policyMin.toString(),
      maxPerMove: policyMax.toString(),
      dailyRemaining: dailyRemaining.toString(),
    });
    await saveState(config.stateFile, state);
    return;
  }

  const quoteResponse = await requestQuote(
    config,
    amount,
    Math.min(config.slippageBps, summary.policy.max_slippage_bps),
  );
  const quote = quoteResponse.quote;
  const decision = computeDecision({
    summary,
    amount,
    quote,
    gasPriceYoctoPerGas: gasPrice,
    nearApyBps: config.nearApyBps,
    externalApyBps: config.externalApyBps,
    holdDays: config.holdDays,
    minSpreadBps: config.minSpreadBps,
    nearUsd: config.nearUsd,
    gasUnits: config.gasUnits,
  });

  await logger.info("strategy_decision", {
    enter: decision.enter,
    reason: decision.reason,
    netSpreadBps: decision.netSpreadBps,
    costBps: decision.costBps,
    annualizedCostBps: decision.annualizedCostBps,
    gasCostBps: decision.gasCostBps,
    amountInUsd: decision.amountInUsd,
    amountOutUsd: decision.amountOutUsd,
    amountOut: quote.amountOutFormatted,
    minAmountOut: quote.minAmountOut,
    depositAddress: quote.depositAddress ?? null,
    timeEstimate: quote.timeEstimate ?? null,
    correlationId: quoteResponse.correlationId,
  });

  if (!decision.enter) {
    state.lastAction = "hold";
    await saveState(config.stateFile, state);
    return;
  }

  if (config.dryRun) {
    state.lastAction = "would_enter";
    await logger.info("dry_run_would_enter", {
      note: "Set DRY_RUN=false on a funded mainnet vault to execute this move.",
      depositAddress: quote.depositAddress ?? null,
      minOut: decision.minAmountOut.toString(),
    });
    await saveState(config.stateFile, state);
    return;
  }

  if (!quote.depositAddress) {
    throw new Error("live quote did not include a depositAddress");
  }

  const account = createAgentAccount(config, provider);
  if (!account) throw new Error("agent account is not configured");

  await callRebalanceOut(account, config.vaultContract, {
    amount,
    destinationAsset: config.destinationAsset,
    depositAddress: quote.depositAddress,
    minOut: decision.minAmountOut,
    reason: decision.reason,
  });

  state.position = {
    depositAddress: quote.depositAddress,
    destinationAsset: config.destinationAsset,
    amount: amount.toString(),
    minOut: decision.minAmountOut.toString(),
    expectedOut: decision.amountOut.toString(),
    openedAtMs: Date.now(),
    correlationId: quoteResponse.correlationId,
    quoteTimestamp: quoteResponse.timestamp,
    amountInUsd: quote.amountInUsd,
    amountOutUsd: quote.amountOutUsd,
  };
  state.lastAction = "rebalance_out";
  await saveState(config.stateFile, state);

  await logger.info("rebalance_out_sent", {
    depositAddress: quote.depositAddress,
    amount: amount.toString(),
    minOut: decision.minAmountOut.toString(),
    correlationId: quoteResponse.correlationId,
  });
}

async function handleOpenPosition(
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: ReturnType<typeof createProvider>,
  logger: Logger,
  state: Awaited<ReturnType<typeof loadState>>,
  token: string,
  idle: bigint,
): Promise<void> {
  const position = state.position;
  if (!position) {
    await logger.warn("position_without_local_state", {
      hint: "rebalance_in needs no local data; inspect get_rebalances and the vault FT balance",
    });
    return;
  }

  const principal = BigInt(position.amount);
  const yieldEarned = accruedYield(principal, config.externalApyBps, position.openedAtMs);
  const expected = expectedReturn(position, config.externalApyBps);
  const requiredBalance = idle + principal;
  const elapsedMs = Date.now() - position.openedAtMs;
  const actual = await getFtBalance(provider, token, config.vaultContract);

  await logger.info("position_open", {
    depositAddress: position.depositAddress,
    principal: position.amount,
    expectedOut: position.expectedOut,
    simulatedYield: yieldEarned.toString(),
    expectedReturn: expected.toString(),
    daysOpen: holdDays(position.openedAtMs).toFixed(2),
    elapsedMs,
    maxMs: config.positionMaxMs,
    vaultFtBalance: actual.toString(),
  });

  if (elapsedMs < config.positionMaxMs) {
    state.lastAction = "position_open";
    return;
  }

  if (config.dryRun) {
    state.lastAction = "would_close";
    await logger.info("dry_run_would_close", {
      note: "Funds must be returned to the vault before rebalance_in can recognize them.",
      requiredFtBalance: requiredBalance.toString(),
      expectedReturn: expected.toString(),
      actualFtBalance: actual.toString(),
    });
    return;
  }

  if (!config.autoCloseMock) {
    state.lastAction = "awaiting_mock_return";
    await logger.warn("awaiting_mock_return", {
      hint: "run `npm --prefix agent run mock:return` after the external leg is back, then set AUTO_CLOSE_MOCK=true",
      vaultFtBalance: actual.toString(),
      expectedReturn: expected.toString(),
    });
    return;
  }

  if (actual < requiredBalance) {
    state.lastAction = "awaiting_mock_return";
    await logger.warn("funds_not_back", {
      vaultFtBalance: actual.toString(),
      idle: idle.toString(),
      requiredBalance: requiredBalance.toString(),
      expectedReturn: expected.toString(),
      hint: "contract requires the return to cover deployed principal; waiting",
    });
    return;
  }

  const account = createAgentAccount(config, provider);
  if (!account) throw new Error("agent account is not configured");

  await callRebalanceIn(
    account,
    config.vaultContract,
    `mock venue returned ${holdDays(position.openedAtMs).toFixed(1)}d of simulated yield`,
  );

  state.position = null;
  state.lastAction = "rebalance_in";
  await logger.info("rebalance_in_sent", {
    depositAddress: position.depositAddress,
    vaultFtBalanceBefore: actual.toString(),
    note: "contract recomputes total_assets from the real FT balance",
  });
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "fatal",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  process.exitCode = 1;
});
