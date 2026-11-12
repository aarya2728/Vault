import { useNear } from "../providers/NearProvider.js";
import { shorten } from "../lib/vault.js";
import { DEMO_OWNER } from "../lib/demo.js";
import { WalletIcon } from "./Icons.js";

export function WalletBar({ demoMode = false }: { demoMode?: boolean }) {
  const { accountId, connecting, connectError, connect, disconnect } = useNear();

  if (accountId) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
        <button
          type="button"
          className="vp-wallet-pill"
          onClick={() => void disconnect().catch(() => undefined)}
          title={`Connected: ${accountId} (Click to disconnect)`}
        >
          <WalletIcon width={14} height={14} style={{ color: "var(--muted)" }} />
          <span>{shorten(accountId, 14, 7)}</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
      <button
        type="button"
        className="vp-wallet-pill"
        onClick={() => void connect().catch(() => undefined)}
        disabled={connecting}
        title={demoMode ? "Preview account (click to connect NEAR wallet)" : "Connect NEAR wallet"}
      >
        <WalletIcon width={14} height={14} style={{ color: "var(--muted)" }} />
        <span>
          {connecting
            ? "Connecting..."
            : demoMode
            ? shorten(DEMO_OWNER, 14, 7)
            : "Connect Wallet"}
        </span>
      </button>
      {connectError && (
        <span className="vp-badge vp-badge-red" role="alert" title={connectError}>
          Wallet Err
        </span>
      )}
    </div>
  );
}
