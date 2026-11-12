import { useEffect, useState } from "react";
import { useNear } from "../providers/NearProvider.js";
import {
  config,
  formatAmount,
  parseAmount,
  type Policy,
  type TimelockedPolicyProposal,
  type VaultSummary,
} from "../lib/vault.js";
import { AlertTriangleIcon, ClockIcon, LockIcon, ShieldOutlineIcon } from "./Icons.js";

const GAS = "100000000000000";

function formatShortUsdK(raw: string | number | bigint): string {
  const num = Number(BigInt(raw)) / 10 ** config.tokenDecimals;
  if (num >= 1000) return `$${Math.round(num / 1000)}k`;
  return `$${num.toFixed(0)}`;
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "00:00:00";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const secs = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${mins}:${secs}`;
}

export function OwnerControls({
  summary,
  onRefreshed,
  demo = false,
}: {
  summary: VaultSummary;
  onRefreshed: () => void;
  demo?: boolean;
}) {
  const { accountId, callMethod } = useNear();
  const isOwner = accountId !== null && accountId === summary.owner;
  const canControl = isOwner && !demo;

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [propMaxPerMove, setPropMaxPerMove] = useState(formatAmount(summary.policy.max_per_move));
  const [propDailyCap, setPropDailyCap] = useState(formatAmount(summary.policy.daily_cap));
  const [propSlippageBps, setPropSlippageBps] = useState(
    summary.policy.max_slippage_bps.toString(),
  );

  const [demoProposal, setDemoProposal] = useState<TimelockedPolicyProposal | null | undefined>(
    summary.pending_policy_proposal,
  );
  const [demoPaused, setDemoPaused] = useState(summary.paused);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const activeProposal = demo ? demoProposal : summary.pending_policy_proposal;
  const pausedState = demo ? demoPaused : summary.paused;

  const msRemaining = activeProposal ? Math.max(0, activeProposal.eta_ms - nowMs) : 0;
  const isTimelockReady = activeProposal ? msRemaining === 0 : false;
  const hoursRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60)));

  async function handleTogglePause() {
    setError(null);
    if (demo) {
      setDemoPaused((p) => !p);
      return;
    }
    if (!canControl) {
      setError("Connect the vault owner wallet to pause/unpause.");
      return;
    }
    setLoading("pause");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "pause",
        args: { paused: !summary.paused },
        gas: GAS,
        deposit: "0",
      });
      onRefreshed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleExecutePolicy() {
    setError(null);
    if (demo) {
      setDemoProposal(null);
      return;
    }
    if (!canControl) {
      setError("Connect the vault owner wallet to execute policy.");
      return;
    }
    setLoading("execute");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "execute_policy",
        args: {},
        gas: GAS,
        deposit: "0",
      });
      onRefreshed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleProposePolicy(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    let maxPerMoveParsed: bigint;
    let dailyCapParsed: bigint;
    let slippageParsed: number;

    try {
      maxPerMoveParsed = parseAmount(propMaxPerMove);
      dailyCapParsed = parseAmount(propDailyCap);
      slippageParsed = parseInt(propSlippageBps, 10);
      if (Number.isNaN(slippageParsed) || slippageParsed <= 0 || slippageParsed > 1000) {
        throw new Error("Slippage must be between 1 and 1000 bps.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    const newPolicy: Policy = {
      min_move: summary.policy.min_move,
      max_per_move: maxPerMoveParsed.toString(),
      daily_cap: dailyCapParsed.toString(),
      max_slippage_bps: slippageParsed,
      allowed_destination_assets: summary.policy.allowed_destination_assets,
    };

    if (demo) {
      setDemoProposal({
        policy: newPolicy,
        proposed_at_ms: Date.now(),
        eta_ms: Date.now() + 48 * 3600 * 1000,
        proposer: summary.owner,
      });
      setShowProposeForm(false);
      return;
    }

    if (!canControl) {
      setError("Connect the vault owner wallet to propose policy changes.");
      return;
    }

    setLoading("propose");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "propose_policy",
        args: { policy: newPolicy },
        gas: GAS,
        deposit: "0",
      });
      setShowProposeForm(false);
      onRefreshed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="vp-card">
      <header className="vp-card-header">
        <div className="vp-card-title-row">
          <ShieldOutlineIcon width={16} height={16} style={{ color: "var(--muted)" }} />
          <span>Governance &amp; Timelock</span>
        </div>
        <span className="vp-badge">48h Window</span>
      </header>

      {error && <div className="vp-alert-error" style={{ marginBottom: "0.85rem", marginTop: 0 }}>{error}</div>}

      {activeProposal ? (
        <div className="vp-inset-panel" style={{ marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.55rem" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", fontWeight: 600 }}>
              <ClockIcon width={14} height={14} style={{ color: "var(--amber-bright)" }} />
              <span>Pending Parameter Change</span>
            </span>
            <span className="mono" style={{ fontSize: "0.74rem", color: isTimelockReady ? "var(--emerald-bright)" : "var(--amber-bright)" }}>
              {isTimelockReady ? "Timelock elapsed" : `${hoursRemaining}h remaining`}
            </span>
          </div>

          <p style={{ margin: "0 0 0.85rem", fontSize: "0.74rem", color: "var(--muted)", lineHeight: 1.45 }}>
            Mandatory 48-hour timelock is enforcing community auditability. No unilateral owner re-allocations are technically permissible.
          </p>

          <div className="vp-split-metrics">
            <div>
              <div style={{ fontSize: "0.69rem", color: "var(--muted)" }}>Proposed Max Per Move</div>
              <div className="mono" style={{ fontSize: "0.84rem", fontWeight: 600, marginTop: "2px" }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {formatShortUsdK(summary.policy.max_per_move)}
                </span>{" "}
                <span style={{ color: "var(--muted)" }}>→</span>{" "}
                <span style={{ color: "var(--emerald-bright)" }}>
                  {formatShortUsdK(activeProposal.policy.max_per_move)}
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.69rem", color: "var(--muted)" }}>Proposed Daily UTC Cap</div>
              <div className="mono" style={{ fontSize: "0.84rem", fontWeight: 600, marginTop: "2px" }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {formatShortUsdK(summary.policy.daily_cap)}
                </span>{" "}
                <span style={{ color: "var(--muted)" }}>→</span>{" "}
                <span style={{ color: "var(--emerald-bright)" }}>
                  {formatShortUsdK(activeProposal.policy.daily_cap)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="vp-inset-panel" style={{ marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Timelock Armed</span>
            <button
              type="button"
              className="vp-icon-btn"
              onClick={() => setShowProposeForm((s) => !s)}
            >
              {showProposeForm ? "Close Form" : "Propose Update"}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--muted)" }}>
            No pending parameter changes. All cap updates enforce a mandatory timelock queue before execution.
          </p>
        </div>
      )}

      {showProposeForm && !activeProposal && (
        <form onSubmit={(e) => void handleProposePolicy(e)} className="vp-inset-panel" style={{ marginBottom: "0.9rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.55rem" }}>
            <div>
              <div style={{ fontSize: "0.69rem", color: "var(--muted)", marginBottom: "0.2rem" }}>Max Per Move (USDC)</div>
              <input className="vp-input" style={{ width: "100%" }} value={propMaxPerMove} onChange={(e) => setPropMaxPerMove(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: "0.69rem", color: "var(--muted)", marginBottom: "0.2rem" }}>Daily Cap (USDC)</div>
              <input className="vp-input" style={{ width: "100%" }} value={propDailyCap} onChange={(e) => setPropDailyCap(e.target.value)} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.69rem", color: "var(--muted)", marginBottom: "0.2rem" }}>Max Slippage (bps)</div>
            <input className="vp-input" style={{ width: "100%" }} type="number" value={propSlippageBps} onChange={(e) => setPropSlippageBps(e.target.value)} />
          </div>
          <button type="submit" className="vp-cta-white" disabled={loading === "propose"}>
            {loading === "propose" ? "Submitting..." : "Submit Timelocked Proposal"}
          </button>
        </form>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {activeProposal && (
          <button
            type="button"
            className="vp-btn-muted"
            onClick={() => void handleExecutePolicy()}
            disabled={!isTimelockReady || loading !== null}
            title={!isTimelockReady ? "Timelock delay has not elapsed yet" : "Execute policy change"}
          >
            <LockIcon width={13} height={13} />
            <span>
              {loading === "execute"
                ? "Executing Policy..."
                : isTimelockReady
                ? "Execute Policy Change (Unlocked)"
                : `Execute Policy Change (Locked - ${formatCountdown(msRemaining)})`}
            </span>
          </button>
        )}

        <button
          type="button"
          className="vp-btn-danger"
          onClick={() => void handleTogglePause()}
          disabled={loading !== null}
        >
          <AlertTriangleIcon width={14} height={14} />
          <span>
            {loading === "pause"
              ? "Updating..."
              : pausedState
              ? "Resume Vault Operations"
              : "Emergency Vault Pause"}
          </span>
        </button>
      </div>

      <p className="mono" style={{ fontSize: "0.68rem", color: "var(--muted)", textAlign: "center", margin: "0.85rem 0 0" }}>
        Multi-sig owner quorum: 3 of 4 verified signatures required.
      </p>
    </section>
  );
}
