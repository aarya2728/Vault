import { useState, type FormEvent } from "react";
import {
  fetchOneClickQuote,
  formatAmount,
  formatBps,
  parseAmount,
  shorten,
  type OneClickQuoteResult,
  type VaultSummary,
  config,
} from "../lib/vault.js";

const DEFAULT_ORIGIN_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"; // NEAR USDC
const DEFAULT_DEST_ASSET = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"; // Arb USDC

export function QuoteSimulator({ summary }: { summary: VaultSummary }) {
  const [amountInput, setAmountInput] = useState("25");
  const [destinationAsset, setDestinationAsset] = useState(
    summary.policy.allowed_destination_assets[0] || DEFAULT_DEST_ASSET,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteResult, setQuoteResult] = useState<OneClickQuoteResult | null>(null);

  async function handleSimulate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const parsed = parseAmount(amountInput);
      if (parsed <= 0n) {
        throw new Error("Amount must be greater than zero");
      }

      const res = await fetchOneClickQuote({
        amount: parsed.toString(),
        originAsset: DEFAULT_ORIGIN_ASSET,
        destinationAsset,
        slippageTolerance: Math.min(100, summary.policy.max_slippage_bps),
      });
      setQuoteResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const [showPayload, setShowPayload] = useState(false);

  // Evaluate policy compliance
  let parsedAmount = 0n;
  try {
    parsedAmount = parseAmount(amountInput);
  } catch {
    parsedAmount = 0n;
  }

  const minMove = BigInt(summary.policy.min_move);
  const maxPerMove = BigInt(summary.policy.max_per_move);
  const dailyRemaining = BigInt(summary.daily_remaining ?? 0);
  const idleAssets = BigInt(summary.idle_assets);

  const passesMin = parsedAmount >= minMove;
  const passesMax = parsedAmount <= maxPerMove;
  const passesDaily = parsedAmount <= dailyRemaining;
  const passesLiquidity = parsedAmount <= idleAssets;
  const passesAsset = summary.policy.allowed_destination_assets.includes(destinationAsset);
  const allPolicyPass =
    passesMin && passesMax && passesDaily && passesLiquidity && passesAsset;

  // Strategy Spread Formula Calculation
  const externalApyBps = 1200; // 12.0%
  const nearApyBps = 450; // 4.5%
  const minSpreadBps = 150; // 1.5%
  const holdDays = 30;

  let costBps = 15; // default estimate
  if (quoteResult?.quote?.amountInUsd && quoteResult?.quote?.amountOutUsd) {
    const inUsd = parseFloat(quoteResult.quote.amountInUsd);
    const outUsd = parseFloat(quoteResult.quote.amountOutUsd);
    if (inUsd > 0 && outUsd > 0) {
      costBps = Math.max(0, Math.round(((inUsd - outUsd) / inUsd) * 10000));
    }
  }
  const annualizedCostBps = Math.round((costBps * 365) / holdDays);
  const netSpreadBps = externalApyBps - nearApyBps - annualizedCostBps;
  const shouldEnter = allPolicyPass && netSpreadBps >= minSpreadBps;

  const mockPayload = {
    contractId: config.vaultContract || "vault.near",
    methodName: "rebalance_out",
    args: {
      amount: parsedAmount.toString(),
      destination_asset: destinationAsset,
      deposit_address: quoteResult?.quote?.depositAddress || "1click-solver-deposit.near",
      min_out: quoteResult?.quote?.minAmountOut || parsedAmount.toString(),
      reason: `spread ${netSpreadBps}bps >= ${minSpreadBps}bps; apy ${externalApyBps} vs ${nearApyBps}`,
    },
    gas: "100000000000000",
    deposit: "0",
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>1Click Intent & Policy Pre-Flight Inspector</h2>
          <span className="panel-subtitle">
            Test live NEAR Intents quote against on-chain vault guardrails
          </span>
        </div>
        <span className={`pill ${allPolicyPass ? "pill-ok" : "pill-warn"}`}>
          {allPolicyPass ? "Policy Cleared" : "Policy Restrained"}
        </span>
      </header>

      <form onSubmit={handleSimulate} className="quote-sim-form">
        <div className="form-row">
          <div>
            <label className="stat-label">Simulate Amount ({config.tokenSymbol})</label>
            <input
              type="text"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="e.g. 25"
              className="input"
            />
          </div>
          <div>
            <label className="stat-label">Destination Asset (Allowed only)</label>
            <select
              value={destinationAsset}
              onChange={(e) => setDestinationAsset(e.target.value)}
              className="select"
            >
              {summary.policy.allowed_destination_assets.map((asset) => (
                <option key={asset} value={asset}>
                  {shorten(asset, 16, 8)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" className="button button-primary" disabled={loading}>
              {loading ? "Fetching Quote..." : "Fetch Live 1Click Quote"}
            </button>
          </div>
        </div>
      </form>

      <p className="muted small">
        Dry, non-binding quote: 1Click answers with live solver pricing but does not reserve a
        deposit address. The agent uses its configured destination recipient for real moves.
      </p>

      {error && (
        <div className="alert alert-warn" style={{ marginTop: "1rem" }}>
          <strong>Quote failed:</strong> {error}
        </div>
      )}

      {/* On-Chain Policy Verification Matrix */}
      <div className="policy-matrix">
        <h3>On-Chain Vault Policy Verification</h3>
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Guardrail</th>
              <th>Policy Limit</th>
              <th>Move Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Min Move</td>
              <td>&ge; {formatAmount(summary.policy.min_move)}</td>
              <td>{formatAmount(parsedAmount)}</td>
              <td>
                <span className={`badge ${passesMin ? "badge-in" : "badge-out"}`}>
                  {passesMin ? "PASS" : "FAIL"}
                </span>
              </td>
            </tr>
            <tr>
              <td>Max Per Move</td>
              <td>&le; {formatAmount(summary.policy.max_per_move)}</td>
              <td>{formatAmount(parsedAmount)}</td>
              <td>
                <span className={`badge ${passesMax ? "badge-in" : "badge-out"}`}>
                  {passesMax ? "PASS" : "FAIL"}
                </span>
              </td>
            </tr>
            <tr>
              <td>Daily Cap Headroom</td>
              <td>&le; {formatAmount(dailyRemaining)}</td>
              <td>{formatAmount(parsedAmount)}</td>
              <td>
                <span className={`badge ${passesDaily ? "badge-in" : "badge-out"}`}>
                  {passesDaily ? "PASS" : "FAIL"}
                </span>
              </td>
            </tr>
            <tr>
              <td>Idle Liquidity</td>
              <td>&le; {formatAmount(summary.idle_assets)}</td>
              <td>{formatAmount(parsedAmount)}</td>
              <td>
                <span className={`badge ${passesLiquidity ? "badge-in" : "badge-out"}`}>
                  {passesLiquidity ? "PASS" : "FAIL"}
                </span>
              </td>
            </tr>
            <tr>
              <td>Allowed Destination</td>
              <td>Allowlist verified</td>
              <td>{shorten(destinationAsset, 8, 6)}</td>
              <td>
                <span className={`badge ${passesAsset ? "badge-in" : "badge-out"}`}>
                  {passesAsset ? "PASS" : "FAIL"}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {quoteResult && (
        <div className="live-quote-results">
          <h3>Live 1Click Solver Response</h3>
          <div className="quote-grid">
            <div>
              <span className="stat-label">Offered Output</span>
              <strong>{quoteResult.quote.amountOutFormatted}</strong>
            </div>
            <div>
              <span className="stat-label">Min Guaranteed Out</span>
              <span className="mono">{formatAmount(quoteResult.quote.minAmountOut)}</span>
            </div>
            <div>
              <span className="stat-label">Max Slippage</span>
              <span>{formatBps(summary.policy.max_slippage_bps)}</span>
            </div>
            <div>
              <span className="stat-label">Est. Solver Duration</span>
              <span>{quoteResult.quote.timeEstimate ? `${quoteResult.quote.timeEstimate}s` : "~30s"}</span>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: "0.5rem" }}>
            Correlation ID: <code>{quoteResult.correlationId}</code> &bull; Solver quotes are cryptographically signed by Chaindefuser.
          </p>

          {/* Strategy Formula Inspector */}
          <div className="strategy-decision-box">
            <div className="decision-header">
              <span className="text-xs font-mono uppercase text-gray-400">Autonomous Agent Strategy Formula</span>
              <span className={`pill ${shouldEnter ? "pill-ok" : "pill-warn"}`}>
                {shouldEnter ? "DECISION: ENTER POSITION" : "DECISION: HOLD POSITION"}
              </span>
            </div>

            <div className="formula-display">
              <code>
                Net Spread ({netSpreadBps} bps) = External APY ({externalApyBps} bps) - NEAR APY ({nearApyBps} bps) - Annualized Cost ({annualizedCostBps} bps)
              </code>
            </div>

            <div className="decision-metrics-row">
              <div>
                <span className="stat-label">Gross Spread</span>
                <strong>+{externalApyBps - nearApyBps} bps (+{( (externalApyBps - nearApyBps) / 100).toFixed(1)}%)</strong>
              </div>
              <div>
                <span className="stat-label">One-Way Swap Cost</span>
                <span className="mono">{costBps} bps</span>
              </div>
              <div>
                <span className="stat-label">Required Min Spread</span>
                <span className="mono">{minSpreadBps} bps</span>
              </div>
              <div>
                <span className="stat-label">Calculated Net Spread</span>
                <strong className={netSpreadBps >= minSpreadBps ? "text-emerald-600 dark:text-emerald-400 font-mono" : "text-amber-600 dark:text-amber-400 font-mono"}>
                  {netSpreadBps} bps ({netSpreadBps >= minSpreadBps ? "Spread Cleared" : "Too Low"})
                </strong>
              </div>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={() => setShowPayload(!showPayload)}
              >
                {showPayload ? "Hide Agent Contract Payload" : "Inspect Agent Contract Payload (rebalance_out)"}
              </button>
            </div>

            {showPayload && (
              <pre className="payload-preview-code">
                {JSON.stringify(mockPayload, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

