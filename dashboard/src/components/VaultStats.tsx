import type { VaultSummary } from "../lib/vault.js";
import { formatAmount, formatSharePrice, formatTime, formatUsd } from "../lib/vault.js";

export function VaultStats({ summary }: { summary: VaultSummary }) {
  const cards = [
    { label: "Total assets", value: formatUsd(summary.total_assets), hint: "idle + deployed" },
    { label: "Idle liquidity", value: formatUsd(summary.idle_assets), hint: "withdrawable now" },
    { label: "Deployed", value: formatUsd(summary.deployed_assets), hint: "external position" },
    { label: "Share price", value: formatSharePrice(summary.share_price), hint: "assets per share" },
    {
      label: "Moved today",
      value: `${formatAmount(summary.daily_moved)} / ${formatAmount(summary.policy.daily_cap)}`,
      hint: "policy daily cap",
    },
    {
      label: "Daily headroom",
      value: formatAmount(summary.daily_remaining ?? 0),
      hint: "remaining before the cap",
    },
    {
      label: "Last move",
      value: summary.last_move_ms ? formatTime(summary.last_move_ms) : "-",
      hint: summary.pending_move
        ? `pending: ${summary.pending_move.status}`
        : "no pending move",
    },
  ];

  const dailyCap = BigInt(summary.policy.daily_cap);
  const dailyMoved = BigInt(summary.daily_moved);
  const dailyUsage =
    dailyCap > 0n ? Math.min(100, Number((dailyMoved * 100n) / dailyCap)) : 0;
  const idle = BigInt(summary.idle_assets);
  const deployed = BigInt(summary.deployed_assets);
  const capital = idle + deployed;
  const idlePct = capital > 0n ? Number((idle * 100n) / capital) : 100;

  return (
    <>
      <section className="stats-grid" aria-label="Vault statistics">
        {cards.map((card) => (
          <article className="stat-card" key={card.label}>
            <span className="stat-label">{card.label}</span>
            <strong className="stat-value">{card.value}</strong>
            <span className="stat-hint">{card.hint}</span>
          </article>
        ))}
      </section>

      <section className="panel gauge-panel" aria-label="Policy guardrail gauges">
        <div className="gauge-row">
          <div className="gauge-head">
            <span>Daily cap usage</span>
            <strong className={dailyUsage >= 80 ? "gauge-hot-text" : ""}>
              {dailyUsage}%
            </strong>
          </div>
          <div className="gauge-track">
            <span
              className={`gauge-fill ${dailyUsage >= 80 ? "gauge-hot" : ""}`}
              style={{ width: `${dailyUsage}%` }}
            />
          </div>
          <div className="gauge-legend">
            <span>
              Moved <strong>{formatAmount(dailyMoved)}</strong>
            </span>
            <span>
              Cap <strong>{formatAmount(dailyCap)}</strong>
            </span>
          </div>
        </div>

        <div className="gauge-row">
          <div className="gauge-head">
            <span>Capital deployment</span>
            <strong>{100 - idlePct}% deployed</strong>
          </div>
          <div className="gauge-track dual">
            <span
              className="gauge-fill gauge-idle"
              style={{ width: `${idlePct}%` }}
            />
            <span
              className="gauge-fill gauge-deployed"
              style={{ width: `${100 - idlePct}%` }}
            />
          </div>
          <div className="gauge-legend">
            <span>
              <span className="split-dot split-dot-idle" /> Idle{" "}
              <strong>{formatAmount(idle)}</strong>
            </span>
            <span>
              <span className="split-dot split-dot-deployed" /> Deployed{" "}
              <strong>{formatAmount(deployed)}</strong>
            </span>
          </div>
        </div>

        <p className="muted small">
          These bounds are enforced on-chain. The agent cannot move capital outside the
          policy even if its off-chain strategy is compromised.
        </p>
      </section>
    </>
  );
}
