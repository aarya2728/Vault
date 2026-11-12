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
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <span className="vp-dot" />
          <span>Agent Reasoning Stream</span>
          <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 400 }}>
            vaultpilot-agent • strategy.ts ({utcOffset()})
          </span>
        </div>
        <span className={`vp-badge ${mode === "LIVE FEED" ? "vp-badge-emerald" : ""}`}>
          <span className="vp-dot" />
          <span>{mode}</span>
        </span>
      </header>

      <div
        className="vp-inset-panel mono"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          fontSize: "0.74rem",
          maxHeight: "340px",
          overflowY: "auto",
        }}
        role="log"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {entries.map((entry, index) => (
            <motion.div
              key={`${entry.ts}-${entry.event}-${index}`}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.55rem",
                padding: "0.4rem 0",
                borderBottom: "1px solid var(--border)",
              }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
            >
              <span style={{ color: "var(--muted)" }}>[{logTime(entry.ts)}]</span>
              <span className={`vp-badge ${entry.level === "warn" ? "vp-badge-amber" : entry.level === "error" ? "vp-badge-red" : "vp-badge-emerald"}`}>
                {entry.event}
              </span>
              {entry.metrics && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                  <span className="vp-badge">ext {pct(entry.metrics.externalApyBps)}</span>
                  <span style={{ color: "var(--muted)" }}>-</span>
                  <span className="vp-badge">near {pct(entry.metrics.nearApyBps)}</span>
                  <span style={{ color: "var(--muted)" }}>-</span>
                  <span className="vp-badge">cost {pct(entry.metrics.annualizedCostBps)}</span>
                  <span style={{ color: "var(--muted)" }}>=</span>
                  <span className="vp-badge vp-badge-emerald">net {pct(entry.metrics.netSpreadBps)}</span>
                  <span className={`vp-badge ${entry.metrics.action === "APPROVED" ? "vp-badge-emerald" : "vp-badge-amber"}`}>
                    {entry.metrics.action}
                  </span>
                </span>
              )}
              <span style={{ color: "var(--text-secondary)" }}>{entry.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {feedError && (
        <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.65rem" }}>
          Live log endpoint unavailable ({feedError}); showing bundled demo stream.
        </p>
      )}
    </section>
  );
}
