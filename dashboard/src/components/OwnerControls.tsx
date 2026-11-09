import { useState } from "react";
import { useNear } from "../providers/NearProvider.js";
import { config, type VaultSummary } from "../lib/vault.js";

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

  const hasDeployed = BigInt(summary.deployed_assets) > 0n;

  return (
    <section className="panel owner-panel">
      <header className="panel-header">
        <div>
          <h2>Owner Governance &amp; Emergency Controls</h2>
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
          Control surface preview. Connect the owner wallet and configure a vault contract to
          arm the pause switch and emergency reset.
        </p>
      )}

      {error && (
        <div className="alert alert-warn">
          <strong>Action Failed:</strong> {error}
        </div>
      )}

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

