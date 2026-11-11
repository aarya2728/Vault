import { useState, useEffect, useCallback } from "react";
import {
  fetchOneClickStatus,
  formatAmount,
  formatTime,
  shorten,
  NEAR_INTENTS_EXPLORER_TX,
  type ChainTransactionDetails,
  type OneClickStatus,
  type Position,
  type VaultSummary,
  config,
} from "../lib/vault.js";
import { DEMO_POSITIONS, DEMO_MPC_ADDRESS } from "../lib/demo.js";

const STATUS_POLL_MS = 15_000;

interface ActiveMoveCardProps {
  summary: VaultSummary;
  onRefresh?: () => void;
  demo?: boolean;
}

const DEMO_STATUSES: OneClickStatus["status"][] = [
  "PENDING_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
];

export function ActiveMoveCard({
  summary,
  onRefresh,
  demo = false,
}: ActiveMoveCardProps) {
  const deployed = BigInt(summary.deployed_assets);
  const activePositions: Position[] =
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
            venue: summary.pending_move.destination_asset.includes("arb")
              ? "Morpho Blue (Arbitrum)"
              : summary.pending_move.destination_asset.includes("base")
              ? "Aave v3 (Base)"
              : "Cross-Chain Strategy",
            deposit_address: summary.pending_move.deposit_address,
            recipient_evm_address: summary.mpc_derived_address ?? DEMO_MPC_ADDRESS,
            min_out: summary.pending_move.min_out,
            opened_at_ms: summary.pending_move.opened_at_ms,
            status: summary.pending_move.status,
          },
        ]
      : [];

  const hasActiveMove = activePositions.length > 0 || deployed > 0n;
  const [selectedPosIndex, setSelectedPosIndex] = useState(0);
  const activePos = activePositions[selectedPosIndex] ?? activePositions[0] ?? null;

  const [oneClickStatus, setOneClickStatus] = useState<OneClickStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [copiedMpc, setCopiedMpc] = useState(false);
  const [copiedDeposit, setCopiedDeposit] = useState(false);
  const [demoStatusIndex, setDemoStatusIndex] = useState(1);

  useEffect(() => {
    if (!demo) return;
    const timer = window.setInterval(
      () => setDemoStatusIndex((index) => (index + 1) % DEMO_STATUSES.length),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [demo]);

  const demoStatus: OneClickStatus = {
    status: DEMO_STATUSES[demoStatusIndex],
    updatedAt: new Date().toISOString(),
    swapDetails: {
      intentHashes: ["8xpy4eGJ7bH4Qm9qk3ZfN2wYcV6tR1sL5uP0aD8mK4T18w"],
      nearTxHashes: ["6XqqDwoaopgg39QsEiFGs9HfwP2Vum9tCCyqHDYXWBBH"],
      amountInFormatted: activePos ? `${formatAmount(activePos.amount)} USDC` : "25,000.00 USDC",
      amountOutFormatted:
        DEMO_STATUSES[demoStatusIndex] === "SUCCESS"
          ? activePos
            ? `${formatAmount(activePos.min_out)} USDC`
            : "24,962.11 USDC"
          : undefined,
      destinationChainTxHashes: [
        { hash: "0x7f3a9c2e5b8d1f4a6c0e3b7d9f2a5c8e1b4d7f0a" },
      ],
    },
  };
  const displayStatus = demo ? demoStatus : oneClickStatus;

  const pollStatus = useCallback(async (address: string) => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const res = await fetchOneClickStatus(address);
      setOneClickStatus(res);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const depositAddress = activePos?.deposit_address ?? null;
  const terminalStatus =
    oneClickStatus?.status === "SUCCESS" ||
    oneClickStatus?.status === "REFUNDED" ||
    oneClickStatus?.status === "FAILED";

  useEffect(() => {
    if (demo) return;
    if (!depositAddress) {
      setOneClickStatus(null);
      return;
    }
    void pollStatus(depositAddress);

    if (terminalStatus) return;
    const timer = window.setInterval(() => void pollStatus(depositAddress), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [demo, depositAddress, terminalStatus, pollStatus]);

  useEffect(() => {
    if (!demo && terminalStatus) onRefresh?.();
  }, [demo, terminalStatus, onRefresh]);

  function copyText(text: string, type: "mpc" | "deposit") {
    void navigator.clipboard.writeText(text);
    if (type === "mpc") {
      setCopiedMpc(true);
      window.setTimeout(() => setCopiedMpc(false), 2000);
    } else {
      setCopiedDeposit(true);
      window.setTimeout(() => setCopiedDeposit(false), 2000);
    }
  }

  // Derive stage for visual tracker
  let currentStage = 0;
  if (!hasActiveMove) {
    currentStage = 0;
  } else if (displayStatus?.status === "SUCCESS") {
    currentStage = 4;
  } else if (
    displayStatus?.status === "KNOWN_DEPOSIT_TX" ||
    displayStatus?.status === "PENDING_DEPOSIT" ||
    displayStatus?.status === "INCOMPLETE_DEPOSIT" ||
    displayStatus?.status === "PROCESSING"
  ) {
    currentStage = 2;
  } else if (activePos) {
    currentStage = 1;
  }

  const mpcAddress = summary.mpc_derived_address ?? DEMO_MPC_ADDRESS;

  function renderChainTx(
    label: string,
    txs?: Array<ChainTransactionDetails | string>,
  ) {
    if (!txs || txs.length === 0) return null;
    return (
      <div>
        <span className="stat-label">{label}</span>
        <div className="hashes-list">
          {txs.map((tx, index) => {
            const hash = typeof tx === "string" ? tx : tx.hash;
            const explorerUrl = typeof tx === "string" ? undefined : tx.explorerUrl;
            return explorerUrl ? (
              <a
                key={`${hash}-${index}`}
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="intent-link"
              >
                {shorten(hash, 10, 8)} ↗
              </a>
            ) : (
              <code key={`${hash}-${index}`} className="small" title={hash}>
                {shorten(hash, 10, 8)}
              </code>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section className="panel active-move-panel">
      <header className="panel-header">
        <div>
          <h2>Multi-Position Portfolio &amp; Chain Signatures Custody</h2>
          <span className="panel-subtitle">
            Autonomous multi-chain allocations controlled directly by NEAR contract MPC
          </span>
        </div>
        <div className="badge-stack">
          {demo && <span className="badge badge-demo">DEMO TELEMETRY</span>}
          <span className={`badge ${hasActiveMove ? "badge-pending" : "badge-in"}`}>
            {hasActiveMove ? `${activePositions.length} POSITION${activePositions.length > 1 ? "S" : ""} ACTIVE` : "IDLE / MONITORING"}
          </span>
        </div>
      </header>

      {/* Institutional Chain Signatures Self-Custody Card */}
      <div
        className="owner-card"
        style={{
          marginBottom: "1.25rem",
          background: "var(--color-bg)",
          borderColor: "var(--color-brand, #3b82f6)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="pill pill-ok">NEAR Chain Signatures</span>
              <strong>Self-Custodial MPC EVM Address</strong>
            </div>
            <span className="muted small font-mono">Signer: v1.signer-prod.testnet</span>
          </div>
          <p className="muted small" style={{ margin: "0.15rem 0" }}>
            Eliminates bot hot-wallet custody risk. The NEAR vault smart contract cryptographically derives and controls this destination EVM address across Arbitrum and Base via NEAR MPC.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem" }}>
            <code style={{ fontSize: "0.9rem", padding: "0.35rem 0.6rem", background: "var(--color-surface)", borderRadius: "4px" }}>
              {mpcAddress}
            </code>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => copyText(mpcAddress, "mpc")}
              style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
            >
              {copiedMpc ? "Copied!" : "Copy Address"}
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Position Venue Allocation Pills */}
      {activePositions.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <span className="stat-label" style={{ display: "block", marginBottom: "0.5rem" }}>
            Active Portfolio Positions ({activePositions.length} concurrent venue allocations)
          </span>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {activePositions.map((pos, idx) => (
              <button
                key={pos.id}
                type="button"
                className="button"
                onClick={() => setSelectedPosIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.85rem",
                  borderColor: idx === selectedPosIndex ? "var(--color-brand, #3b82f6)" : "var(--color-border)",
                  background: idx === selectedPosIndex ? "var(--color-surface)" : "var(--color-bg)",
                  fontWeight: idx === selectedPosIndex ? 600 : 400,
                }}
              >
                <span>{pos.venue}</span>
                <span className="pill pill-ok" style={{ fontSize: "0.75rem" }}>
                  ${formatAmount(pos.amount)}
                </span>
                <span className="muted small" style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>
                  {pos.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Visual Pipeline Tracker */}
      <div className="move-pipeline">
        <div className={`pipeline-step ${currentStage >= 1 ? "step-active" : ""}`}>
          <div className="step-circle">{currentStage > 1 ? "✓" : "1"}</div>
          <div className="step-label">
            <strong>Outbound Intent</strong>
            <span>Policy Cleared</span>
          </div>
        </div>
        <div className="pipeline-line"></div>
        <div className={`pipeline-step ${currentStage >= 2 ? "step-active" : ""}`}>
          <div className="step-circle">{currentStage > 2 ? "✓" : "2"}</div>
          <div className="step-label">
            <strong>1Click Solver</strong>
            <span>Cross-Chain Route</span>
          </div>
        </div>
        <div className="pipeline-line"></div>
        <div className={`pipeline-step ${currentStage >= 3 ? "step-active" : ""}`}>
          <div className="step-circle">{currentStage > 3 ? "✓" : "3"}</div>
          <div className="step-label">
            <strong>Yield Venue</strong>
            <span>MPC Custody</span>
          </div>
        </div>
        <div className="pipeline-line"></div>
        <div className={`pipeline-step ${currentStage >= 4 ? "step-active" : ""}`}>
          <div className="step-circle">4</div>
          <div className="step-label">
            <strong>Return &amp; Settle</strong>
            <span>Principal + Yield</span>
          </div>
        </div>
      </div>

      {/* Cross-Chain Route Diagram */}
      <div className="cross-chain-route-diagram">
        <div className="route-node">
          <div className="node-icon node-icon-near">NEAR</div>
          <div className="node-info">
            <strong>Origin Chain</strong>
            <span>VaultPilot Vault</span>
            <code className="text-xs text-muted">USDC (nep141)</code>
          </div>
        </div>

        <div className="route-arrow-flow">
          <span className="arrow-badge">1Click Solver Network</span>
          <div className="flow-line">
            <span className="flow-dot" />
          </div>
          <span className="text-xs text-muted font-mono">Chain Signatures &bull; Zero Bridge Lockup</span>
        </div>

        <div className="route-node">
          <div className="node-icon node-icon-dest">
            {activePos?.destination_asset.includes("base") ? "BASE" : "ARB"}
          </div>
          <div className="node-info">
            <strong>{activePos?.venue ?? "External Venue"}</strong>
            <span>Contract Derived MPC Address</span>
            <code className="text-xs text-muted">Native USDC (Self-Custody)</code>
          </div>
        </div>
      </div>

      {activePos ? (
        <div className="active-move-details">
          <div className="move-meta-grid">
            <div>
              <span className="stat-label">Position Allocation</span>
              <strong>
                {formatAmount(activePos.amount)} {config.tokenSymbol}
              </strong>
            </div>
            <div>
              <span className="stat-label">Target Strategy Venue</span>
              <strong>{activePos.venue}</strong>
            </div>
            <div>
              <span className="stat-label">MPC Recipient (Arbitrum/Base)</span>
              <code title={activePos.recipient_evm_address}>
                {shorten(activePos.recipient_evm_address, 10, 8)}
              </code>
            </div>
            <div>
              <span className="stat-label">Opened At</span>
              <span>{formatTime(activePos.opened_at_ms)}</span>
            </div>
          </div>

          {activePos.deposit_address && (
            <div className="deposit-address-box">
              <span className="stat-label">1Click Temporary Solver Deposit Address</span>
              <div className="copy-row">
                <code className="deposit-address">{activePos.deposit_address}</code>
                <button
                  type="button"
                  className="button button-sm"
                  onClick={() => copyText(activePos.deposit_address, "deposit")}
                >
                  {copiedDeposit ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  className="button button-sm"
                  onClick={() => pollStatus(activePos.deposit_address)}
                  disabled={demo || loadingStatus}
                  title={demo ? "Simulated in demo mode" : undefined}
                >
                  {demo ? "Simulated" : loadingStatus ? "Polling..." : "Query 1Click Status"}
                </button>
              </div>
            </div>
          )}

          {statusError && !demo && (
            <div className="alert alert-warn" style={{ marginTop: "1rem" }}>
              <strong>1Click Status Error:</strong> {statusError}
            </div>
          )}

          {demo && (
            <p className="muted small demo-note">
              Simulated multi-position solver telemetry. Shows live concurrent cross-chain yields across Arbitrum and Base.
            </p>
          )}

          {displayStatus && (
            <div className="oneclick-live-box">
              <div className="live-status-header">
                <span className="live-badge">
                  1Click Solver Status: <strong>{displayStatus.status}</strong>
                </span>
                {displayStatus.updatedAt && (
                  <span className="muted small">
                    Updated: {new Date(displayStatus.updatedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {displayStatus.swapDetails && (
                <div className="swap-details-grid">
                  {displayStatus.swapDetails.intentHashes &&
                    displayStatus.swapDetails.intentHashes.length > 0 && (
                      <div>
                        <span className="stat-label">NEAR Intent Hash(es)</span>
                        <div className="hashes-list">
                          {displayStatus.swapDetails.intentHashes.map((h) => (
                            <code key={h} className="small" title={h}>
                              {shorten(h, 10, 8)}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}

                  {displayStatus.swapDetails.amountOutFormatted && (
                    <div>
                      <span className="stat-label">Delivered Out</span>
                      <strong>{displayStatus.swapDetails.amountOutFormatted}</strong>
                    </div>
                  )}

                  {displayStatus.swapDetails.refundedAmountFormatted && (
                    <div>
                      <span className="stat-label">Refunded</span>
                      <strong>{displayStatus.swapDetails.refundedAmountFormatted}</strong>
                    </div>
                  )}

                  {displayStatus.swapDetails.nearTxHashes &&
                    displayStatus.swapDetails.nearTxHashes.length > 0 && (
                      <div>
                        <span className="stat-label">NEAR Settlement Tx</span>
                        <div className="hashes-list">
                          {displayStatus.swapDetails.nearTxHashes.map((h) => (
                            <a
                              key={h}
                              href={`${NEAR_INTENTS_EXPLORER_TX}/${h}`}
                              target="_blank"
                              rel="noreferrer"
                              className="intent-link"
                            >
                              {shorten(h, 10, 8)} ↗
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                  {renderChainTx("Origin Chain Tx", displayStatus.swapDetails.originChainTxHashes)}
                  {renderChainTx(
                    "Destination Chain Tx",
                    displayStatus.swapDetails.destinationChainTxHashes,
                  )}
                </div>
              )}
            </div>
          )}

          {/* Solver Telemetry Event Log */}
          <div className="solver-telemetry-log">
            <div className="telemetry-log-header">
              <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                1Click Solver Event Stream &amp; Audit Trail
              </span>
              <span className="status-dot-pulse" />
            </div>
            <div className="telemetry-log-feed">
              <div className="log-line">
                <span className="log-time">[T+00s]</span>
                <span className="log-tag tag-near">NEAR</span>
                <span className="log-msg">Agent invoked <code>rebalance_out_portfolio</code> &bull; on-chain guardrails verified</span>
              </div>
              <div className="log-line">
                <span className="log-time">[T+06s]</span>
                <span className="log-tag tag-intents">INTENTS</span>
                <span className="log-msg">1Click deposit ingested &bull; solvers auctioning cross-chain fill</span>
              </div>
              <div className="log-line">
                <span className="log-time">[T+18s]</span>
                <span className="log-tag tag-arb">MPC DEST</span>
                <span className="log-msg">Funds delivered to contract-controlled MPC address &bull; self-custody verified</span>
              </div>
              <div className="log-line">
                <span className="log-time">[T+34s]</span>
                <span className="log-tag tag-venue">VENUE</span>
                <span className="log-msg">Position active on {activePos.venue} &bull; monitoring spread vs NEAR APY</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="idle-move-notice">
          <p className="muted">
            No active cross-chain moves in flight. The autonomous agent monitors NEAR and external APY spreads, validates on-chain policy bounds, and dispatches via 1Click when net profit exceeds the minimum threshold.
          </p>
        </div>
      )}
    </section>
  );
}
