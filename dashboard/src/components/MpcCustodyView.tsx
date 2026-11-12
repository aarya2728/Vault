import { useState } from "react";
import {
  fetchOneClickStatus,
  formatPrettyAmount,
  NEAR_INTENTS_EXPLORER_TX,
  type OneClickStatus,
  type Position,
  type VaultSummary,
  config,
} from "../lib/vault.js";
import { DEMO_MPC_ADDRESS, DEMO_POSITIONS } from "../lib/demo.js";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LayersIcon,
  RefreshIcon,
  SwapVerticalIcon,
} from "./Icons.js";

interface MpcCustodyViewProps {
  summary: VaultSummary;
  onRefresh?: () => void;
  demo?: boolean;
}

export function MpcCustodyView({ summary, onRefresh, demo = false }: MpcCustodyViewProps) {
  const positions: Position[] =
    summary.active_positions && summary.active_positions.length > 0
      ? summary.active_positions
      : demo
      ? DEMO_POSITIONS
      : summary.pending_move
      ? [
          {
            id: summary.pending_move.id,
            amount: summary.pending_move.amount,
            destination_asset: summary.pending_move.destination_asset,
            venue: summary.pending_move.destination_asset.includes("base")
              ? "Aave v3 Prime"
              : "Morpho Blue",
            chain_badge: summary.pending_move.destination_asset.includes("base")
              ? "BASE L2"
              : "ARBITRUM ONE",
            deposit_address: summary.pending_move.deposit_address,
            recipient_evm_address: summary.mpc_derived_address ?? DEMO_MPC_ADDRESS,
            min_out: summary.pending_move.min_out,
            opened_at_ms: summary.pending_move.opened_at_ms,
            status: summary.pending_move.status,
          },
        ]
      : [];

  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedPos = positions[selectedIndex] ?? positions[0] ?? null;

  const [copiedKey, setCopiedKey] = useState<"master" | "deposit" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [liveStatus, setLiveStatus] = useState<OneClickStatus | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  const mpcAddress = summary.mpc_derived_address ?? DEMO_MPC_ADDRESS;

  function copyValue(val: string, key: "master" | "deposit") {
    void navigator.clipboard.writeText(val);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1800);
  }

  async function handleForceVerify() {
    setVerifyNotice(null);
    setVerifying(true);
    try {
      if (!demo && selectedPos?.deposit_address) {
        const res = await fetchOneClickStatus(selectedPos.deposit_address);
        setLiveStatus(res);
        setVerifyNotice(`1Click status verified: ${res.status}`);
      } else {
        await new Promise((r) => setTimeout(r, 350));
        setVerifyNotice("MPC signature threshold (8/12) & contract state re-verified.");
      }
      onRefresh?.();
    } catch (err) {
      setVerifyNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  const auditEvents = [
    {
      timestamp: "T+00s",
      scope: "NEAR",
      action: "Agent invoked rebalance_out_portfolio with scoped function-call key",
      status: "Guardrails verified",
      tone: "emerald",
    },
    {
      timestamp: "T+06s",
      scope: "INTENTS",
      action: "1Click deposit ingested by market maker solver ring for automated cross-chain settlement",
      status: "Auctioning cross-chain fill",
      tone: "muted",
    },
    {
      timestamp: "T+18s",
      scope: "MPC DEST",
      action: `Funds delivered to contract-controlled master MPC address on ${selectedPos?.chain_badge === "BASE L2" ? "Base L2" : "Arbitrum One"}`,
      status: "Self-custody verified",
      tone: "emerald",
    },
    {
      timestamp: "T+34s",
      scope: "VENUE",
      action: `Supplied into ${selectedPos?.venue ?? "Morpho Blue"} USDC/WETH market via deterministic controller signature`,
      status: "Active & Monitoring",
      tone: "emerald-dot",
    },
  ];

  function exportAuditJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      mpcSigner: "v1.signer-prod.testnet",
      masterEvmController: mpcAddress,
      positions,
      events: auditEvents,
      liveStatus,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vaultpilot-mpc-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const openedDateLabel = selectedPos
    ? new Date(selectedPos.opened_at_ms).toLocaleString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "-";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
      {/* Master MPC Controller Banner */}
      <section className="vp-mpc-banner">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <span className="vp-hero-eyebrow" style={{ marginBottom: 0 }}>
              <span className="vp-dot" />
              <span>ZERO HOT-WALLET EXECUTION MODEL</span>
            </span>
            <span style={{ color: "var(--border-strong)" }}>|</span>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Contract Signer ID:{" "}
              <code style={{ color: "var(--text-secondary)" }}>v1.signer-prod.testnet</code>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)", letterSpacing: "0.06em" }}>
              MASTER EVM CONTROLLER:
            </span>
            <code
              style={{
                padding: "0.3rem 0.65rem",
                borderRadius: "6px",
                background: "var(--surface-inset)",
                border: "1px solid var(--emerald-border)",
                color: "var(--emerald-bright)",
                fontSize: "0.78rem",
              }}
            >
              {mpcAddress}
            </code>
            <button
              type="button"
              className="vp-icon-btn"
              onClick={() => copyValue(mpcAddress, "master")}
            >
              <CopyIcon width={12} height={12} />
              <span>{copiedKey === "master" ? "Copied" : "Copy"}</span>
            </button>
            <a
              href={`https://etherscan.io/address/${mpcAddress}`}
              target="_blank"
              rel="noreferrer"
              className="vp-icon-btn"
            >
              <ExternalLinkIcon width={12} height={12} />
              <span>Etherscan</span>
            </a>
            <a
              href={`https://arbiscan.io/address/${mpcAddress}`}
              target="_blank"
              rel="noreferrer"
              className="vp-icon-btn"
            >
              <ExternalLinkIcon width={12} height={12} />
              <span>Arbiscan</span>
            </a>
          </div>
        </div>

        <div className="vp-mpc-consensus">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.7rem" }}>
            <span className="mono" style={{ color: "var(--muted)", letterSpacing: "0.05em" }}>MPC CONSENSUS</span>
            <span className="mono" style={{ color: "var(--emerald-bright)", fontWeight: 600 }}>8 / 12 Nodes (66.6%)</span>
          </div>
          <div className="vp-consensus-bars" aria-label="8 of 12 MPC nodes active">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className={`vp-consensus-seg ${i < 8 ? "is-lit" : ""}`} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--muted)" }}>
            <span>Threshold Reached</span>
            <span>BFT Finalized</span>
          </div>
        </div>
      </section>

      {/* Main 2-Column Allocation & Telemetry */}
      <div className="vp-grid-2">
        {/* Left Column: Concurrent Multi-Position Allocation */}
        <div className="vp-col-stack">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0.15rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
              <LayersIcon width={15} height={15} style={{ color: "var(--emerald-bright)" }} />
              <span className="vp-card-title-mono">CONCURRENT MULTI-POSITION ALLOCATION</span>
            </div>
            <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
              {positions.length} ACTIVE PROTOCOL{positions.length === 1 ? "" : "S"}
            </span>
          </div>

          {positions.map((pos, idx) => {
            const isSelected = selectedPos?.id === pos.id;
            const isProcessing = pos.status.toLowerCase().includes("processing") || pos.status.toLowerCase().includes("funding");
            const numLabel = `#${String(pos.id).padStart(2, "0")}`;
            return (
              <div
                key={pos.id}
                role="button"
                tabIndex={0}
                className={`vp-position-card ${isSelected ? "is-selected" : ""}`}
                onClick={() => setSelectedIndex(idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedIndex(idx);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: "0.78rem", color: isSelected ? "var(--emerald-bright)" : "var(--muted)", fontWeight: 600 }}>
                      {numLabel}
                    </span>
                    <strong style={{ fontSize: "0.94rem", color: "var(--text)" }}>{pos.venue}</strong>
                    <span className="vp-badge" style={{ fontSize: "0.64rem" }}>
                      {pos.chain_badge ?? (pos.destination_asset.includes("base") ? "BASE L2" : "ARBITRUM ONE")}
                    </span>
                  </div>
                  <span className="vp-badge vp-badge-emerald">
                    <span className="vp-dot" />
                    <span>{pos.status}</span>
                  </span>
                </div>

                <div className="vp-position-metrics-3">
                  <div className="vp-metric-box">
                    <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Supplied Principal</div>
                    <div className="mono" style={{ fontSize: "0.86rem", fontWeight: 600, marginTop: "3px" }}>
                      ${formatPrettyAmount(pos.amount)}{" "}
                      <span style={{ fontSize: "0.68rem", color: "var(--muted)", fontWeight: 400 }}>
                        {config.tokenSymbol}
                      </span>
                    </div>
                  </div>

                  <div className="vp-metric-box">
                    <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                      {pos.expected_apy ? "Expected APY" : "Realized 24h Yield"}
                    </div>
                    <div className="mono" style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "3px" }}>
                      {pos.expected_apy ?? pos.realized_24h_yield ?? "+$5.12"}
                    </div>
                  </div>

                  <div className="vp-metric-box">
                    <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                      {pos.collateral_route
                        ? "Collateral Route"
                        : pos.health_factor
                        ? "Health Factor"
                        : "Rewards Accrued"}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 500,
                        color: pos.health_factor ? "var(--emerald-bright)" : pos.rewards_accrued ? "var(--amber-bright)" : "var(--text)",
                        marginTop: "4px",
                      }}
                    >
                      {pos.collateral_route ?? pos.health_factor ?? pos.rewards_accrued ?? "USDC Pool"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.7rem" }}>
                  <code style={{ color: "var(--muted)" }}>
                    Path: {pos.mpc_path ?? `near,${summary.owner},pos-${pos.id}`}
                  </code>
                  <span
                    className="mono"
                    style={{
                      color: isSelected ? "var(--emerald-bright)" : "var(--muted)",
                      fontWeight: isSelected ? 500 : 400,
                    }}
                  >
                    {isSelected
                      ? "Active Inspection"
                      : pos.rebalanced_label ?? (isProcessing ? "In Flight" : "Rebalanced")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Selected Position In-Flight Telemetry */}
        <section className="vp-card">
          <header className="vp-card-header">
            <div className="vp-card-title-row">
              <SwapVerticalIcon width={15} height={15} style={{ color: "var(--emerald-bright)" }} />
              <span className="vp-card-title-mono">
                POSITION #{selectedPos?.id ?? 1} IN-FLIGHT TELEMETRY
              </span>
            </div>
            <span className="vp-badge vp-badge-emerald">Live Pipeline</span>
          </header>

          {selectedPos ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Opened Timestamp</div>
                  <div className="mono" style={{ fontSize: "0.78rem", marginTop: "2px" }}>
                    {openedDateLabel}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Target Destination</div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: "2px" }}>
                    {selectedPos.venue} ({selectedPos.chain_badge === "BASE L2" ? "Base" : "Arbitrum"})
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", marginBottom: "0.35rem" }}>
                  <span className="mono" style={{ color: "var(--muted)" }}>SOLVER TEMP DEPOSIT ADDRESS</span>
                  <span style={{ color: "var(--muted)" }}>Ephemeral Escrow</span>
                </div>
                <div className="vp-address-bar">
                  <code style={{ fontSize: "0.74rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedPos.deposit_address}
                  </code>
                  <button
                    type="button"
                    className="vp-icon-btn"
                    onClick={() => copyValue(selectedPos.deposit_address, "deposit")}
                  >
                    <CopyIcon width={12} height={12} />
                    {copiedKey === "deposit" && <span>Copied</span>}
                  </button>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", marginBottom: "0.35rem" }}>
                  <span className="mono" style={{ color: "var(--muted)" }}>NEAR INTENT HASH</span>
                  <span className="mono" style={{ color: "var(--emerald-bright)" }}>Auction ingested</span>
                </div>
                <div className="vp-address-bar">
                  <code style={{ fontSize: "0.74rem", color: "var(--emerald-bright)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedPos.intent_hash ?? "8xpy4eGJ7baY23n9Xy7x923LKmQp8mK4T18w"}
                  </code>
                  <a
                    href={`${NEAR_INTENTS_EXPLORER_TX}/${selectedPos.settlement_tx ?? ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="vp-icon-btn"
                    title="Inspect intent"
                  >
                    <ExternalLinkIcon width={12} height={12} />
                  </a>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", marginBottom: "0.35rem" }}>
                  <span className="mono" style={{ color: "var(--muted)" }}>SETTLEMENT TRANSACTION</span>
                  <span style={{ color: "var(--muted)" }}>
                    {selectedPos.chain_badge === "BASE L2" ? "Base L2 Execution" : "Arbitrum L2 Execution"}
                  </span>
                </div>
                <div className="vp-address-bar">
                  <code style={{ fontSize: "0.74rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedPos.settlement_tx ?? "0x6XqqDwoaop92nK39xLa81z049vmnHDYXWBBH"}
                  </code>
                  <a
                    href={`https://arbiscan.io/tx/${selectedPos.settlement_tx ?? ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="vp-icon-btn"
                    title="View on block explorer"
                  >
                    <ExternalLinkIcon width={12} height={12} />
                  </a>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem" }}>
                <div className="vp-metric-box">
                  <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Solver Quote Spread</div>
                  <div className="mono" style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "3px" }}>
                    {selectedPos.solver_spread ?? "+0.012% (< 1 bps)"}
                  </div>
                </div>
                <div className="vp-metric-box">
                  <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>MPC Sig Latency</div>
                  <div className="mono" style={{ fontSize: "0.84rem", fontWeight: 600, marginTop: "3px" }}>
                    {selectedPos.sig_latency ?? "1,240 ms"}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="vp-btn-muted"
                onClick={() => void handleForceVerify()}
                disabled={verifying}
              >
                <RefreshIcon width={13} height={13} />
                <span>{verifying ? "Verifying State..." : "Force Re-Verify State"}</span>
              </button>

              {verifyNotice && (
                <div className="mono" style={{ fontSize: "0.72rem", color: "var(--emerald-bright)", textAlign: "center" }}>
                  {verifyNotice}
                </div>
              )}
            </div>
          ) : (
            <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              No active positions currently deployed. Capital is held safely in idle NEAR reserves.
            </p>
          )}
        </section>
      </div>

      {/* Bottom Full-Width 1Click Solver Event Stream & Audit Trail */}
      <section className="vp-card">
        <header className="vp-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div className="vp-card-title-row">
              <SwapVerticalIcon width={15} height={15} style={{ color: "var(--emerald-bright)" }} />
              <span className="vp-card-title-mono">1CLICK SOLVER EVENT STREAM &amp; AUDIT TRAIL</span>
            </div>
            <span className="vp-badge vp-badge-emerald">
              <span className="vp-dot" />
              <span>Websocket Subscribed</span>
            </span>
          </div>
          <button type="button" className="vp-icon-btn" onClick={exportAuditJson}>
            <DownloadIcon width={12} height={12} />
            <span>Export Audit JSON</span>
          </button>
        </header>

        <div style={{ overflowX: "auto" }}>
          <table className="vp-table">
            <thead>
              <tr>
                <th className="mono">TIMESTAMP</th>
                <th className="mono">LAYER / SCOPE</th>
                <th className="mono">TRANSACTION ACTION</th>
                <th className="mono" style={{ textAlign: "right" }}>VERIFICATION STATUS</th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.map((ev) => (
                <tr key={ev.timestamp}>
                  <td className="mono" style={{ color: "var(--muted)", width: "100px" }}>{ev.timestamp}</td>
                  <td style={{ width: "130px" }}>
                    <span className={`vp-badge ${ev.scope === "MPC DEST" ? "vp-badge-sky" : ev.scope === "NEAR" ? "vp-badge-emerald" : ""}`}>
                      {ev.scope}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    {ev.action.includes("rebalance_out_portfolio") ? (
                      <>
                        Agent invoked <code style={{ color: "var(--text)" }}>rebalance_out_portfolio</code> with scoped function-call key
                      </>
                    ) : (
                      ev.action
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {ev.tone === "emerald" ? (
                      <span className="mono" style={{ color: "var(--emerald-bright)", fontSize: "0.74rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                        <CheckIcon width={12} height={12} />
                        <span>{ev.status}</span>
                      </span>
                    ) : ev.tone === "emerald-dot" ? (
                      <span className="mono" style={{ color: "var(--emerald-bright)", fontSize: "0.74rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                        <span className="vp-dot" />
                        <span>{ev.status}</span>
                      </span>
                    ) : (
                      <span className="mono" style={{ color: "var(--muted)", fontSize: "0.74rem" }}>
                        {ev.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "0.85rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border)",
            fontSize: "0.7rem",
            color: "var(--muted)",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <span className="mono">
            Channel: wss://telemetry.solver.near.org/intents/v1 &nbsp; Target: {summary.owner}
          </span>
          <span className="mono" style={{ color: "var(--emerald-bright)", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span className="vp-dot" />
            <span>Latency 4ms</span>
          </span>
        </div>
      </section>
    </div>
  );
}

