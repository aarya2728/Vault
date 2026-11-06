import type { VaultSummary } from "../lib/vault.js";
import { formatAmount, formatSharePrice, formatUsd } from "../lib/vault.js";

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
  ];

  return (
    <section className="stats-grid" aria-label="Vault statistics">
      {cards.map((card) => (
        <article className="stat-card" key={card.label}>
          <span className="stat-label">{card.label}</span>
          <strong className="stat-value">{card.value}</strong>
          <span className="stat-hint">{card.hint}</span>
        </article>
      ))}
    </section>
  );
}
