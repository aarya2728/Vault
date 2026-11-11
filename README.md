# VaultPilot

**Deposit once on NEAR; an institutional multi-chain yield vault with bounded AI automation and NEAR Chain Signatures.**

VaultPilot is an institutional-grade, multi-position DeFi yield vault native to NEAR Protocol. It automates capital allocation across native NEAR positions and multiple external EVM venues (such as Morpho Blue on Arbitrum and Aave v3 on Base) via **NEAR Intents** and **NEAR Chain Signatures (MPC)**.

An off-chain agent monitors APY spreads, quote costs, and gas prices, submitting rebalance transactions signed with a **strictly scoped function-call key**. The vault contract enforces all financial policies, custody boundaries, and unbonding queues directly on-chain: per-move bounds, UTC daily caps, allowed destination assets, multi-position capacity limits, epoch-based redemption queues, and a 48-hour governance timelock.

> Built for the **NEAR HACKATHON** — **Unstoppable DeFi** track.

---

## Key Institutional Architecture Upgrades

| Feature | Limitation Solved | Implementation Details |
| --- | --- | --- |
| **Epoch-Based Redemption Queue** | **Illiquidity Trap**: Direct withdrawals revert when capital is deployed in cross-chain positions (`idle < requested`). | User withdrawal requests are queued into the current epoch with shares reserved. Once cross-chain strategies settle back to NEAR, idle liquidity replenishes and users claim principal + yield without slippage. |
| **NEAR Chain Signatures (MPC)** | **Hot-Wallet Custody Gap**: Cross-chain funds landing in an off-chain bot runner's EOA wallet. | The NEAR smart contract deterministically derives and controls destination EVM addresses on Arbitrum/Base via NEAR MPC (`v1.signer-prod.testnet`). Funds never leave contract custody. |
| **Multi-Position Portfolio** | **Single-Move Restriction**: Vault was restricted to a single external move (`deployed_assets == 0`). | Upgraded storage to multi-position tracking (`positions: LookupMap<u64, Position>`, `active_position_ids`). Enables simultaneous allocations across Arbitrum, Base, and NEAR with independent settlement. |
| **Governance Timelock** | **Centralized Single-Key Governance**: Owner EOA could instantly alter policies or caps. | All policy modifications (`min_move`, `max_per_move`, `daily_cap`, `slippage`) require a mandatory 48-hour timelock delay before execution, allowing depositors to exit if they disagree. |
| **Human-Crafted Web UI** | **Cluttered Neon/Glassmorphic Templates**: Hard to read and untrusted by institutional allocators. | Professional financial terminal aesthetic with solid Slate palettes, crisp 1px borders, subtle elevation, Light and Dark theme toggle, and dedicated owner governance controls. |

---

## What is Real vs. Modeled

| Component | Status | Details |
| --- | --- | --- |
| **Smart Contract** | Real (On-Chain) | NEP-141 shares, virtual ERC-4626 offsets, epoch redemption queue, governance timelock, multi-position allocations, MPC address derivation, and NEP-297 event telemetry in `contracts/src/lib.rs`. |
| **Scoped Agent Key** | Real (On-Chain) | Agent uses a function-call key restricted to `["rebalance_out", "rebalance_in"]`. Full-access keys are rejected by contract asserts. |
| **1Click Intents API** | Real (Live API) | Live quote generation and solver status polling via `https://1click.chaindefuser.com/v0/quote` and `/v0/status` in `agent/src/intents.ts`. |
| **Chain Signatures MPC** | Real (On-Chain) | Deterministic keccak256 EVM address derivation anchored to `v1.signer-prod.testnet`. Destination funds map to contract-controlled accounts. |
| **Autonomous Walkthrough** | Real (Simulation Script) | End-to-end 6-stage lifecycle walkthrough script runnable via `npm run demo:walkthrough` in `agent/`. |
| **Institutional Dashboard** | Real (Live App) | Built with Vite/React, supporting Light & Dark themes, live wallet connection, instant deposits/withdrawals, epoch unbonding claims, multi-position monitoring, and owner timelock controls in `dashboard/`. |
| **External Lending Protocols** | Modeled / Simulated | Yield spreads are evaluated against live 1Click quote pricing with modeled lending venue yields (Morpho, Aave, Compound), as testnet lending pools and NEAR Intents testnets do not exist. |

---

## System Architecture

