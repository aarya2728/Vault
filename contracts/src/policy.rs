use near_sdk::json_types::U128;
use near_sdk::{near, require};

/// On-chain guardrails for the agent. Amounts are in the vault token's smallest unit.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub min_move: U128,
    pub max_per_move: U128,
    pub daily_cap: U128,
    pub max_slippage_bps: u16,
    pub allowed_destination_assets: Vec<String>,
}

impl Policy {
    pub fn assert_valid(&self) {
        require!(self.max_per_move.0 > 0, "max_per_move must be > 0");
        require!(self.min_move.0 > 0, "min_move must be > 0");
        require!(
            self.min_move.0 <= self.max_per_move.0,
            "min_move must be <= max_per_move"
        );
        require!(
            self.daily_cap.0 >= self.max_per_move.0,
            "daily_cap must be >= max_per_move"
        );
        require!(
            self.max_slippage_bps <= 10_000,
            "max_slippage_bps must be <= 10000"
        );
        require!(
            !self.allowed_destination_assets.is_empty(),
            "allowed_destination_assets must not be empty"
        );
        require!(
            self.allowed_destination_assets.len() <= 16,
            "too many allowed destination assets"
        );
        for asset in &self.allowed_destination_assets {
            require!(!asset.is_empty(), "asset id must not be empty");
            require!(asset.len() <= 128, "asset id too long");
        }
    }

    pub fn allows(&self, asset: &str) -> bool {
        self.allowed_destination_assets.iter().any(|a| a == asset)
    }
}
