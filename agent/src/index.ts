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
import { getStatus, requestQuote, requestReturnQuote } from "./intents.js";
import { Logger } from "./logger.js";
import { loadState, saveState } from "./state.js";
import { computeDecision } from "./strategy.js";
import {
  expectedReturn,
  accruedYield,
  holdDays,
  rankVenues,
} from "./venue.js";
import { assertScopedKey, inspectAgentKey } from "./wallet.js";
import type { AgentConfig, PositionPhase, PositionState, VaultSummary } from "./types.js";
import type { JsonRpcProvider } from "near-api-js";
import type { AgentState } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
    statusPollIntervalMs: config.statusPollIntervalMs,
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

  // Reconcile local state with on-chain state at startup
  const startupState = await loadState(config.stateFile);
  const startupSummary = await getSummary(provider, config.vaultContract);
  await reconcileOnStartup(config, logger, startupState, startupSummary);

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    let nextPollMs = config.pollIntervalMs;
    try {
      nextPollMs = await runOnce(config, provider, logger);
    } catch (error) {
      await logger.error("cycle_failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (once) process.exitCode = 1;
    }

    if (once) break;
    await sleep(nextPollMs);
  }

  await logger.info("agent_stop");
}

// ---------------------------------------------------------------------------
// On-chain reconciliation at startup
// ---------------------------------------------------------------------------

async function reconcileOnStartup(
  config: AgentConfig,
  logger: Logger,
  state: AgentState,
  summary: VaultSummary,
): Promise<void> {
  const onChainPending = summary.pending_move;
  const localPosition = state.position;

  if (onChainPending && !localPosition) {
    // Chain has a pending move but local state lost it (agent restarted)
    await logger.warn("reconcile_recovered_position", {
      pendingMove: onChainPending,
      hint: "agent may have restarted mid-cycle; recovering position from on-chain data",
    });
    state.position = {
      depositAddress: onChainPending.deposit_address,
      destinationAsset: onChainPending.destination_asset,
      amount: onChainPending.amount.toString(),
      minOut: onChainPending.min_out.toString(),
      expectedOut: onChainPending.min_out.toString(),
      openedAtMs: onChainPending.opened_at_ms,
      correlationId: "recovered-from-chain",
      quoteTimestamp: new Date(onChainPending.opened_at_ms).toISOString(),
      amountInUsd: "0",
      amountOutUsd: "0",
      phase: "outbound_pending",
      statusPollCount: 0,
    };
    state.lastAction = "reconciled_from_chain";
    await saveState(config.stateFile, state);
  } else if (!onChainPending && localPosition && BigInt(summary.deployed_assets) === 0n) {
    // Chain shows no pending move and no deployed assets, but local state thinks there's a position
    await logger.warn("reconcile_cleared_stale_position", {
      localPosition,
      hint: "chain has no pending move and deployed_assets=0; position may have been settled externally or via emergency_reset_position",
    });
    state.position = null;
    state.lastAction = "reconciled_clear";
    await saveState(config.stateFile, state);
  } else if (onChainPending && localPosition) {
    // Both exist — make sure local phase tracking is initialized
    if (!localPosition.phase) {
      localPosition.phase = "outbound_pending";
      localPosition.statusPollCount = localPosition.statusPollCount ?? 0;
      await logger.info("reconcile_initialized_phase", {
        hint: "migrated pre-v2 position to phase-tracked state machine",
      });
      await saveState(config.stateFile, state);
    }
  }
}

// ---------------------------------------------------------------------------
// Run one cycle — returns the desired next poll interval (ms)
// ---------------------------------------------------------------------------

