import { useState } from "react";
import { useNear } from "../providers/NearProvider.js";
import { config, shorten } from "../lib/vault.js";
import { CopyIcon, ExternalLinkIcon, ShieldCheckIcon, WalletIcon } from "./Icons.js";

export function WalletBar({ demoMode = false }: { demoMode?: boolean }) {
  const {
    accountId,
    isDemoWallet,
    connecting,
    connectError,
    clearConnectError,
    connect,
    connectDemoWallet,
    disconnect,
  } = useNear();

  const [menuOpen, setMenuOpen] = useState(false);
  const [demoInput, setDemoInput] = useState("roundvest2883.testnet");
  const [copied, setCopied] = useState(false);

  async function handleRealConnect() {
    clearConnectError();
    try {
      await connect();
      setMenuOpen(false);
    } catch {
      // connectError state is populated and displayed cleanly inside modal
    }
  }

  function handleDemoConnect() {
    connectDemoWallet(demoInput);
    setMenuOpen(false);
  }

  function copyAddress() {
    if (!accountId) return;
    void navigator.clipboard.writeText(accountId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div style={{ position: "relative" }}>
      {accountId ? (
        <button
          type="button"
          className="vp-wallet-pill"
          onClick={() => setMenuOpen((o) => !o)}
          title={`Connected: ${accountId}`}
        >
          <span className={`vp-dot ${isDemoWallet ? "vp-dot-amber" : ""}`} />
          <span>{shorten(accountId, 14, 7)}</span>
          {isDemoWallet && (
            <span className="vp-badge vp-badge-amber" style={{ padding: "0.08rem 0.35rem", fontSize: "0.6rem" }}>
              SIM
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          className="vp-wallet-pill"
          style={{ borderColor: "var(--emerald-border)" }}
          onClick={() => setMenuOpen((o) => !o)}
          disabled={connecting}
        >
          <WalletIcon width={14} height={14} style={{ color: "var(--emerald-bright)" }} />
          <span>{connecting ? "Connecting..." : "Connect Wallet"}</span>
        </button>
      )}

      {menuOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(0, 0, 0, 0.55)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            padding: "4.25rem 1.5rem 1.5rem",
          }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="vp-card"
            style={{
              width: "100%",
              maxWidth: "380px",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.65)",
              borderColor: "var(--border-strong)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {accountId ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="vp-card-title-row" style={{ fontSize: "0.88rem" }}>
                    <WalletIcon width={15} height={15} style={{ color: "var(--emerald-bright)" }} />
                    <span>Connected Account</span>
                  </span>
                  <span className={`vp-badge ${isDemoWallet ? "vp-badge-amber" : "vp-badge-emerald"}`}>
                    {isDemoWallet ? "Simulated Wallet" : "NEAR Wallet"}
                  </span>
                </div>

                <div className="vp-address-bar">
                  <code style={{ fontSize: "0.78rem", color: "var(--text)" }}>{accountId}</code>
                  <button type="button" className="vp-icon-btn" onClick={copyAddress}>
                    <CopyIcon width={12} height={12} />
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {!isDemoWallet ? (
                    <a
                      href={`https://${config.network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${accountId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="vp-btn-muted"
                      style={{ textDecoration: "none" }}
                    >
                      <ExternalLinkIcon width={13} height={13} />
                      <span>NearBlocks</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="vp-btn-muted"
                      onClick={() => void handleRealConnect()}
                    >
                      Switch to Real Wallet
                    </button>
                  )}
                  <button
                    type="button"
                    className="vp-btn-danger"
                    onClick={() => {
                      void disconnect().catch(() => undefined);
                      setMenuOpen(false);
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.95rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="vp-card-title-row" style={{ fontSize: "0.92rem" }}>
                    <ShieldCheckIcon width={16} height={16} style={{ color: "var(--emerald-bright)" }} />
                    <span>Connect NEAR Wallet</span>
                  </span>
                  <button type="button" className="vp-icon-btn" onClick={() => setMenuOpen(false)}>
                    Close
                  </button>
                </div>

                {connectError && (
                  <div className="vp-alert-error" style={{ marginTop: 0 }}>
                    {connectError}
                  </div>
                )}

                <div className="vp-inset-panel" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    1. Browser / Hardware NEAR Wallet
                  </div>
                  <p style={{ margin: 0, fontSize: "0.73rem", color: "var(--muted)", lineHeight: 1.45 }}>
                    Opens NEAR Connect. On <code style={{ color: "var(--text-secondary)" }}>testnet</code>,{" "}
                    <strong>Meteor Wallet</strong>, <strong>Intear Wallet</strong>,{" "}
                    <strong>Nightly</strong>, and <strong>Ledger</strong> are supported. (HOT Wallet &amp; MyNearWallet require mainnet.)
                  </p>
                  <button
                    type="button"
                    className="vp-cta-white"
                    onClick={() => void handleRealConnect()}
                    disabled={connecting}
                  >
                    {connecting ? "Waiting for Wallet..." : "Open NEAR Wallet Selector →"}
                  </button>
                </div>

                <div className="vp-inset-panel" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                      2. Simulated Testnet Session
                    </span>
                    <span className="vp-badge vp-badge-amber">No Extension Needed</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.73rem", color: "var(--muted)", lineHeight: 1.45 }}>
                    {demoMode
                      ? "No vault contract is configured in .env. Use a simulated testnet account to test deposits, withdrawals, epoch queues, and timelocks interactively."
                      : "Preview account flows locally without signing real transactions."}
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      className="vp-input"
                      style={{ flex: 1 }}
                      value={demoInput}
                      onChange={(e) => setDemoInput(e.target.value)}
                      placeholder="yourname.testnet"
                    />
                    <button
                      type="button"
                      className="vp-pill-btn is-active"
                      onClick={handleDemoConnect}
                    >
                      Use Account
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
