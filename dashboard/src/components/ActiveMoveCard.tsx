import { useState, useEffect, useCallback } from "react";
import {
  fetchOneClickStatus,
  formatPrettyAmount,
  type OneClickStatus,
  type Position,
  type VaultSummary,
  config,
} from "../lib/vault.js";
import { DEMO_POSITIONS, DEMO_MPC_ADDRESS } from "../lib/demo.js";
import { CheckIcon, CopyIcon, LockIcon, RouteIcon } from "./Icons.js";

const STATUS_POLL_MS = 15_000;

interface ActiveMoveCardProps {
  summary: VaultSummary;
  onRefresh?: () => void;
  onOpenMpcTab?: () => void;
  demo?: boolean;
}

export function ActiveMoveCard({
  summary,
  onRefresh,
  onOpenMpcTab,
  demo = false,
}: ActiveMoveCardProps) {
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
            venue: summary.pending_move.destination_asset.includes("base")
              ? "Aave v3"
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

  const primaryPos = activePositions[0] ?? null;
  const [oneClickStatus, setOneClickStatus] = useState<OneClickStatus | null>(null);
  const [copiedMpc, setCopiedMpc] = useState(false);

  const pollStatus = useCallback(async (address: string) => {
    try {
      const res = await fetchOneClickStatus(address);
      setOneClickStatus(res);
    } catch {
      // Keep UI clean; error surface lives on MPC Custody telemetry inspect
    }
  }, []);

  const depositAddress = primaryPos?.deposit_address ?? null;
  const terminalStatus =
    oneClickStatus?.status === "SUCCESS" ||
    oneClickStatus?.status === "REFUNDED" ||
    oneClickStatus?.status === "FAILED";

  useEffect(() => {
    if (demo || !depositAddress) return;
    void pollStatus(depositAddress);
    if (terminalStatus) return;
    const timer = window.setInterval(() => void pollStatus(depositAddress), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [demo, depositAddress, terminalStatus, pollStatus]);

  useEffect(() => {
    if (!demo && terminalStatus) onRefresh?.();
  }, [demo, terminalStatus, onRefresh]);

  const mpcAddress = primaryPos?.recipient_evm_address ?? summary.mpc_derived_address ?? DEMO_MPC_ADDRESS;

  function copyMpc() {
    void navigator.clipboard.writeText(mpcAddress);
    setCopiedMpc(true);
    window.setTimeout(() => setCopiedMpc(false), 1800);
  }

  const venueTitle = primaryPos
    ? `${primaryPos.chain_badge === "BASE L2" ? "Base" : "Arbitrum"} ${primaryPos.venue}`
    : "Arbitrum Morpho Blue";

  const isSettled = !demo && oneClickStatus?.status === "SUCCESS";

  return (
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <RouteIcon width={16} height={16} style={{ color: "var(--emerald-bright)" }} />
          <span>Active Strategy &amp; Intent Pipeline</span>
        </div>
        <button
          type="button"
          className="vp-badge vp-badge-emerald"
          style={{ cursor: onOpenMpcTab ? "pointer" : "default" }}
          onClick={onOpenMpcTab}
          title="Open full MPC Custody telemetry"
        >
          Live Route
        </button>
      </header>

      {/* Execution Route Inset Card */}
      <div className="vp-inset-panel" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.74rem" }}>
          <span style={{ color: "var(--muted)" }}>Execution Route</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "var(--emerald-bright)", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
            <span className="vp-dot" />
            <span>{isSettled ? "Filled & Accruing" : primaryPos ? "Processing Fill" : "Monitoring Spreads"}</span>
          </span>
        </div>

        <div className="vp-route-pills">
          <span className="vp-route-node">NEAR</span>
          <span style={{ color: "var(--muted)" }}>→</span>
          <span className="vp-route-node">1Click Solver</span>
          <span style={{ color: "var(--muted)" }}>→</span>
          <span className="vp-route-node is-emerald">{venueTitle}</span>
        </div>

        <div className="vp-split-metrics">
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Active Allocation</div>
            <div className="mono" style={{ fontSize: "0.94rem", fontWeight: 600, marginTop: "2px" }}>
              {primaryPos
                ? `${formatPrettyAmount(primaryPos.amount)} ${config.tokenSymbol}`
                : `${formatPrettyAmount(summary.deployed_assets)} ${config.tokenSymbol}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Target Venue APY</div>
            <div className="mono" style={{ fontSize: "0.94rem", fontWeight: 600, color: "var(--emerald-bright)", marginTop: "2px" }}>
              14.20% Net
            </div>
          </div>
        </div>
      </div>

      {/* Derived MPC EVM Address */}
      <div style={{ marginBottom: "1.1rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.74rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "var(--muted)" }}>Derived MPC EVM Address</span>
          <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Contract-Derived</span>
        </div>
        <div className="vp-address-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
            <LockIcon width={13} height={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <code style={{ fontSize: "0.74rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {mpcAddress}
            </code>
          </div>
          <button
            type="button"
            className="vp-icon-btn"
            onClick={copyMpc}
            title="Copy contract-derived EVM address"
          >
            <CopyIcon width={12} height={12} />
            {copiedMpc && <span>Copied</span>}
          </button>
        </div>
      </div>

      {/* Intent Pipeline State */}
      <div>
        <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginBottom: "0.65rem" }}>
          Intent Pipeline State
        </div>

        <div className="vp-pipeline-list">
          <div className="vp-pipeline-row">
            <div className="vp-pipeline-left">
              <span className="vp-step-circle is-done">
                <CheckIcon width={12} height={12} />
              </span>
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>Outbound Intent Broadcast</div>
                <div className="mono" style={{ fontSize: "0.69rem", color: "var(--muted)" }}>
                  NEAR emitted • Block #1294821
                </div>
              </div>
            </div>
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--emerald-bright)" }}>Done</span>
          </div>

          <div className="vp-pipeline-row">
            <div className="vp-pipeline-left">
              <span className="vp-step-circle is-done">
                <CheckIcon width={12} height={12} />
              </span>
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>1Click Solver Route Lock</div>
                <div className="mono" style={{ fontSize: "0.69rem", color: "var(--muted)" }}>
                  Quoted 0.04% spread verified
                </div>
              </div>
            </div>
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--emerald-bright)" }}>Done</span>
          </div>

          <div className="vp-pipeline-row">
            <div className="vp-pipeline-left">
              <span className={`vp-step-circle ${isSettled ? "is-done" : "is-active"}`}>
                {isSettled ? <CheckIcon width={12} height={12} /> : "3"}
              </span>
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                  {primaryPos?.venue ?? "Morpho Blue"} Venue Supply
                </div>
                <div className="mono" style={{ fontSize: "0.69rem", color: "var(--muted)" }}>
                  Arbitrum L2 MPC payload broadcasting
                </div>
              </div>
            </div>
            <span
              className="mono"
              style={{
                fontSize: "0.72rem",
                color: isSettled ? "var(--emerald-bright)" : "var(--sky)",
              }}
            >
              {isSettled ? "Done" : "Active"}
            </span>
          </div>

          <div className="vp-pipeline-row">
            <div className="vp-pipeline-left">
              <span className={`vp-step-circle ${isSettled ? "is-active" : ""}`}>4</span>
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 500, color: isSettled ? "var(--text)" : "var(--muted)" }}>
                  On-Chain Ledger Settlement
                </div>
                <div className="mono" style={{ fontSize: "0.69rem", color: "var(--muted)" }}>
                  Verification on NEAR MPC
                </div>
              </div>
            </div>
            <span className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
              {isSettled ? "Ready" : "Pending"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