```text
                                  ┌──────────────────────────────────────────────┐
                                  │            DEPOSITOR WALLET (NEAR)           │
                                  └──────────────────────┬───────────────────────┘
                                                         │ ft_transfer_call (USDC)
                                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         VAULTPILOT CONTRACT (NEAR)                                             │
│                                                                                                                │
│   • Shares & NAV (Virtual Offsets)          • Multi-Position Storage (Up to 5 Venues)                          │
│   • 48h Governance Timelock Queue           • Epoch-Based Redemption Queue (No Illiquidity Reverts)           │
│   • On-Chain Policy Guardrails              • NEAR Chain Signatures MPC Derivation (v1.signer-prod.testnet)    │
└───────────────────────┬────────────────────────────────────────┬───────────────────────────────────────────────┘
                        │ ft_transfer (1Click Deposit)           │ MPC Destination Address Derivation
                        ▼                                        ▼
┌──────────────────────────────────────────────┐       ┌─────────────────────────────────────────────────────────┐
│        1CLICK SOLVER INTENTS NETWORK         │       │          CONTRACT-CONTROLLED DESTINATION ACCOUNTS       │
│                                              │       │                                                         │
│   • Intent Auctioning & Cross-Chain Routing  │──────▶│   • Arbitrum Venue: Morpho Blue (0x39a1c13bc949... MPC) │
│   • Fronted Liquidity (Zero Bridge Lockup)   │       │   • Base Venue:     Aave v3     (0x7b2f6a1e8c9d... MPC) │
│   • Transparent Solver Telemetry             │       │   • NEAR Venue:     Burrow Staking (Native NEAR)        │
└──────────────────────────────────────────────┘       └─────────────────────────────────────────────────────────┘
                        ▲                                                        │
                        │ rebalance_out / rebalance_in                           │ yield settlement
                        │ (Function-call key ONLY)                               ▼
┌──────────────────────────────────────────────┐       ┌─────────────────────────────────────────────────────────┐
│           AUTONOMOUS AGENT RUNNER            │       │               ON-CHAIN RETURN SETTLEMENT                │
│                                              │       │                                                         │
│   • Live Spread & Gas Evaluation Engine      │       │   • Reads real token ft_balance_of                      │
│   • Circuit Breaker Self-Protection          │       │   • Verifies returned >= position principal             │
│   • Structured JSONL Audit Logging           │       │   • Advances current_epoch & unlocks redemption queue   │
└──────────────────────────────────────────────┘       └─────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```text
vault-pilot/
├── contracts/                 # Rust / near-sdk-rs smart contracts
│   ├── src/lib.rs             # Vault core: shares, epoch queue, timelock, multi-position, views
│   └── src/policy.rs          # On-chain financial guardrails & asset allowlists
├── agent/                     # TypeScript autonomous agent & telemetry
│   ├── src/index.ts           # Autonomous state machine loop
│   ├── src/intents.ts         # Live 1Click quote, status polling, and return quote client
│   ├── src/wallet.ts          # Function-call key scoping validator
│   ├── src/strategy.ts        # Net-alpha spread computation (quote, gas, hold horizon)
│   ├── src/venue.ts           # Multi-venue yield ranking & circuit breaker
│   ├── src/history-server.ts  # Read-only REST endpoint serving audit stream
│   ├── src/types.ts           # Type definitions (Positions, EpochQueue, Timelock)
│   └── scripts/
│       ├── demo-walkthrough.ts# 60-second end-to-end autonomous lifecycle simulation
│       ├── deploy-vault.ts    # Contract deployment & initialization script
│       └── setup-agent-key.ts # Scoped function-call key generation script
├── dashboard/                 # Human-crafted Vite + React institutional web dashboard
│   ├── src/components/
│   │   ├── VaultDashboardHero.tsx     # Clean topbar, theme switcher, and core vault metrics
│   │   ├── ActiveMoveCard.tsx         # Multi-position portfolio tabs & Chain Signatures MPC custody
│   │   ├── UserPosition.tsx           # Deposit, instant withdraw, and Epoch Redemption Queue
│   │   ├── OwnerControls.tsx          # 48h Timelocked policy proposals, pause, and emergency reset
│   │   ├── VaultYieldCalculator.tsx   # Interactive APY & yield projection calculator
│   │   ├── QuoteSimulator.tsx         # Live 1Click quote inspector & net-spread math
│   │   ├── RebalanceTable.tsx         # Searchable rebalance ledger with CSV/JSON exports
│   │   ├── DecisionStream.tsx         # Terminal view of autonomous agent reasoning logs
│   │   └── NetworkBackground.tsx      # Lightweight architectural grid backdrop (0.27 KB)
│   ├── src/providers/
│   │   ├── ThemeProvider.tsx          # Light & Dark theme state persisted in localStorage
│   │   └── NearProvider.tsx           # NEAR wallet connector (Meteor, HOT, Nightly, MyNearWallet)
│   └── src/lib/demo.ts        # Realistic demo vault state, positions, and unbonding queue
└── .github/workflows/ci.yml   # Multi-stage CI: cargo test, wasm target build, tsc, vite build
```

---

## Security & Risk Mitigation Model

| Threat Vector | Mitigation Mechanism | Enforced By |
| --- | --- | --- |
| **Agent Key Compromise** | Function-call key restricted strictly to `receiver_id = <vault>` and `method_names = ["rebalance_out", "rebalance_in"]`. Key cannot attach NEAR or transfer assets. | NEAR Protocol Runtime & Contract Asserts |
| **Malicious Policy Changes** | 48-Hour Governance Timelock. Proposals require an elapsed delay before `execute_policy()` can be called. | Smart Contract State & Timestamp Checks |
| **Illiquidity / Bank Runs** | Epoch-Based Redemption Queue unbonds shares orderly as external positions settle back to NEAR. | Smart Contract Epoch Queue |
| **Hot-Wallet Key Loss / Theft** | Destination EVM addresses are derived directly from the NEAR contract via Chain Signatures MPC (`v1.signer-prod.testnet`). | NEAR Multi-Party Computation (MPC) |
| **Flash Loan / Donation Inflation** | ERC-4626 virtual shares + virtual assets offset plus a mandatory `MIN_FIRST_DEPOSIT` (1,000 units). | Virtual Share Math in `lib.rs` |
| **Solver Slippage & Frontrunning** | On-chain `max_slippage_bps` upper bound and strictly recorded `min_out` per rebalance. | Smart Contract Guardrails |
| **Failed Token Transfers** | `on_withdraw`, `on_rebalance_out`, and `on_claim_withdrawal` promise callbacks restore burned shares and state if token transfers fail. | Asynchronous Revert Callbacks |
| **Anomalous Spreads / Gas Spikes** | Agent trips an automatic circuit breaker after 3 consecutive anomalous quote cycles, pausing new moves. | Agent Protection Engine |

---

## Quickstart & Verification

### ⚡ 60-Second Autonomous Walkthrough (Recommended for Judges)

Run the full end-to-end autonomous lifecycle simulation (key sandboxing &rarr; policy checks &rarr; live 1Click quote &rarr; `rebalance_out` &rarr; MPC custody derivation &rarr; solver telemetry &rarr; return quote &rarr; yield accounting &rarr; settlement) with zero configuration:

```bash
cd agent
npm install
npm run demo:walkthrough
```

---

### 1. Smart Contract Build & Tests

Contract unit tests cover share minting/burning, policy enforcement, epoch queue claims/cancellations, governance timelock delays, multi-position concurrent allocations, and deterministic Chain Signatures address derivations:

```bash
cd contracts
cargo test
cargo near build
```

*(Contract builds and tests also run automatically on Linux via `.github/workflows/ci.yml` on every commit).*

---

### 2. Autonomous Agent Setup

```bash
cd agent
cp .env.example .env
npm install
npm run typecheck    # Strict TypeScript verification
npm run dev          # Start autonomous rebalance loop (DRY_RUN=true by default)
```

To stream live agent reasoning into the dashboard:

```bash
npm run history      # Serves audit log at http://127.0.0.1:8787/api/history
```

---

### 3. Institutional Dashboard

```bash
cd dashboard
cp .env.example .env
npm install
npm run build        # Production build verification
npm run dev          # Start local Vite development server
```

Open `http://localhost:5173/` in your browser. 
* Toggle between **Light** and **Dark** themes using the Sun/Moon button in the top navigation.
* Experience **Multi-Position Portfolio** allocations and verify **Chain Signatures MPC Custody**.
* Test **Instant Withdraw** vs. **Epoch Unbonding Queue** when requested exits exceed idle reserves.
* Review **48-Hour Timelocked Governance Proposals** in the Owner Controls panel.

---

## Hackathon Submission Metadata

* **Project Name**: VaultPilot
* **Track**: Unstoppable DeFi (NEAR HACKATHON)
* **Bounty ID**: `652d6afc-2999-4c0f-9d18-39c1f4b6bb85` (Unstoppable DeFi — 1st Place)
* **Live Demo URL**: [https://aarya2728.github.io/Vault/](https://aarya2728.github.io/Vault/)
* **Repository**: [https://github.com/aarya2728/Vault](https://github.com/aarya2728/Vault)
* **License**: MIT
