import { useState } from "react";
import { formatBps, type VaultSummary } from "../lib/vault.js";
import { DiamondIcon } from "./Icons.js";

interface VaultYieldCalculatorProps {
  summary: VaultSummary;
}

const STRATEGIES = [
  {
    id: "usdc-arb",
    name: "USDC Cross-Chain Intent Arbitrage",
    pair: "NEAR ↔ Arbitrum (Morpho Blue)",
    status: "ACTIVE",
    targetApyBps: 1420,
    baseApyBps: 450,
    desc: "Autonomous rebalancing between NEAR native yield and Arbitrum money markets via 1Click solvers.",
  },
  {
    id: "usdc-base",
    name: "USDC Aave v3 Prime Strategy",
    pair: "NEAR ↔ Base L2",
    status: "ACTIVE",
    targetApyBps: 920,
    baseApyBps: 450,
    desc: "Overcollateralized USDC supply on Base L2 controlled directly by NEAR Chain Signatures MPC.",
  },
  {
    id: "usdc-comp",
    name: "Compound v3 Comet + COMP Incentives",
    pair: "NEAR ↔ Arbitrum One",
    status: "ACTIVE",
    targetApyBps: 840,
    baseApyBps: 420,
    desc: "Low-volatility USDC supply pool capturing institutional borrow demand plus COMP reward emissions.",
  },
];

export function VaultYieldCalculator({ summary }: VaultYieldCalculatorProps) {
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGIES[0]);
  const [depositAmount, setDepositAmount] = useState("25000");
  const [days, setDays] = useState(90);

  const numAmount = parseFloat(depositAmount) || 0;
  const targetApy = selectedStrategy.targetApyBps / 10000;
  const baseApy = selectedStrategy.baseApyBps / 10000;
  const spreadBps = selectedStrategy.targetApyBps - selectedStrategy.baseApyBps;

  const vaultEarnings = numAmount * targetApy * (days / 365);
  const baseEarnings = numAmount * baseApy * (days / 365);
  const netAlpha = Math.max(0, vaultEarnings - baseEarnings);

  const presets = ["5000", "25000", "100000", "500000"];
  const durationPresets = [
    { label: "30D", val: 30 },
    { label: "90D", val: 90 },
    { label: "180D", val: 180 },
    { label: "1Y", val: 365 },
  ];

  const hasCapacity = BigInt(summary.idle_assets) > 0n || BigInt(summary.total_assets) > 0n;

  return (
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <DiamondIcon width={16} height={16} style={{ color: "var(--emerald-bright)" }} />
          <span>Multi-Strategy Yield &amp; Alpha Projection</span>
        </div>
        <span className="vp-badge vp-badge-emerald">
          {hasCapacity ? "Routes Operational" : "Engine Ready"}
        </span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.1rem" }}>
        {STRATEGIES.map((strategy) => {
          const isSelected = selectedStrategy.id === strategy.id;
          return (
            <button
              key={strategy.id}
              type="button"
              onClick={() => setSelectedStrategy(strategy)}
              className={`vp-position-card ${isSelected ? "is-selected" : ""}`}
              style={{ textAlign: "left", padding: "0.85rem 1rem" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                <span className="vp-badge vp-badge-emerald" style={{ fontSize: "0.62rem" }}>
                  {strategy.status}
                </span>
                <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                  {strategy.pair}
                </span>
              </div>
              <div style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--text)", marginBottom: "0.25rem" }}>
                {strategy.name}
              </div>
              <div className="mono" style={{ fontSize: "1rem", fontWeight: 600, color: "var(--emerald-bright)" }}>
                {formatBps(strategy.targetApyBps)} APY
              </div>
            </button>
          );
        })}
      </div>

      <div className="vp-grid-2">
        <div className="vp-inset-panel" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
              <span>Allocation Principal (USDC)</span>
              <span className="mono">Spread: +{formatBps(spreadBps)}</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="number"
                className="vp-input"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                min="0"
                style={{ flex: 1, minWidth: "120px" }}
              />
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`vp-pill-btn ${depositAmount === p ? "is-active" : ""}`}
                  onClick={() => setDepositAmount(p)}
                >
                  ${(Number(p) / 1000).toFixed(0)}k
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
              <span>Hold Horizon</span>
              <span className="mono" style={{ color: "var(--text)" }}>{days} Days</span>
            </div>
            <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="range"
                min="7"
                max="365"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#10b981" }}
              />
              {durationPresets.map((dp) => (
                <button
                  key={dp.val}
                  type="button"
                  className={`vp-pill-btn ${days === dp.val ? "is-active" : ""}`}
                  onClick={() => setDays(dp.val)}
                >
                  {dp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="vp-inset-panel" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.65rem", alignContent: "center" }}>
          <div className="vp-metric-box">
            <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Vault Yield</div>
            <div className="mono" style={{ fontSize: "1.02rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "4px" }}>
              +${vaultEarnings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
              at {formatBps(selectedStrategy.targetApyBps)}
            </div>
          </div>
          <div className="vp-metric-box">
            <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>NEAR Base</div>
            <div className="mono" style={{ fontSize: "1.02rem", fontWeight: 600, marginTop: "4px" }}>
              +${baseEarnings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
              at {formatBps(selectedStrategy.baseApyBps)}
            </div>
          </div>
          <div className="vp-metric-box" style={{ borderColor: "var(--emerald-border)" }}>
            <div style={{ fontSize: "0.68rem", color: "var(--emerald-bright)" }}>Net Intent Alpha</div>
            <div className="mono" style={{ fontSize: "1.02rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "4px" }}>
              +${netAlpha.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mono" style={{ fontSize: "0.66rem", color: "var(--muted)" }}>
              Outperformance
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
