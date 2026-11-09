import type { PositionState } from "./types.js";

/**
 * Yield estimation helpers — used for strategy decisions and logging only.
 *
 * These functions project what an external venue *would* earn at a given APY.
 * They do NOT drive settlement; settlement is driven by real 1Click status
 * polling and the vault's on-chain FT balance check.
 *
 * The external APY is a configurable assumption (EXTERNAL_APY_BPS), not a
 * claim about any specific live protocol. When a real venue adapter is added,
 * these projections can be compared against actual realized yield.
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

export interface VenueCandidate {
  id: string;
  name: string;
  chain: string;
  /** Gross venue APY before 1Click route cost. */
  apyBps: number;
  /** Estimated annualized route/settlement cost for this venue (bps). */
  routeCostBps: number;
  /** Ranking score: gross APY minus estimated route cost. */
  netApyBps: number;
}

const VENUE_TEMPLATES: Array<Omit<VenueCandidate, "apyBps" | "netApyBps"> & { apyDeltaBps: number }> = [
  { id: "morpho-arb", name: "Morpho Blue", chain: "Arbitrum", apyDeltaBps: 40, routeCostBps: 130 },
  { id: "fluid-arb", name: "Fluid", chain: "Arbitrum", apyDeltaBps: 10, routeCostBps: 105 },
  { id: "aave-arb", name: "Aave v3", chain: "Arbitrum", apyDeltaBps: -30, routeCostBps: 110 },
  { id: "compound-arb", name: "Compound v3", chain: "Arbitrum", apyDeltaBps: -60, routeCostBps: 95 },
  { id: "spark-eth", name: "Spark", chain: "Ethereum", apyDeltaBps: -80, routeCostBps: 160 },
];

/**
 * Rank simulated external venues around the configured baseline APY.
 *
 * The baseline (EXTERNAL_APY_BPS) is the operator's assumption. Each venue
 * applies a small, deterministic delta so the agent can demonstrate selecting
 * the best net opportunity after route costs without pretending these are live
 * protocol rates. A real adapter can replace this function later.
 */
export function rankVenues(baseApyBps: number): VenueCandidate[] {
  return VENUE_TEMPLATES.map((venue) => {
    const apyBps = Math.max(0, baseApyBps + venue.apyDeltaBps);
    return {
      id: venue.id,
      name: venue.name,
      chain: venue.chain,
      apyBps,
      routeCostBps: venue.routeCostBps,
      netApyBps: apyBps - venue.routeCostBps,
    };
  }).sort((left, right) => right.netApyBps - left.netApyBps);
}

export function bestVenue(baseApyBps: number): VenueCandidate {
  return rankVenues(baseApyBps)[0];
}
