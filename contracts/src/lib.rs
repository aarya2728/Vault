use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, Promise, PromiseResult,
};

mod policy;
pub use policy::Policy;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Shares,
    Rebalances,
    WithdrawalRequests,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct RebalanceRecord {
    pub id: u64,
    pub timestamp_ms: u64,
    pub kind: String,
    pub amount: U128,
    pub destination_asset: String,
    pub deposit_address: Option<AccountId>,
    pub min_out: U128,
    pub reason: String,
    pub executor: AccountId,
}

/// The single external position the agent is currently allowed to have.
/// `status` is `funding` while the outbound `ft_transfer` is in flight,
/// `open` once the transfer callback confirms success, and `failed` (or absent)
/// after a revert or reset.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingMove {
    pub id: u64,
    pub amount: U128,
    pub destination_asset: String,
    pub deposit_address: AccountId,
    pub min_out: U128,
    pub opened_at_ms: u64,
    pub status: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct QueuedWithdrawal {
    pub account_id: AccountId,
    pub shares: U128,
    pub requested_at_ms: u64,
    pub epoch: u64,
    pub status: String,
    pub assets_allocated: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct TimelockedPolicyProposal {
    pub policy: Policy,
    pub proposed_at_ms: u64,
    pub eta_ms: u64,
    pub proposer: AccountId,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultSummary {
    pub owner: AccountId,
    pub token: AccountId,
    pub agent: AccountId,
    pub agent_enabled: bool,
    pub paused: bool,
    pub total_shares: U128,
    pub total_assets: U128,
    pub idle_assets: U128,
    pub deployed_assets: U128,
    /// 1e24-scaled assets per share. 1e24 means 1.0.
    pub share_price: U128,
    pub daily_moved: U128,
    pub daily_remaining: U128,
    pub today_bucket: u64,
    pub last_move_ms: u64,
    pub pending_move: Option<PendingMove>,
    pub policy: Policy,
    pub current_epoch: u64,
    pub queued_shares: U128,
    pub pending_policy_proposal: Option<TimelockedPolicyProposal>,
}

#[near(contract_state)]
pub struct VaultPilot {
    owner: AccountId,
    token: AccountId,
    agent: AccountId,
    agent_enabled: bool,
    paused: bool,
    total_shares: u128,
    total_assets: u128,
    idle_assets: u128,
    deployed_assets: u128,
    shares: LookupMap<AccountId, u128>,
    rebalances: Vector<RebalanceRecord>,
    policy: Policy,
    daily_moved: u128,
    daily_bucket: u64,
    pending_move: Option<PendingMove>,
    last_move_ms: u64,
    current_epoch: u64,
    queued_shares: u128,
    withdrawal_requests: LookupMap<AccountId, QueuedWithdrawal>,
    timelock_duration_ms: u64,
    pending_policy_proposal: Option<TimelockedPolicyProposal>,
}

const DAY_NS: u64 = 86_400_000_000_000;
const SHARE_PRICE_SCALE: u128 = 1_000_000_000_000_000_000_000_000;
const DEFAULT_TIMELOCK_DURATION_MS: u64 = 86_400_000; // 24 hours

/// Minimum first deposit. Prevents the classic first-depositor share inflation
/// attack together with the virtual share/asset offsets below.
const MIN_FIRST_DEPOSIT: u128 = 1_000;
/// Virtual offsets (ERC-4626 style) keep the exchange rate non-zero and make
/// donation-based share inflation expensive even before the first real deposit.
const VIRTUAL_SHARES: u128 = 1_000_000;
const VIRTUAL_ASSETS: u128 = 1_000_000;

impl Default for VaultPilot {
    fn default() -> Self {
        Self {
            owner: env::current_account_id(),
            token: env::current_account_id(),
            agent: env::current_account_id(),
            agent_enabled: false,
            paused: true,
            total_shares: 0,
            total_assets: 0,
            idle_assets: 0,
            deployed_assets: 0,
            shares: LookupMap::new(StorageKey::Shares),
            rebalances: Vector::new(StorageKey::Rebalances),
            policy: Policy {
                min_move: U128(1),
                max_per_move: U128(1),
                daily_cap: U128(1),
                max_slippage_bps: 0,
                allowed_destination_assets: Vec::new(),
            },
            daily_moved: 0,
            daily_bucket: 0,
            pending_move: None,
            last_move_ms: 0,
            current_epoch: 1,
            queued_shares: 0,
            withdrawal_requests: LookupMap::new(StorageKey::WithdrawalRequests),
            timelock_duration_ms: DEFAULT_TIMELOCK_DURATION_MS,
            pending_policy_proposal: None,
        }
    }
}

#[near]
impl VaultPilot {
    #[init]
    pub fn new(owner: AccountId, token: AccountId, agent: AccountId, policy: Policy) -> Self {
        policy.assert_valid();
        Self {
            owner,
            token,
            agent,
            agent_enabled: true,
            paused: false,
            total_shares: 0,
            total_assets: 0,
            idle_assets: 0,
            deployed_assets: 0,
            shares: LookupMap::new(StorageKey::Shares),
            rebalances: Vector::new(StorageKey::Rebalances),
            policy,
            daily_moved: 0,
            daily_bucket: current_day(),
            pending_move: None,
            last_move_ms: 0,
            current_epoch: 1,
            queued_shares: 0,
            withdrawal_requests: LookupMap::new(StorageKey::WithdrawalRequests),
            timelock_duration_ms: DEFAULT_TIMELOCK_DURATION_MS,
            pending_policy_proposal: None,
        }
    }

    // ---------------------------------------------------------------- user flows

    /// NEP-141 receiver. The user calls `ft_transfer_call` on the vault token with
    /// `receiver_id = <vault>`; the token then calls this method.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, _msg: String) -> U128 {
        require!(
            env::predecessor_account_id() == self.token,
            "only the token contract can call this"
        );
        require!(!self.paused, "vault is paused");
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        if self.total_shares == 0 {
            require!(
                amount >= MIN_FIRST_DEPOSIT,
                "first deposit is below the minimum"
            );
        }

        let shares = self.shares_for_deposit(amount);
        require!(shares > 0, "deposit too small");

        let current = self.shares.get(&sender_id).copied().unwrap_or(0);
        self.shares.insert(sender_id.clone(), current + shares);
        self.total_shares += shares;
        self.total_assets += amount;
        self.idle_assets += amount;

        emit_event(
            "deposit",
            json!({
                "account_id": sender_id,
                "amount": U128(amount),
                "shares": U128(shares),
                "total_shares": U128(self.total_shares),
                "total_assets": U128(self.total_assets),
            }),
        );

        U128(0)
    }

    /// Burn shares and receive the proportional amount of idle assets.
    ///
    /// Withdrawals deliberately stay open while the vault is paused: the pause
    /// switch only stops new deposits and agent moves. The owner escape hatch is
    /// therefore "pause + let users withdraw", not a privileged transfer.
    pub fn withdraw(&mut self, shares: U128) -> Promise {
        let account = env::predecessor_account_id();
        let shares = shares.0;
        require!(shares > 0, "shares must be > 0");

        let owned = self.shares.get(&account).copied().unwrap_or(0);
        require!(owned >= shares, "insufficient shares");

        let assets = self.assets_for_shares(shares);
        require!(assets > 0, "amount too small");
        require!(self.idle_assets >= assets, "insufficient idle liquidity");

        self.shares.insert(account.clone(), owned - shares);
        self.total_shares -= shares;
        self.total_assets -= assets;
        self.idle_assets -= assets;

        emit_event(
            "withdraw",
            json!({
                "account_id": account.clone(),
                "shares": U128(shares),
                "assets": U128(assets),
                "total_shares": U128(self.total_shares),
                "total_assets": U128(self.total_assets),
            }),
        );

        let callback_args = json!({
            "account_id": account.clone(),
            "shares": U128(shares),
            "assets": U128(assets),
        })
        .to_string()
        .into_bytes();

        self.ft_transfer(account, assets).then(
            Promise::new(env::current_account_id()).function_call(
                "on_withdraw".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            ),
        )
    }

    /// Restores the burned shares if the withdrawal transfer failed, so a
    /// failed `ft_transfer` cannot silently confiscate a user's position.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, shares: U128, assets: U128) {
        if env::promise_result(0) == PromiseResult::Failed {
            let current = self.shares.get(&account_id).copied().unwrap_or(0);
            self.shares.insert(account_id.clone(), current + shares.0);
            self.total_shares += shares.0;
            self.total_assets += assets.0;
            self.idle_assets += assets.0;
            env::log_str("withdraw failed; shares restored");
            emit_event(
                "withdraw_reverted",
                json!({
                    "account_id": account_id,
                    "shares": shares,
                    "assets": assets,
                }),
            );
        }
    }

    /// Queue a withdrawal request when idle liquidity is deployed in external venues.
    /// Deducts shares from the user balance and reserves them in the redemption queue.
    /// When the position settles and returns idle liquidity, the user can call `claim_withdrawal`.
    pub fn request_withdrawal(&mut self, shares: U128) -> String {
        let account = env::predecessor_account_id();
        let shares = shares.0;
        require!(shares > 0, "shares must be > 0");

        let owned = self.shares.get(&account).copied().unwrap_or(0);
        require!(owned >= shares, "insufficient shares");

        require!(
            self.withdrawal_requests.get(&account).is_none(),
            "an existing withdrawal request is already pending; claim or cancel first"
        );

        let assets = self.assets_for_shares(shares);
        require!(assets > 0, "amount too small");

        self.shares.insert(account.clone(), owned - shares);
        self.queued_shares += shares;

        let now = env::block_timestamp() / 1_000_000;
        let is_ready = self.idle_assets >= assets && self.deployed_assets == 0;
        let status = if is_ready { "ready" } else { "pending" };
        let allocated = if is_ready { assets } else { 0 };

        let request = QueuedWithdrawal {
            account_id: account.clone(),
            shares: U128(shares),
            requested_at_ms: now,
            epoch: self.current_epoch,
            status: status.to_string(),
            assets_allocated: U128(allocated),
        };

        self.withdrawal_requests.insert(account.clone(), request);

        emit_event(
            "withdrawal_queued",
            json!({
                "account_id": account,
                "shares": U128(shares),
                "assets_estimated": U128(assets),
                "epoch": self.current_epoch,
                "status": status,
            }),
        );

        status.to_string()
    }

    /// Claim a queued withdrawal once idle liquidity is available or after settlement.
    pub fn claim_withdrawal(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let req = self
            .withdrawal_requests
            .get(&account)
            .cloned()
            .expect("no queued withdrawal found for this account");

        let assets = if req.assets_allocated.0 > 0 {
            req.assets_allocated.0
        } else {
            self.assets_for_shares(req.shares.0)
        };

        require!(assets > 0, "amount too small");
        require!(
            self.idle_assets >= assets,
            "insufficient idle liquidity to claim yet; waiting for settlement"
        );

        self.withdrawal_requests.remove(&account);
        self.queued_shares = self.queued_shares.saturating_sub(req.shares.0);
        self.total_shares = self.total_shares.saturating_sub(req.shares.0);
        self.total_assets = self.total_assets.saturating_sub(assets);
        self.idle_assets = self.idle_assets.saturating_sub(assets);

        emit_event(
            "withdrawal_claimed",
            json!({
                "account_id": account.clone(),
                "shares": req.shares,
                "assets": U128(assets),
                "epoch": req.epoch,
            }),
        );

        let callback_args = json!({
            "account_id": account.clone(),
            "shares": req.shares,
            "assets": U128(assets),
            "epoch": req.epoch,
        })
        .to_string()
        .into_bytes();

        self.ft_transfer(account, assets).then(
            Promise::new(env::current_account_id()).function_call(
                "on_claim_withdrawal".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            ),
        )
    }

    /// Restores the queued withdrawal if the token transfer failed.
    #[private]
    pub fn on_claim_withdrawal(
        &mut self,
        account_id: AccountId,
        shares: U128,
        assets: U128,
        epoch: u64,
    ) {
        if env::promise_result(0) == PromiseResult::Failed {
            self.total_shares += shares.0;
            self.queued_shares += shares.0;
            self.total_assets += assets.0;
            self.idle_assets += assets.0;

            let req = QueuedWithdrawal {
                account_id: account_id.clone(),
                shares,
                requested_at_ms: env::block_timestamp() / 1_000_000,
                epoch,
                status: "ready".to_string(),
                assets_allocated: assets,
            };
            self.withdrawal_requests.insert(account_id.clone(), req);

            env::log_str("claim_withdrawal failed; queued request restored");
            emit_event(
                "claim_withdrawal_reverted",
                json!({
                    "account_id": account_id,
                    "shares": shares,
                    "assets": assets,
                }),
            );
        }
    }

    /// Cancel a pending queued withdrawal request and restore shares to user balance.
    pub fn cancel_withdrawal_request(&mut self) {
        let account = env::predecessor_account_id();
        let req = self
            .withdrawal_requests
            .get(&account)
            .cloned()
            .expect("no pending withdrawal request to cancel");

        self.withdrawal_requests.remove(&account);
        self.queued_shares = self.queued_shares.saturating_sub(req.shares.0);

        let current = self.shares.get(&account).copied().unwrap_or(0);
        self.shares.insert(account.clone(), current + req.shares.0);

        emit_event(
            "withdrawal_request_cancelled",
            json!({
                "account_id": account,
                "shares": req.shares,
            }),
        );
    }

    // ---------------------------------------------------------------- agent flows

    /// Move idle assets to a 1Click `ORIGIN_CHAIN` deposit address. Only the
    /// configured agent can call this. One external position at a time.
    pub fn rebalance_out(
        &mut self,
        amount: U128,
        destination_asset: String,
        deposit_address: AccountId,
        min_out: U128,
        reason: String,
    ) -> Promise {
        self.assert_agent();
        require!(!self.paused, "vault is paused");
        require!(self.pending_move.is_none(), "a move is already pending");
        require!(self.deployed_assets == 0, "a position is already open");

        let amount = amount.0;
        require!(amount >= self.policy.min_move.0, "amount below min_move");
        require!(
            amount <= self.policy.max_per_move.0,
            "amount above max_per_move"
        );
        require!(amount <= self.idle_assets, "insufficient idle liquidity");
        require!(min_out.0 > 0, "min_out must be > 0");
        require!(
            self.policy.allows(&destination_asset),
            "destination asset not allowed"
        );
        require!(reason.len() <= 280, "reason too long");

        self.roll_daily_bucket();
        require!(
            self.daily_moved + amount <= self.policy.daily_cap.0,
            "daily cap exceeded"
        );

        self.idle_assets -= amount;
        self.deployed_assets += amount;
        self.daily_moved += amount;

        let id = self.record(
            "rebalance_out",
            amount,
            destination_asset.clone(),
            Some(deposit_address.clone()),
            min_out.0,
            reason,
            env::predecessor_account_id(),
        );

        let opened_at_ms = env::block_timestamp() / 1_000_000;
        self.pending_move = Some(PendingMove {
            id,
            amount: U128(amount),
            destination_asset,
            deposit_address: deposit_address.clone(),
            min_out,
            opened_at_ms,
            status: "funding".to_string(),
        });
        self.last_move_ms = opened_at_ms;

        let callback_args = json!({ "id": id, "amount": U128(amount) })
            .to_string()
            .into_bytes();

        self.ft_transfer(deposit_address, amount).then(
            Promise::new(env::current_account_id()).function_call(
                "on_rebalance_out".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            ),
        )
    }

    /// Reverts the optimistic accounting if the outbound transfer failed.
    /// A successful transfer flips the pending move from `funding` to `open`.
    #[private]
    pub fn on_rebalance_out(&mut self, id: u64, amount: U128) {
        let matches = self
            .pending_move
            .as_ref()
            .map_or(false, |pending| pending.id == id);
        if !matches {
            env::log_str("stale or unknown rebalance_out callback");
            return;
        }

        if env::promise_result(0) == PromiseResult::Failed {
            self.idle_assets += amount.0;
            self.deployed_assets = self.deployed_assets.saturating_sub(amount.0);
            self.daily_moved = self.daily_moved.saturating_sub(amount.0);
            self.pending_move = None;
            env::log_str("rebalance_out failed; accounting reverted");
            emit_event(
                "rebalance_out_reverted",
                json!({ "id": id, "amount": amount }),
            );
        } else if let Some(pending) = self.pending_move.as_mut() {
            pending.status = "open".to_string();
            env::log_str("rebalance_out transfer succeeded");
        }
    }

    /// Close the external position by reading the vault's real FT balance.
    /// The agent must only call this after the external leg has returned funds.
    /// The returned amount is read from the token contract, not reported by the
    /// agent, and must cover the deployed principal.
    pub fn rebalance_in(&mut self, reason: String) -> Promise {
        self.assert_agent();
        require!(self.deployed_assets > 0, "no open position");
        require!(reason.len() <= 280, "reason too long");

        let args = json!({ "account_id": env::current_account_id() });
        let executor = env::predecessor_account_id();
        let callback_args = json!({ "reason": reason, "executor": executor })
            .to_string()
            .into_bytes();

        Promise::new(self.token.clone())
            .function_call(
                "ft_balance_of".to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_rebalance_in".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            ))
    }

    #[private]
    pub fn on_rebalance_in(&mut self, reason: String, executor: AccountId) -> u128 {
        let result = env::promise_result(0);
        let value = match result {
            PromiseResult::Successful(value) => value,
            PromiseResult::Failed => env::panic_str("ft_balance_of failed"),
        };

        let raw: String =
            near_sdk::serde_json::from_slice(&value).expect("invalid ft_balance_of response");
        let actual: u128 = raw.parse().expect("invalid FT balance");

        let previous_idle = self.idle_assets;
        require!(
            actual > previous_idle,
            "no funds returned; position stays open"
        );
        let returned = actual - previous_idle;
        require!(
            returned >= self.deployed_assets,
            "return is below deployed principal; position stays open"
        );

        self.idle_assets = actual;
        self.deployed_assets = 0;
        self.total_assets = self.idle_assets;
        self.pending_move = None;
        self.last_move_ms = env::block_timestamp() / 1_000_000;
        self.current_epoch += 1;

        let id = self.record(
            "rebalance_in",
            returned,
            "near".to_string(),
            None,
            0,
            reason,
            executor.clone(),
        );

        emit_event(
            "settle",
            json!({
                "id": id,
                "returned": U128(returned),
                "idle_assets": U128(self.idle_assets),
                "executor": executor,
            }),
        );

        actual
    }

    // ---------------------------------------------------------------- owner flows

    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        emit_event(
            "set_agent",
            json!({ "previous": self.agent.clone(), "agent": agent.clone() }),
        );
        self.agent = agent;
    }

    pub fn set_agent_enabled(&mut self, enabled: bool) {
        self.assert_owner();
        self.agent_enabled = enabled;
        emit_event("set_agent_enabled", json!({ "enabled": enabled }));
    }

    pub fn pause(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        emit_event("pause", json!({ "paused": paused }));
    }

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        policy.assert_valid();
        emit_event("set_policy", json!({ "policy": policy.clone() }));
        self.policy = policy;
    }

    /// Propose a policy change with a mandatory timelock delay (Institutional Governance).
    pub fn propose_policy(&mut self, policy: Policy) {
        self.assert_owner();
        policy.assert_valid();

        let now = env::block_timestamp() / 1_000_000;
        let eta_ms = now + self.timelock_duration_ms;

        let proposal = TimelockedPolicyProposal {
            policy: policy.clone(),
            proposed_at_ms: now,
            eta_ms,
            proposer: env::predecessor_account_id(),
        };

        self.pending_policy_proposal = Some(proposal);

        emit_event(
            "policy_proposed",
            json!({
                "policy": policy,
                "proposed_at_ms": now,
                "eta_ms": eta_ms,
                "timelock_duration_ms": self.timelock_duration_ms,
            }),
        );
    }

    /// Execute an approved policy change after the timelock delay has elapsed.
    pub fn execute_policy(&mut self) {
        self.assert_owner();
        let proposal = self
            .pending_policy_proposal
            .take()
            .expect("no pending policy proposal to execute");

        let now = env::block_timestamp() / 1_000_000;
        require!(
            now >= proposal.eta_ms,
            "timelock delay has not elapsed yet"
        );

        self.policy = proposal.policy.clone();

        emit_event(
            "policy_executed",
            json!({
                "policy": self.policy,
                "executed_at_ms": now,
            }),
        );
    }

    /// Cancel a pending policy proposal before execution.
    pub fn cancel_policy_proposal(&mut self) {
        self.assert_owner();
        require!(
            self.pending_policy_proposal.is_some(),
            "no pending policy proposal"
        );
        self.pending_policy_proposal = None;
        emit_event("policy_proposal_cancelled", json!({}));
    }

    /// Configure the timelock duration in milliseconds (e.g. 86400000 = 24h).
    pub fn set_timelock_duration(&mut self, duration_ms: u64) {
        self.assert_owner();
        require!(duration_ms >= 3_600_000, "timelock must be at least 1 hour");
        self.timelock_duration_ms = duration_ms;
        emit_event("set_timelock_duration", json!({ "duration_ms": duration_ms }));
    }

    /// Owner escape hatch for an `ft_transfer` that failed after accounting
    /// moved. This does not move funds; it only clears `deployed_assets` and
    /// re-bases `total_assets` on the idle balance. Use only after checking the
    /// token balance and the 1Click deposit address on-chain.
    pub fn emergency_reset_position(&mut self, reason: String) {
        self.assert_owner();
        require!(self.deployed_assets > 0, "no open position");
        require!(reason.len() <= 280, "reason too long");

        let deployed = self.deployed_assets;
        self.deployed_assets = 0;
        self.total_assets = self.idle_assets;
        self.pending_move = None;
        self.last_move_ms = env::block_timestamp() / 1_000_000;

        self.record(
            "emergency_reset",
            deployed,
            "near".to_string(),
            None,
            0,
            reason,
            env::predecessor_account_id(),
        );
    }

    // ---------------------------------------------------------------- views

    pub fn get_summary(&self) -> VaultSummary {
        VaultSummary {
            owner: self.owner.clone(),
            token: self.token.clone(),
            agent: self.agent.clone(),
            agent_enabled: self.agent_enabled,
            paused: self.paused,
            total_shares: U128(self.total_shares),
            total_assets: U128(self.total_assets),
            idle_assets: U128(self.idle_assets),
            deployed_assets: U128(self.deployed_assets),
            share_price: U128(self.share_price()),
            daily_moved: U128(self.daily_moved_today()),
            daily_remaining: U128(
                self.policy
                    .daily_cap
                    .0
                    .saturating_sub(self.daily_moved_today()),
            ),
            today_bucket: current_day(),
            last_move_ms: self.last_move_ms,
            pending_move: self.pending_move.clone(),
            policy: self.policy.clone(),
            current_epoch: self.current_epoch,
            queued_shares: U128(self.queued_shares),
            pending_policy_proposal: self.pending_policy_proposal.clone(),
        }
    }

    pub fn get_withdrawal_request(&self, account_id: AccountId) -> Option<QueuedWithdrawal> {
        self.withdrawal_requests.get(&account_id).cloned()
    }

    pub fn get_policy_proposal(&self) -> Option<TimelockedPolicyProposal> {
        self.pending_policy_proposal.clone()
    }

    pub fn get_timelock_duration_ms(&self) -> u64 {
        self.timelock_duration_ms
    }

    pub fn get_current_epoch(&self) -> u64 {
        self.current_epoch
    }

    pub fn get_queued_shares(&self) -> U128 {
        U128(self.queued_shares)
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_pending_moves(&self) -> Vec<PendingMove> {
        self.pending_move.iter().cloned().collect()
    }

    pub fn get_shares(&self, account_id: AccountId) -> U128 {
        U128(self.shares.get(&account_id).copied().unwrap_or(0))
    }

    pub fn preview_deposit(&self, amount: U128) -> U128 {
        U128(self.shares_for_deposit(amount.0))
    }

    pub fn preview_withdraw(&self, shares: U128) -> U128 {
        U128(self.assets_for_shares(shares.0))
    }

    pub fn get_rebalance_count(&self) -> u64 {
        self.rebalances.len() as u64
    }

    pub fn get_rebalances(&self, from_index: u64, limit: u64) -> Vec<RebalanceRecord> {
        let len = self.rebalances.len() as u64;
        let start = from_index.min(len);
        let end = start.saturating_add(limit).min(len);
        (start..end)
            .filter_map(|index| self.rebalances.get(index as u32).cloned())
            .collect()
    }

    // ---------------------------------------------------------------- internals

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner can call this"
        );
    }

    fn assert_agent(&self) {
        require!(self.agent_enabled, "agent is disabled");
        require!(
            env::predecessor_account_id() == self.agent,
            "only the agent can call this"
        );
    }

    fn roll_daily_bucket(&mut self) {
        let today = current_day();
        if today != self.daily_bucket {
            self.daily_bucket = today;
            self.daily_moved = 0;
        }
    }

    fn daily_moved_today(&self) -> u128 {
        if current_day() == self.daily_bucket {
            self.daily_moved
        } else {
            0
        }
    }

    fn shares_for_deposit(&self, amount: u128) -> u128 {
        let virtual_assets = self
            .total_assets
            .checked_add(VIRTUAL_ASSETS)
            .expect("share math overflow");
        let virtual_shares = self
            .total_shares
            .checked_add(VIRTUAL_SHARES)
            .expect("share math overflow");
        amount
            .checked_mul(virtual_shares)
            .expect("share math overflow")
            / virtual_assets
    }

    fn assets_for_shares(&self, shares: u128) -> u128 {
        if self.total_shares == 0 {
            return 0;
        }
        let virtual_assets = self
            .total_assets
            .checked_add(VIRTUAL_ASSETS)
            .expect("share math overflow");
        let virtual_shares = self
            .total_shares
            .checked_add(VIRTUAL_SHARES)
            .expect("share math overflow");
        shares
            .checked_mul(virtual_assets)
            .expect("share math overflow")
            / virtual_shares
    }

    fn share_price(&self) -> u128 {
        let virtual_assets = self.total_assets.saturating_add(VIRTUAL_ASSETS);
        let virtual_shares = self.total_shares.saturating_add(VIRTUAL_SHARES);
        virtual_assets.saturating_mul(SHARE_PRICE_SCALE) / virtual_shares
    }

    fn record(
        &mut self,
        kind: &str,
        amount: u128,
        destination_asset: String,
        deposit_address: Option<AccountId>,
        min_out: u128,
        reason: String,
        executor: AccountId,
    ) -> u64 {
        let id = self.rebalances.len() as u64;
        let record = RebalanceRecord {
            id,
            timestamp_ms: env::block_timestamp() / 1_000_000,
            kind: kind.to_string(),
            amount: U128(amount),
            destination_asset: destination_asset.clone(),
            deposit_address: deposit_address.clone(),
            min_out: U128(min_out),
            reason: reason.clone(),
            executor: executor.clone(),
        };
        self.rebalances.push(record);

        emit_event(
            kind,
            json!({
                "id": id,
                "amount": U128(amount),
                "destination_asset": destination_asset,
                "deposit_address": deposit_address,
                "min_out": U128(min_out),
                "reason": reason,
                "executor": executor,
            }),
        );

        id
    }

    fn ft_transfer(&self, receiver_id: AccountId, amount: u128) -> Promise {
        let args = json!({
            "receiver_id": receiver_id,
            "amount": U128(amount),
            "memo": "VaultPilot rebalance",
        });
        Promise::new(self.token.clone()).function_call(
            "ft_transfer".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            Gas::from_tgas(30),
        )
    }
}

