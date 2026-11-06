import type { RebalanceRecord } from "../lib/vault.js";
import { formatAmount, formatTime, shorten } from "../lib/vault.js";

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
                    {record.reason || "-"}
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
