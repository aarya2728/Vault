import { useCallback, useEffect, useState } from "react";
import { ActiveMoveCard } from "./components/ActiveMoveCard.js";
import { DecisionStream } from "./components/DecisionStream.js";
import { MpcCustodyView } from "./components/MpcCustodyView.js";
import { OwnerControls } from "./components/OwnerControls.js";
import { PolicyCard } from "./components/PolicyCard.js";
import { QuoteSimulator } from "./components/QuoteSimulator.js";
import { RebalanceTable } from "./components/RebalanceTable.js";
import { UserPosition } from "./components/UserPosition.js";
import { VaultDashboardHero } from "./components/VaultDashboardHero.js";
import { VaultYieldCalculator } from "./components/VaultYieldCalculator.js";
import { WalletBar } from "./components/WalletBar.js";
import { KeyLinkIcon, ShieldCheckIcon, ShieldOutlineIcon } from "./components/Icons.js";
import { DEMO_RECORDS, DEMO_SUMMARY } from "./lib/demo.js";
import {
  config,
  fetchRebalances,
  fetchSummary,
  shorten,
  type RebalanceRecord,
  type VaultSummary,
} from "./lib/vault.js";

type NavTab = "overview" | "yield" | "mpc" | "audit";

const REFRESH_MS = 15_000;

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [records, setRecords] = useState<RebalanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(!config.vaultContract);
  const [syncMs, setSyncMs] = useState<number>(18);

  const refresh = useCallback(async () => {
    if (!config.vaultContract) {
      setSummary(DEMO_SUMMARY);
      setRecords(DEMO_RECORDS);
      setDemoMode(true);
      setError(null);
      setSyncMs(18);
      return;
    }
    const start = performance.now();
    try {
      const [nextSummary, nextRecords] = await Promise.all([fetchSummary(), fetchRebalances()]);
      setSummary(nextSummary);
      setRecords(nextRecords);
      setDemoMode(false);
      setError(null);
      setSyncMs(Math.max(4, Math.round(performance.now() - start)));
    } catch (cause) {
      setSummary((current) => current ?? DEMO_SUMMARY);
      setRecords((current) => (current.length > 0 ? current : DEMO_RECORDS));
      setDemoMode(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const networkLabel = config.network === "mainnet" ? "NEAR Mainnet" : "NEAR Testnet";
  const keyStatusLabel = summary?.paused
    ? "Vault Paused"
    : summary?.agent_enabled === false
    ? "Agent Disabled"
    : "Function-Call Key Active";

  return (
    <div className="vp-shell">
      {/* Persistent Top Navigation Bar */}
      <header className="vp-navbar">
        <div className="vp-navbar-inner">
          <div className="vp-brand-cluster">
            <div className="vp-logo-box">
              <ShieldCheckIcon width={17} height={17} />
            </div>
            {activeTab === "mpc" ? (
              <div className="vp-brand-text">
                <span className="vp-brand-title">VaultPilot</span>
                <span className="vp-brand-sub">INSTITUTIONAL MPC</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                <span className="vp-brand-title">VaultPilot</span>
                <span className="vp-brand-badge">NEAR INTENTS</span>
              </div>
            )}
          </div>

          <nav className="vp-nav-tabs" aria-label="Primary Navigation">
            {[
              { id: "overview", label: "Overview" },
              { id: "yield", label: "Yield & Routing" },
              { id: "mpc", label: "MPC Custody" },
              { id: "audit", label: "Audit Log" },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`vp-nav-tab ${isActive ? "is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id as NavTab)}
                >
                  {isActive && <span className="vp-dot" />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="vp-nav-right">
            <span className="vp-status-pill">
              <span className="vp-dot" />
              <span>{networkLabel}</span>
            </span>
            <span className={`vp-status-pill ${summary?.paused ? "" : "is-emerald"}`}>
              <KeyLinkIcon width={12} height={12} />
              <span>{keyStatusLabel}</span>
            </span>
            <WalletBar demoMode={demoMode} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="vp-main">
        {error && (
          <div className="vp-alert-warn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              Live RPC read failed ({error}). Rendering demo telemetry fallback.
            </span>
            <button type="button" className="vp-icon-btn" onClick={() => void refresh()}>
              Retry RPC
            </button>
          </div>
        )}

        {summary ? (
          <>
            {activeTab === "overview" && (
              <>
                <VaultDashboardHero summary={summary} />
                <div className="vp-grid-2">
                  <UserPosition summary={summary} onRefreshed={refresh} demo={demoMode} />
                  <div className="vp-col-stack">
                    <ActiveMoveCard
                      summary={summary}
                      onRefresh={refresh}
                      onOpenMpcTab={() => setActiveTab("mpc")}
                      demo={demoMode}
                    />
                    <OwnerControls summary={summary} onRefreshed={refresh} demo={demoMode} />
                  </div>
                </div>
              </>
            )}

            {activeTab === "mpc" && (
              <MpcCustodyView summary={summary} onRefresh={refresh} demo={demoMode} />
            )}

            {activeTab === "yield" && (
              <>
                <VaultYieldCalculator summary={summary} />
                <QuoteSimulator summary={summary} />
                <PolicyCard policy={summary.policy} />
              </>
            )}

            {activeTab === "audit" && (
              <>
                <RebalanceTable records={records} />
                <DecisionStream />
                <section className="vp-card">
                  <header className="vp-card-header">
                    <div className="vp-card-title-row">
                      <span>Contract Wiring &amp; On-Chain Endpoints</span>
                    </div>
                    <span className="vp-badge">{demoMode ? "Preview Wiring" : "Live RPC"}</span>
                  </header>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
                    <div className="vp-metric-box">
                      <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Vault Contract</div>
                      <code style={{ fontSize: "0.78rem", color: "var(--emerald-bright)" }}>
                        {config.vaultContract || "vault.roundvest2883.testnet"}
                      </code>
                    </div>
                    <div className="vp-metric-box">
                      <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>NEP-141 Token</div>
                      <code style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                        {shorten(summary.token, 18, 10)}
                      </code>
                    </div>
                    <div className="vp-metric-box">
                      <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Scoped Agent Account</div>
                      <code style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                        {summary.agent}
                      </code>
                    </div>
                    <div className="vp-metric-box">
                      <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>Current Epoch</div>
                      <code style={{ fontSize: "0.84rem", fontWeight: 600 }}>
                        Epoch #{summary.current_epoch ?? 4}
                      </code>
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        ) : (
          <section className="vp-card">
            <p className="mono" style={{ color: "var(--muted)", margin: 0 }}>
              Loading NEAR vault state...
            </p>
          </section>
        )}
      </main>

      {/* Bottom Footer */}
      <footer className="vp-footer">
        <div className="vp-footer-inner">
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <ShieldOutlineIcon width={14} height={14} style={{ color: "var(--emerald-bright)" }} />
            <span>
              Non-custodial MPC execution on NEAR. Real 1Click solver intents.
            </span>
          </div>

          <div className="vp-footer-links">
            <button type="button" className="vp-footer-link" onClick={() => setActiveTab("audit")}>
              {activeTab === "mpc" ? "Audit Ledger" : "Contracts"}
            </button>
            <a
              href="https://github.com/aarya2728/Vault#readme"
              target="_blank"
              rel="noreferrer"
              className="vp-footer-link"
            >
              Documentation
            </a>
            <a
              href="https://github.com/aarya2728/Vault"
              target="_blank"
              rel="noreferrer"
              className="vp-footer-link"
            >
              GitHub
            </a>
            <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "var(--muted)" }}>
              <span className="vp-dot" />
              <span>{syncMs}ms sync</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
