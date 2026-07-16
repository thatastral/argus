-- Off-chain-only, informational (same as target_days, migration 0002) — a recurring daily
-- time-of-day the user wants this specific habit done by (e.g. "8:00 PM"). Purely a display/
-- reminder concept: HabitManager's actual on-chain day boundary is a fixed UTC-midnight cutoff
-- for every habit, not configurable per-habit — this never changes what's enforced on-chain,
-- only what the UI shows as this habit's own daily deadline. Stored as the literal wall-clock
-- time the user picked in their own browser, no timezone conversion (matches the informal,
-- personal-reminder nature of the feature).
alter table habits add column deadline_time time;