async function runOnce(
  config: AgentConfig,
  provider: JsonRpcProvider,
  logger: Logger,
): Promise<number> {
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
    pendingMove: summary.pending_move ? summary.pending_move.status : null,
    gasPriceYoctoPerGas: gasPrice.toString(),
  });

  if (summary.paused || !summary.agent_enabled) {
    await logger.warn("agent_inactive", {
      paused: summary.paused,
      agentEnabled: summary.agent_enabled,
      hint: "owner must unpause or enable the agent",
    });
    await saveState(config.stateFile, state);
    return config.pollIntervalMs;
  }

  if (deployed > 0n || state.position) {
    const nextPoll = await handleOpenPosition(config, provider, logger, state, summary.token, idle);
    await saveState(config.stateFile, state);
    return nextPoll;
  }

  // Self-protective circuit breaker: stop opening new positions during a
  // persistent anomaly window. Open positions continue to settle above.
  if (state.breakerTrippedAtMs) {
    const elapsed = Date.now() - state.breakerTrippedAtMs;
    if (elapsed < config.circuitBreakerCooldownMs) {
      await logger.error("circuit_breaker_active", {
        trippedAt: new Date(state.breakerTrippedAtMs).toISOString(),
        reason: state.breakerReason,
        remainingMs: config.circuitBreakerCooldownMs - elapsed,
        hint: "agent is self-paused; no new entries until cooldown elapses",
      });
      state.lastAction = "circuit_breaker_active";
      await saveState(config.stateFile, state);
      return config.pollIntervalMs;
    }

    await logger.info("circuit_breaker_cooldown_elapsed", {
      trippedAt: new Date(state.breakerTrippedAtMs).toISOString(),
      reason: state.breakerReason,
      cooldownMs: config.circuitBreakerCooldownMs,
      hint: "resuming evaluation with a fresh anomaly streak",
    });
    state.breakerTrippedAtMs = null;
    state.breakerReason = null;
    state.anomalyStreak = 0;
  }

  // -------------------------------------------------------------------------
  // No position open — evaluate whether to enter
  // -------------------------------------------------------------------------

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
    return config.pollIntervalMs;
  }

  const venueRanking = rankVenues(config.externalApyBps);
  const selectedVenue = venueRanking[0];

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
    externalApyBps: selectedVenue.apyBps,
    holdDays: config.holdDays,
    minSpreadBps: config.minSpreadBps,
    nearUsd: config.nearUsd,
    gasUnits: config.gasUnits,
  });

  const anomaly =
    decision.costBps > config.anomalyCostBps ||
    decision.gasCostBps > config.anomalyGasCostBps;

  await logger.info("strategy_decision", {
    enter: decision.enter,
    reason: decision.reason,
    nearApyBps: config.nearApyBps,
    externalApyBps: selectedVenue.apyBps,
    configuredExternalApyBps: config.externalApyBps,
    selectedVenue: selectedVenue.id,
    selectedVenueName: selectedVenue.name,
    selectedVenueChain: selectedVenue.chain,
    venueRanking,
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
    anomaly,
    anomalyStreak: state.anomalyStreak ?? 0,
    anomalyThresholds: {
      costBps: config.anomalyCostBps,
      gasCostBps: config.anomalyGasCostBps,
    },
  });

  if (anomaly) {
    state.anomalyStreak = (state.anomalyStreak ?? 0) + 1;
    await logger.warn("anomaly_detected", {
      streak: state.anomalyStreak,
      threshold: config.circuitBreakerThreshold,
      quoteCostBps: decision.costBps,
      gasCostBps: decision.gasCostBps,
      maxCostBps: config.anomalyCostBps,
      maxGasCostBps: config.anomalyGasCostBps,
      hint:
        state.anomalyStreak >= config.circuitBreakerThreshold
          ? "trip threshold reached; self-pausing new entries"
          : "watching for a persistent slippage/gas anomaly",
    });

    if (state.anomalyStreak >= config.circuitBreakerThreshold) {
      state.breakerTrippedAtMs = Date.now();
      state.breakerReason = `consecutive anomalies (${state.anomalyStreak}): quote cost ${decision.costBps.toFixed(
        0,
      )}bps, gas ${decision.gasCostBps.toFixed(0)}bps`;
      state.lastAction = "circuit_breaker_tripped";
      await logger.error("circuit_breaker_tripped", {
        reason: state.breakerReason,
        cooldownMs: config.circuitBreakerCooldownMs,
        hint: "no new entries; existing positions continue to settle",
      });
      await saveState(config.stateFile, state);
      return config.pollIntervalMs;
    }
  } else if ((state.anomalyStreak ?? 0) > 0) {
    await logger.info("anomaly_streak_reset", {
      previousStreak: state.anomalyStreak,
      quoteCostBps: decision.costBps,
      gasCostBps: decision.gasCostBps,
    });
    state.anomalyStreak = 0;
  }

  if (!decision.enter) {
    state.lastAction = "hold";
    await saveState(config.stateFile, state);
    return config.pollIntervalMs;
  }

  if (config.dryRun) {
    state.lastAction = "would_enter";
    await logger.info("dry_run_would_enter", {
      note: "Set DRY_RUN=false on a funded mainnet vault to execute this move.",
      depositAddress: quote.depositAddress ?? null,
      minOut: decision.minAmountOut.toString(),
    });
    await saveState(config.stateFile, state);
    return config.pollIntervalMs;
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
    phase: "outbound_pending",
    statusPollCount: 0,
  };
  state.lastAction = "rebalance_out";
  await saveState(config.stateFile, state);

  await logger.info("rebalance_out_sent", {
    depositAddress: quote.depositAddress,
    amount: amount.toString(),
    minOut: decision.minAmountOut.toString(),
    correlationId: quoteResponse.correlationId,
    phase: "outbound_pending",
  });

  // Poll quickly for initial status
  return config.statusPollIntervalMs;
}

