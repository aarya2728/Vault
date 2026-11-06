import type { Policy } from "../lib/vault.js";
import { formatAmount, formatBps, shorten } from "../lib/vault.js";

export function PolicyCard({ policy }: { policy: Policy }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>On-chain policy</h2>
        <span className="muted">enforced by the contract, not the agent</span>
      </header>

      <dl className="policy-grid">
        <div>
          <dt>Min move</dt>
          <dd>{formatAmount(policy.min_move)}</dd>
        </div>
        <div>
          <dt>Max per move</dt>
          <dd>{formatAmount(policy.max_per_move)}</dd>
        </div>
        <div>
          <dt>Daily cap</dt>
          <dd>{formatAmount(policy.daily_cap)}</dd>
        </div>
        <div>
          <dt>Max slippage</dt>
          <dd>{formatBps(policy.max_slippage_bps)}</dd>
        </div>
      </dl>

      <div className="asset-list">
        <span className="stat-label">Allowed destination assets</span>
        <ul>
          {policy.allowed_destination_assets.map((asset) => (
            <li key={asset} title={asset}>
              <code>{shorten(asset, 18, 10)}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
