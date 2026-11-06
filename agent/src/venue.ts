import type { PositionState } from "./types.js";

/**
 * The external yield venue is simulated. Only the Intents leg is real; the
 * external APY below is an assumption, not a claim about a live protocol.
 */
export function accruedYield(
  principal: bigint,
  apyBps: number,
  openedAtMs: number,
  nowMs: number = Date.now(),
): bigint {
  if (nowMs <= openedAtMs || apyBps <= 0) return 0n;
  const elapsedMs = BigInt(Math.floor(nowMs - openedAtMs));
  return (principal * BigInt(apyBps) * elapsedMs) / (10_000n * 365n * 86_400_000n);
}

export function expectedReturn(position: PositionState, apyBps: number, nowMs = Date.now()): bigint {
  return BigInt(position.amount) + accruedYield(BigInt(position.amount), apyBps, position.openedAtMs, nowMs);
}

export function holdDays(openedAtMs: number, nowMs = Date.now()): number {
  return (nowMs - openedAtMs) / 86_400_000;
}