// ---------------------------------------------------------------------------
// Phase-based open position handler
// ---------------------------------------------------------------------------

async function handleOpenPosition(
  config: AgentConfig,
  provider: JsonRpcProvider,
  logger: Logger,
  state: AgentState,
  token: string,
  idle: bigint,
): Promise<number> {
  const position = state.position;
  if (!position) {
    await logger.warn("position_without_local_state", {
      hint: "on-chain deployed_assets > 0 but no local position; run reconciliation or call emergency_reset_position",
    });
    return config.pollIntervalMs;
  }

  // Backward compat: positions created before phase tracking default to outbound_pending
  const phase: PositionPhase = position.phase ?? "outbound_pending";

  switch (phase) {
    case "outbound_pending":
      return handleOutboundPending(config, provider, logger, state, position);

    case "outbound_completed":
      return handleOutboundCompleted(config, provider, logger, state, position, token, idle);

    case "awaiting_return":
      return handleAwaitingReturn(config, provider, logger, state, position, token, idle);

    case "settling":
      return handleSettling(config, provider, logger, state, position, token, idle);

    default:
      await logger.error("unknown_position_phase", { phase });
      return config.pollIntervalMs;
  }
}

// ---------------------------------------------------------------------------
// Phase: outbound_pending — poll 1Click status for the outbound swap
// ---------------------------------------------------------------------------

async function handleOutboundPending(
  config: AgentConfig,
  provider: JsonRpcProvider,
  logger: Logger,
  state: AgentState,
  position: PositionState,
): Promise<number> {
  const pollCount = (position.statusPollCount ?? 0) + 1;
  position.statusPollCount = pollCount;

  try {
    const status = await getStatus(config, position.depositAddress);

    await logger.info("outbound_status_poll", {
      depositAddress: position.depositAddress,
      status: status.status,
      pollCount,
      updatedAt: status.updatedAt,
      swapDetails: status.swapDetails
        ? {
            intentHashes: status.swapDetails.intentHashes,
            amountOut: status.swapDetails.amountOut,
            amountOutFormatted: status.swapDetails.amountOutFormatted,
          }
        : null,
    });

    if (status.status === "SUCCESS") {
      position.phase = "outbound_completed";
      position.outboundSwapDetails = status.swapDetails ?? undefined;
      state.lastAction = "outbound_confirmed";

      await logger.info("outbound_confirmed", {
        depositAddress: position.depositAddress,
        correlationId: position.correlationId,
        intentHashes: status.swapDetails?.intentHashes,
        nearTxHashes: status.swapDetails?.nearTxHashes,
        destinationChainTxHashes: status.swapDetails?.destinationChainTxHashes,
        amountIn: status.swapDetails?.amountIn,
        amountOut: status.swapDetails?.amountOut,
        amountOutFormatted: status.swapDetails?.amountOutFormatted,
        pollsRequired: pollCount,
      });

      // Transition quickly to next phase
      return config.statusPollIntervalMs;
    }

    if (status.status === "FAILED" || status.status === "REFUNDED") {
      const summary = await getSummary(provider, config.vaultContract);
      const stillDeployed = BigInt(summary.deployed_assets) > 0n;

      if (!stillDeployed) {
        state.lastAction = `outbound_${status.status.toLowerCase()}_reverted`;
        await logger.warn("outbound_failed_reverted", {
          depositAddress: position.depositAddress,
          correlationId: position.correlationId,
          status: status.status,
          hint: "on-chain deployed_assets is zero; the transfer callback reverted accounting, so the local position is cleared",
        });
        state.position = null;
        return config.pollIntervalMs;
      }

      // The outbound deposit left the vault, so on-chain deployed_assets is still
      // positive. Keep the position and watch the vault FT balance for a refund
      // instead of clearing local state and looping on position_without_local_state.
      position.phase = "awaiting_return";
      state.lastAction = `outbound_${status.status.toLowerCase()}_awaiting_refund`;
      await logger.warn("outbound_failed_awaiting_refund", {
        depositAddress: position.depositAddress,
        correlationId: position.correlationId,
        status: status.status,
        deployedAssets: summary.deployed_assets,
        refundedAmount: status.swapDetails?.refundedAmount,
        hint: "waiting for a 1Click refund to the vault; if no refund arrives, the owner must inspect and use emergency_reset_position",
      });
      return 0;
    }

    // Still processing (KNOWN_DEPOSIT_TX, PENDING_DEPOSIT, INCOMPLETE_DEPOSIT, PROCESSING)
    state.lastAction = `outbound_polling_${status.status.toLowerCase()}`;

    if (pollCount >= config.statusPollMaxRetries) {
      await logger.warn("outbound_poll_timeout", {
        pollCount,
        lastStatus: status.status,
        hint: "exceeded max retries but will keep polling; check 1Click dashboard",
        depositAddress: position.depositAddress,
      });
    }
  } catch (error) {
    await logger.warn("outbound_status_poll_error", {
      pollCount,
      message: error instanceof Error ? error.message : String(error),
      hint: "will retry on next cycle",
    });
  }

  // Continue polling at the fast interval
  return config.statusPollIntervalMs;
}

