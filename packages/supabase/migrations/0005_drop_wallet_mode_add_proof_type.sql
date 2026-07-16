-- Product realignment (see Downloads/Updates.md): Hard Mode is removed entirely — every user
-- is now a single-vault user, so users.wallet_mode has nothing left to distinguish.
alter table users drop column if exists wallet_mode;

-- Records which submission path a completion came from: a live camera capture (with the
-- gesture challenge) or an explicit app-summary/screenshot upload (Strava/WakaTime/Kindle-style
-- evidence, exempt from the gesture challenge — see app/api/verify/route.ts). Defaults to
-- 'camera' for any row written before this migration.
alter table habit_completions add column if not exists proof_type text not null default 'camera'
    check (proof_type in ('camera', 'appSummary'));

-- Accountability Partner and the "Shuffle/Raffle" (Surprise) consequence types are removed —
-- Savings Vault and Donate are the only two now. Any existing row using a removed type falls
-- back to 'savingsVault' (never silently to 'donate', which would change what happens to a
-- user's money without their choosing it) — 'save' is the old name for the same bucket.
-- Constraint must be dropped *before* the update — the old constraint doesn't allow
-- 'savingsVault' yet, so updating into it first (as an earlier version of this migration did)
-- fails with a check-constraint violation.
alter table penalty_configs drop constraint if exists penalty_configs_penalty_type_check;
update penalty_configs set penalty_type = 'savingsVault' where penalty_type in ('save', 'partner', 'surprise');
alter table penalty_configs add constraint penalty_configs_penalty_type_check
    check (penalty_type in ('savingsVault', 'donate'));
alter table penalty_configs drop column if exists partner_address;

alter table daily_settlements drop constraint if exists daily_settlements_resolved_penalty_type_check;
update daily_settlements set resolved_penalty_type = 'savingsVault'
    where resolved_penalty_type in ('save', 'partner', 'surprise');
alter table daily_settlements add constraint daily_settlements_resolved_penalty_type_check
    check (resolved_penalty_type in ('savingsVault', 'donate'));
