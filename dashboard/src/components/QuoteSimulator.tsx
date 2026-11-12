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
import { RouteIcon } from "./Icons.js";

const DEFAULT_ORIGIN_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEFAULT_DEST_ASSET = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";

export function QuoteSimulator({ summary }: { summary: VaultSummary }) {
  const [amountInput, setAmountInput] = useState("2500");
  const [destinationAsset, setDestinationAsset] = useState(
    summary.policy.allowed_destination_assets[0] || DEFAULT_DEST_ASSET,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteResult, setQuoteResult] = useState<OneClickQuoteResult | null>(null);
  const [showPayload, setShowPayload] = useState(false);

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

  const externalApyBps = 1420;
  const nearApyBps = 450;
  const minSpreadBps = 150;
  const holdDays = 30;

  let costBps = 12;
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
    contractId: config.vaultContract || "vault.roundvest2883.testnet",
    methodName: "rebalance_out_portfolio",
    args: {
      amount: parsedAmount.toString(),
      destination_asset: destinationAsset,
      deposit_address: quoteResult?.quote?.depositAddress || "0x9f2c7a6b1e4d8c3f5a0b2d7e9c1f4a6b8d3e5c70",
      min_out: quoteResult?.quote?.minAmountOut || parsedAmount.toString(),
      reason: `spread ${netSpreadBps}bps >= ${minSpreadBps}bps; apy ${externalApyBps} vs ${nearApyBps}`,
    },
    gas: "100000000000000",
    deposit: "0",
  };

  return (
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <RouteIcon width={16} height={16} style={{ color: "var(--emerald-bright)" }} />
          <span>1Click Intent &amp; Policy Pre-Flight Inspector</span>
        </div>
        <span className={`vp-badge ${allPolicyPass ? "vp-badge-emerald" : "vp-badge-amber"}`}>
          {allPolicyPass ? "Policy Cleared" : "Policy Restrained"}
        </span>
      </header>

      <form onSubmit={(e) => void handleSimulate(e)} style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: "0.75rem", alignItems: "end", marginBottom: "0.85rem" }}>
        <div>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "0.3rem" }}>
            Amount ({config.tokenSymbol})
          </div>
          <input
            type="text"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="2500"
            className="vp-input"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "0.3rem" }}>
            Allowed Destination Asset
          </div>
          <select
            value={destinationAsset}
            onChange={(e) => setDestinationAsset(e.target.value)}
            className="vp-input"
            style={{ width: "100%" }}
          >
            {summary.policy.allowed_destination_assets.map((asset) => (
              <option key={asset} value={asset}>
                {asset.includes("arb") ? "Arbitrum USDC — " : asset.includes("base") ? "Base USDC — " : ""}
                {shorten(asset, 14, 8)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="vp-cta-white" style={{ width: "auto", padding: "0.55rem 1.15rem" }} disabled={loading}>
          {loading ? "Fetching Quote..." : "Fetch Live 1Click Quote"}
        </button>
      </form>

      {error && <div className="vp-alert-warn" style={{ marginBottom: "0.85rem" }}>Quote check notice: {error}</div>}

      <div className="vp-grid-2">
        {/* Guardrails Checklist */}
        <div className="vp-inset-panel">
          <div className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.6rem" }}>
            ON-CHAIN GUARDRAIL VERIFICATION
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", fontSize: "0.78rem" }}>
            {[
              { ok: passesMin, label: `>= Min Move (${formatAmount(minMove)})` },
              { ok: passesMax, label: `<= Max Per Move (${formatAmount(maxPerMove)})` },
              { ok: passesDaily, label: `<= Daily Remaining (${formatAmount(dailyRemaining)})` },
              { ok: passesLiquidity, label: `<= Idle Liquidity (${formatAmount(idleAssets)})` },
              { ok: passesAsset, label: "Allowlisted Destination Asset" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                <span className={`vp-badge ${item.ok ? "vp-badge-emerald" : "vp-badge-red"}`}>
                  {item.ok ? "PASS" : "FAIL"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Spread Math & Decision */}
        <div className="vp-inset-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
            <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
              SPREAD ALPHA COMPUTATION
            </span>
            <span className={`vp-badge ${shouldEnter ? "vp-badge-emerald" : "vp-badge-amber"}`}>
              {shouldEnter ? "ENTER POSITION" : "HOLD / SKIP"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.55rem" }}>
            <div className="vp-metric-box">
              <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Quote Cost</div>
              <div className="mono" style={{ fontSize: "0.88rem", fontWeight: 600 }}>{formatBps(costBps)}</div>
            </div>
            <div className="vp-metric-box">
              <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Annualized Cost</div>
              <div className="mono" style={{ fontSize: "0.88rem", fontWeight: 600 }}>{formatBps(annualizedCostBps)}</div>
            </div>
            <div className="vp-metric-box">
              <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Target vs Base</div>
              <div className="mono" style={{ fontSize: "0.84rem" }}>14.20% vs 4.50%</div>
            </div>
            <div className="vp-metric-box" style={{ borderColor: "var(--emerald-border)" }}>
              <div style={{ fontSize: "0.68rem", color: "var(--emerald-bright)" }}>Net Spread</div>
              <div className="mono" style={{ fontSize: "0.92rem", fontWeight: 600, color: "var(--emerald-bright)" }}>
                +{formatBps(netSpreadBps)}
              </div>
            </div>
          </div>

          <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="vp-icon-btn" onClick={() => setShowPayload((v) => !v)}>
              {showPayload ? "Hide Contract Payload" : "Inspect Contract Call JSON"}
            </button>
            {quoteResult?.quote?.minAmountOut && (
              <span className="mono" style={{ fontSize: "0.72rem", color: "var(--emerald-bright)" }}>
                Live MinOut: {formatAmount(quoteResult.quote.minAmountOut)}
              </span>
            )}
          </div>
        </div>
      </div>

      {showPayload && (
        <pre
          className="mono"
          style={{
            marginTop: "0.85rem",
            padding: "0.85rem",
            borderRadius: "8px",
            background: "var(--surface-inset)",
            border: "1px solid var(--border)",
            fontSize: "0.72rem",
            color: "var(--emerald-bright)",
            overflowX: "auto",
          }}
        >
          {JSON.stringify(mockPayload, null, 2)}
        </pre>
      )}
    </section>
  );
}
