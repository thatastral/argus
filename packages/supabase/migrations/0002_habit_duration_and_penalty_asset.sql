-- Off-chain-only habit duration metadata (informational — HabitManager keeps tracking a habit
-- perpetually on-chain regardless of this value; nothing auto-deactivates a habit when it lapses).
alter table habits add column target_days int;

-- Records which asset (symbol + decimals) a penalty amount_wei was denominated in at write time.
-- Needed because the real asset is only knowable on-chain via a deployed AccountabilityWallet,
-- and Hard Mode never deploys one — without this, Settings has no way to know whether a stored
-- amount_wei means MON (18 decimals) or USDC (6 decimals) for a Hard Mode account.
alter table penalty_configs add column asset_symbol text;
alter table penalty_configs add column asset_decimals int;
