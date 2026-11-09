import type { RebalanceRecord } from "../lib/vault.js";
import {
  formatAmount,
  formatTime,
  shorten,
  NEAR_INTENTS_EXPLORER_TX,
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
  const rows = [...records].reverse();

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Rebalance history</h2>
        <span className="muted">{records.length} record(s)</span>
      </header>

      {rows.length === 0 ? (
        <p className="empty">No rebalances recorded yet.</p>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={record.id}>
                  <td className="mono">{record.id}</td>
                  <td>{formatTime(record.timestamp_ms)}</td>
                  <td>
                    <span className={`badge ${record.kind === "rebalance_in" ? "badge-in" : "badge-out"}`}>
                      {record.kind === "rebalance_in" ? "IN" : "OUT"}
                    </span>
                  </td>
                  <td className="mono">{formatAmount(record.amount)}</td>
                  <td className="mono">{record.kind === "rebalance_in" ? "-" : formatAmount(record.min_out)}</td>
                  <td className="mono" title={record.deposit_address ?? undefined}>
                    {record.deposit_address ? shorten(record.deposit_address, 10, 6) : "-"}
                  </td>
                  <td className="reason" title={record.reason}>
                    {renderReason(record.reason)}
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
