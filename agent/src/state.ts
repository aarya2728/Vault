import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentState, PositionState } from "./types.js";

const EMPTY: AgentState = {
  version: 1,
  lastRunMs: null,
  lastAction: null,
  position: null,
};

export async function loadState(file: string): Promise<AgentState> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentState>;
    return {
      version: 1,
      lastRunMs: typeof parsed.lastRunMs === "number" ? parsed.lastRunMs : null,
      lastAction: typeof parsed.lastAction === "string" ? parsed.lastAction : null,
      position: isPosition(parsed.position) ? parsed.position : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw error;
  }
}

export async function saveState(file: string, state: AgentState): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function isPosition(value: unknown): value is PositionState {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.depositAddress === "string" &&
    typeof p.destinationAsset === "string" &&
    typeof p.amount === "string" &&
    typeof p.minOut === "string" &&
    typeof p.expectedOut === "string" &&
    typeof p.openedAtMs === "number" &&
    typeof p.correlationId === "string" &&
    typeof p.quoteTimestamp === "string" &&
    typeof p.amountInUsd === "string" &&
    typeof p.amountOutUsd === "string"
  );
}