/// NEP-297 shaped event log entry.
fn emit_event(event: &str, data: near_sdk::serde_json::Value) {
    let payload = json!({
        "standard": "vaultpilot",
        "version": "1.0.0",
        "event": event,
        "data": data,
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

fn current_day() -> u64 {
    env::block_timestamp() / DAY_NS
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, testing_env_with_promise_results, VMContextBuilder};
    use near_sdk::testing_env;

    fn policy() -> Policy {
        Policy {
            min_move: U128(1_000),
            max_per_move: U128(10_000),
            daily_cap: U128(25_000),
            max_slippage_bps: 100,
            allowed_destination_assets: vec!["nep141:usdc.test".to_string()],
        }
    }

    fn contract() -> VaultPilot {
        VaultPilot::new(accounts(0), accounts(1), accounts(2), policy())
    }

    fn context_at(predecessor: AccountId, timestamp: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor)
            .current_account_id(accounts(3))
            .block_timestamp(timestamp);
        builder
    }

    fn context(predecessor: AccountId) -> VMContextBuilder {
        context_at(predecessor, 1_700_000_000_000_000_000)
    }

    fn deposit(vault: &mut VaultPilot, sender: AccountId, amount: u128) {
        testing_env!(context(accounts(1)).build());
        vault.ft_on_transfer(sender, U128(amount), String::new());
    }

    #[test]
    fn deposit_mints_shares() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 5_000);
        assert_eq!(vault.total_shares, 5_000);
        assert_eq!(vault.total_assets, 5_000);
        assert_eq!(vault.get_shares(accounts(0)).0, 5_000);
    }

    #[test]
    #[should_panic(expected = "only the token contract can call this")]
    fn only_token_can_deposit() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        vault.ft_on_transfer(accounts(0), U128(1), String::new());
    }

    #[test]
    fn withdraw_burns_shares() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 5_000);
        testing_env!(context(accounts(0)).build());
        vault.withdraw(U128(2_000));
        assert_eq!(vault.total_shares, 3_000);
        assert_eq!(vault.total_assets, 3_000);
        assert_eq!(vault.get_shares(accounts(0)).0, 3_000);
    }

    #[test]
    fn agent_can_open_one_position() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(2)).build());
        vault.rebalance_out(
            U128(5_000),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(4_900),
            "external apy higher".to_string(),
        );

        assert_eq!(vault.idle_assets, 15_000);
        assert_eq!(vault.deployed_assets, 5_000);
        assert_eq!(vault.total_assets, 20_000);
        assert_eq!(vault.get_rebalance_count(), 1);
    }

    #[test]
    #[should_panic(expected = "amount above max_per_move")]
    fn policy_blocks_oversized_move() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(2)).build());
        vault.rebalance_out(
            U128(10_001),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(9_900),
            "too big".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "destination asset not allowed")]
    fn policy_blocks_unknown_asset() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(2)).build());
        vault.rebalance_out(
            U128(5_000),
            "nep141:evil.test".to_string(),
            accounts(4),
            U128(4_900),
            "not allowed".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "only the agent can call this")]
    fn non_agent_cannot_rebalance() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(0)).build());
        vault.rebalance_out(
            U128(5_000),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(4_900),
            "not the agent".to_string(),
        );
    }

    #[test]
    fn stores_and_paginates_history() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        vault.record(
            "rebalance_out",
            1_000,
            "nep141:usdc.test".to_string(),
            Some(accounts(4)),
            900,
            "first".to_string(),
            accounts(2),
        );
        vault.record(
            "rebalance_in",
            1_100,
            "near".to_string(),
            None,
            0,
            "second".to_string(),
            accounts(2),
        );

        assert_eq!(vault.get_rebalance_count(), 2);
        let all = vault.get_rebalances(0, 10);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, 0);
        assert_eq!(all[1].id, 1);

        let page = vault.get_rebalances(1, 1);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, 1);
    }

    #[test]
    fn owner_can_reset_after_failed_transfer() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(2)).build());
        vault.rebalance_out(
            U128(5_000),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(4_900),
            "open".to_string(),
        );
        assert_eq!(vault.deployed_assets, 5_000);

        testing_env!(context(accounts(0)).build());
        vault.emergency_reset_position("ft_transfer failed".to_string());
        assert_eq!(vault.deployed_assets, 0);
        assert_eq!(vault.total_assets, 15_000);
        assert_eq!(vault.idle_assets, 15_000);
    }

    #[test]
    #[should_panic(expected = "a move is already pending")]
    fn only_one_position_at_a_time() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(2)).build());
        vault.rebalance_out(
            U128(5_000),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(4_900),
            "first".to_string(),
        );
        vault.rebalance_out(
            U128(5_000),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(4_900),
            "second".to_string(),
        );
    }

    fn open_position(vault: &mut VaultPilot, amount: u128) -> u64 {
        testing_env!(context(accounts(2)).build());
        vault.rebalance_out(
            U128(amount),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(amount - 100),
            "test move".to_string(),
        );
        vault.get_rebalance_count() - 1
    }

    fn confirm_out(vault: &mut VaultPilot, id: u64, amount: u128, success: bool) {
        let result = if success {
            PromiseResult::Successful(Vec::new())
        } else {
            PromiseResult::Failed
        };
        testing_env_with_promise_results(context(accounts(3)).build(), result);
        vault.on_rebalance_out(id, U128(amount));
    }

    fn settle_in(vault: &mut VaultPilot, balance: u128) {
        let result = format!("\"{}\"", balance).into_bytes();
        testing_env_with_promise_results(
            context(accounts(3)).build(),
            PromiseResult::Successful(result),
        );
        vault.on_rebalance_in("settle".to_string(), accounts(2));
    }

    #[test]
    #[should_panic(expected = "first deposit is below the minimum")]
    fn first_deposit_must_meet_minimum() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 999);
    }

    #[test]
    fn withdrawals_stay_open_while_paused() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(0)).build());
        vault.pause(true);

        testing_env!(context(accounts(0)).build());
        vault.withdraw(U128(5_000));

        assert_eq!(vault.get_shares(accounts(0)).0, 15_000);
        assert_eq!(vault.total_shares, 15_000);
        assert_eq!(vault.total_assets, 15_000);
        assert_eq!(vault.idle_assets, 15_000);
    }

    #[test]
    fn rebalance_out_callback_reverts_on_failure() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        let id = open_position(&mut vault, 5_000);
        assert_eq!(vault.deployed_assets, 5_000);
        assert_eq!(vault.daily_moved, 5_000);
        assert_eq!(vault.idle_assets, 15_000);

        confirm_out(&mut vault, id, 5_000, false);

        assert_eq!(vault.deployed_assets, 0);
        assert_eq!(vault.daily_moved, 0);
        assert_eq!(vault.idle_assets, 20_000);
        assert!(vault.pending_move.is_none());
    }

    #[test]
    fn rebalance_out_callback_marks_position_open() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        let id = open_position(&mut vault, 5_000);
        confirm_out(&mut vault, id, 5_000, true);

        let pending = vault.pending_move.clone().expect("pending move");
        assert_eq!(pending.id, id);
        assert_eq!(pending.status, "open");
        assert_eq!(vault.deployed_assets, 5_000);
        assert_eq!(vault.get_pending_moves().len(), 1);
    }

    #[test]
    fn full_deposit_rebalance_settle_withdraw_cycle() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        let id = open_position(&mut vault, 5_000);
        confirm_out(&mut vault, id, 5_000, true);
        settle_in(&mut vault, 20_600);

        assert_eq!(vault.idle_assets, 20_600);
        assert_eq!(vault.deployed_assets, 0);
        assert_eq!(vault.total_assets, 20_600);
        assert!(vault.pending_move.is_none());
        assert!(vault.last_move_ms > 0);

        testing_env!(context(accounts(0)).build());
        vault.withdraw(U128(5_000));

        let expected_assets = 5_000u128 * (20_600 + VIRTUAL_ASSETS) / (20_000 + VIRTUAL_SHARES);
        assert_eq!(vault.get_shares(accounts(0)).0, 15_000);
        assert_eq!(vault.total_shares, 15_000);
        assert_eq!(vault.total_assets, 20_600 - expected_assets);
        assert_eq!(vault.idle_assets, 20_600 - expected_assets);
    }

    #[test]
    #[should_panic(expected = "return is below deployed principal")]
    fn short_return_keeps_position_open() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        let id = open_position(&mut vault, 5_000);
        confirm_out(&mut vault, id, 5_000, true);
        settle_in(&mut vault, 19_900);
    }

    #[test]
    fn withdraw_callback_restores_shares_on_failure() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        testing_env!(context(accounts(0)).build());
        vault.withdraw(U128(5_000));
        assert_eq!(vault.total_shares, 15_000);
        assert_eq!(vault.total_assets, 15_000);

        testing_env_with_promise_results(context(accounts(3)).build(), PromiseResult::Failed);
        vault.on_withdraw(accounts(0), U128(5_000), U128(5_000));

        assert_eq!(vault.get_shares(accounts(0)).0, 20_000);
        assert_eq!(vault.total_shares, 20_000);
        assert_eq!(vault.total_assets, 20_000);
        assert_eq!(vault.idle_assets, 20_000);
    }

    #[test]
    #[should_panic(expected = "daily cap exceeded")]
    fn daily_cap_is_enforced_across_moves() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        for _ in 0..2 {
            let id = open_position(&mut vault, 10_000);
            confirm_out(&mut vault, id, 10_000, true);
            settle_in(&mut vault, 20_000);
        }

        open_position(&mut vault, 10_000);
    }

    #[test]
    fn daily_cap_rolls_over_next_day() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        let id = open_position(&mut vault, 10_000);
        confirm_out(&mut vault, id, 10_000, true);
        settle_in(&mut vault, 20_000);

        let next_day = 1_700_000_000_000_000_000 + DAY_NS;
        testing_env!(context_at(accounts(2), next_day).build());
        vault.rebalance_out(
            U128(10_000),
            "nep141:usdc.test".to_string(),
            accounts(4),
            U128(9_900),
            "new day".to_string(),
        );

        assert_eq!(vault.daily_moved, 10_000);
        assert_eq!(vault.deployed_assets, 10_000);
        assert_eq!(vault.idle_assets, 10_000);
    }

    #[test]
    fn summary_exposes_pending_move_and_daily_remaining() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        let id = open_position(&mut vault, 5_000);
        let summary = vault.get_summary();

        assert_eq!(summary.daily_remaining.0, 20_000);
        let pending = summary.pending_move.expect("pending move in summary");
        assert_eq!(pending.id, id);
        assert_eq!(pending.status, "funding");
        assert_eq!(vault.get_pending_moves().len(), 1);
    }

    #[test]
    fn new_depositor_shares_round_down_after_yield() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);
        vault.total_assets += 10_000;

        let shares = vault.preview_deposit(U128(5_000)).0;
        assert!(shares > 0);
        assert!(shares < 5_000);
    }

    #[test]
    fn queued_withdrawal_and_claim_flow() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        // Deploy 10,000 to external venue so idle becomes 10,000
        let id = open_position(&mut vault, 10_000);
        confirm_out(&mut vault, id, 10_000, true);
        assert_eq!(vault.idle_assets, 10_000);
        assert_eq!(vault.deployed_assets, 10_000);

        // User requests withdrawal of 12,000 shares (more than idle 10,000)
        testing_env!(context(accounts(0)).build());
        let status = vault.request_withdrawal(U128(12_000));
        assert_eq!(status, "pending");
        assert_eq!(vault.get_queued_shares().0, 12_000);
        assert_eq!(vault.get_shares(accounts(0)).0, 8_000); // 20k - 12k

        let req = vault.get_withdrawal_request(accounts(0)).expect("request exists");
        assert_eq!(req.status, "pending");
        assert_eq!(req.shares.0, 12_000);

        // External position settles back with 10,500
        settle_in(&mut vault, 20_500);
        assert_eq!(vault.idle_assets, 20_500);
        assert_eq!(vault.get_current_epoch(), 2);

        // User can now claim their queued withdrawal
        testing_env!(context(accounts(0)).build());
        vault.claim_withdrawal();

        assert_eq!(vault.get_queued_shares().0, 0);
        assert!(vault.get_withdrawal_request(accounts(0)).is_none());
    }

    #[test]
    fn cancel_queued_withdrawal_restores_shares() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();
        deposit(&mut vault, accounts(0), 20_000);

        // Deploy 10,000
        let id = open_position(&mut vault, 10_000);
        confirm_out(&mut vault, id, 10_000, true);

        // Queue withdrawal
        testing_env!(context(accounts(0)).build());
        vault.request_withdrawal(U128(8_000));
        assert_eq!(vault.get_shares(accounts(0)).0, 12_000);
        assert_eq!(vault.get_queued_shares().0, 8_000);

        // Cancel
        vault.cancel_withdrawal_request();
        assert_eq!(vault.get_shares(accounts(0)).0, 20_000);
        assert_eq!(vault.get_queued_shares().0, 0);
        assert!(vault.get_withdrawal_request(accounts(0)).is_none());
    }

    #[test]
    #[should_panic(expected = "timelock delay has not elapsed yet")]
    fn governance_timelock_fails_before_delay() {
        testing_env!(context(accounts(0)).build());
        let mut vault = contract();

        let new_policy = Policy {
            min_move: U128(2_000),
            max_per_move: U128(50_000),
            daily_cap: U128(100_000),
            max_slippage_bps: 50,
            allowed_destination_assets: vec!["nep141:arb-usdc".to_string()],
        };

        // Propose policy
        vault.propose_policy(new_policy);
        assert!(vault.get_policy_proposal().is_some());

        // Immediately executing must panic
        vault.execute_policy();
    }

    #[test]
    fn governance_timelock_executes_after_delay() {
        let start_time = 1_700_000_000_000_000_000;
        testing_env!(context_at(accounts(0), start_time).build());
        let mut vault = contract();

        let new_policy = Policy {
            min_move: U128(2_000),
            max_per_move: U128(50_000),
            daily_cap: U128(100_000),
            max_slippage_bps: 50,
            allowed_destination_assets: vec!["nep141:arb-usdc".to_string()],
        };

        // Propose
        vault.propose_policy(new_policy.clone());

        // Advance time by 25 hours (timelock is 24h = 86_400_000 ms)
        let later = start_time + (25 * 3600 * 1_000_000_000);
        testing_env!(context_at(accounts(0), later).build());

        // Execute succeeds
        vault.execute_policy();
        assert_eq!(vault.get_policy().max_per_move.0, 50_000);
        assert!(vault.get_policy_proposal().is_none());
    }
}
