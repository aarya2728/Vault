# VaultPilot

**Deposit once on NEAR; an agent with capped keys chases the best stablecoin yield.**

VaultPilot is a NEAR vault that moves stablecoins between a NEAR-native position and one
external chain through NEAR Intents. An off-chain agent watches APYs and gas, and submits
rebalances signed with a **function-call key** that can only call the vault. The vault
enforces the policy on-chain: per-move cap, daily cap, allowed destination assets, one open
position at a time, and an owner pause. The agent key can be disabled on-chain and deleted
at the account level.

> This is a hackathon MVP scaffold. It is **not** audited and must not hold real funds.

## What is real vs. simulated

| Piece | Status |
| --- | --- |
| NEAR vault contract: shares, deposits, withdrawals, policy, pause | Implemented in `contracts/` |
| Agent with function-call key, hourly loop, strategy, reasoning log | Implemented in `agent/` |
| 1Click quote + status client (real API) | Implemented in `agent/src/intents.ts` |
| Outbound cross-chain swap via 1Click `ORIGIN_CHAIN` deposit | Wired; requires mainnet and a funded vault |
| External yield venue | **Simulated** by default (`agent/src/venue.ts`) |
| Dashboard: balances, policy, history, wallet deposit/withdraw | Implemented in `dashboard/` |

