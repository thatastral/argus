-- Redeploying contracts is routine on this project (see CLAUDE.md's redeploy notes) — every
-- redeploy resets HabitManager's state to zero for everyone, but Supabase's `habits` mirror was
-- never automatically cleared to match, only ever "clear them by hand for any wallet you're
-- actively testing with" per an existing gotcha. Left alone, a wallet's old habit rows from a
-- prior deployment could bleed into the new one: history could show "imaginary" days that never
-- happened on the current contract (since the old row's created_at could be days in the past),
-- and a stale `active: true` row could keep showing up as "today's habit" even though nothing on
-- the freshly-deployed HabitManager corresponds to it at all — direct instruction to fix both.
--
-- Tags each row with the contract address it was actually mirrored against, so every read can
-- filter to only the currently-configured deployment (NEXT_PUBLIC_HABIT_MANAGER_ADDRESS) without
-- destroying old data — a prior deployment's rows just stop being shown, rather than being
-- deleted. Existing rows get NULL here (there's no way to know retroactively which deployment
-- they belonged to), which is the correct behavior: NULL never matches a real contract address,
-- so pre-existing rows are correctly treated as belonging to a now-defunct deployment and won't
-- resurface.
alter table habits add column habit_manager_address text;
create index habits_wallet_manager_idx on habits (wallet_address, habit_manager_address);

-- Run once, by hand, right after this migration (not included above since the value is
-- environment-specific and shouldn't be hardcoded into a versioned migration file): backfill
-- every pre-existing row with whatever NEXT_PUBLIC_HABIT_MANAGER_ADDRESS currently is, so rows
-- written before this column existed aren't mistaken for a defunct deployment's leftovers and
-- silently excluded from every view.
--
-- update habits
-- set habit_manager_address = '<current NEXT_PUBLIC_HABIT_MANAGER_ADDRESS>'
-- where habit_manager_address is null;
