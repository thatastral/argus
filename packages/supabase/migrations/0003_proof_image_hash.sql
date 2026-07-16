-- Perceptual hash (dHash, see apps/web/lib/proofForensics.ts) of every submitted proof image —
-- backstop duplicate/reuse detection, checked before the Gemini call. Indexed since the lookup
-- scans image_hash across all users (not just the submitting one) per the anti-cheat design.
alter table habit_completions add column image_hash text;
create index habit_completions_image_hash_idx on habit_completions (image_hash) where image_hash is not null;

-- True only when the client's device had no camera at all (getUserMedia's NotFoundError) and
-- fell back to a file picker — never set for a declined camera permission, which stays on the
-- live-capture-only path. Pure audit trail for now (no human review exists yet), but keeps this
-- narrow exception queryable/tunable later without re-deriving it from free-text reason strings.
alter table habit_completions add column via_gallery_fallback boolean not null default false;
