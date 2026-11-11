import { useNear } from "../providers/NearProvider.js";
import { useTheme } from "../providers/ThemeProvider.js";
import { config, shorten, type VaultSummary } from "../lib/vault.js";

interface VaultDashboardHeroProps {
  summary: VaultSummary | null;
  onGetStarted?: () => void;
}

export function VaultDashboardHero({ summary, onGetStarted }: VaultDashboardHeroProps) {
  const { accountId, connecting, connect, disconnect } = useNear();
  const { theme, toggleTheme } = useTheme();

  const handleScroll = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleStart = () => {
    if (onGetStarted) {
      onGetStarted();
    } else {
      handleScroll("user-position-section");
    }
  };

  const isAgentActive = summary?.agent_enabled && !summary?.paused;
  const hasPendingMove = summary?.pending_move !== null && summary?.pending_move !== undefined;

  return (
    <div className="hero-container">
      {/* Top Navigation Bar */}
      <nav className="hero-nav">
        <div className="hero-brand">
          <div className="brand-logo">VP</div>
          <div className="brand-text">
            <span className="brand-name">VaultPilot</span>
            <span className="brand-tag">NEAR Intents Yield Vault</span>
          </div>
        </div>

        <div className="hero-links">
          <button type="button" onClick={() => handleScroll("vault-stats-section")}>
            Overview
          </button>
          <button type="button" onClick={() => handleScroll("yield-engine-section")}>
            Yield Engine
          </button>
          <button type="button" onClick={() => handleScroll("intent-tracker")}>
            Intent Route
          </button>
          <button type="button" onClick={() => handleScroll("quote-simulator")}>
            Simulator
          </button>
          <button type="button" onClick={() => handleScroll("rebalance-history")}>
            Audit Ledger
          </button>
        </div>

        <div className="hero-actions">
          {/* Theme Switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle-btn"
            title={`Switch to ${theme === "light" ? "Dark" : "Light"} theme`}
            aria-label="Toggle color theme"
          >
            {theme === "light" ? (
              <svg className="theme-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            ) : (
              <svg className="theme-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            )}
            <span className="theme-label">{theme === "light" ? "Dark" : "Light"}</span>
          </button>

          {/* Network Chip */}
          <span className="network-pill">{config.network}</span>

          {/* Wallet Button */}
          {accountId ? (
            <div className="account-pill-group">
              <span className="account-address" title={accountId}>
                {shorten(accountId, 10, 6)}
              </span>
              <button
                type="button"
                onClick={() => void disconnect().catch(() => undefined)}
                className="disconnect-btn"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void connect().catch(() => undefined)}
              disabled={connecting}
              className="connect-wallet-btn"
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </nav>

      {/* Hero Headline & Intro */}
      <div className="hero-content">
        <div className="security-tag-row">
          <span className="security-tag">
            <span className="tag-dot" />
            Bounded Function-Call Keys
          </span>
          <span className="security-tag">On-Chain Policy Guardrails</span>
          <span className="security-tag">ERC-4626 Virtual Shares</span>
        </div>

        <h1 className="hero-title">
          Autonomous Stablecoin Yield, <br />
          <span className="hero-title-highlight">Driven by NEAR Intents.</span>
        </h1>

        <p className="hero-desc">
          Deposit once on NEAR. An automated agent scans cross-chain opportunities via 1Click solvers,
          routing stablecoins to top-tier venues while locked inside on-chain caps and daily limits.
        </p>

        <div className="hero-cta-group">
          <button type="button" onClick={handleStart} className="btn-primary-cta">
            Deposit to Vault
            <svg className="cta-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => handleScroll("intent-tracker")}
            className="btn-secondary-cta"
          >
            Live Intent Telemetry
          </button>

          <button
            type="button"
            onClick={() => handleScroll("quote-simulator")}
            className="btn-secondary-cta"
          >
            Simulate Strategy
          </button>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="hero-metrics-grid">
        <div className="metric-box">
          <span className="metric-label">Target Strategy Yield</span>
          <div className="metric-main">
            <span className="metric-number">14.2%</span>
            <span className="metric-badge-alpha">+9.7% Alpha</span>
          </div>
          <span className="metric-sub">vs. 4.5% standard single-chain base</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Active Intent Route</span>
          <div className="metric-main">
            <span className="metric-text-val">NEAR ➔ Arbitrum</span>
          </div>
          <span className="metric-sub">Priced via 1Click Solvers (USDC)</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Agent Status</span>
          <div className="metric-main">
            <span className={`status-pill ${isAgentActive ? "status-active" : "status-paused"}`}>
              {summary?.paused ? "Vault Paused" : isAgentActive ? "Active & Enforcing" : "Disabled"}
            </span>
          </div>
          <span className="metric-sub">
            {hasPendingMove ? "Position currently in flight" : "Standing by for profitable spread"}
          </span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Safety &amp; Execution</span>
          <div className="metric-main">
            <span className="metric-text-val">Strictly Bounded</span>
          </div>
          <span className="metric-sub">Instant withdrawal from idle liquidity</span>
        </div>
      </div>
    </div>
  );
}
