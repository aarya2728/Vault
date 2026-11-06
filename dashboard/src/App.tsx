import { useCallback, useEffect, useState } from "react";
import { PolicyCard } from "./components/PolicyCard.js";
import { RebalanceTable } from "./components/RebalanceTable.js";
import { UserPosition } from "./components/UserPosition.js";
import { VaultStats } from "./components/VaultStats.js";
import { WalletBar } from "./components/WalletBar.js";
import { useNear } from "./providers/NearProvider.js";
import {
  config,
  fetchRebalances,
  fetchSummary,
  shorten,
  type RebalanceRecord,
  type VaultSummary,
} from "./lib/vault.js";

const REFRESH_MS = 15_000;

export default function App() {
  const { accountId } = useNear();
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [records, setRecords] = useState<RebalanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!config.vaultContract) {
      setError("Set VITE_VAULT_CONTRACT in dashboard/.env and restart the dev server.");
      return;
    }
    setRefreshing(true);
    try {
      const [nextSummary, nextRecords] = await Promise.all([fetchSummary(), fetchRebalances()]);
      setSummary(nextSummary);
      setRecords(nextRecords);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="mark">VP</span>
          <div>
            <h1>VaultPilot</h1>
            <p>Autonomous stablecoin vault on NEAR Intents</p>
          </div>
        </div>
        <div className="topbar-right">
          <WalletBar />
          <span className="chip">{config.network}</span>
          <button className="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      <main>
        <section className="status-row">
          <div>
            <span className="stat-label">Vault</span>
            <code title={config.vaultContract}>{config.vaultContract ? shorten(config.vaultContract, 14, 8) : "not configured"}</code>
          </div>
          <div>
            <span className="stat-label">Token</span>
            <span>{config.tokenSymbol}</span>
          </div>
          <div>
            <span className="stat-label">Agent</span>
            {summary ? (
              <span className={`pill ${summary.agent_enabled && !summary.paused ? "pill-ok" : "pill-warn"}`}>
                {summary.paused ? "paused" : summary.agent_enabled ? "enabled" : "disabled"}
              </span>
            ) : (
              <span className="pill">unknown</span>
            )}
          </div>
          <div>
            <span className="stat-label">Updated</span>
            <span>{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "-"}</span>
          </div>
        </section>

        {error && (
          <section className="alert" role="alert">
            <strong>Read failed.</strong> {error}
          </section>
        )}

        {summary?.paused && (
          <section className="alert" role="status">
            Vault is paused. Withdrawals stay open; agent moves are blocked.
          </section>
        )}

        {summary && !summary.agent_enabled && !summary.paused && (
          <section className="alert" role="status">
            Agent is disabled. The owner must call <code>set_agent_enabled(true)</code>.
          </section>
        )}

        {summary ? (
          <>
            <VaultStats summary={summary} />
            {accountId ? (
              <UserPosition summary={summary} onRefreshed={refresh} />
            ) : (
              <section className="panel wallet-cta">
                <p className="muted">
                  Connect a wallet to deposit, withdraw, and view your position. The agent never holds
                  your keys; only the vault policy moves funds.
                </p>
              </section>
            )}
            <div className="two-col">
              <PolicyCard policy={summary.policy} />
              <section className="panel">
                <header className="panel-header">
                  <h2>Wiring</h2>
                </header>
                <dl className="wiring">
                  <div>
                    <dt>Owner</dt>
                    <dd title={summary.owner}>{shorten(summary.owner, 12, 8)}</dd>
                  </div>
                  <div>
                    <dt>Agent account</dt>
                    <dd title={summary.agent}>{shorten(summary.agent, 12, 8)}</dd>
                  </div>
                  <div>
                    <dt>FT contract</dt>
                    <dd title={summary.token}>{shorten(summary.token, 12, 8)}</dd>
                  </div>
                  <div>
                    <dt>Share supply</dt>
                    <dd>{summary.total_shares.toString()}</dd>
                  </div>
                </dl>
                <p className="muted small">
                  Read-only. The agent holds a function-call key scoped to this vault and can only
                  move funds inside the policy above.
                </p>
              </section>
            </div>
            <RebalanceTable records={records} />
          </>
        ) : (
          !error && (
            <section className="panel">
              <p className="empty">Loading vault state...</p>
            </section>
          )
        )}
      </main>

      <footer>
        External venue APY is simulated. Intents quotes are real. Not a trustless product.
      </footer>
    </div>
  );
}
