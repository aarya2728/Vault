import type { StrategyDecision, StrategyInput } from "./types.js";

export function bpsOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 10_000;
}

export function computeDecision(input: StrategyInput): StrategyDecision {
  const {
    quote,
    gasPriceYoctoPerGas,
    nearApyBps,
    externalApyBps,
    holdDays,
    minSpreadBps,
    nearUsd,
    gasUnits,
  } = input;

  const amountOut = BigInt(quote.amountOut);
  const minAmountOut = BigInt(quote.minAmountOut);
  if (amountOut <= 0n || minAmountOut <= 0n) {
    throw new Error("quote returned a non-positive output amount");
  }

  const amountInUsd = Number(quote.amountInUsd);
  const amountOutUsd = Number(quote.amountOutUsd);
  if (!Number.isFinite(amountInUsd) || amountInUsd <= 0) {
    throw new Error("quote is missing a usable amountInUsd");
  }

  const priceCostBps = bpsOf(amountInUsd - amountOutUsd, amountInUsd);
  const gasUsd = (Number(gasUnits) * Number(gasPriceYoctoPerGas) * nearUsd) / 1e24;
  const gasCostBps = bpsOf(gasUsd, amountInUsd);
  const costBps = priceCostBps + gasCostBps;
  const annualizedCostBps = (costBps * 365) / Math.max(holdDays, 1);
  const netSpreadBps = externalApyBps - nearApyBps - annualizedCostBps;
  const enter = netSpreadBps > minSpreadBps;

  const reason = [
    `spread ${netSpreadBps.toFixed(0)}bps > ${minSpreadBps}bps`,
    `apy ${externalApyBps} vs ${nearApyBps}`,
    `cost ${costBps.toFixed(0)}bps annualized ${annualizedCostBps.toFixed(0)}bps`,
    `out ${quote.amountOutFormatted ?? quote.amountOut}`,
  ].join("; ");

  return {
    enter,
    reason: reason.slice(0, 280),
    costBps,
    gasCostBps,
    annualizedCostBps,
    netSpreadBps,
    amountOut,
    minAmountOut,
    amountInUsd,
    amountOutUsd,
  };
}