// ---------------------------------------------------------------------------
// Phase: outbound_completed — wait for hold period, then request return quote
// ---------------------------------------------------------------------------

async function handleOutboundCompleted(
  config: AgentConfig,
  provider: JsonRpcProvider,
  logger: Logger,
  state: AgentState,
  position: PositionState,
  token: string,
  idle: bigint,
): Promise<number> {
  const principal = BigInt(position.amount);
  const elapsedMs = Date.now() - position.openedAtMs;
  const projectedYield = accruedYield(principal, config.externalApyBps, position.openedAtMs);
  const projected = expectedReturn(position, config.externalApyBps);

  await logger.info("outbound_completed_holding", {
    depositAddress: position.depositAddress,
    principal: position.amount,
    projectedYield: projectedYield.toString(),
    projectedReturn: projected.toString(),
    daysOpen: holdDays(position.openedAtMs).toFixed(2),
    elapsedMs,
    maxMs: config.positionMaxMs,
    outboundIntentHashes: position.outboundSwapDetails?.intentHashes,
  });

  if (elapsedMs < config.positionMaxMs) {
    state.lastAction = "outbound_completed_holding";
    return config.pollIntervalMs;
  }

  // Hold period elapsed — request a return quote to prove the return path
  if (!position.returnQuote) {
    try {
      const returnQuoteResponse = await requestReturnQuote(config, principal);
      position.returnQuote = {
        depositAddress: returnQuoteResponse.quote.depositAddress ?? "",
        correlationId: returnQuoteResponse.correlationId,
        amountOut: returnQuoteResponse.quote.amountOut,
        minAmountOut: returnQuoteResponse.quote.minAmountOut,
        timestamp: returnQuoteResponse.timestamp,
      };

      await logger.info("return_quote_obtained", {
        returnPath: `${config.destinationAsset} → ${config.originAsset}`,
        returnAmountOut: returnQuoteResponse.quote.amountOutFormatted,
        returnMinOut: returnQuoteResponse.quote.minAmountOut,
        returnDepositAddress: returnQuoteResponse.quote.depositAddress ?? "dry-quote",
        correlationId: returnQuoteResponse.correlationId,
      });
    } catch (error) {
      await logger.warn("return_quote_failed", {
        message: error instanceof Error ? error.message : String(error),
        hint: "return quote is informational; settlement proceeds based on vault FT balance",
      });
    }
  }

  // Transition to awaiting_return
  position.phase = "awaiting_return";
  state.lastAction = "awaiting_return";
  return config.statusPollIntervalMs;
}

// ---------------------------------------------------------------------------
// Phase: awaiting_return — monitor vault FT balance for returned funds
// ---------------------------------------------------------------------------

