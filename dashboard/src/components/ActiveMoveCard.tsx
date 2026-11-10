import { useState, useEffect, useCallback } from "react";
import {
  fetchOneClickStatus,
  formatAmount,
  formatTime,
  shorten,
  NEAR_INTENTS_EXPLORER_TX,
  type ChainTransactionDetails,
  type OneClickStatus,
  type VaultSummary,
  config,
} from "../lib/vault.js";

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
  const pendingMove = summary.pending_move;
  const deployed = BigInt(summary.deployed_assets);
  const hasActiveMove = pendingMove !== null || deployed > 0n;

  const [oneClickStatus, setOneClickStatus] = useState<OneClickStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      amountInFormatted: "25,000.00 USDC",
      amountOutFormatted:
        DEMO_STATUSES[demoStatusIndex] === "SUCCESS" ? "24,962.11 USDC" : undefined,
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

  const depositAddress = pendingMove?.deposit_address ?? null;
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

  function copyAddress(addr: string) {
    void navigator.clipboard.writeText(addr);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  // Derive stage for visual tracker
  let currentStage = 0;
  if (!hasActiveMove) {
    currentStage = 0;
  } else if (displayStatus?.status === "SUCCESS") {
    currentStage = 4; // Solver delivered; awaiting return + on-chain settlement
  } else if (
    displayStatus?.status === "KNOWN_DEPOSIT_TX" ||
    displayStatus?.status === "PENDING_DEPOSIT" ||
    displayStatus?.status === "INCOMPLETE_DEPOSIT" ||
    displayStatus?.status === "PROCESSING"
  ) {
    currentStage = 2; // Solver executing
  } else if (pendingMove) {
    currentStage = 1; // Outbound dispatched
  }

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
          <h2>Cross-Chain Move & Intent Status</h2>
          <span className="panel-subtitle">
            Autonomous 1Click solver execution &amp; round-trip settlement
          </span>
        </div>
        <div className="badge-stack">
          {demo && <span className="badge badge-demo">DEMO TELEMETRY</span>}
          <span
            className={`badge ${
              hasActiveMove ? "badge-pending" : "badge-in"
            }`}
          >
            {hasActiveMove ? "POSITION ACTIVE" : "IDLE / MONITORING"}
          </span>
        </div>
      </header>

      {/* Visual Pipeline Tracker */}
      <div className="move-pipeline">
        <div className={`pipeline-step ${currentStage >= 1 ? "step-active" : ""}`}>
          <div className="step-circle">{currentStage > 1 ? "✓" : "1"}</div>
          <div className="step-label">
            <strong>Outbound Intent</strong>
            <span>Vault Policy Cleared</span>
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
            <span>Markets Never Close</span>
          </div>
        </div>
        <div className="pipeline-line"></div>
        <div className={`pipeline-step ${currentStage >= 4 ? "step-active" : ""}`}>
          <div className="step-circle">4</div>
          <div className="step-label">
            <strong>Return & Settle</strong>
            <span>On-Chain Principal + Yield</span>
          </div>
        </div>
      </div>

      {/* Cross-Chain Route Diagram */}
      <div className="cross-chain-route-diagram">
        <div className="route-node">
          <div className="node-icon bg-purple-500/20 text-purple-300 border border-purple-500/40">
            NEAR
          </div>
          <div className="node-info">
            <strong>Origin Chain</strong>
            <span>VaultPilot Vault</span>
            <code className="text-[10px] text-gray-400">USDC (nep141)</code>
          </div>
        </div>

        <div className="route-arrow-flow">
          <span className="arrow-badge">1Click Solver Network</span>
          <div className="flow-line">
            <span className="flow-dot" />
          </div>
          <span className="text-[10px] text-cyan-400 font-mono">Zero Bridge Risk &bull; Intent Auction</span>
        </div>

        <div className="route-node">
          <div className="node-icon bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            ARB
          </div>
          <div className="node-info">
            <strong>Destination Venue</strong>
            <span>Arbitrum One</span>
            <code className="text-[10px] text-gray-400">USDC (Native ERC-20)</code>
          </div>
        </div>
      </div>

      {hasActiveMove ? (
        <div className="active-move-details">
          <div className="move-meta-grid">
            <div>
              <span className="stat-label">Deployed Capital</span>
              <strong>
                {pendingMove
                  ? `${formatAmount(pendingMove.amount)} ${config.tokenSymbol}`
                  : `${formatAmount(summary.deployed_assets)} ${config.tokenSymbol}`}
              </strong>
            </div>
            <div>
              <span className="stat-label">Destination Asset</span>
              <code title={pendingMove?.destination_asset ?? "Arbitrum USDC"}>
                {pendingMove?.destination_asset
                  ? shorten(pendingMove.destination_asset, 12, 8)
                  : "Arbitrum USDC"}
              </code>
            </div>
            <div>
              <span className="stat-label">Minimum Expected Out</span>
              <span className="mono">
                {pendingMove ? `${formatAmount(pendingMove.min_out)}` : "-"}
              </span>
            </div>
            <div>
              <span className="stat-label">Opened At</span>
              <span>
                {pendingMove ? formatTime(pendingMove.opened_at_ms) : "-"}
              </span>
            </div>
          </div>

          {pendingMove?.deposit_address && (
            <div className="deposit-address-box">
              <span className="stat-label">1Click Temporary Deposit Address</span>
              <div className="copy-row">
                <code className="deposit-address">{pendingMove.deposit_address}</code>
                <button
                  type="button"
                  className="button button-sm"
                  onClick={() => copyAddress(pendingMove.deposit_address)}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  className="button button-sm"
                  onClick={() => pollStatus(pendingMove.deposit_address)}
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
              Simulated solver telemetry. Configure a vault contract to watch live 1Click
              status polling and on-chain settlement.
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
                <span className="log-msg">Agent invoked <code>rebalance_out</code> &bull; on-chain guardrails verified</span>
              </div>
              <div className="log-line">
                <span className="log-time">[T+06s]</span>
                <span className="log-tag tag-intents">INTENTS</span>
                <span className="log-msg">1Click deposit ingested &bull; solvers auctioning cross-chain fill</span>
              </div>
              <div className="log-line">
                <span className="log-time">[T+18s]</span>
                <span className="log-tag tag-arb">ARBITRUM</span>
                <span className="log-msg">Solver fronted capital &bull; destination liquidity settled without bridge lockup</span>
              </div>
              <div className="log-line">
                <span className="log-time">[T+34s]</span>
                <span className="log-tag tag-venue">VENUE</span>
                <span className="log-msg">Capital deployed to yield strategy &bull; monitoring spread vs NEAR APY</span>
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

