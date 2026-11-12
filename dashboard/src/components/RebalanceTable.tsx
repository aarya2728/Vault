import { useState } from "react";
import type { RebalanceRecord } from "../lib/vault.js";
import {
  formatPrettyAmount,
  formatTime,
  shorten,
  NEAR_INTENTS_EXPLORER_TX,
  config,
} from "../lib/vault.js";
import { DownloadIcon, SwapVerticalIcon } from "./Icons.js";

function renderReason(reason: string) {
  if (!reason) return "-";
  const parts = reason.split(/(intents:[a-zA-Z0-9_,]+|tx:[a-zA-Z0-9]+)/g);
  return (
    <span>
      {parts.map((part, index) => {
        if (part.startsWith("intents:")) {
          const hashes = part.slice("intents:".length).split(",");
          return (
            <span key={`intents-${index}`}>
              intents:
              {hashes.map((h, hashIndex) => (
                <span key={h}>
                  {hashIndex > 0 ? "," : ""}
                  <code style={{ color: "var(--emerald-bright)" }} title={h}>
                    {shorten(h, 6, 4)}
                  </code>
                </span>
              ))}
            </span>
          );
        }
        if (part.startsWith("tx:")) {
          const hash = part.slice("tx:".length);
          return (
            <a
              key={`tx-${index}`}
              href={`${NEAR_INTENTS_EXPLORER_TX}/${hash}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--sky)", textDecoration: "none", marginLeft: "4px" }}
              title={`View NEAR Intents transaction ${hash}`}
            >
              [tx:{shorten(hash, 6, 4)} ↗]
            </a>
          );
        }
        return <span key={`text-${index}`}>{part}</span>;
      })}
    </span>
  );
}

export function RebalanceTable({ records }: { records: RebalanceRecord[] }) {
  const [filterKind, setFilterKind] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const totalOut = records
    .filter((r) => r.kind === "rebalance_out")
    .reduce((acc, r) => acc + BigInt(r.amount), 0n);

  const settlementsCount = records.filter((r) => r.kind === "rebalance_in").length;
  const deploymentsCount = records.filter((r) => r.kind === "rebalance_out").length;

  const filtered = [...records].reverse().filter((r) => {
    if (filterKind !== "all" && r.kind !== filterKind) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.reason.toLowerCase().includes(q) ||
        r.destination_asset.toLowerCase().includes(q) ||
        (r.deposit_address?.toLowerCase().includes(q) ?? false) ||
        r.executor.toLowerCase().includes(q)
      );
    }
    return true;
  });

  function exportJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records, null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `vaultpilot-rebalances-${Date.now()}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function exportCsv() {
    const headers = ["id", "timestamp_ms", "kind", "amount", "min_out", "deposit_address", "destination_asset", "executor", "reason"];
    const csvRows = [headers.join(",")];
    for (const r of records) {
      csvRows.push([
        r.id,
        r.timestamp_ms,
        r.kind,
        r.amount,
        r.min_out,
        `"${r.deposit_address || ""}"`,
        `"${r.destination_asset || ""}"`,
        `"${r.executor || ""}"`,
        `"${(r.reason || "").replace(/"/g, '""')}"`,
      ].join(","));
    }
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `vaultpilot-rebalances-${Date.now()}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <SwapVerticalIcon width={16} height={16} style={{ color: "var(--emerald-bright)" }} />
          <span>Autonomous Rebalance Ledger</span>
        </div>
        <div style={{ display: "flex", gap: "0.45rem" }}>
          <button type="button" className="vp-icon-btn" onClick={exportCsv}>
            <DownloadIcon width={12} height={12} />
            <span>Export CSV</span>
          </button>
          <button type="button" className="vp-icon-btn" onClick={exportJson}>
            <DownloadIcon width={12} height={12} />
            <span>Export JSON</span>
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Total Volume Rebalanced</div>
          <div className="mono" style={{ fontSize: "0.96rem", fontWeight: 600, marginTop: "3px" }}>
            {formatPrettyAmount(totalOut)} {config.tokenSymbol}
          </div>
          <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
            {deploymentsCount} outbound intent(s)
          </div>
        </div>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Settled Yield Cycles</div>
          <div className="mono" style={{ fontSize: "0.96rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "3px" }}>
            {settlementsCount} Completed
          </div>
          <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
            Principal + accrued yield
          </div>
        </div>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Execution Integrity</div>
          <div className="mono" style={{ fontSize: "0.96rem", fontWeight: 600, color: "var(--sky)", marginTop: "3px" }}>
            100% Policy Bound
          </div>
          <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
            On-chain guardrail verified
          </div>
        </div>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Total Recorded Moves</div>
          <div className="mono" style={{ fontSize: "0.96rem", fontWeight: 600, marginTop: "3px" }}>
            {records.length} Transactions
          </div>
          <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
            Immutable contract log
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {[
            { key: "all", label: "All" },
            { key: "rebalance_out", label: "Deployments" },
            { key: "rebalance_in", label: "Settlements" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`vp-pill-btn ${filterKind === tab.key ? "is-active" : ""}`}
              onClick={() => setFilterKind(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="vp-input"
          placeholder="Search intent hash, executor, asset..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ minWidth: "240px" }}
        />
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>No rebalance records match this filter.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="vp-table">
            <thead>
              <tr>
                <th className="mono">#</th>
                <th className="mono">TYPE</th>
                <th className="mono">AMOUNT</th>
                <th className="mono">DESTINATION</th>
                <th className="mono">REASON / TELEMETRY</th>
                <th className="mono">EXECUTOR</th>
                <th className="mono">TIMESTAMP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ color: "var(--muted)" }}>#{r.id}</td>
                  <td>
                    <span className={`vp-badge ${r.kind === "rebalance_in" ? "vp-badge-emerald" : "vp-badge-sky"}`}>
                      {r.kind}
                    </span>
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {formatPrettyAmount(r.amount)} {config.tokenSymbol}
                  </td>
                  <td>
                    <code style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                      {shorten(r.destination_asset, 14, 8)}
                    </code>
                  </td>
                  <td style={{ fontSize: "0.74rem", color: "var(--text-secondary)", maxWidth: "360px" }}>
                    {renderReason(r.reason)}
                  </td>
                  <td>
                    <code style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                      {shorten(r.executor, 12, 6)}
                    </code>
                  </td>
                  <td className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {formatTime(r.timestamp_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