async function handleAwaitingReturn(
  config: AgentConfig,
  provider: JsonRpcProvider,
  logger: Logger,
  state: AgentState,
  position: PositionState,
  token: string,
  idle: bigint,
): Promise<number> {
  const principal = BigInt(position.amount);
  const actual = await getFtBalance(provider, token, config.vaultContract);
  const requiredBalance = idle + principal;
  const elapsedMs = Date.now() - position.openedAtMs;

  await logger.info("awaiting_return", {
    depositAddress: position.depositAddress,
    principal: position.amount,
    daysOpen: holdDays(position.openedAtMs).toFixed(2),
    elapsedMs,
    vaultFtBalance: actual.toString(),
    idleAssets: idle.toString(),
    requiredBalance: requiredBalance.toString(),
    hasReturnQuote: !!position.returnQuote,
    outboundIntentHashes: position.outboundSwapDetails?.intentHashes,
  });

  if (actual >= requiredBalance) {
    await logger.info("funds_returned_to_vault", {
      actualBalance: actual.toString(),
      requiredBalance: requiredBalance.toString(),
      surplus: (actual - requiredBalance).toString(),
      hint: "transitioning to settling phase",
    });

    position.phase = "settling";
    state.lastAction = "funds_returned";
    return 0; // settle immediately on next iteration
  }

  // Funds not back yet
  if (config.dryRun) {
    state.lastAction = "dry_run_awaiting_return";
    await logger.info("dry_run_awaiting_return", {
      note: "In live mode, the 1Click return swap would deposit funds back to the vault.",
      requiredFtBalance: requiredBalance.toString(),
      actualFtBalance: actual.toString(),
      returnQuote: position.returnQuote ?? null,
    });
    return config.pollIntervalMs;
  }

  state.lastAction = "awaiting_return";
  return config.statusPollIntervalMs;
}

// ---------------------------------------------------------------------------
// Phase: settling — funds are back, call rebalance_in
// ---------------------------------------------------------------------------

async function handleSettling(
  config: AgentConfig,
  provider: JsonRpcProvider,
  logger: Logger,
  state: AgentState,
  position: PositionState,
  token: string,
  idle: bigint,
): Promise<number> {
  const principal = BigInt(position.amount);
  const actual = await getFtBalance(provider, token, config.vaultContract);
  const requiredBalance = idle + principal;

  // Double-check balance before settling
  if (actual < requiredBalance) {
    await logger.warn("settle_balance_insufficient", {
      vaultFtBalance: actual.toString(),
      requiredBalance: requiredBalance.toString(),
      hint: "balance dropped below required; reverting to awaiting_return",
    });
    position.phase = "awaiting_return";
    state.lastAction = "settle_deferred";
    return config.statusPollIntervalMs;
  }

  if (config.dryRun) {
    state.lastAction = "would_settle";
    await logger.info("dry_run_would_settle", {
      note: "Set DRY_RUN=false to execute rebalance_in.",
      vaultFtBalance: actual.toString(),
      requiredBalance: requiredBalance.toString(),
      surplus: (actual - requiredBalance).toString(),
    });
    return config.pollIntervalMs;
  }

  const account = createAgentAccount(config, provider);
  if (!account) throw new Error("agent account is not configured");

  // Build a descriptive reason with real swap data
  const parts: string[] = [];
  if (position.outboundSwapDetails?.intentHashes?.length) {
    parts.push(`intents:${position.outboundSwapDetails.intentHashes.join(",")}`);
  }
  if (position.outboundSwapDetails?.nearTxHashes?.length) {
    parts.push(`tx:${position.outboundSwapDetails.nearTxHashes[0]}`);
  }
  if (position.outboundSwapDetails?.amountOutFormatted) {
    parts.push(`out:${position.outboundSwapDetails.amountOutFormatted}`);
  }
  parts.push(`${holdDays(position.openedAtMs).toFixed(1)}d`);
  if (position.returnQuote) {
    parts.push(`return-quote:${position.returnQuote.correlationId.slice(0, 8)}`);
  }
  const reason = `1Click round-trip: ${parts.join("; ")}`.slice(0, 280);

  await callRebalanceIn(account, config.vaultContract, reason);

  const settled = {
    depositAddress: position.depositAddress,
    correlationId: position.correlationId,
    principal: position.amount,
    vaultFtBalanceBefore: actual.toString(),
    surplus: (actual - requiredBalance).toString(),
    daysOpen: holdDays(position.openedAtMs).toFixed(2),
    outboundIntentHashes: position.outboundSwapDetails?.intentHashes,
    outboundAmountOut: position.outboundSwapDetails?.amountOut,
    returnQuoteCorrelation: position.returnQuote?.correlationId,
    reason,
  };

  state.position = null;
  state.lastAction = "rebalance_in";
  await logger.info("rebalance_in_sent", settled);

  return config.pollIntervalMs;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

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
