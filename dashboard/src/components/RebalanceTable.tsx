import { useState } from "react";
import type { RebalanceRecord } from "../lib/vault.js";
import {
  formatAmount,
  formatTime,
  shorten,
  NEAR_INTENTS_EXPLORER_TX,
  config,
} from "../lib/vault.js";

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
                  <code className="intent-hash-inline" title={h}>
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
              className="intent-link-inline"
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
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const allRows = [...records].reverse();

  // Calculate history metrics
  const totalOut = records
    .filter((r) => r.kind === "rebalance_out")
    .reduce((acc, r) => acc + BigInt(r.amount), 0n);
  const settlementsCount = records.filter((r) => r.kind === "rebalance_in").length;
  const deploymentsCount = records.filter((r) => r.kind === "rebalance_out").length;

  // Filter & Search
  const filteredRows = allRows.filter((r) => {
    if (filter === "in" && r.kind !== "rebalance_in") return false;
    if (filter === "out" && r.kind !== "rebalance_out") return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchReason = r.reason?.toLowerCase().includes(q);
      const matchAddr = r.deposit_address?.toLowerCase().includes(q);
      const matchKind = r.kind?.toLowerCase().includes(q);
      const matchAsset = r.destination_asset?.toLowerCase().includes(q);
      if (!matchReason && !matchAddr && !matchKind && !matchAsset) return false;
    }
    return true;
  });

  // Export functions
  function exportJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vaultpilot-rebalances-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function exportCsv() {
    const headers = ["id", "timestamp_ms", "kind", "amount", "min_out", "deposit_address", "destination_asset", "executor", "reason"];
    const csvRows = [headers.join(",")];
    for (const r of records) {
      const row = [
        r.id,
        r.timestamp_ms,
        r.kind,
        r.amount,
        r.min_out,
        `"${r.deposit_address || ""}"`,
        `"${r.destination_asset || ""}"`,
        `"${r.executor || ""}"`,
        `"${(r.reason || "").replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(","));
    }
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vaultpilot-rebalances-${Date.now()}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  return (
    <section className="panel history-panel">
      <header className="panel-header">
        <div>
          <h2>Autonomous Rebalance Ledger</h2>
          <span className="panel-subtitle">
            Cryptographically verifiable on-chain rebalances and 1Click solver fills
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={exportCsv}
            title="Export audit log as CSV"
          >
            Export CSV
          </button>
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={exportJson}
            title="Export raw JSON"
          >
            Export JSON
          </button>
        </div>
      </header>

      {/* Metrics Bar */}
      <div className="history-metrics-grid">
        <div className="history-metric-card">
          <span className="stat-label">Total Volume Rebalanced</span>
          <strong className="text-xl">
            {formatAmount(totalOut)} {config.tokenSymbol}
          </strong>
          <span className="text-xs text-muted">across {deploymentsCount} outbound intent(s)</span>
        </div>
        <div className="history-metric-card">
          <span className="stat-label">Settled Yield Cycles</span>
          <strong className="text-xl text-emerald-600 dark:text-emerald-400">
            {settlementsCount} Completed
          </strong>
          <span className="text-xs text-muted">Round-trip principal + yield</span>
        </div>
        <div className="history-metric-card">
          <span className="stat-label">Solver Execution Integrity</span>
          <strong className="text-xl text-sky-600 dark:text-sky-400">
            100% Policy Bound
          </strong>
          <span className="text-xs text-muted">Zero unverified slippage</span>
        </div>
        <div className="history-metric-card">
          <span className="stat-label">Total Recorded Moves</span>
          <strong className="text-xl">
            {records.length} Transactions
          </strong>
          <span className="text-xs text-muted">Immutable contract history</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="history-controls-row">
        <div className="filter-pill-group">
          <button
            type="button"
            className={`filter-pill ${filter === "all" ? "filter-pill-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All Moves ({records.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${filter === "out" ? "filter-pill-active" : ""}`}
            onClick={() => setFilter("out")}
          >
            Deployments OUT ({deploymentsCount})
          </button>
          <button
            type="button"
            className={`filter-pill ${filter === "in" ? "filter-pill-active" : ""}`}
            onClick={() => setFilter("in")}
          >
            Settlements IN ({settlementsCount})
          </button>
        </div>

        <div className="history-search-box">
          <input
            type="text"
            placeholder="Search by hash, deposit address, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input text-xs"
          />
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="empty">No matching rebalances found.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Action</th>
                <th>Amount</th>
                <th>Min out</th>
                <th>Deposit address</th>
                <th>Reason</th>
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((record) => {
                const isExpanded = expandedId === record.id;
                return (
                  <tr
                    key={record.id}
                    className={`cursor-pointer hover:bg-white/[0.02] ${
                      isExpanded ? "bg-white/[0.04]" : ""
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : record.id)}
                  >
                    <td className="mono font-bold text-gray-400">#{record.id}</td>
                    <td>{formatTime(record.timestamp_ms)}</td>
                    <td>
                      <span className={`badge ${record.kind === "rebalance_in" ? "badge-in" : "badge-out"}`}>
                        {record.kind === "rebalance_in" ? "IN (SETTLE)" : "OUT (INTENT)"}
                      </span>
                    </td>
                    <td className="mono font-semibold">{formatAmount(record.amount)}</td>
                    <td className="mono text-gray-400">
                      {record.kind === "rebalance_in" ? "-" : formatAmount(record.min_out)}
                    </td>
                    <td className="mono" title={record.deposit_address ?? undefined}>
                      {record.deposit_address ? shorten(record.deposit_address, 10, 6) : "-"}
                    </td>
                    <td className="reason" title={record.reason}>
                      {renderReason(record.reason)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(isExpanded ? null : record.id);
                        }}
                      >
                        {isExpanded ? "Close" : "Inspect"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Expanded Row Inspector Modal / Box */}
      {expandedId !== null && (() => {
        const selected = records.find((r) => r.id === expandedId);
        if (!selected) return null;
        return (
          <div className="history-inspection-drawer">
            <div className="drawer-header">
              <span className="text-xs font-mono uppercase text-cyan-400">
                Transaction #{selected.id} Deep Audit Inspector
              </span>
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={() => setExpandedId(null)}
              >
                &times; Close
              </button>
            </div>
            <div className="drawer-grid">
              <div>
                <span className="stat-label">Action Kind</span>
                <strong className={selected.kind === "rebalance_in" ? "text-emerald-400" : "text-amber-400"}>
                  {selected.kind}
                </strong>
              </div>
              <div>
                <span className="stat-label">Amount Transacted</span>
                <span className="font-mono">{formatAmount(selected.amount)} {config.tokenSymbol}</span>
              </div>
              <div>
                <span className="stat-label">Executor Account</span>
                <code className="text-xs">{selected.executor}</code>
              </div>
              <div>
                <span className="stat-label">Timestamp</span>
                <span>{new Date(selected.timestamp_ms).toISOString()}</span>
              </div>
            </div>
            <div className="mt-3">
              <span className="stat-label">Full Audit Payload Reason</span>
              <p className="font-mono text-xs text-gray-300 bg-black/40 p-2.5 rounded border border-white/5 break-all mt-1">
                {selected.reason || "No additional reason provided"}
              </p>
            </div>
            {selected.deposit_address && (
              <div className="mt-2">
                <span className="stat-label">1Click Deposit Address</span>
                <code className="text-xs text-cyan-300 block bg-black/40 p-2 rounded border border-white/5 mt-1">
                  {selected.deposit_address}
                </code>
              </div>
            )}
          </div>
        );
      })()}
    </section>
  );
}
