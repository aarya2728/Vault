import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ActiveMoveCard } from "./components/ActiveMoveCard.js";
import { DecisionStream } from "./components/DecisionStream.js";
import { OwnerControls } from "./components/OwnerControls.js";
import { PolicyCard } from "./components/PolicyCard.js";
import { QuoteSimulator } from "./components/QuoteSimulator.js";
import { RebalanceTable } from "./components/RebalanceTable.js";
import { SetupBanner } from "./components/SetupBanner.js";
import { UserPosition } from "./components/UserPosition.js";
import { VaultStats } from "./components/VaultStats.js";
import { WalletBar } from "./components/WalletBar.js";
import { useNear } from "./providers/NearProvider.js";
import { DEMO_RECORDS, DEMO_SUMMARY } from "./lib/demo.js";
import {
  config,
  fetchRebalances,
  fetchSummary,
  shorten,
  type RebalanceRecord,
  type VaultSummary,
} from "./lib/vault.js";

const REFRESH_MS = 15_000;

const NetworkBackground = lazy(() =>
  import("./components/NetworkBackground.js").then((module) => ({
    default: module.NetworkBackground,
  })),
);

export default function App() {
  const { accountId } = useNear();
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [records, setRecords] = useState<RebalanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(!config.vaultContract);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!config.vaultContract) {
      setSummary(DEMO_SUMMARY);
      setRecords(DEMO_RECORDS);
      setDemoMode(true);
      setError(null);
      setUpdatedAt(Date.now());
      return;
    }
    setRefreshing(true);
    try {
      const [nextSummary, nextRecords] = await Promise.all([fetchSummary(), fetchRebalances()]);
      setSummary(nextSummary);
      setRecords(nextRecords);
      setDemoMode(false);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (cause) {
      setSummary((current) => current ?? DEMO_SUMMARY);
      setRecords((current) => (current.length > 0 ? current : DEMO_RECORDS));
      setDemoMode(true);
      setError(cause instanceof Error ? cause.message : String(cause));
      setUpdatedAt(Date.now());
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
      <Suspense fallback={null}>
        <NetworkBackground />
      </Suspense>
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
            <code title={config.vaultContract}>
              {config.vaultContract
                ? shorten(config.vaultContract, 14, 8)
                : demoMode
                ? "demo mode"
                : "not configured"}
            </code>
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

        <SetupBanner demoMode={demoMode} error={error} onRetry={refresh} />

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
            <OwnerControls summary={summary} onRefreshed={refresh} demo={demoMode} />
            <VaultStats summary={summary} />
            <ActiveMoveCard summary={summary} onRefresh={refresh} demo={demoMode} />
            <DecisionStream />
            {accountId || demoMode ? (
              <UserPosition summary={summary} onRefreshed={refresh} demo={demoMode} />
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
            <QuoteSimulator summary={summary} />
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
        {demoMode && " Demo mode renders sample vault state until VITE_VAULT_CONTRACT is set."}
      </footer>
    </div>
  );
}