NEAR Intents has **no testnet**. Quotes and swaps use mainnet liquidity. The default config
therefore runs the agent in `DRY_RUN=true` against testnet vault state, and fetches real
mainnet quotes for the decision log. A mainnet demo is possible with a separate vault and a
small amount of USDC; see [Demo path](#demo-path).

## Architecture

```text
                     ┌──────────────────────────────┐
   user ──deposit──▶ │  VaultPilot contract (NEAR)  │
                     │  shares · policy · pause     │
                     └──────────────┬───────────────┘
                                    │ ft_transfer
                                    ▼
                     ┌──────────────────────────────┐
                     │ 1Click deposit address (NEAR)│
                     └──────────────┬───────────────┘
                                    │ NEAR Intents solvers
                                    ▼
                     ┌──────────────────────────────┐
                     │ one external chain + venue    │
                     └──────────────┬───────────────┘
                                    │ return leg (simulated by default)
                                    ▼
   agent loop ──rebalance_out / rebalance_in──▶ VaultPilot
   (function-call key: only these methods)
```

The agent never holds the vault's full-access key. It holds a function-call key on a
dedicated agent account, scoped to `receiver_id = <vault>` and
`method_names = ["rebalance_out", "rebalance_in"]`, with a gas allowance. Function-call
keys cannot attach NEAR, so the vault — not the agent — moves the FT.

## Repository layout

```text
vault-pilot/
├── contracts/                 # Rust / near-sdk-rs vault
│   ├── src/lib.rs             # deposits, shares, rebalance, views, inline tests
│   └── src/policy.rs          # on-chain guardrails
├── agent/                     # TypeScript worker
│   ├── src/index.ts           # loop
│   ├── src/intents.ts         # 1Click quote/status client
│   ├── src/wallet.ts          # function-call key scope check
│   ├── src/strategy.ts        # spread + threshold logic
│   ├── src/venue.ts           # external venue adapter (mock default)
│   ├── src/mock-return.ts     # treasury return helper for the demo
│   └── src/rpc.ts             # NEAR view calls + gas price
├── dashboard/                 # Vite + React dashboard + wallet deposit/withdraw
└── .github/workflows/ci.yml   # tests, wasm build, typecheck, dashboard build
```

## Contract policy model

`Policy` is stored on-chain and can only be changed by the owner:

- `min_move` / `max_per_move`: absolute token-unit bounds per rebalance.
- `daily_cap`: maximum token units moved out per UTC day.
- `max_slippage_bps`: upper bound on the slippage the agent will request from 1Click.
  Quotes are off-chain, so the contract records the bound but cannot verify it.
- `allowed_destination_assets`: allowlist of 1Click `assetId` strings.

The contract enforces caps, allowlist, single open position, pause, and agent identity.
It cannot verify the off-chain quote on-chain, so the trust model is **bounded, not
trustless**: a compromised agent can move at most `max_per_move` per transaction and
`daily_cap` per day before the owner pauses or deletes the key. Say it that way in the
demo; do not call it trustless.

Accounting: `total_assets = idle_assets + deployed_assets`. Yield is recognized only when
the position is closed (`rebalance_in` reads the real FT balance). The agent cannot inflate
NAV while a position is open. `rebalance_in` refuses to close unless the FT balance increased
by at least `deployed_assets`, so neither an empty close nor a 1-yocto donation can silently
write off a deployed position. The amount is read from the token contract, not reported by
the agent. A real loss requires the owner to inspect and call `emergency_reset_position`.

Share math uses ERC-4626-style virtual shares and assets plus a minimum first deposit. This
keeps the exchange rate non-zero and makes donation-based share inflation expensive even
before the first real deposit. The virtual offsets are mirrored in the dashboard so previews
match the contract.

`withdraw` deliberately has **no pause check**: the pause switch stops deposits and agent
moves, while users can always exit against idle liquidity. The owner escape path is
`pause(true)` followed by per-user withdrawals, not a privileged transfer of vault assets.

### How the agent decides

```text
quoteCostBps        = (amountInUsd - amountOutUsd) / amountInUsd * 10_000
gasCostBps          = gasUsd / amountInUsd * 10_000
annualizedCostBps   = (quoteCostBps + gasCostBps) * 365 / HOLD_DAYS
netSpreadBps        = externalApyBps - nearApyBps - annualizedCostBps
enter if netSpreadBps > MIN_SPREAD_BPS and the on-chain policy allows the move
```

The agent reads `get_summary()` every cycle, caps the amount against `max_per_move` and the
remaining daily cap, requests a real 1Click quote with `slippageTolerance` bounded by the
policy, and logs the whole decision as JSON. In `DRY_RUN=true` it stops before signing.

## Threat model

| Failure | What bounds it |
| --- | --- |
| Agent key stolen | The key can only call `rebalance_out` / `rebalance_in` on the vault. Per-move and daily caps bound loss; the owner can pause, disable the agent, or delete the key. |
| Agent passes a malicious deposit address | Caps bound each move. The contract cannot verify the quote; this is why the design is **not trustless**. |
| Bad 1Click quote | The agent requests `slippageTolerance` bounded by on-chain `max_slippage_bps`, records `min_out`, and logs the full quote. The contract cannot verify it. |
| Withdrawal `ft_transfer` fails | The `on_withdraw` callback restores the burned shares and accounting. |
| Rebalance `ft_transfer` fails after accounting moves | The `on_rebalance_out` callback restores idle/deployed/daily accounting automatically. `emergency_reset_position` stays as an owner-only fallback for a callback that never executed. It does not move funds. |
| Premature `rebalance_in` | The callback requires `actual - idle >= deployed_assets`, so an empty close or a tiny donation cannot write off a position. |
| In-flight move ambiguity | `rebalance_out` records a `PendingMove` with status `funding`, flips to `open` after the transfer succeeds, and clears it on settle or reset. `get_pending_moves` exposes it to the agent and dashboard. |
| Owner key lost | Users can still withdraw idle liquidity; no owner action is needed for withdrawals. Policy changes and agent rotation require the owner. |
| Contract bug | Not audited. Do not hold real funds beyond a small demo amount. |

## Quickstart

### 1. Contract

Local build requires Rust and [`cargo-near`](https://github.com/near/cargo-near). If you do
not have a toolchain, push the repo and download
`vault-pilot-contract.wasm` from the `ci` workflow artifact instead.

```bash
cargo install cargo-near
cd contracts
cargo test
cargo near build
```

Deploy and initialize (testnet):

```bash
cd agent
copy .env.setup.example .env.setup
# fill OWNER_*, VAULT_*, VAULT_TOKEN, AGENT_ACCOUNT, and POLICY_ALLOWED_ASSETS
npm install
npm run deploy
```

`npm run deploy` creates `vault.<you>.testnet` as a subaccount of `OWNER_ACCOUNT` when it
does not exist, adds `VAULT_PRIVATE_KEY` as a full-access key, deploys the wasm, and calls
`new` once. It detects an already-initialized contract and skips `new`. It looks for the wasm
in `contracts/target/near/` and `contracts/target/wasm32-unknown-unknown/release/`; set
`WASM_PATH` to override. `VAULT_PRIVATE_KEY` is the vault account's full-access key; use a
fresh ed25519 keypair from `near generate-key` (or your deploy key) and keep it offline after
setup.

Amounts are in the token's smallest unit. The testnet USDC faucet is available from the
NEAR hackathon resources.

The vault account needs NEAR for contract storage and gas. The deploy script transfers
`VAULT_INITIAL_NEAR` (default 5 NEAR) when it creates the account. If the account already
exists, fund it with enough NEAR for contract storage (a few NEAR) before deploying; after
deployment keep ~0.1 NEAR for the `ft_transfer` 1 yoctoNEAR attach and callback gas.

If the token enforces NEP-145 storage, register the vault with the token contract once before
the first deposit or the FT transfer will fail:

```bash
near call usdc.fakes.testnet storage_deposit '{"account_id":"vault.<you>.testnet"}' \
  --accountId <you>.testnet --deposit 0.00125
```

`npm run deploy` prints this command after a successful run.

### 2. Scoped agent key

`setup-agent-key.ts` creates `agent.<you>.testnet` with **only** a function-call key when the
account is missing, then calls `set_agent`:

```bash
cd agent
npm run setup:agent
```

It generates the agent key when `AGENT_PRIVATE_KEY` is empty and writes it to the gitignored
`agent/.env.agent-key`; move that line into `agent/.env` and delete the file. The script
verifies the on-chain scope is exactly `vault.<you>.testnet` plus
`rebalance_out,rebalance_in`, and prints any remaining full-access keys. When the agent
account already exists, set `AGENT_FULL_ACCESS_PRIVATE_KEY` so the script can add the scoped
key and delete that full-access key (`REVOKE_FULL_ACCESS_KEY=true` by default).

After setup the agent account has no full-access key, so the function-call key and its
allowance are fixed for that account. Rotate by creating a new `AGENT_ACCOUNT` and running
the script again. Revoke with the on-chain switch:

```bash
near call vault.<you>.testnet set_agent_enabled '{"enabled": false}' --accountId <you>.testnet
```

### 3. Agent

```bash
cd agent
copy .env.example .env
npm install
npm run dev
```

Default mode is `DRY_RUN=true`: the agent fetches real 1Click quotes, evaluates the spread,
and logs the decision without submitting a transaction.

### 4. Close the simulated position

After a real `rebalance_out` in live mode, the external venue is still mocked. Return
principal plus simulated yield from a separate treasury account, then let the agent close:

```bash
cd agent
npm run mock:return          # treasury ft_transfer to the vault
# set AUTO_CLOSE_MOCK=true and DRY_RUN=false, then:
npm run once
```

`mock:return` needs `MOCK_RETURN_ACCOUNT` / `MOCK_RETURN_PRIVATE_KEY` (full access, never the
agent key). It sends principal plus `MOCK_YIELD_BPS` (default 100 = 1%) so the dashboard
shows a visible simulated profit. The close proceeds only if the FT balance increased by at
least the deployed principal.

### 5. Dashboard

```bash
cd dashboard
copy .env.example .env
npm install
npm run dev
```

Connect a NEAR-native wallet (Meteor, HOT, Nightly, or MyNearWallet) from the top bar to see
your balance, shares, and position value. The **Deposit** form calls `ft_transfer_call` on
the vault token with the vault as receiver; the **Withdraw** form burns shares through the
vault. If the connected account has never held the token, the dashboard first calls
`storage_deposit` on the token (0.00125 NEAR) so the withdrawal can land. The EVM/MetaMask
connector is intentionally excluded: it depends on a popup, a chain switch, and a sponsored
onboarding transaction that obscure the NEAR-native flow. The dashboard still shows balances,
policy, and rebalance history before you connect.

## Demo path

Two honest options:

1. **Safe testnet demo (default).** Vault deposits, withdrawals, policy enforcement, agent
   key scoping, revocation, and real 1Click quotes in dry mode. The external venue is the
   mock adapter.
2. **Mainnet micro-demo.** Deploy the same contract to mainnet with a small USDC balance,
   give the agent a scoped key, and execute one small `ORIGIN_CHAIN` swap. The return leg
   still uses the mock venue unless a real venue integration is added.

Do not promise four chains or hourly autonomy. Promise: one vault, one external chain,
capped agent, visible reasoning, revocable key.

## Known limitations

- No testnet for NEAR Intents; mainnet swaps need real funds.
- The on-chain policy cannot verify a 1Click quote signature. Caps bound the damage.
- The external venue is simulated; a real venue needs its own deposit/withdraw integration.
- 1Click deposit addresses are quote-specific, so the agent is trusted to pass a valid one.
- `cargo-near` and a Rust toolchain are required to build the contract; they are not
  installed in this scaffold by default. The `ci` workflow builds and tests it on push.
- The setup script leaves the agent account with a function-call key only. The key and its
  allowance cannot be changed in place without a full-access key; create a new
  `AGENT_ACCOUNT` and call `set_agent` instead.
- The `on_rebalance_out` callback normally reverts accounting when `ft_transfer` fails. If
  the callback itself never executes, the owner can call `emergency_reset_position` to
  re-base accounting on the idle balance. It does not move funds; verify the token balance
  and deposit address first. This is an owner-trusted escape hatch, not a trustless recovery
  path.
- The first deposit must meet `MIN_FIRST_DEPOSIT` (1,000 token units). Virtual share/asset
  offsets reduce donation inflation but do not eliminate rounding; the contract rejects
  zero-share deposits.
- The dashboard covers user deposit/withdraw and auto-registers token storage; owner actions
  (pause, `set_policy`, `set_agent`, key rotation) still use `near-cli`. There is no admin UI
  by design.
- The on-chain policy verifies the return amount from the token balance but cannot verify
  the off-chain 1Click venue leg. A real venue integration is future work.

## References

- NEAR Intents overview: https://docs.near.org/chain-abstraction/intents/overview
- 1Click API quickstart: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart
- 1Click request lifecycle: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
- NEAR access keys (function-call keys): https://docs.near.org/protocol/accounts-contracts/access-keys

## Submission

Target track: **Unstoppable DeFi** (NEAR HACKATHON). The same build also fits
**AI Security & Defense** because the scoped key and policy engine are the core mechanism.
