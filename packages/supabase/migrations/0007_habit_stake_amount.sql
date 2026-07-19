-- Stake amount moved from a single wallet-level PenaltyEngine.penaltyAmountOf to a per-habit
-- HabitManager.habitStake, locked in once at each habit's own creation and never changing again
-- (see contracts/src/HabitManager.sol) — a direct instruction that changing your stake later
-- must never retroactively change what an already-created habit has at risk. These columns
-- mirror that per-habit amount off-chain, purely informational (same convention as
-- migration 0002's target_days/asset_symbol) — on-chain HabitManager.habitStake stays the
-- source of truth.
alter table habits add column stake_amount_wei numeric(78, 0);
alter table habits add column stake_asset_symbol text;
alter table habits add column stake_asset_decimals int;
