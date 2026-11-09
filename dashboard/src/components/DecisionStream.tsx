import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { config } from "../lib/vault.js";
import { DEMO_DECISIONS, type DecisionLogEntry } from "../lib/demo.js";

const HEARTBEATS = [
  "Scanning NEAR native yield versus external stablecoin venues...",
  "Policy bounds satisfied. Waiting for the next spread window.",
  "Comparing 1Click route costs against the configured hurdle rate.",
  "No anomalous slippage detected. Circuit breaker armed.",
  "Vault snapshot refreshed. Capital stays within policy limits.",
];

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function logTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}

function utcOffset(): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function normalizeEntries(value: unknown): DecisionLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => {
      const flatMetrics =
        typeof item.netSpreadBps === "number"
          ? {
              nearApyBps: Number(item.nearApyBps ?? 0),
              externalApyBps: Number(item.externalApyBps ?? 0),
              annualizedCostBps: Number(item.annualizedCostBps ?? 0),
              netSpreadBps: Number(item.netSpreadBps),
              action:
                item.enter === true
                  ? ("APPROVED" as const)
                  : item.enter === false
                  ? ("HOLD" as const)
                  : ("HOLD" as const),
              amount: typeof item.amount === "string" ? item.amount : undefined,
              quoteId:
                typeof item.correlationId === "string"
                  ? item.correlationId.slice(0, 8)
                  : undefined,
            }
          : undefined;
      const metrics =
        typeof item.metrics === "object" && item.metrics !== null
          ? (item.metrics as DecisionLogEntry["metrics"])
          : flatMetrics;
      const level =
        item.level === "warn" || item.level === "error" ? item.level : "info";
      return {
        ts: String(item.ts ?? item.timestamp ?? new Date().toISOString()),
        level,
        event: String(item.event ?? "agent_cycle"),
        message: String(
          item.message ?? item.detail ?? item.reason ?? item.hint ?? item.event ?? "",
        ),
        metrics,
      } satisfies DecisionLogEntry;
    })
    .slice(0, 12);
}

export function DecisionStream() {
  const [liveEntries, setLiveEntries] = useState<DecisionLogEntry[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [pulse, setPulse] = useState<DecisionLogEntry[]>([]);

  useEffect(() => {
    if (!config.agentLogUrl) return;
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(config.agentLogUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const entries = normalizeEntries(await response.json());
        if (!cancelled) {
          setLiveEntries(entries);
          setFeedError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setFeedError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (config.agentLogUrl && liveEntries.length > 0) return;
    let index = 0;
    const timer = window.setInterval(() => {
      const message = HEARTBEATS[index % HEARTBEATS.length];
      index += 1;
      setPulse((current) => [
        {
          ts: new Date().toISOString(),
          level: "info" as const,
          event: "agent_heartbeat",
          message,
        },
        ...current,
      ].slice(0, 2));
    }, 9_000);
    return () => window.clearInterval(timer);
  }, [liveEntries.length]);

  const entries = useMemo(() => {
    if (liveEntries.length > 0) return liveEntries;
    return [...pulse, ...DEMO_DECISIONS].slice(0, 9);
  }, [liveEntries, pulse]);

  const mode = config.agentLogUrl
    ? feedError
      ? "DEMO FALLBACK"
      : "LIVE FEED"
    : "DEMO FEED";

  return (
    <section className="panel decision-panel">
      <header className="panel-header">
        <div>
          <h2>Agent Reasoning Stream</h2>
          <span className="panel-subtitle">
            Hourly evaluation loop · net spread gate · 1Click execution trace
          </span>
        </div>
        <span className={`stream-mode ${mode === "LIVE FEED" ? "live" : ""}`}>
          <span className="stream-dot" />
          {mode}
        </span>
      </header>

      <div className="decision-terminal">
        <div className="terminal-chrome">
          <span className="terminal-dot dot-red" />
          <span className="terminal-dot dot-amber" />
          <span className="terminal-dot dot-green" />
          <span className="terminal-title">vaultpilot-agent · strategy.ts</span>
          <span className="terminal-time">{utcOffset()}</span>
        </div>

        <div className="terminal-body" role="log" aria-live="polite">
          <AnimatePresence initial={false}>
            {entries.map((entry, index) => (
              <motion.div
                key={`${entry.ts}-${entry.event}-${index}`}
                className={`terminal-line terminal-${entry.level}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <span className="terminal-time">[{logTime(entry.ts)}]</span>
                <span className="terminal-event">{entry.event}</span>
                {entry.metrics && (
                  <span className="terminal-math">
                    <span className="math-chip external">
                      ext {pct(entry.metrics.externalApyBps)}
                    </span>
                    <span className="math-op">-</span>
                    <span className="math-chip near">
                      near {pct(entry.metrics.nearApyBps)}
                    </span>
                    <span className="math-op">-</span>
                    <span className="math-chip cost">
                      cost {pct(entry.metrics.annualizedCostBps)}
                    </span>
                    <span className="math-op">=</span>
                    <span className="math-chip net">
                      net {pct(entry.metrics.netSpreadBps)}
                    </span>
                    <span
                      className={`math-action action-${entry.metrics.action.toLowerCase()}`}
                    >
                      {entry.metrics.action}
                    </span>
                  </span>
                )}
                <span className="terminal-message">{entry.message}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="terminal-cursor">
            <span>vaultpilot@near:~$</span> <span className="cursor-block">▌</span>
          </div>
        </div>
      </div>

      {feedError && (
        <p className="muted small">
          Live log endpoint unavailable ({feedError}); showing the bundled demo stream.
        </p>
      )}
    </section>
  );
}
