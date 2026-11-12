# VaultPilot

VaultPilot is a NEAR-native NEP-141 stablecoin yield vault governed by on-chain policy guardrails, an epoch-based redemption queue, a timelocked governance queue, multi-position portfolio accounting, deterministic NEAR Chain Signatures (MPC) recipient derivation, and an autonomous off-chain rebalance agent using **NEAR Intents (1Click API)** with a strictly scoped function-call access key.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Smart Contract (`contracts/`)](#smart-contract-contracts)
   - [Core Accounting & Share Math](#core-accounting--share-math)
   - [Epoch-Based Redemption Queue](#epoch-based-redemption-queue)
   - [Multi-Position Portfolio & Chain Signatures MPC](#multi-position-portfolio--chain-signatures-mpc)
   - [Governance & Timelock Controls](#governance--timelock-controls)
   - [Contract Method Reference](#contract-method-reference)
   - [NEP-297 Event Schema](#nep-297-event-schema)
3. [Autonomous Agent (`agent/`)](#autonomous-agent-agent)
   - [Key Sandboxing & Lifecycle](#key-sandboxing--lifecycle)
   - [Spread & Alpha Strategy Math](#spread--alpha-strategy-math)
   - [Circuit Breaker & Failure Recovery](#circuit-breaker--failure-recovery)
   - [Agent Environment Variables](#agent-environment-variables)
4. [Web Terminal Dashboard (`dashboard/`)](#web-terminal-dashboard-dashboard)
   - [Views & Functional Architecture](#views--functional-architecture)
   - [Wallet Integration & Demo Simulation Mode](#wallet-integration--demo-simulation-mode)
   - [Dashboard Environment Variables](#dashboard-environment-variables)
5. [Repository Structure](#repository-structure)
6. [Build, Test & Deployment](#build-test--deployment)
7. [Security Model & Scope Boundaries](#security-model--scope-boundaries)

---

## System Architecture

```text
                             ┌─────────────────────────────────────────────┐
                             │         Depositor / Owner (NEAR)            │
                             └──────────────────────┬──────────────────────┘
                                                    │ ft_transfer_call / withdraw / request_withdrawal
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      VaultPilot Contract (NEAR)                                        │
│                                                                                                        │
│  • Shares & ERC-4626 Virtual Offsets       • Epoch Redemption Queue (request / claim / cancel)         │
│  • Policy Guardrails (policy.rs)           • Multi-Position Storage (positions, active_position_ids)   │
│  • Timelocked Policy Proposals             • MPC Address Derivation (v1.signer-prod.testnet)           │
└──────────────────────────┬─────────────────────────────────────────┬───────────────────────────────────┘
                           │ ft_transfer                             │ keccak256 derivation path
                           ▼                                         ▼
┌─────────────────────────────────────────────┐       ┌──────────────────────────────────────────────────┐
│        1Click Solver Intents API            │       │      Contract-Derived EVM Recipient (MPC)        │
│                                             │       │                                                  │
│  • POST /v0/quote (dry / live quotes)       │──────▶│  • Arbitrum One (Morpho Blue / Compound v3)      │
│  • GET  /v0/status (polling depositAddress) │       │  • Base L2 (Aave v3 Prime)                       │
└─────────────────────────────────────────────┘       └──────────────────────────────────────────────────┘
                           ▲                                                     │
                           │ rebalance_out_portfolio / rebalance_in_position     │ ft_balance_of settle
                           │ (Function-Call Key ONLY)                            ▼
┌─────────────────────────────────────────────┐       ┌──────────────────────────────────────────────────┐
│         Autonomous Agent (`agent/`)         │       │         On-Chain Settlement Verification         │
│                                             │       │                                                  │
│  • Net-Spread & Gas Evaluation Engine       │       │  • Requires returned >= position principal       │
│  • Anomaly Circuit Breaker                  │       │  • Releases deployed_assets -> idle_assets         │
│  • Append-only JSONL Log + /api/history     │       │  • Increments current_epoch for queued claims    │
└─────────────────────────────────────────────┘       └──────────────────────────────────────────────────┘
```

---

## Smart Contract (`contracts/`)

Implemented in Rust using `near-sdk = "5"` ([`contracts/src/lib.rs`](contracts/src/lib.rs) and [`contracts/src/policy.rs`](contracts/src/policy.rs)).

### Core Accounting & Share Math

* **NAV Equation**: `total_assets = idle_assets + deployed_assets`. Yield is never accrued optimistically while funds are deployed off-chain; gains are realized only when `rebalance_in` / `rebalance_in_position` reads the vault token's actual `ft_balance_of`.
* **First-Depositor & Donation Inflation Protection**:
  * `MIN_FIRST_DEPOSIT = 1_000` token units when `total_shares == 0`.
  * Virtual offsets (`VIRTUAL_SHARES = 1_000_000`, `VIRTUAL_ASSETS = 1_000_000`):
    * `shares_for_deposit(assets) = assets * (total_shares + VIRTUAL_SHARES) / (total_assets + VIRTUAL_ASSETS)`
    * `assets_for_shares(shares) = shares * (total_assets + VIRTUAL_ASSETS) / (total_shares + VIRTUAL_SHARES)`
* **Failure-Safe Callbacks**: Outbound `ft_transfer` calls chain asynchronous `#[private]` callbacks (`on_withdraw`, `on_claim_withdrawal`, `on_rebalance_out`). If a token transfer fails, the callback restores burned shares or reverts optimistic idle/deployed/daily accounting.
* **Pause Behavior**: `withdraw` intentionally has **no** pause guard. Setting `paused = true` halts new deposits (`ft_on_transfer`) and outbound agent moves (`rebalance_out`), while depositor withdrawals remain open against idle liquidity.

### Epoch-Based Redemption Queue

Prevents withdrawal reverts when `requested_assets > idle_assets`:

1. **`request_withdrawal(shares: U128)`**: Deducts `shares` from the user's share balance and adds them to `queued_shares` under a `QueuedWithdrawal` record for `current_epoch`. Marks status `"ready"` if `idle_assets >= assets && deployed_assets == 0`, otherwise `"pending"`.
2. **Epoch Advancement**: Every successful settlement in `on_rebalance_in_position` increments `current_epoch += 1` and replenishes `idle_assets`.
3. **`claim_withdrawal()`**: Verifies `idle_assets >= assets`, removes the request, burns the reserved shares, updates `total_assets` / `idle_assets`, and transfers tokens with `on_claim_withdrawal` revert safety.
4. **`cancel_withdrawal_request()`**: Cancels a queued ticket and immediately restores the reserved shares to the caller.

### Multi-Position Portfolio & Chain Signatures MPC

* **Concurrent Position Storage**: Replaces single-position blocking (`deployed_assets == 0`) with `positions: LookupMap<u64, Position>` and `active_position_ids: Vec<u64>`, bounded by `max_active_positions` (default `5`, configurable `1..=20`).
* **In-Flight Race Guard**: While an outbound `ft_transfer` promise is in `"funding"` state (`pending_move.status == "funding"`), subsequent `rebalance_out` calls are blocked until `on_rebalance_out` confirms or reverts.
* **Independent Settlement**: `rebalance_in_position(position_id, reason)` verifies `returned >= position.amount`, closes only that position (`status = "closed"`), deducts its principal from `deployed_assets`, and keeps remaining positions open.
* **Deterministic MPC EVM Recipient Derivation**:
  * Anchored to `mpc_signer` (default `"v1.signer-prod.testnet"`, updatable by owner via `set_mpc_signer`).
  * `get_derived_evm_address(path: Option<String>)` computes `env::keccak256_array(format!("{}:{}", env::current_account_id(), path))` and formats the trailing 20 bytes as a `0x`-prefixed EVM address assigned to each `Position.recipient_evm_address`.

### Governance & Timelock Controls

* **On-Chain Policy (`Policy`)**: Enforces `min_move`, `max_per_move`, `daily_cap` (rolling UTC bucket via `block_timestamp / DAY_NS`), `max_slippage_bps <= 10_000`, and `allowed_destination_assets` (1..=16 non-empty asset IDs).
* **Timelocked Proposals**:
  * `propose_policy(policy)` stores a `TimelockedPolicyProposal` with `eta_ms = now + timelock_duration_ms`.
  * `DEFAULT_TIMELOCK_DURATION_MS = 86_400_000` (24 hours; configurable via `set_timelock_duration`, minimum `3_600_000` ms / 1 hour).
  * `execute_policy()` asserts `now >= proposal.eta_ms` before updating `self.policy`.
  * `cancel_policy_proposal()` discards a queued proposal before execution.

### Contract Method Reference

| Category | Method | Caller | Description |
| --- | --- | --- | --- |
| **Init** | `new(owner, token, agent, policy)` | Deployer | Initializes vault state, policy, epoch `1`, and default MPC signer. |
| **User** | `ft_on_transfer(sender_id, amount, _msg)` | `token` contract | Deposits NEP-141 tokens and mints proportional shares. |
| **User** | `withdraw(shares)` | Any depositor | Burns shares for idle assets immediately; reverts if `idle_assets < assets`. |
| **User** | `request_withdrawal(shares)` | Any depositor | Reserves shares in the epoch redemption queue. |
| **User** | `claim_withdrawal()` | Any depositor | Claims tokens for a queued request once `idle_assets` covers it. |
| **User** | `cancel_withdrawal_request()` | Any depositor | Cancels pending queue ticket and restores shares. |
| **Agent** | `rebalance_out(amount, destination_asset, deposit_address, min_out, reason)` | `agent` | Wrapper for `rebalance_out_portfolio` with inferred venue and derived MPC address. |
| **Agent** | `rebalance_out_portfolio(..., venue, recipient_evm_address)` | `agent` | Opens a new tracked `Position` within policy & concurrency caps and transfers FT. |
| **Agent** | `rebalance_in(reason)` / `rebalance_in_position(position_id, reason)` | `agent` | Reads `ft_balance_of`, asserts returned principal, settles position, advances epoch. |
| **Owner** | `pause(paused)` / `set_agent_enabled(enabled)` / `set_agent(agent)` | `owner` | Controls pause state and agent execution permissions. |
| **Owner** | `propose_policy(policy)` / `execute_policy()` / `cancel_policy_proposal()` | `owner` | Queues, executes (after timelock ETA), or cancels policy updates. |
| **Owner** | `set_timelock_duration(duration_ms)` / `set_max_active_positions(max)` / `set_mpc_signer(mpc_signer)` | `owner` | Configures governance delay, position slot cap (`1..=20`), and MPC signer. |
| **Owner** | `set_policy(policy)` | `owner` | Direct owner policy setter (legacy/setup override). |
| **Owner** | `emergency_reset_position(reason)` | `owner` | Clears stuck deployed accounting and resets `total_assets = idle_assets`. |
| **Views** | `get_summary()` | Anyone | Returns `VaultSummary` (TVL, shares, caps, epoch, queued shares, active positions, MPC address, pending proposal). |
| **Views** | `get_active_positions()` / `get_position(id)` / `get_pending_moves()` | Anyone | Returns open `Position` records or legacy `PendingMove`. |
| **Views** | `get_derived_evm_address(path)` / `get_mpc_signer()` | Anyone | Returns deterministic EVM address and configured MPC signer ID. |
| **Views** | `get_withdrawal_request(account_id)` / `get_policy_proposal()` / `get_timelock_duration_ms()` / `get_current_epoch()` / `get_queued_shares()` | Anyone | Inspects queue tickets, timelocked proposals, and epoch metrics. |
| **Views** | `get_shares(account_id)` / `preview_deposit(amount)` / `preview_withdraw(shares)` / `get_policy()` / `get_rebalance_count()` / `get_rebalances(from_index, limit)` | Anyone | Queries balances, share previews, guardrails, and paginated history. |

### NEP-297 Event Schema

All logs emit `EVENT_JSON:{"standard":"vaultpilot","version":"1.0.0","event":"<name>","data":{...}}`:

* **User actions**: `deposit`, `withdraw`, `withdraw_reverted`, `withdrawal_queued`, `withdrawal_claimed`, `claim_withdrawal_reverted`, `withdrawal_request_cancelled`
* **Agent actions**: `rebalance_out`, `rebalance_out_reverted`, `settle`
* **Owner actions**: `set_agent`, `set_agent_enabled`, `pause`, `set_policy`, `policy_proposed`, `policy_executed`, `policy_proposal_cancelled`, `set_timelock_duration`, `emergency_reset`

---

## Autonomous Agent (`agent/`)

Implemented in TypeScript (`near-api-js v7`, `dotenv`, native `fetch`).

### Key Sandboxing & Lifecycle

1. **Function-Call Key Verification (`src/wallet.ts`)**: Checks the agent account's access keys on startup and refuses execution if the configured key is a `FullAccess` key or is scoped outside `receiver_id = VAULT_CONTRACT` and `method_names = ["rebalance_out", "rebalance_in"]`.
2. **State Machine (`src/index.ts` & `src/state.ts`)**: Persists active position phase (`outbound_pending` &rarr; `outbound_completed` &rarr; `awaiting_return` &rarr; `settling`) to `STATE_FILE` (`data/state.json`) and reconciles against on-chain `get_summary()` / `get_pending_moves()` every cycle.
3. **1Click API Integration (`src/intents.ts`)**:
   * `POST /v0/quote` with `swapType: "EXACT_INPUT"`, `depositType: "ORIGIN_CHAIN"`, `recipientType: "DESTINATION_CHAIN"`, `refundTo: VAULT_CONTRACT`.
   * `GET /v0/status?depositAddress=...` polling every `STATUS_POLL_INTERVAL_MS` (`30000` ms default).
   * `requestReturnQuote()` verifies return-leg liquidity and pricing with `dry: true` (`Vault` as recipient).
4. **Telemetry & History API (`src/logger.ts` & `src/history-server.ts`)**: Writes structured JSONL decision records to `LOG_FILE` (`data/rebalances.jsonl`) and exposes a read-only CORS-enabled HTTP server (`GET /api/history`, default port `8787`) consumed by the dashboard's Audit Log stream.

### Spread & Alpha Strategy Math

Implemented in [`agent/src/strategy.ts`](agent/src/strategy.ts) and [`agent/src/venue.ts`](agent/src/venue.ts):

```text
priceCostBps      = ((amountInUsd - amountOutUsd) / amountInUsd) * 10_000
gasCostBps        = ((gasUnits * gasPriceYoctoPerGas * nearUsd / 1e24) / amountInUsd) * 10_000
costBps           = priceCostBps + gasCostBps
annualizedCostBps = (costBps * 365) / max(holdDays, 1)
netSpreadBps      = externalApyBps - nearApyBps - annualizedCostBps
enter             = netSpreadBps > minSpreadBps
```

`venue.ts` ranks five modeled external venues around `EXTERNAL_APY_BPS` and attaches the full ranking breakdown to the decision log.

### Circuit Breaker & Failure Recovery

* **Anomaly Detection**: Tracks consecutive cycles where `quoteCostBps > ANOMALY_COST_BPS` (`350`) or `gasCostBps > ANOMALY_GAS_COST_BPS` (`150`).
* **Self-Pause**: After `CIRCUIT_BREAKER_THRESHOLD` (`3`) consecutive anomalous cycles, the agent enters cooldown for `CIRCUIT_BREAKER_COOLDOWN_MS` (`21600000` ms / 6 hours) and halts new outbound entries without blocking active settlements.
* **Refund Safety**: If 1Click reports `FAILED` or `REFUNDED`, the agent reconciles against on-chain `deployed_assets` before clearing local state.

### Agent Environment Variables

Configured via `agent/.env` (see [`agent/.env.example`](agent/.env.example)):

* **NEAR**: `NEAR_NETWORK`, `NEAR_RPC_URL`, `VAULT_CONTRACT`, `AGENT_ACCOUNT`, `AGENT_PRIVATE_KEY`
* **1Click**: `ONECLICK_BASE_URL`, `ONECLICK_JWT`, `QUOTE_DRY`, `ORIGIN_ASSET`, `DESTINATION_ASSET`, `DESTINATION_RECIPIENT`, `ORIGIN_DECIMALS`, `DESTINATION_DECIMALS`
* **Strategy**: `REBALANCE_AMOUNT`, `SLIPPAGE_BPS`, `MIN_SPREAD_BPS`, `NEAR_APY_BPS`, `EXTERNAL_APY_BPS`, `HOLD_DAYS`, `NEAR_USD`, `GAS_UNITS`
* **Loop & Circuit Breaker**: `POLL_INTERVAL_MS`, `POSITION_MAX_MS`, `DRY_RUN`, `AUTO_CLOSE_MOCK`, `STATUS_POLL_INTERVAL_MS`, `STATUS_POLL_MAX_RETRIES`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_BREAKER_COOLDOWN_MS`, `ANOMALY_COST_BPS`, `ANOMALY_GAS_COST_BPS`
* **Logging & Demo Return**: `LOG_FILE`, `STATE_FILE`, `HISTORY_PORT`, `MOCK_RETURN_ACCOUNT`, `MOCK_RETURN_PRIVATE_KEY`, `MOCK_YIELD_BPS`

---

## Web Terminal Dashboard (`dashboard/`)

Built with React 19, TypeScript, Vite 6, Tailwind CSS v4, and `@hot-labs/near-connect`, using a dark institutional terminal palette (`#080B0C` canvas, `#0D1214` card surfaces, `#1A2226` 1px borders, `#10B981` emerald accents, and tabular `JetBrains Mono` typography).

### Views & Functional Architecture

1. **`Overview`** (`VaultDashboardHero`, `UserPosition`, `ActiveMoveCard`, `OwnerControls`):
   * **Hero Summary Strip**: TVL, VP-USDC shares, Net Terminal APY & Alpha, Idle Liquidity %, Cross-Chain Deployed %, and daily UTC cap progress bar.
   * **Manage Position**: Wallet balance, shares, pool share %, accrued position value, segmented `Deposit` / `Withdraw` form, ERC-4626 exchange rate preview, instant withdrawal, and automatic switch to `Queue for Epoch` when withdrawal exceeds `idle_assets`.
   * **Epoch Redemption Queue**: Ticket ledger displaying pending/ready queue entries with `Claim` and `Cancel` actions.
   * **Active Strategy & Intent Pipeline**: Route visualizer (`NEAR -> 1Click Solver -> Target Venue`), copyable contract-derived MPC EVM address, and 4-step pipeline status tracker.
   * **Governance & Timelock**: Pending parameter change diff, live countdown lock timer on `Execute Policy Change`, proposal creation form, and `Emergency Vault Pause`.
2. **`Yield & Routing`** (`VaultYieldCalculator`, `QuoteSimulator`, `PolicyCard`):
   * Strategy APY & hold-horizon projection calculator.
   * Live 1Click mainnet quote simulator validating amounts against on-chain `Policy` guardrails and outputting contract call JSON previews.
   * On-chain policy bounds and destination asset allowlist viewer.
3. **`MPC Custody`** (`MpcCustodyView`):
   * Master EVM controller address banner (`v1.signer-prod.testnet`) with copy, Etherscan/Arbiscan links, and 12-node MPC consensus threshold bar.
   * Interactive concurrent position cards (`#01 Morpho Blue`, `#02 Aave v3 Prime`, `#03 Compound v3 Comet`, or live contract `get_active_positions()`).
   * Per-position in-flight telemetry panel (ephemeral solver deposit address, NEAR Intent hash, L2 settlement tx, quote spread, signature latency, and `Force Re-Verify State` trigger).
   * 1Click Solver Event Stream table with `Export Audit JSON` download.
4. **`Audit Log`** (`RebalanceTable`, `DecisionStream`, Contract Wiring):
   * Searchable, filterable contract rebalance ledger with inline explorer links and CSV/JSON export.
   * Live/demo agent reasoning stream connected to `VITE_AGENT_LOG_URL`.
   * Active contract, NEP-141 token, scoped agent account, and current epoch metadata.

### Wallet Integration & Demo Simulation Mode

* **NEAR Wallet Selector** (`NearProvider.tsx` & `WalletBar.tsx`): Configures `@hot-labs/near-connect` with explicit NEAR RPC providers. On `testnet`, **Meteor Wallet**, **Intear Wallet**, **Nightly Wallet**, and **Ledger** are supported (HOT Wallet and MyNearWallet require `mainnet` in the `near-selector` manifest).
* **Simulated Testnet Session & Interactive Demo State**: When `VITE_VAULT_CONTRACT` is unset or a simulated testnet wallet is selected in `WalletBar`, `Deposit`, `Withdraw`, `Queue`, `Claim`, `Cancel`, `Propose/Execute Policy`, and `Pause` run interactively in local client state using ERC-4626 share math and update TVL, idle liquidity, shares, and balances live.

### Dashboard Environment Variables

Configured via `dashboard/.env` (see [`dashboard/.env.example`](dashboard/.env.example)):

```env
VITE_NEAR_NETWORK=testnet
VITE_NEAR_RPC_URL=https://rpc.testnet.near.org
VITE_VAULT_CONTRACT=vault.you.testnet
VITE_TOKEN_SYMBOL=USDC
VITE_TOKEN_DECIMALS=6
VITE_ONECLICK_BASE_URL=https://1click.chaindefuser.com
# Optional: live agent decision feed from `npm run history` in agent/
# VITE_AGENT_LOG_URL=http://127.0.0.1:8787/api/history
```

---

## Repository Structure

```text
vault-pilot/
├── contracts/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                        # Vault state, shares, epoch queue, timelock, multi-position, MPC derivation, unit tests
│       └── policy.rs                     # Policy struct, validation assertions, destination asset allowlist
├── agent/
│   ├── package.json
│   ├── .env.example
│   ├── .env.setup.example
│   ├── src/
│   │   ├── index.ts                      # Polling loop, 4-phase position state machine, circuit breaker
│   │   ├── config.ts                     # Environment config loader & validation
│   │   ├── intents.ts                    # 1Click /v0/tokens, /v0/quote, /v0/status, /v0/deposit/submit client
│   │   ├── strategy.ts                   # Spread, gas cost, and net-alpha gate calculation
│   │   ├── venue.ts                      # Multi-venue APY ranking model
│   │   ├── wallet.ts                     # On-chain function-call access key scope verification
│   │   ├── rpc.ts                        # NEAR view calls, gas price queries, signed tx submission
│   │   ├── state.ts                      # Persistent JSON state reader/writer
│   │   ├── logger.ts                     # Append-only JSONL audit logger
│   │   ├── history-server.ts             # Read-only HTTP server (/api/history)
│   │   ├── mock-return.ts                # Treasury demo return script (principal + MOCK_YIELD_BPS)
│   │   └── types.ts                      # Shared TypeScript interfaces
│   └── scripts/
│       ├── demo-walkthrough.ts           # Self-contained 6-step autonomous lifecycle simulation
│       ├── deploy-vault.ts               # Vault account creation, wasm deployment, and init call
│       ├── setup-agent-key.ts            # Scoped function-call key generator and owner set_agent registrar
│       └── lib.ts                        # Shared script helpers
├── dashboard/
│   ├── package.json
│   ├── index.html
│   ├── .env.example
│   └── src/
│       ├── App.tsx                       # Shell navbar, tab navigation (Overview, Yield & Routing, MPC Custody, Audit Log)
│       ├── main.tsx
│       ├── styles.css                    # Dark institutional terminal CSS tokens and layout classes
│       ├── providers/
│       │   ├── NearProvider.tsx          # @hot-labs/near-connect integration + simulated wallet support
│       │   └── ThemeProvider.tsx
│       ├── lib/
│       │   ├── vault.ts                  # Contract RPC view wrappers, ERC-4626 math, 1Click client, formatters
│       │   └── demo.ts                   # Demo summary, 3 concurrent multi-chain positions, queue ticket, logs
│       └── components/
│           ├── VaultDashboardHero.tsx
│           ├── UserPosition.tsx
│           ├── ActiveMoveCard.tsx
│           ├── OwnerControls.tsx
│           ├── MpcCustodyView.tsx
│           ├── VaultYieldCalculator.tsx
│           ├── QuoteSimulator.tsx
│           ├── PolicyCard.tsx
│           ├── RebalanceTable.tsx
│           ├── DecisionStream.tsx
│           ├── WalletBar.tsx
│           └── Icons.tsx
└── .github/workflows/ci.yml              # CI: cargo test, wasm32 release build, agent typecheck, dashboard build
```

---

## Build, Test & Deployment

### 1. 60-Second Agent Lifecycle Simulation

Runs key-scope validation, policy verification, live 1Click API quoting (with fallback), `rebalance_out_portfolio` with MPC recipient derivation, solver telemetry, and `rebalance_in` settlement:

```bash
cd agent
npm install
npm run demo:walkthrough
```

### 2. Smart Contract Tests & Wasm Build

```bash
cd contracts
cargo test
cargo build --release --target wasm32-unknown-unknown
```

*(Automated on Linux via [`.github/workflows/ci.yml`](.github/workflows/ci.yml), which also uploads `vault_pilot_contract.wasm` as a build artifact.)*

### 3. Testnet Contract Deployment & Agent Key Setup

```bash
cd agent
cp .env.setup.example .env.setup
# Populate OWNER_ACCOUNT, OWNER_PRIVATE_KEY, VAULT_CONTRACT, VAULT_PRIVATE_KEY, VAULT_TOKEN, AGENT_ACCOUNT, POLICY_ALLOWED_ASSETS
npm install
npm run deploy
npm run setup:agent
```

Register the vault for NEP-145 token storage before the first deposit:

```bash
near call <VAULT_TOKEN> storage_deposit '{"account_id":"<VAULT_CONTRACT>"}' \
  --accountId <OWNER_ACCOUNT> --deposit 0.00125
```

### 4. Run Agent & History Server

```bash
cd agent
cp .env.example .env
npm run typecheck
npm run dev          # Runs autonomous loop (DRY_RUN=true by default)
npm run history      # Serves /api/history on port 8787
```

To simulate a treasury return and execute a settlement close in live mode:

```bash
npm run mock:return
# With AUTO_CLOSE_MOCK=true and DRY_RUN=false:
npm run once
```

### 5. Run Dashboard Locally

```bash
cd dashboard
cp .env.example .env
npm install
npm run build        # Verifies TypeScript (tsc --noEmit) + Vite bundle
npm run dev          # Starts local server at http://localhost:5173
```

---

## Security Model & Scope Boundaries

* **Bounded Trust vs. Trustless Verification**: The contract bounds agent risk via `min_move`, `max_per_move`, `daily_cap`, `allowed_destination_assets`, `max_active_positions`, `pause`, and function-call key method restrictions. Off-chain 1Click quotes are not cryptographically verified on-chain; a compromised agent key is bounded by `max_per_move` and `daily_cap` until paused or rotated by the owner.
* **No NEAR Intents Testnet**: 1Click quotes run against mainnet asset IDs (`nep141:...`). Default agent configuration runs with `DRY_RUN=true` against testnet vault state while querying real mainnet quotes.
* **Modeled Lending Yields**: External venue APYs (Morpho Blue, Aave v3, Compound v3) are modeled in `agent/src/venue.ts` and `dashboard/src/lib/demo.ts`; live lending protocol deposit/withdraw adapters on Arbitrum/Base are outside the current contract scope.
* **Unaudited Prototype**: Code has not undergone an external smart-contract security audit and is intended for testnet/demo funds only.
