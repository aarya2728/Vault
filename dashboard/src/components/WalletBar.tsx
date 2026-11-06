import { useNear } from "../providers/NearProvider.js";
import { shorten } from "../lib/vault.js";

export function WalletBar() {
  const { accountId, connecting, connect, disconnect } = useNear();

  if (accountId) {
    return (
      <div className="wallet-bar">
        <span className="chip chip-account" title={accountId}>
          {shorten(accountId, 12, 8)}
        </span>
        <button className="button button-ghost" onClick={() => void disconnect().catch(() => undefined)}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      className="button button-primary"
      onClick={() => void connect().catch(() => undefined)}
      disabled={connecting}
    >
      {connecting ? "Connecting" : "Connect wallet"}
    </button>
  );
}
