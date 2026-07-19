-- HabitManager.sol's MAX_HABITS (3) gates only *active* habits at creation time
-- (`_activeCount(msg.sender) >= MAX_HABITS`) — habitCountOf is a lifetime counter that only ever
-- grows, and a deactivated index is never reused (see CLAUDE.md's 3-habit-cap gotcha). A wallet
-- that has created and deleted a handful of habits over time will legitimately reach
-- contract_index 3, 4, 5... while never having more than 3 active at once. The original
-- `between 0 and 2` constraint here (and the matching Zod schemas in app/api/habits/route.ts,
-- app/api/verify/route.ts, and app/api/verify/challenge/route.ts) wrongly conflated "at most 3
-- active" with "index can never exceed 2" — confirmed live as a permanently stuck, non-dismissible
-- "Existing habits found" recovery modal for a real on-chain habit at index 3 that could never
-- actually be saved.
alter table habits drop constraint if exists habits_contract_index_check;
alter table habits add constraint habits_contract_index_check check (contract_index >= 0);
