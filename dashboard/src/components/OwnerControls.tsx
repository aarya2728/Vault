import { useState } from "react";
import { useNear } from "../providers/NearProvider.js";
import {
  config,
  formatAmount,
  formatBps,
  formatTime,
  parseAmount,
  type Policy,
  type TimelockedPolicyProposal,
  type VaultSummary,
} from "../lib/vault.js";

const GAS = "100000000000000";

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
  const [confirmReset, setConfirmReset] = useState(false);
  const [showProposeModal, setShowProposeModal] = useState(false);

  // Proposal form state
  const [propMaxPerMove, setPropMaxPerMove] = useState(
    formatAmount(summary.policy.max_per_move),
  );
  const [propDailyCap, setPropDailyCap] = useState(
    formatAmount(summary.policy.daily_cap),
  );
  const [propSlippageBps, setPropSlippageBps] = useState(
    summary.policy.max_slippage_bps.toString(),
  );

  // Demo proposal state
  const [demoProposal, setDemoProposal] = useState<TimelockedPolicyProposal | null | undefined>(
    summary.pending_policy_proposal,
  );

  const activeProposal = demo ? demoProposal : summary.pending_policy_proposal;

  if (!isOwner && !demo) {
    return null; // Only visible to the owner
  }

  async function handleTogglePause() {
    if (!canControl) return;
    setError(null);
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

  async function handleToggleAgent() {
    if (!canControl) return;
    setError(null);
    setLoading("agent");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "set_agent_enabled",
        args: { enabled: !summary.agent_enabled },
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

  async function handleEmergencyReset() {
    if (!canControl) return;
    setError(null);
    setLoading("reset");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "emergency_reset_position",
        args: {
          reason: "Manual owner emergency reset via VaultPilot dashboard",
        },
        gas: GAS,
        deposit: "0",
      });
      setConfirmReset(false);
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
        throw new Error("slippage must be between 1 and 1000 bps (0.01% - 10%)");
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
      setLoading("propose");
      setTimeout(() => {
        setDemoProposal({
          policy: newPolicy,
          proposed_at_ms: Date.now(),
          eta_ms: Date.now() + 48 * 3600 * 1000,
          proposer: "council.roundvest.testnet",
        });
        setShowProposeModal(false);
        setLoading(null);
      }, 500);
      return;
    }

    if (!canControl) return;
    setLoading("propose");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "propose_policy",
        args: { policy: newPolicy },
        gas: GAS,
        deposit: "0",
      });
      setShowProposeModal(false);
      onRefreshed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleExecutePolicy() {
    if (demo) {
      setLoading("execute");
      setTimeout(() => {
        setDemoProposal(null);
        setLoading(null);
      }, 500);
      return;
    }

    if (!canControl) return;
    setError(null);
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

  async function handleCancelProposal() {
    if (demo) {
      setLoading("cancel_prop");
      setTimeout(() => {
        setDemoProposal(null);
        setLoading(null);
      }, 500);
      return;
    }

    if (!canControl) return;
    setError(null);
    setLoading("cancel_prop");
    try {
      await callMethod({
        contractId: config.vaultContract,
        methodName: "cancel_policy_proposal",
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

  const hasDeployed = BigInt(summary.deployed_assets) > 0n;
  const now = Date.now();
  const isTimelockReady = activeProposal ? now >= activeProposal.eta_ms : false;
  const hoursRemaining = activeProposal
    ? Math.max(0, Math.ceil((activeProposal.eta_ms - now) / (1000 * 60 * 60)))
    : 0;

  return (
    <section className="panel owner-panel">
      <header className="panel-header">
        <div>
          <h2>Owner Governance &amp; Timelock Controls</h2>
          <span className="panel-subtitle">
            {demo ? "Demo governance view" : "Authenticated as vault owner"}:{" "}
            <code>{summary.owner}</code>
          </span>
        </div>
        <span className={`badge ${demo ? "badge-demo" : "badge-in"}`}>
          {demo ? "DEMO GOVERNANCE" : "OWNER CONNECTED"}
        </span>
      </header>

      {demo && (
        <p className="muted small demo-note">
          Institutional Governance preview. Features 48h timelock delays on policy changes, emergency pause, and position resets.
        </p>
      )}

      {error && (
        <div className="alert alert-warn">
          <strong>Action Failed:</strong> {error}
        </div>
      )}

      {/* Timelocked Governance Proposal Sub-panel */}
      <div className="owner-card" style={{ marginBottom: "1rem", flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>Institutional Timelock Governance (48-Hour Delay)</strong>
            <p className="muted small" style={{ margin: "0.25rem 0 0 0" }}>
              To protect depositors from unilateral key compromise or malicious policy edits, all policy changes require a mandatory 48-hour delay before execution.
            </p>
          </div>
          {!activeProposal && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setShowProposeModal(!showProposeModal)}
            >
              {showProposeModal ? "Cancel Proposal" : "Propose Policy Update"}
            </button>
          )}
        </div>

        {activeProposal && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <div>
                <span className="stat-label">Pending Policy Proposal</span>
                <span className={`pill ${isTimelockReady ? "pill-ok" : "pill-warn"}`} style={{ marginLeft: "0.5rem" }}>
                  {isTimelockReady ? "Ready to Execute" : `Timelock Active (${hoursRemaining}h remaining)`}
                </span>
              </div>
              <span className="muted small">Proposed: {formatTime(activeProposal.proposed_at_ms)}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", margin: "0.75rem 0" }}>
              <div>
                <span className="stat-label">Proposed Max Per Move</span>
                <strong>{formatAmount(activeProposal.policy.max_per_move)} {config.tokenSymbol}</strong>
              </div>
              <div>
                <span className="stat-label">Proposed Daily Cap</span>
                <strong>{formatAmount(activeProposal.policy.daily_cap)} {config.tokenSymbol}</strong>
              </div>
              <div>
                <span className="stat-label">Proposed Max Slippage</span>
                <strong>{formatBps(activeProposal.policy.max_slippage_bps)}</strong>
              </div>
              <div>
                <span className="stat-label">Executable After</span>
                <strong>{formatTime(activeProposal.eta_ms)}</strong>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void handleExecutePolicy()}
                disabled={!isTimelockReady || loading !== null}
                title={!isTimelockReady ? "Timelock delay has not elapsed yet" : undefined}
              >
                {loading === "execute" ? "Executing..." : "Execute Policy Change"}
              </button>
              <button
                type="button"
                className="button button-warn"
                onClick={() => void handleCancelProposal()}
                disabled={loading !== null}
              >
                {loading === "cancel_prop" ? "Cancelling..." : "Cancel Proposal"}
              </button>
            </div>
          </div>
        )}

        {showProposeModal && !activeProposal && (
          <form
            onSubmit={(e) => void handleProposePolicy(e)}
            style={{
              marginTop: "1rem",
              padding: "1rem",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
            }}
          >
            <h4 style={{ margin: "0 0 0.5rem 0" }}>Propose New Vault Policy</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <label className="stat-label">Max Per Move ({config.tokenSymbol})</label>
                <input
                  className="input"
                  value={propMaxPerMove}
                  onChange={(e) => setPropMaxPerMove(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>
              <div>
                <label className="stat-label">Daily Cap ({config.tokenSymbol})</label>
                <input
                  className="input"
                  value={propDailyCap}
                  onChange={(e) => setPropDailyCap(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>
              <div>
                <label className="stat-label">Max Slippage (basis points)</label>
                <input
                  className="input"
                  type="number"
                  value={propSlippageBps}
                  onChange={(e) => setPropSlippageBps(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>
            </div>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="button button-primary" disabled={loading === "propose"}>
                {loading === "propose" ? "Submitting..." : "Submit 48h Timelock Proposal"}
              </button>
              <button type="button" className="button" onClick={() => setShowProposeModal(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="owner-actions-grid">
        <div className="owner-card">
          <div>
            <strong>Vault Emergency Pause</strong>
            <p className="muted small">
              Pauses all agent rebalance actions immediately. User withdrawals remain active.
            </p>
          </div>
          <button
            type="button"
            className={`button ${summary.paused ? "button-primary" : "button-warn"}`}
            onClick={handleTogglePause}
            disabled={demo || loading !== null}
          >
            {loading === "pause"
              ? "Updating..."
              : summary.paused
              ? "Unpause Vault"
              : "Pause Vault"}
          </button>
        </div>

        <div className="owner-card">
          <div>
            <strong>Autonomous Agent Permission</strong>
            <p className="muted small">
              Enable or disable the agent function-call key from triggering moves.
            </p>
          </div>
          <button
            type="button"
            className="button"
            onClick={handleToggleAgent}
            disabled={demo || loading !== null}
          >
            {loading === "agent"
              ? "Updating..."
              : summary.agent_enabled
              ? "Disable Agent"
              : "Enable Agent"}
          </button>
        </div>

        <div className="owner-card">
          <div>
            <strong>Emergency Position Reset</strong>
            <p className="muted small">
              Clears stuck deployed position if an external solver or callback hangs.
            </p>
          </div>
          {confirmReset ? (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="button button-warn"
                onClick={handleEmergencyReset}
                disabled={demo || loading !== null}
              >
                {loading === "reset" ? "Resetting..." : "Confirm Reset"}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button button-warn"
              onClick={() => setConfirmReset(true)}
              disabled={demo || loading !== null || !hasDeployed}
              title={
                demo
                  ? "Demo governance preview"
                  : !hasDeployed
                  ? "No open position to reset"
                  : undefined
              }
            >
              Emergency Reset
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
