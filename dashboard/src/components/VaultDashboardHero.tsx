import { formatPrettyAmount, formatPrettyUsd, type VaultSummary } from "../lib/vault.js";
import { DiamondIcon, LockIcon, ShieldCheckIcon } from "./Icons.js";

export function VaultDashboardHero({ summary }: { summary: VaultSummary | null }) {
  const tvl = summary ? BigInt(summary.total_assets) : 0n;
  const totalShares = summary ? BigInt(summary.total_shares) : 0n;
  const idle = summary ? BigInt(summary.idle_assets) : 0n;
  const deployed = summary ? BigInt(summary.deployed_assets) : 0n;
  const dailyMoved = summary ? BigInt(summary.daily_moved) : 0n;
  const dailyCap = summary ? BigInt(summary.policy.daily_cap) : 1n;

  const totalCapital = idle + deployed;
  const idlePct = totalCapital > 0n ? ((Number(idle) / Number(totalCapital)) * 100).toFixed(1) : "100.0";
  const deployedPct = totalCapital > 0n ? ((Number(deployed) / Number(totalCapital)) * 100).toFixed(1) : "0.0";
  const capPct = dailyCap > 0n ? Math.min(100, Math.round((Number(dailyMoved) / Number(dailyCap)) * 100)) : 0;

  const activeCount = summary?.active_positions?.length ?? (deployed > 0n ? 1 : 0);
  const primaryVenue =
    summary?.active_positions?.[0]?.venue && summary?.active_positions?.[0]?.chain_badge
      ? `${summary.active_positions[0].chain_badge === "ARBITRUM ONE" ? "Arbitrum" : "Base"} ${summary.active_positions[0].venue}`
      : activeCount > 1
      ? `${activeCount} Concurrent Venues`
      : deployed > 0n
      ? "Arbitrum Morpho Blue"
      : "No Active Route";

  return (
    <section className="vp-hero-card">
      <div className="vp-hero-top">
        <div>
          <div className="vp-hero-eyebrow">
            <span className="vp-dot" />
            <span>DETERMINISTIC CROSS-CHAIN ENGINE</span>
          </div>
          <h1 className="vp-hero-h1">
            Autonomous Stablecoin Yield, Governed by On-Chain Policy
          </h1>
          <p className="vp-hero-sub">
            Single-signature cross-chain MPC liquidity routing bound by verified timelock controls.
          </p>
        </div>

        <div className="vp-hero-pills">
          <span className="vp-hero-pill">
            <LockIcon width={13} height={13} />
            <span>48h Timelock Active</span>
          </span>
          <span className="vp-hero-pill">
            <ShieldCheckIcon width={13} height={13} />
            <span>NEAR MPC Custody</span>
          </span>
          <span className="vp-hero-pill">
            <DiamondIcon width={13} height={13} />
            <span>ERC-4626 Virtual Offsets</span>
          </span>
        </div>
      </div>

      <div className="vp-kpi-strip">
        <div className="vp-kpi-item">
          <div className="vp-kpi-top">
            <span>Total Vault TVL</span>
          </div>
          <div className="vp-kpi-value">{summary ? formatPrettyUsd(tvl) : "-"}</div>
          <div className="vp-kpi-sub">
            {summary ? `${formatPrettyAmount(totalShares, 6, 0)} VP-USDC Shares` : "-"}
          </div>
        </div>

        <div className="vp-kpi-item">
          <div className="vp-kpi-top">
            <span>Net Terminal APY</span>
            <span className="vp-badge vp-badge-emerald">+9.70% Alpha</span>
          </div>
          <div className="vp-kpi-value is-emerald">14.20%</div>
          <div className="vp-kpi-sub">4.50% Base + Intent Spread</div>
        </div>

        <div className="vp-kpi-item">
          <div className="vp-kpi-top">
            <span>Idle Liquidity</span>
            <span className="mono">{idlePct}%</span>
          </div>
          <div className="vp-kpi-value">{summary ? formatPrettyUsd(idle) : "-"}</div>
          <div className="vp-kpi-sub is-emerald">Instant Exit Reserved</div>
        </div>

        <div className="vp-kpi-item">
          <div className="vp-kpi-top">
            <span>Cross-Chain Deployed</span>
            <span className="mono">{deployedPct}%</span>
          </div>
          <div className="vp-kpi-value">{summary ? formatPrettyUsd(deployed) : "-"}</div>
          <div className="vp-kpi-sub">{primaryVenue}</div>
        </div>

        <div className="vp-kpi-item">
          <div className="vp-kpi-top">
            <span>Today&apos;s UTC Cap</span>
            <span className="mono">{capPct}%</span>
          </div>
          <div className="vp-kpi-value">
            {summary ? formatPrettyUsd(dailyMoved, 6, 0) : "-"}{" "}
            <span style={{ fontSize: "0.86rem", color: "var(--muted)", fontWeight: 400 }}>
              / {summary ? formatPrettyUsd(dailyCap, 6, 0) : "-"}
            </span>
          </div>
          <div className="vp-cap-bar">
            <div className="vp-cap-fill" style={{ width: `${capPct}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
