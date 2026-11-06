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
    pub today_bucket: u64,
    pub policy: Policy,
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
}

const DAY_NS: u64 = 86_400_000_000_000;
const SHARE_PRICE_SCALE: u128 = 1_000_000_000_000_000_000_000_000;

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

        let shares = self.shares_for_deposit(amount);
        require!(shares > 0, "deposit too small");

        let current = self.shares.get(&sender_id).copied().unwrap_or(0);
        self.shares.insert(sender_id, current + shares);
        self.total_shares += shares;
        self.total_assets += amount;
        self.idle_assets += amount;

        U128(0)
    }

    /// Burn shares and receive the proportional amount of idle assets.
    /// Withdrawals stay open while the vault is paused.
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

        let callback_args = json!({
            "account_id": account.clone(),
            "shares": U128(shares),
            "assets": U128(assets),
        })
        .to_string()
        .into_bytes();

        self.ft_transfer(account, assets)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_withdraw".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            ))
    }

    /// Restores the burned shares if the withdrawal transfer failed, so a
    /// failed `ft_transfer` cannot silently confiscate a user's position.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, shares: U128, assets: U128) {
        if env::promise_result(0) == PromiseResult::Failed {
            let current = self.shares.get(&account_id).copied().unwrap_or(0);
            self.shares.insert(account_id, current + shares.0);
            self.total_shares += shares.0;
            self.total_assets += assets.0;
            self.idle_assets += assets.0;
            env::log_str("withdraw failed; shares restored");
        }
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
        require!(self.deployed_assets == 0, "a position is already open");

        let amount = amount.0;
        require!(
            amount >= self.policy.min_move.0,
            "amount below min_move"
        );
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

        self.record(
            "rebalance_out",
            amount,
            destination_asset,
            Some(deposit_address.clone()),
            min_out.0,
            reason,
            env::predecessor_account_id(),
        );

        self.ft_transfer(deposit_address, amount)
    }

    /// Close the external position by reading the vault's real FT balance.
    /// The agent must only call this after the external leg has returned funds.
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

        self.record(
            "rebalance_in",
            returned,
            "near".to_string(),
            None,
            0,
            reason,
            executor,
        );

        actual
    }

    // ---------------------------------------------------------------- owner flows

    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agent = agent;
    }

    pub fn set_agent_enabled(&mut self, enabled: bool) {
        self.assert_owner();
        self.agent_enabled = enabled;
    }

    pub fn pause(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        policy.assert_valid();
        self.policy = policy;
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
            daily_moved: U128(self.daily_moved),
            today_bucket: self.daily_bucket,
            policy: self.policy.clone(),
        }
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
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

    fn shares_for_deposit(&self, amount: u128) -> u128 {
        if self.total_shares == 0 || self.total_assets == 0 {
            amount
        } else {
            amount
                .checked_mul(self.total_shares)
                .expect("share math overflow")
                / self.total_assets
        }
    }

    fn assets_for_shares(&self, shares: u128) -> u128 {
        if self.total_shares == 0 {
            0
        } else {
            shares
                .checked_mul(self.total_assets)
                .expect("share math overflow")
                / self.total_shares
        }
    }

    fn share_price(&self) -> u128 {
        if self.total_shares == 0 {
            SHARE_PRICE_SCALE
        } else {
            self.total_assets
                .saturating_mul(SHARE_PRICE_SCALE)
                / self.total_shares
        }
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
    ) {
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

        let event = json!({
            "standard": "vaultpilot",
            "version": "1.0.0",
            "event": kind,
            "data": {
                "id": id,
                "amount": U128(amount),
                "destination_asset": destination_asset,
                "deposit_address": deposit_address,
                "min_out": U128(min_out),
                "reason": reason,
                "executor": executor,
            }
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
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

fn current_day() -> u64 {
    env::block_timestamp() / DAY_NS
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
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

    fn context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor)
            .current_account_id(accounts(3))
            .block_timestamp(1_700_000_000_000_000_000);
        builder
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
    #[should_panic(expected = "a position is already open")]
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
}
