import { useState } from "react";
import { formatBps, formatUsd, type VaultSummary } from "../lib/vault.js";

interface VaultYieldCalculatorProps {
  summary: VaultSummary;
}

const STRATEGIES = [
  {
    id: "usdc-arb",
    name: "USDC Cross-Chain Intent Arbitrage",
    pair: "NEAR ↔ Arbitrum",
    status: "ACTIVE",
    targetApyBps: 1420, // 14.2%
    baseApyBps: 450, // 4.5%
    desc: "Autonomous rebalancing between NEAR native yield and Arbitrum money markets via 1Click solvers.",
  },
  {
    id: "wnear-intent",
    name: "wNEAR Liquid Staking Intent Vault",
    pair: "NEAR ↔ Base / Optimism",
    status: "COMING SOON",
    targetApyBps: 1850, // 18.5%
    baseApyBps: 750, // 7.5%
    desc: "Captures cross-chain staking yield differentials using NEP-141 wrapped NEAR with zero bridge lockup.",
  },
  {
    id: "usdt-omni",
    name: "USDT Omni-Route Yield Pilot",
    pair: "NEAR ↔ Solana / EVM",
    status: "PLANNED",
    targetApyBps: 1680, // 16.8%
    baseApyBps: 420, // 4.2%
    desc: "Multi-venue intent solver distribution optimizing stablecoin borrow/lending spreads.",
  },
];

export function VaultYieldCalculator({ summary }: VaultYieldCalculatorProps) {
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGIES[0]);
  const [depositAmount, setDepositAmount] = useState("5000");
  const [days, setDays] = useState(90);

  const numAmount = parseFloat(depositAmount) || 0;
  const targetApy = selectedStrategy.targetApyBps / 10000;
  const baseApy = selectedStrategy.baseApyBps / 10000;
  const spreadBps = selectedStrategy.targetApyBps - selectedStrategy.baseApyBps;

  // Compounded interest projections: A = P * (1 + r * (days/365))
  const vaultEarnings = numAmount * targetApy * (days / 365);
  const baseEarnings = numAmount * baseApy * (days / 365);
  const netAlpha = Math.max(0, vaultEarnings - baseEarnings);

  const presets = ["1000", "5000", "25000", "100000"];
  const durationPresets = [
    { label: "30 Days", val: 30 },
    { label: "90 Days", val: 90 },
    { label: "180 Days", val: 180 },
    { label: "1 Year", val: 365 },
  ];

  return (
    <section className="panel yield-calculator-panel">
      <header className="panel-header">
        <div>
          <h2>Vault Command Center &amp; Yield Engine</h2>
          <span className="panel-subtitle">
            Simulate autonomous cross-chain intent alpha vs. standard single-chain yields
          </span>
        </div>
        <span className="badge badge-in">ERC-4626 VIRTUAL SHARES</span>
      </header>

      {/* Multi-Strategy Selector */}
      <div className="strategy-tabs-grid">
        {STRATEGIES.map((strat) => (
          <button
            key={strat.id}
            type="button"
            onClick={() => setSelectedStrategy(strat)}
            className={`strategy-tab-card ${
              selectedStrategy.id === strat.id ? "strategy-tab-active" : ""
            }`}
          >
            <div className="strategy-tab-top">
              <span className="strategy-pair">{strat.pair}</span>
              <span
                className={`badge ${
                  strat.status === "ACTIVE" ? "badge-in" : "badge-demo"
                }`}
              >
                {strat.status}
              </span>
            </div>
            <strong className="strategy-title">{strat.name}</strong>
            <div className="strategy-metrics">
              <span>Target: <strong>{formatBps(strat.targetApyBps)} APY</strong></span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+{formatBps(strat.targetApyBps - strat.baseApyBps)} spread</span>
            </div>
          </button>
        ))}
      </div>

      {/* Interactive Controls & Live Projection */}
      <div className="calculator-body-grid">
        <div className="calculator-inputs">
          <div className="input-group">
            <label className="stat-label">Deposit Simulation ($)</label>
            <input
              type="number"
              min="100"
              step="100"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="input text-lg font-mono"
              placeholder="e.g. 5000"
            />
            <div className="preset-row">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDepositAmount(p)}
                  className={`button button-ghost ${depositAmount === p ? "button-primary" : ""}`}
                >
                  ${parseInt(p).toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="input-group" style={{ marginTop: "1.25rem" }}>
            <label className="stat-label">Strategy Hold Horizon</label>
            <div className="duration-grid">
              {durationPresets.map((d) => (
                <button
                  key={d.val}
                  type="button"
                  onClick={() => setDays(d.val)}
                  className={`button ${days === d.val ? "button-primary" : "button-ghost"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="vault-health-summary">
            <div className="health-item">
              <span className="stat-label">Current Share Price</span>
              <span className="font-mono">{summary.share_price ? `${(Number(summary.share_price) / 1e24).toFixed(4)} USDC` : "1.0000 USDC"}</span>
            </div>
            <div className="health-item">
              <span className="stat-label">Total Vault TVL</span>
              <span className="font-mono">{formatUsd(summary.total_assets)}</span>
            </div>
            <div className="health-item">
              <span className="stat-label">Vault Reserve Idle</span>
              <span className="font-mono">{formatUsd(summary.idle_assets)}</span>
            </div>
          </div>
        </div>

        {/* Projection Comparison Card */}
        <div className="projection-card">
          <div className="projection-header">
            <span>Projected Returns over {days} Days</span>
            <span className="text-xs uppercase font-mono text-muted">Autonomous Rebalancing</span>
          </div>

          <div className="projection-comparison">
            <div className="projection-metric">
              <span className="stat-label">VaultPilot Projected Yield</span>
              <strong className="text-2xl text-emerald-600 dark:text-emerald-400">
                +${vaultEarnings.toFixed(2)}
              </strong>
              <span className="text-xs text-muted">
                at {formatBps(selectedStrategy.targetApyBps)} Strategy APY
              </span>
            </div>

            <div className="projection-divider" />

            <div className="projection-metric">
              <span className="stat-label">Standard NEAR Native Yield</span>
              <strong className="text-lg">
                +${baseEarnings.toFixed(2)}
              </strong>
              <span className="text-xs text-muted">
                at {formatBps(selectedStrategy.baseApyBps)} Base APY
              </span>
            </div>
          </div>

          <div className="alpha-badge-box">
            <div className="alpha-text">
              <span className="alpha-label">
                Intent Alpha Generated
              </span>
              <p className="text-sm font-bold mt-0.5">
                +${netAlpha.toFixed(2)} extra profit (+{formatBps(spreadBps)} spread)
              </p>
            </div>
            <span className="alpha-pill">
              {(vaultEarnings / (baseEarnings || 1)).toFixed(1)}x Higher
            </span>
          </div>

          <p className="text-xs text-muted mt-4 leading-relaxed">
            * Yield is captured autonomously via 1Click solvers and credited to the vault contract on-chain. NAV appreciates directly into user share value upon rebalance settlement.
          </p>
        </div>
      </div>
    </section>
  );
}
