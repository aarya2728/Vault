import { useState } from "react";
import { useNear } from "../providers/NearProvider.js";

const ENV_SNIPPET = "VITE_VAULT_CONTRACT=vault.yourname.testnet";

export function SetupBanner({
  demoMode,
  error,
  onRetry,
}: {
  demoMode: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { accountId, connecting, connectError, connect } = useNear();
  const [copied, setCopied] = useState(false);

  if (!demoMode && !error) return null;

  function copySnippet() {
    void navigator.clipboard
      .writeText(ENV_SNIPPET)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  return (
    <section className="setup-banner" role="status">
      <div className="setup-copy">
        <div className="setup-heading">
          <span className="setup-icon">!</span>
          <strong>{error ? "Live read failed — demo fallback" : "Demo mode active"}</strong>
          <span className="badge badge-pending">PREVIEW DATA</span>
        </div>
        <p>
          {error
            ? `The configured vault could not be read (${error}). Showing realistic sample state instead of a dead screen; the 1Click quote panel still calls the live mainnet API.`
            : !demoMode
            ? "The live vault read failed."
            : "No vault contract is configured, so the dashboard is rendering realistic sample data instead of the read error. The 1Click quote panel still calls the live mainnet API."}
        </p>
        <div className="setup-snippet">
          <code>{ENV_SNIPPET}</code>
          <button type="button" className="button button-sm" onClick={copySnippet}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="muted small">
          Add it to <code>dashboard/.env</code> for local builds and to the repository
          Actions variable <code>VITE_VAULT_CONTRACT</code> for GitHub Pages, then rebuild.
        </p>
      </div>

      <div className="setup-actions">
        {accountId ? (
          <span className="pill pill-ok">Wallet: {accountId}</span>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting ? "Connecting..." : "Connect wallet"}
          </button>
        )}
        <button type="button" className="button" onClick={onRetry}>
          Retry live read
        </button>
        {connectError && <span className="form-error small">{connectError}</span>}
      </div>
    </section>
  );
}
