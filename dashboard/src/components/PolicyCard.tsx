import type { Policy } from "../lib/vault.js";
import { formatBps, formatPrettyAmount, shorten } from "../lib/vault.js";
import { LockIcon } from "./Icons.js";

export function PolicyCard({ policy }: { policy: Policy }) {
  return (
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <LockIcon width={15} height={15} style={{ color: "var(--emerald-bright)" }} />
          <span>On-Chain Policy Guardrails</span>
        </div>
        <span className="vp-badge">Contract Enforced</span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.69rem", color: "var(--muted)" }}>Min Move</div>
          <div className="mono" style={{ fontSize: "0.88rem", fontWeight: 600, marginTop: "3px" }}>
            ${formatPrettyAmount(policy.min_move)}
          </div>
        </div>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.69rem", color: "var(--muted)" }}>Max Per Move</div>
          <div className="mono" style={{ fontSize: "0.88rem", fontWeight: 600, marginTop: "3px" }}>
            ${formatPrettyAmount(policy.max_per_move)}
          </div>
        </div>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.69rem", color: "var(--muted)" }}>Daily UTC Cap</div>
          <div className="mono" style={{ fontSize: "0.88rem", fontWeight: 600, marginTop: "3px" }}>
            ${formatPrettyAmount(policy.daily_cap)}
          </div>
        </div>
        <div className="vp-metric-box">
          <div style={{ fontSize: "0.69rem", color: "var(--muted)" }}>Max Slippage</div>
          <div className="mono" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "3px" }}>
            {formatBps(policy.max_slippage_bps)}
          </div>
        </div>
      </div>

      <div>
        <div className="mono" style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
          ALLOWED DESTINATION ASSETS
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {policy.allowed_destination_assets.map((asset) => (
            <code
              key={asset}
              title={asset}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "6px",
                background: "var(--surface-inset)",
                border: "1px solid var(--border)",
                fontSize: "0.72rem",
                color: "var(--text-secondary)",
              }}
            >
              {shorten(asset, 20, 10)}
            </code>
          ))}
        </div>
      </div>
    </section>
  );
}
