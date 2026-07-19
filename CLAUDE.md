# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Argus: AI-powered accountability wallet on Monad — not a wallet blocker. Users connect their own
wallet, deploy a personal Accountability Wallet, and voluntarily commit funds toward habits; the
wallet itself is never locked, only the amount explicitly committed to a habit is governed.
Missing a habit moves the committed stake into a locked Savings Vault (still the user's own
funds, released after a lock period) or donates it, per the user's choice. Habits are verified
with Gemini. This scaffold covers the **core** of the PRD: the Desktop web app, the on-chain
contracts, and Supabase. Mobile (Expo) isn't built yet.

Contracts are deployed on Monad testnet; addresses live in `apps/web/.env.local` (gitignored,
not in git history — see `.env.local.example` for the shape).

## Structure

```
apps/web/          Next.js 16 app — frontend + backend (Next.js API routes, no separate server)
  hooks/             useAccountabilityWallet (vault/asset/balance), useUnmirroredHabits (on-chain
                     vs Supabase drift + active habit count), useCountdownToMidnight /
                     useCountdownToDeadline (UI-only countdown nudges), useVaultTransfer
                     (deposit/withdraw — shared by WalletStatus.tsx and ChatSidebar.tsx)
  lib/proofForensics.ts   perceptual-hash duplicate detection for proof images (sharp-based dHash)
  lib/verifyChallenge.ts  signed random-gesture challenge tokens for live-capture proof
  lib/habitCategory.ts    shared (client+server) habit-category inference + proof-type copy
contracts/          Foundry project — HabitManager, PenaltyEngine, ArgusFactory, AccountabilityWallet, MockUSDC
packages/supabase/  SQL migrations + schema notes (no ORM — plain SQL + Supabase JS client)
```

Root is an npm workspaces monorepo (`apps/*`, `packages/*`), single lockfile at repo root.

## Commands

Run from repo root unless noted:

```bash
npm install              # installs for all workspaces
npm run dev               # apps/web dev server
npm run build              # apps/web production build
npm run sync-abi           # regenerate apps/web/lib/abi/*.json from contracts/ — run after any contract change
```

Inside `apps/web/`:

```bash
npm run lint               # eslint (flat config, includes react-hooks rules — see gotcha below)
npx tsc --noEmit           # typecheck only, faster than a full build
```

Inside `contracts/` (requires Foundry — `curl -L https://foundry.paradigm.xyz | bash && foundryup`).
Foundry's binaries install to `~/.foundry/bin`, which is often **not** on `PATH` in a non-login
shell — if `forge`/`cast` come back "command not found", run
`export PATH="$HOME/.foundry/bin:$PATH"` first:

```bash
forge build
forge test -vv
forge test --match-contract HabitManagerTest        # one test file
forge test --match-test test_settle_successIncrementsStreak -vvvv   # one test, verbose traces

# testnet (also deploys MockUSDC); pass false + monad_mainnet for mainnet
forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast \
  --sig "run(address,address,bool)" <VERIFIER_ADDRESS> <DONATION_ADDRESS> true
```

Redeploying is a fairly common operation here (contract ABI/constructor changes force it —
see git history) — after any deploy: `npm run sync-abi`, update the four
`NEXT_PUBLIC_*_ADDRESS` vars in `apps/web/.env.local`, restart the dev server. Old Supabase
`habits`/`penalty_configs` rows from a prior deployment are meaningless afterward (indices
won't match) — clear them for any wallet you're actively testing with.

## Architecture

### Contract deployment has a forced order — read before touching constructors

`PenaltyEngine.execute()` is `onlyHabitManager`, and `HabitManager.settle()` calls
`PenaltyEngine.execute()` — a constructor cycle. It's broken with a two-step bootstrap that
`script/Deploy.s.sol` implements exactly:

1. Deploy `PenaltyEngine(deployer, donationAddress)` — `habitManager` address starts unset.
2. Deploy `HabitManager(deployer, address(penaltyEngine))` — takes PenaltyEngine's address directly.
3. `penaltyEngine.setHabitManager(address(habitManager))` — settable once, then locked.
4. Deploy `ArgusFactory(address(habitManager), address(penaltyEngine))` — `habitManager` was
   dropped from this constructor in an earlier iteration, then added back (along with
   `AccountabilityWallet`'s) specifically so the vault can read `activeHabitCount` for the
   Committed-balance formula (see the vault section below).
5. `habitManager.setFactory(...)` and `penaltyEngine.setFactory(...)` — both settable once.
6. `habitManager.setVerifier(verifierAddress)`.
7. (testnet only) Deploy `MockUSDC()` — no wiring needed, it's just a token.

Any change to these four contracts' constructors needs this sequence re-verified in
`contracts/test/utils/ArgusTestBase.sol` (mirrors the same bootstrap for tests) and
`script/Deploy.s.sol`.

### Non-custodial vault with three balances (why there are 4-5 contracts, not the PRD's 3)

`ArgusFactory.deployWallet(asset, initialDeposit)` deploys a fresh `AccountabilityWallet` per
user, **owned entirely by that user's wallet address** — Argus never custodies funds or keys.
`asset` is fixed at deploy time: `address(0)` for native MON, or an ERC-20 address (e.g.
`MockUSDC` on testnet) — a vault only ever holds one asset, and `deposit()`/`depositERC20()` are
separate paths that each revert (`WrongAssetPath`) if called on the wrong kind of vault.
`initialDeposit` (optional, pass `0` for the original deploy-only behavior) folds the vault's
first deposit into the same transaction as deploying it — per a direct instruction to cut
onboarding friction, since deploy-then-deposit used to always be two separate signatures. It
calls straight into the new wallet's own `deposit()`/`depositERC20()` (rather than duplicating
that logic in the factory) so the exact same `Deposited` event fires either way. For native MON,
`msg.value` must equal `initialDeposit` exactly (`MismatchedDeposit` otherwise) and nothing else
is needed — one signature total. For an ERC-20 vault, the caller must `approve()` **this
factory** (not the not-yet-deployed wallet address, which isn't knowable in advance without
CREATE2) for at least `initialDeposit` first — still two signatures, down from three
(deploy, approve, deposit). See `DeployWalletForm.tsx`'s doc comment for the frontend side of
this (it now also handles the USDC approve-against-the-factory step itself).

Three logical balances (`AccountabilityWallet.sol`'s contract-level doc comment has the full
design rationale) — only `savingsVaultAmount` is actually stored; the other two are live views
recomputed on every read, never a separate transaction to keep in sync:
- **Available** (`availableBalance()`) — withdrawable anytime. The wallet is never locked
  wallet-wide anymore — that model (the whole vault locked until today's habits were done) was
  removed along with Hard Mode.
- **Committed** (`committedAmount()`) — the **sum of every still-pending-today active habit's
  own locked-in stake** (`HabitManager.pendingStake(owner)`), clamped to whatever the vault can
  actually cover right now. Per-habit, not a shared wallet-level figure: each habit's stake is
  set once, at `createHabit(stakeAmount)` time, and stored in `HabitManager.habitStake` —
  **immutable for that habit's lifetime**, per a direct instruction that changing your stake in
  Settings must never retroactively change what an already-created habit has at risk. There is
  no more wallet-level "current stake" to configure; `PenaltyEngine.configurePenalty` lost its
  `amount` parameter entirely and now only sets the consequence *type*. To change a habit's
  stake, deactivate it and create a new one — there's no `updateHabitStake`-style call.
  `pendingStake(user)` (`HabitManager.sol`) sums active habits **not yet verified complete
  today** — a completed habit's stake stops counting the moment `completeHabit()` is called,
  before real UTC-midnight settlement, becoming withdrawable immediately with no separate
  transaction (Available is just `balanceOf() - committedAmount() - locked`, so this is a pure
  view recalculation, not a fund transfer — there is only one real balance in the contract).
  Summing (rather than a flat or multiplied figure) matters for the same reason it always did: a
  single missed day fails every active habit at once (settle() is pass/fail per day, not per
  habit — see `HabitManager._allActiveCompletedOn`), and `PenaltyEngine.execute()` moves this
  entire summed figure in one shot. **Accepted trade-off, documented in `pendingStake`'s own doc
  comment**: `PenaltyEngine.execute()` reads `committedAmount()` fresh whenever `settle()`
  actually runs for a past day, not a snapshot from the day that failed — completing today's
  habits before a backlog of unsettled past misses is cleared can partially reduce what gets
  penalized for one of those earlier misses. Accepted deliberately for now (testnet; the
  opportunistic settle-on-every-load/verify calls plus the daily cron keep backlogs rare and
  small) rather than adding the extra complexity of forcing settlement to catch up first.
  It's also still a *standing* commitment for whatever's still pending: once a miss moves it into
  the Savings Vault, the same still-pending habits' stakes immediately re-commit from whatever's
  left, so the user stays "at risk" for the rest of the day automatically with no separate
  re-commit action — see `AccountabilityWallet.committedAmount()`'s doc comment for a worked
  example. Off-chain, `habits.stake_amount_wei`/`stake_asset_symbol`/`stake_asset_decimals`
  (migration 0007) mirror each habit's own stake for display (`HabitDayGroups.tsx`'s `HabitRow`
  formats it per-row now, not from a single shared `stakeLabel` prop) — purely informational,
  same convention as `target_days`/`deadline_time`.
- **Savings Vault** (`savingsVaultAmount` / `savingsVaultUnlockAt`) — what a missed day moved
  here, still the user's own funds, locked until the unlock timestamp. A *rolling* lock: a new
  miss while already locked extends the unlock time from now, rather than tracking independent
  per-tranche timers. Always shown in `WalletStatus.tsx`/`AppHeader.tsx` now, even at 0/not-
  locked — it previously only rendered once something was already locked, so the mechanic was
  invisible until a user had already missed a day.

**Onboarding requires funding before any habit exists.** `SetupFlow.tsx`'s step order is
`profile → setup → habit → done` — "setup" merges what used to be two separate steps/screens
("penalty" then "wallet"), per a direct instruction to cut onboarding friction. It's one
continuous screen now: pick the consequence type, an asset (fixing the vault's deploy-time
asset), and a stake amount, then "Continue" calls `configurePenalty(type)` (no `amount` param
anymore — see the Committed section above); the *same* screen then reveals a second action using
the *same* stakeAmount/asset already entered — `DeployWalletForm` with `initialDeposit` set,
which deploys **and** funds the vault in one signature (native MON) or two (ERC-20, still needs
its own `approve()`; see the vault section above for both). A `useEffect` auto-advances straight
to the "habit" step once `walletAddress` exists and `availableBalance() >= stakeAmount` — no
extra "Continue" click needed for the common case, though a plain deposit-more fallback UI still
exists for the edge case of resuming an interrupted/older setup where the vault exists but isn't
funded enough yet. `penaltyConfigured` (session-local state) `|| Boolean(walletAddress)` is how
the screen knows to skip straight to the deploy half if either already happened. That amount
isn't configured on-chain at the "setup" step for a reason beyond friction, too: it's not spent
until the deploy-with-deposit call (or, if a vault already exists, the manual deposit above) —
it's only ever *locked into a specific habit* at the "habit" step's own
`createHabit(stakeAmount)` call for the first habit (see the Committed section above). Creating
that first habit still can't happen until the vault is funded enough to cover it, closing a real
gap where someone could create a habit and start uploading proof with zero funds actually at
risk. `AddHabitModal.tsx` (the dashboard's "+ Add Habit", and chat's `createHabit` tool) each
collect their own fresh stake amount for every subsequent habit — there's no wallet-level default
to inherit, and each validates inline that the amount doesn't exceed `availableFormatted` rather
than a proactive pre-check before the modal even opens (not knowable in advance anymore, since
the amount isn't chosen until the user is already there), alongside the existing 3-habit cap.

`withdraw()` checks only `availableBalance()` and never touches `HabitManager` itself.
`habitManager` is present in the constructor again (see the deploy order above), but solely so
`committedAmount()` can read `pendingStake` — `isUnlockedToday()`'s old wallet-wide gating
role is still gone for good; this is a narrower read-only dependency, not a revival of Hard Mode.
Only `PenaltyEngine` may move funds, via `executePenalty()` (Donate — an actual transfer out) or
`moveToSavingsVault()` (re-earmarks in place; funds never leave the contract). Frontend looks up
a user's vault address and asset on-chain via `ArgusFactory.walletOf(user)` /
`AccountabilityWallet.asset()` — this is the source of truth, not the
`accountability_wallet_address` mirror column in Supabase. `apps/web/hooks/
useAccountabilityWallet.ts` is the one place every one of these reads happens (balance,
available, committed, savings vault amount + unlock time); the home screen's balance hero and
the Wallet modal both consume it rather than re-deriving. Never render a bare "0.00 USDC" as a
stand-in for "no vault" — that was a real reported bug (`symbol` defaulted to `"USDC"` whenever
`assetAddress` was undefined). A related but distinct bug: before `assetAddress`'s own on-chain
read resolves, `isNative` briefly reads `false` even for a native vault (since `undefined !==
NATIVE_ASSET`), so amounts get formatted with the wrong decimals (6 instead of 18) for a moment —
a real reported "100000000 USDC" on first load, an inflation of `10^12`. `useAccountabilityWallet.ts`
now exposes `balancesLoading` (true until `assetAddress !== undefined`) and every balance-reading
query is gated on it; consumers (`AppHeader.tsx`, `WalletStatus.tsx`, `SettingsSheet.tsx`) show a
neutral "…" during that window instead of a number computed against still-resolving decimals.
`components/WalletStatus.tsx`'s `WalletHeaderRow` (address pill with copy/explorer-link/
disconnect icons) is shared between the header hover tooltip and the Wallet modal — disconnect
lives only here, not in Settings.

**MockUSDC is testnet-only** (open `mint()`, 6 decimals) — `Deploy.s.sol`'s `deployMockUsdc`
flag must be `false` on mainnet; point `NEXT_PUBLIC_USDC_ADDRESS` at real USDC there instead.
The frontend's own mint-100-test-USDC button (`WalletStatus.tsx`) is gated on
`process.env.NODE_ENV !== "production"` in addition to `isMockUsdc` — never renders in a real
build/deploy (testnet or mainnet demo), only under `npm run dev`.

### Consequences: Savings Vault (recommended) or Donate — only two now

`PenaltyEngine.PenaltyType` is `{ SavingsVault, Donate }` — Accountability Partner and the
"Shuffle/Raffle" (Surprise) types from an earlier iteration were removed entirely: contracts,
frontend (`lib/penalty.ts`), and Supabase's `penalty_configs.penalty_type` check constraint all
match this 2-value enum now (see `packages/supabase/migrations/0005_drop_wallet_mode_add_proof_type.sql`
for the data migration off the old values — existing `save`/`partner`/`surprise` rows become
`savingsVault`, never silently `donate`, since that would change what happens to a user's money
without their choosing it). `configurePenalty(PenaltyType)` — no more `partner` address param,
and no more `amount` param either (moved to `HabitManager.habitStake`, set once per habit at
creation — see the Committed section above). `PenaltyEngine.execute(user)` reads the amount
fresh from the wallet's own `committedAmount()` (not a value stored in `PenaltyEngine` itself)
before moving it.

### On-chain vs off-chain split — habit *names* are Supabase-only, on purpose

HabitManager tracks only `habitCountOf` / `habitActive` (bool per index) and per-day completion
— no strings. A habit's display name lives in Supabase only (`habits.name`). This was a
deliberate redesign: a label is UI metadata with no need for trustless enforcement, and storing
it on-chain was pure gas cost with no way to ever edit or clear it (see git history — an early
version stored names on-chain and a mirror-sync bug produced three permanently-immutable
duplicate habits, which is what forced this change). The rule going forward: if it needs to be
tamper-proof (completion, unlock state, streak, fund movement), it's on-chain; everything else
(names, display data, chat, images) is Supabase. `habits.contract_index` must match the
on-chain index exactly — off-chain rows are written only after the corresponding on-chain tx
confirms (see `apps/web/components/SetupFlow.tsx` and `app/api/habits/route.ts`).

Two more habit fields follow this same off-chain-only rule, both **optional and purely
informational — neither is enforced on-chain**: `habits.target_days` (a commitment-length
countdown, e.g. "21 days left," set via `HabitDurationPicker.tsx`) and `habits.deadline_time`
(a recurring daily "complete by HH:MM" nudge, migration `0004_habit_deadline_time.sql`, set via
`HabitDeadlineTimePicker.tsx`). Once a habit's own `deadline_time` passes today,
`HabitList.tsx`'s "Upload Proof" button swaps to a disabled "Missed" pill
(`hooks/useCountdownToDeadline.ts`) — this is a self-discipline UI signal only; the real penalty
still only fires at the actual UTC-midnight settlement via `HabitManager.settle()`, unchanged
regardless of the local deadline time. This was an explicit scope decision (asked directly,
user chose UI-only over wiring the deadline into real on-chain enforcement) — don't silently
upgrade it to affect settlement without checking first, since a timezone bug there would move
real funds.

`target_days` **does** now bound how far a habit is allowed to recur in the off-chain display
layer, via `lib/habitDuration.ts`'s `isWithinHabitDuration(createdAt, targetDays, dayIndex)` —
still purely a Supabase/read-side concern, not a change to the on-chain rule above. Before this,
a fixed-duration habit (e.g. a 1-day "Pick a date" habit) kept showing up as "today's habit"
forever after its configured span ended, since nothing ever excluded it once `target_days` days
had elapsed — `active` only ever went false via explicit user deletion
(`PATCH /api/habits`). Every place that decides "is this habit live for day X" now applies this
bound: `/api/habits/history/route.ts`'s per-day inclusion filter (so a 1-day habit only appears
on the one day it was actually configured for, not every later day too), and
`/api/state/route.ts` (which folds it into the `active` flag it returns, so `app/page.tsx`'s
existing `.filter((h) => h.active)` for the dashboard's action list needed no changes). A habit
with `target_days: null` ("No end date") is unaffected — that's the one case actually configured
to recur indefinitely.

### Habit rows are scoped to the currently-configured contract (`habit_manager_address`)

Redeploying contracts is routine on this project (see the redeploy notes further down) and
resets `HabitManager`'s on-chain state to zero for every wallet — but Supabase's `habits` mirror
was never automatically cleared to match. Left alone, a wallet's rows from a prior deployment
could bleed into the new one: history could show "imaginary" days that never happened on the
current contract, or a stale `active: true` row could keep surfacing as "today's habit" even
though nothing on the freshly-deployed `HabitManager` corresponds to it. Migration
`0008_habits_contract_scoped.sql` adds `habits.habit_manager_address`, stamped on every write
(`POST /api/habits`) with whichever contract is currently configured
(`NEXT_PUBLIC_HABIT_MANAGER_ADDRESS`, via `lib/chain.ts`'s `contractAddresses.habitManager`).
Every read of `habits` (`GET`/`PATCH /api/habits`, `/api/habits/history`, `/api/state`,
`/api/chat`) filters on it — a prior deployment's rows just stop being shown, not deleted.
Pre-existing rows get `NULL` (no way to know retroactively which deployment they belonged to),
which correctly excludes them too, since `NULL` never matches a real contract address.

`/api/habits/history/route.ts`'s `?window=full` mode also got a defensive floor
(`earliestHabitDayIndex`, derived from the now-correctly-scoped `habitRows`' own `created_at`
values): its on-chain `startDay` read has always had a `try/catch` defaulting to `startDay = 0`
on failure, but unlike the home-window path that default was never clamped in full mode — a
failed read could otherwise walk the day-range loop back to the Unix epoch.

### Auth: wallet-signature only, no Supabase Auth

Every Supabase table has RLS enabled with **no policies** — the anon/authenticated roles get
nothing; only the service-role key (used exclusively server-side via
`apps/web/lib/supabase/server.ts`) can read/write. The client never talks to Supabase directly.
Login is `POST /api/auth/nonce` (mints a single-use nonce + message) → wallet signs it →
`POST /api/auth/verify` (reconstructs the message server-side from the stored nonce row, never
trusts a client-supplied message, verifies via `viem`'s `publicClient.verifyMessage` — covers
both EOAs and ERC-1271 contract wallets) → signs an httpOnly JWT cookie (`lib/session.ts`,
`jose`, 7-day TTL). `getSessionWallet()` gates every other API route.

A valid session is *not* proof a `users` row exists — see the FK gotcha below. `/api/auth/verify`
fails the whole sign-in if the `users` insert fails, but the row can still vanish later
(dashboard edits during testing, etc.), so every route with a `users`-FK write calls
`ensureUser()` (`lib/supabase/server.ts`) first, an idempotent upsert that self-heals a missing
row without clobbering an existing one's `display_name`.

### AI has exactly two jobs (`apps/web/lib/gemini.ts`)

1. `verifyHabitProof` — Gemini, `responseSchema` (structured JSON output: `{verified,
   confidence, reason, challengePassed}`). Business logic must never depend on free-form text.
   `POST /api/verify` uploads the proof image to the Supabase `proofs` storage bucket, calls
   this, and — if `verified && (proofType === "appSummary" || challengePassed) && confidence >=
   CONFIDENCE_THRESHOLD` (0.8) — relays `HabitManager.completeHabit()` on-chain using a separate
   backend "verifier" signer (`VERIFIER_PRIVATE_KEY` in `lib/chain.ts`, distinct from the
   contracts' `owner`/deployer key; holds no user funds). Two submission paths scored by the same
   call: `proofType: "camera"` (default/fallback, requires the gesture `challenge` to match) and
   `proofType: "appSummary"` (explicit second path for a screenshot of an app-generated summary —
   Strava, WakaTime, Kindle, etc. — no gesture to check, so `challengePassed` is always true for
   it; Gemini's own scrutiny of the screenshot's plausibility is the safety net instead). The
   prompt is sharpened per habit via `inferHabitCategory(habitName)` (`lib/habitCategory.ts` —
   shared with the client, no `server-only` marker, so `LiveCameraCapture.tsx` can show the same
   category-aware hint; keyword match → running/gym/reading/coding/meditation/journaling/
   studying/generic), each category getting its own accept/reject guidance for both submission
   paths (`CATEGORY_GUIDANCE_CAMERA` / `CATEGORY_GUIDANCE_APP_SUMMARY` in `lib/gemini.ts`) — see
   the anti-cheat pipeline below for how `challenge` gets into this call.
2. `progressCoachReply` — explains the user's own structured data back to them via a system
   instruction that explicitly refuses unrelated questions. Never a general-purpose assistant.
   Also does function-calling for six agentic actions (see the section right below) — the user
   still confirms (and, for on-chain ones, signs) client-side; the model never executes anything
   directly. The system instruction's habit-cap description must stay in sync with the contract:
   it currently says a user can have at most 3 **active** habits (count only `active: true` rows
   in the data it's given) and that deactivating one frees a slot — this was a real live bug once
   (the instruction said "3 is a lifetime limit, deactivating never frees a slot" after the
   contract had already been changed to active-count-based capacity, so the AI refused every
   new-habit request). If `HabitManager`'s cap logic changes again, update this string in the
   same commit. Surfaced via `components/ChatSidebar.tsx`, a fixed right-docked panel, not the
   home screen's dominant element (see below).

### Progress Coach's agentic actions — propose server-verified, never execute directly

Six function-calling tools (`lib/gemini.ts`): `createHabit`, `editHabit` (rename),
`deactivateHabit`, `deposit`, `setPenaltyType`, `withdraw`. Every one only *proposes* —
`ProgressCoachResult.proposedActions` is always an array (possibly empty, never a single
optional value), and the model is **never trusted with a real on-chain index or enum**:
`editHabit`/`deactivateHabit` only ever take a `habitName` string — `app/api/chat/route.ts`'s
`POST` handler resolves `habitName` to a real `contractIndex` server-side (a case-insensitive
match against the same `habits` rows already fetched for context); a match failure is silently
dropped from the array rather than erroring. `createHabit` takes a plain `stakeAmount` string
(the model never decides decimals/asset) — resolved server-side against the deployed vault's
live asset if one exists, falling back to `penalty_configs.asset_symbol`/`asset_decimals`
(same precedence as `wallet.symbol` in `contextJson`) before it ever reaches the client.
`setPenaltyType` only ever takes a `penaltyType` enum (`"savingsVault" | "donate"`) — no amount,
since there is no more wallet-level stake to set (see the Committed section above; each habit's
own stake is fixed forever at `createHabit` time). Every other action type always resolves.

**`deposit` and `createHabit`'s `stakeAmount` are easy to conflate and are NOT
interchangeable** — this was a real reported bug back when the amount lived wallet-level in a
`setStake` tool: asking for "commit 0.5 MON to my accountability wallet" got silently routed
onto `deposit`, which only ever adds to Available and never touched the actual stake. `deposit`
moves funds into the vault's general balance; a habit's `stakeAmount` is a specific amount locked
onto that one habit, permanently, the moment it's created — there is no longer a way to
"commit"/"stake"/"pledge" an amount without creating a habit to attach it to. The system
instruction tells the model this explicitly, and to ask for an amount rather than guessing one
if the user doesn't mention it when asking for a new habit. `hooks/useSetPenaltyType.ts` (renamed
from the old `useSetStake.ts`, which also took an amount) is the shared hook — extracted out of
`SettingsSheet.tsx`'s inline `configurePenalty` + `/api/penalty` mirror sequence — both the
settings UI and the chat-confirm flow call; `hooks/useCreateHabit.ts` is the equivalent shared
hook for `createHabit`, called from `SetupFlow.tsx`, `AddHabitModal.tsx`, and the chat-confirm
flow alike.

**A single message can propose more than one action** (e.g. "deposit 1 and commit 0.5") —
`progressCoachReply` used to read only `response.functionCalls?.[0]`, silently dropping every
action past the first even though Gemini's default AUTO function-calling mode can return several
calls in one turn for a compound request. It now loops the full `functionCalls` array into
`proposedActions`, and `ChatSidebar.tsx`'s `Message.proposedActions`/`actionResolutions` are both
arrays (parallel, same index) so each proposed action within one reply gets its own label and
Confirm/Dismiss control, resolved independently — `resolveAction(messageIndex, actionIndex,
confirm)` takes both indices now, not just one.

`components/ChatSidebar.tsx`'s `resolveAction()` dispatches each confirmed action to the exact
same shared hooks the non-chat UI uses — no separate on-chain logic exists for the chat path:
`hooks/useCreateHabit.ts`, `hooks/useRenameHabit.ts` (pure Supabase write, no wallet signature),
`hooks/useDeleteHabit.ts`, `hooks/useSetStake.ts`, and `hooks/useVaultTransfer.ts` (extracted out
of `WalletStatus.tsx`'s inline deposit/withdraw logic once the chat path needed the exact same
ERC-20 approve-then-deposit dance; `WalletStatus.tsx` now consumes it too instead of duplicating
it).

The coach's context (`app/api/chat/route.ts`) was expanded well beyond the original
name/streak/penalty set to make these actions (and richer Q&A) possible:
- `habit_completions` (last 30 rows, `contract_index/day/verified/confidence/reason`) as
  `recentCompletions` — lets it explain a specific rejection using the real `reason`, or
  synthesize a recap, instead of only ever seeing aggregate streak numbers.
- `habits.target_days`/`deadline_time` are now included, not just `name`/`active`.
- `lib/chain.ts`'s `getVaultSnapshot(user)` — an on-chain read (`ArgusFactory.walletOf` →
  `AccountabilityWallet.balanceOf`/`availableBalance`/`committedAmount`) surfaced as `wallet` in
  context, specifically so the coach knows `available` before proposing a `withdraw` — a
  Committed or still-locked Savings-Vault amount would just revert on-chain otherwise, and the
  system instruction tells it to say so plainly instead of proposing an action that will fail.
  Decimals for a non-native asset are hardcoded to `6` here rather than an extra `decimals()` RPC
  read (same assumption `mintTestUsdc` already makes) — this snapshot is fetched fresh on every
  `/api/chat` call, so that extra sequential round-trip was a real, measurable latency cost on
  every single reply.
- If the most recent proof (today or yesterday) was rejected, `app/api/chat/route.ts` downloads
  that image from the `proofs` bucket and attaches it as a multimodal part to the *next* chat
  call (`createPartFromBase64`, same helper `verifyHabitProof` uses) — so "why was that
  rejected" can reference what's actually in the photo, not just repeat the stored `reason`
  string. Bounded to a 2-day window, and only downloaded when the user's message plausibly asks
  about it (a cheap keyword check — `reject`/`why`/`photo`/`proof`/`fail`) — this used to be
  unconditional within the window, adding a Storage round-trip to every turn (even "what's my
  streak") for as long as a rejection sat in that window, another real latency cost.

`components/ChatSidebar.tsx` also gained quick-action chips (populate + immediately send) in the
empty-conversation state, and a 3-dot typing indicator while awaiting a reply. **True token
streaming was deliberately not built** — it would need the function-call detection and the
`after()`-based `chat_messages` write to both work against a partial/growing response, real
added complexity for what was the lowest-priority item when this was scoped; flagged as a
separate future enhancement if wanted.

### Proof anti-cheat pipeline — live capture, challenge token, perceptual hash

Deliberately lean (no GPS, no Apple Health, no human review, no timelapse, no OCR, nothing
beyond already-installed deps / free packages) — modeled as a lighter alternative to more
built-out competitors, not a full fraud-proofing system:

- **Live camera only, not a file picker.** `components/LiveCameraCapture.tsx` is a hand-rolled
  `getUserMedia` capture (no third-party camera library) — a `<video>` preview, a "Capture"
  button that draws the current frame to an off-screen `<canvas>` and encodes a JPEG. A 3-second
  countdown (`CAPTURE_COUNTDOWN_SECONDS`) starts on tap so the user has time to get into pose for
  the gesture challenge before the frame is actually grabbed. Gallery upload is still available
  as a persistent, equally-scrutinized option (not gated behind a camera-error fallback) — the
  UI just nudges "using the camera gets approved faster"; the backend applies the same duplicate-
  hash and challenge checks either way, only recording `via_gallery_fallback` for audit, never
  using it to relax verification.
- **Random gesture challenge**, server-issued and server-verified, not client-echoed.
  `GET /api/verify/challenge?contractIndex=N` picks a random gesture ("hold up two fingers,"
  etc.) and signs a short-lived (`jose`, 5-min TTL) token binding `{wallet, contractIndex,
  challenge}` (`lib/verifyChallenge.ts`). The client shows the challenge as an on-screen
  instruction and submits the token back untouched with the capture; `/api/verify` verifies the
  token's signature/expiry/wallet/contractIndex match and uses the challenge *from the token*,
  never a client-supplied plain value, when calling Gemini — a client can't claim a convenient
  challenge for a pre-made image.
- **Perceptual-hash duplicate detection** as a backstop (the live-capture + challenge
  combination already rules out most stale/stock photos). `lib/proofForensics.ts`'s
  `computeImageHash` (sharp-based dHash) runs on every upload before Gemini is even called;
  `hammingDistance` against every `habit_completions.image_hash` with a non-null value **across
  all users** (not just the current one) — a match under `DUPLICATE_HASH_THRESHOLD` short-circuits
  the flow, skipping the Gemini call entirely (saves quota) and rejecting without revealing whose
  earlier submission it matched. Runs regardless of `proofType`.
- **Explicit second submission path for app-generated evidence.** Per the product doc's
  "prioritize activity evidence over posed photos" principle, a screenshot of an app summary
  (running app, WakaTime, Kindle, etc.) is often stronger evidence than a photo for some habits.
  `LiveCameraCapture.tsx` shows a category-aware hint (`lib/habitCategory.ts`'s
  `CATEGORY_PROOF_HINT`) next to a distinct "Submit an app summary instead" file picker, separate
  from the plain photo-upload fallback — this sets `proofType: "appSummary"` on the request,
  which skips the gesture-challenge requirement (a screenshot can't show a live gesture) but
  still goes through Gemini's category-specific scrutiny and the perceptual-hash check above. The
  live camera stays the default and fallback for every habit — this is guidance, not a gate; no
  third-party OAuth/API integrations, Gemini vision interprets the screenshot directly.

`packages/supabase/migrations/0003_proof_image_hash.sql` adds `habit_completions.image_hash`
and `via_gallery_fallback`; `0005_drop_wallet_mode_add_proof_type.sql` adds
`habit_completions.proof_type` (`'camera' | 'appSummary'`) — like every migration here, both
must be applied manually (see the migrations gotcha below).

### Landing screen: one-fold, brand-textured, "How it works" reuses the onboarding walkthrough

`components/LandingScreen.tsx` is what `app/page.tsx` renders for the signed-out state (no
session wallet yet) — a top bar (wordmark left, a "How it works" link right, the real brand
asset `public/argus-wordmark.png` — see the logo/brand-asset note under Design constraints
below), a centered hero (eyebrow pill, a Rakkas-styled (`font-display`) headline, subcopy, the
existing `ConnectButton`, a small trust line), and a small footer, all inside `h-dvh flex
flex-col overflow-hidden` (dynamic viewport height, not `100vh`, to avoid the mobile
browser-chrome resize jump) so the whole thing fits one screen with no scrolling at any width.
`ConnectButton.tsx`'s trigger button is styled larger here than its default size (bigger
padding/text, since it's the hero's one CTA) — safe to restyle in place rather than adding a
size-variant prop, since it's only ever rendered from this one call site.

Originally shipped with **no** decorative background at all (deliberately, to keep this screen
simple) — now carries `GlowBackground`/`DotGrid` at intensity `0.5` (lower than the dashboard's
`1` baseline) once the brand-texture pass (see Design constraints below) decided every screen,
including this one, should read as part of the same textured app rather than being the one plain
exception. Still deliberately has **no** decorative *product-preview* panel (a mock of the real
dashboard, the kind many SaaS landing pages show) — that's a different, heavier addition (fake
stat pills, a second bounded card) that a gate for an already-built product doesn't need, distinct
from the app-wide ambient glow/dots/grain treatment every surface now carries.

The "How it works" link opens `components/WelcomeModal.tsx` — the same four-step walkthrough
previously only ever auto-shown once post-signin. `WelcomeModal` is now a controlled component
(`open`/`onClose` props, not a self-managed `useState`) specifically so both callers can drive
the identical content without duplicating it: `app/page.tsx` owns a `welcomeOpen` state gated on
`hasSeenWelcome()`/`markWelcomeSeen()` (both now exported from `WelcomeModal.tsx`) for the
one-time post-signin auto-open, while `LandingScreen.tsx` owns its own independent `useState` for
the link — an explicit click, re-openable anytime, no localStorage bookkeeping on that path.

### Home screen: habit-focused, chat as a fixed side panel

`app/page.tsx`'s signed-in view is habit-first, not a balance hero: `components/AppHeader.tsx`
(logo, streak pill, balance pill, settings — page-level chrome, always mounted) sits above the
main `bg-card rounded-3xl` container, which is `relative overflow-hidden` specifically so it can
host two purely decorative background layers, `components/GlowBackground.tsx` and
`components/DotGrid.tsx`, both `absolute inset-0` and mounted first so every real child needs
`relative z-10` to stack above them: `GlowBackground` is a static, blurred radial glow rising
from bottom-center (reuses the exact palette from the "Chat with Argus" hover glow below, on
purpose, so the two glow moments feel related — a monochromatic gold family anchored on the
brand gold, `#fde9be` → `#f5b94c` → `#e0a233` → `#c08a2e` → `#7a5518`, repainted from an original
5-color rainbow per a direct brand-color decision (a brief intermediate green/mint version was
reverted back to gold); see the brand-texture note under Design constraints below for the full
story and everywhere else this pairing now also appears) that fades to transparent rather
than painting an explicit "near black," so it never risks a seam against `--card`'s real value.
`DotGrid` is an animated dot pattern — not per-dot DOM/JS (would need thousands of nodes or a
canvas loop for true per-dot randomness), instead three stacked copies of the same CSS
repeating-dot background, each opacity-animated at a different duration (`--animate-dot-twinkle-
a/b/c`, `app/globals.css`) so their phases drift apart continuously; reads as organic
non-synchronized twinkling in aggregate. Both respect `prefers-reduced-motion` (the twinkle
keyframes are disabled via a `.dot-twinkle-layer` media-query rule) and are `pointer-events-none`
+ `aria-hidden`. Above these, the real content: a short welcome/summary line, a compact stat row
(habits remaining, committed today, time left — a scannable companion to the sentence above it,
not a replacement),
`components/InsightCard.tsx`, a "Chat with Argus" CTA, and a day-grouped `HabitList` (today's
incomplete habits with "Upload Proof", then past days newest-first with a "Completed"/"Missed"
status pill — see `app/api/habits/history/route.ts` and `hooks/useCountdownToMidnight.ts` for
the live countdown-to-midnight on today's row, also reused directly in `page.tsx` for the stat
row's "time left" pill). `InsightCard.tsx` shows a deterministic, non-AI-call sentence from
`lib/insight.ts` — computed **client-side** from `state.recentCompletionTimestamps`
(`/api/state` returns the last 30 verified `habit_completions.created_at` values, raw) so
"usual completion hour" reflects the signed-in user's own browser timezone, not the server's;
deliberately not a live Gemini call on every dashboard load, consistent with this session's
separate work to *cut* AI latency elsewhere (see the chat-coach section below). Fewer than 5
data points get a generic encouraging default instead of a shaky statistical claim.

The home screen only ever shows the last 4 days (today + 3) — `app/api/habits/history/route.ts`
defaults to `HOME_WINDOW_DAYS`, and every non-today group renders collapsed by default (today
always expanded, un-toggleable). A longer, unbounded range (back to the wallet's on-chain
`startDay`) lives in `components/HistoryModal.tsx`, opened via a "View full history" link, using
the same route's `?window=full`. Both consume `components/HabitDayGroups.tsx`'s `DayGroupsList` —
the shared day-group/collapse/`HabitRow` rendering extracted once a second consumer needed it, so
the two views can't drift. The history route itself includes a habit on a given day if it
*existed* by then (`created_at`-derived), not whether it's *currently* active — this was a real
bug fix: filtering to only-currently-active habits made a past day's one missed habit vanish
entirely once deactivated, so the day would render as vacuously "Completed." A verified habit's
row can no longer be edited (the pencil icon is hidden once `habit.verified`) and renders at
reduced opacity — editing/renaming something already proved for the day was confusing, with no
way to tell which name applied when it was proved.

**Today auto-resolves once every active habit is individually settled**, without waiting for
real UTC midnight. `HabitDayGroups.tsx`'s `allResolvedToday` (and `app/page.tsx`'s mirrored
`allResolvedToday`/`anyMissedToday`, feeding the welcome-line summary) treat a habit as resolved
once it's `verified` or its own `deadline_time` has passed —
`hooks/useCountdownToDeadline.ts`'s `computeCountdown` is exported as a plain function
specifically so this day-group-level `.every()` check can reuse the same date math without
calling a hook inside a loop. Once every active habit is resolved, the day's pill swaps from the
live countdown straight to Completed/Missed. A habit with no `deadline_time` set can only ever
resolve via `verified`, so it keeps the whole day counting down regardless of the others until
real midnight — same "UI-only, not real enforcement" caveat as `deadline_time` itself: the actual
penalty only ever fires at `HabitManager.settle()`'s real UTC-midnight boundary.

Clicking "Chat with Argus" opens `components/ChatSidebar.tsx` — a `position: fixed`, full-height
right dock, `CHAT_SIDEBAR_WIDTH` (530px, exported from that file) wide at the `sm:` breakpoint and
up, **full-viewport-width below it** (`w-full sm:w-[530px]`) — a hardcoded 530px panel would be
unusable on any phone-width screen. It is **not** a flex sibling and does not narrow the main card
directly; instead the page wrapper in `app/page.tsx` reserves that same width as `padding-right`
only at `sm:`+ (`chatOpen ? "sm:pr-[530px]" : "sm:pr-0"` — a class toggle, not the inline style
this used to be, specifically so the padding never applies below `sm:`, where the panel is already
full-width and there's nothing to push away from), which shifts the header and main content left
together on desktop so nothing (including the header's pills) ever sits underneath the fixed
panel. This is the standard AI-chat-sidebar pattern (Notion AI, Cursor, Intercom) — pinned to the
viewport, unaffected by page scroll. Kept always-mounted so the conversation survives collapsing
the panel. Message rendering follows the current ChatGPT/Claude.ai convention: user turns get a
`rounded-3xl` bubble (`bg-foreground` — briefly moved to a `bg-primary` gold token during a since-
reverted brand-color pass, see Design constraints below — right-aligned via `flex justify-end`, not the old
`text-align` + `inline-block` approach, which could render an oddly-clipped corner on wrapped
text), assistant turns are plain flowing text with **no** bubble — a colored box reads fine for a
short user message but wraps a longer, often multi-paragraph reply in an odd-looking box instead
of just reading as text.

A single refresh button lives in `AppHeader.tsx` (not duplicated elsewhere) and refreshes
everything: its own wallet/streak reads directly, plus `onRefreshAll` bumps a `refreshToken`
number prop on `HabitList.tsx` (whose habit/history fetch depends on it, re-triggering from a
sibling component) and calls `app/page.tsx`'s `loadState()` for `/api/state`. `components/
WelcomeModal.tsx` is a one-time, four-step intro to how accountability works here, gated on a
`localStorage` flag (`argus_welcome_seen`) rather than a Supabase column — purely cosmetic, no
migration needed, resets if the user clears browser data (an accepted trade-off for something
this low-stakes).

`components/Modal.tsx` (portal to `document.body`, centered, backdrop) is the **only** overlay
pattern — used for Habits history detail, Settings, Wallet, Streak, and habit recovery.
`BottomSheet.tsx` was deleted; don't reintroduce a second overlay mechanism without a specific
reason. It takes an optional `dismissible` prop (default `true`); pass `false` to hide the Close
link and disable backdrop-click/Escape — used by `RecoverHabitsModal.tsx` so a user can't dodge
naming an orphaned on-chain habit by dismissing the modal.

Habit creation has two entry points beyond onboarding: `components/AddHabitModal.tsx` (the "+
Add Habit" button next to the Habits heading, gated on active on-chain habit count — see the
gotcha below) and via chat (Gemini proposes `createHabit`, user confirms, same
`hooks/useCreateHabit.ts` executes the write either way). Both go through
`components/HabitDurationPicker.tsx` (optional commitment length) and
`components/HabitDeadlineTimePicker.tsx` (optional recurring daily deadline time) — see the
off-chain metadata note above.

### Orphaned on-chain habit recovery

A habit's on-chain `createHabit()` tx can succeed while the Supabase mirror write fails (stale
session, a missing migration column — this has happened live) — `HabitManager` has no reset and
no dedupe, so retrying "Create habit" in that state creates a *second* orphaned on-chain slot
rather than fixing the first. `hooks/useUnmirroredHabits.ts` scans on-chain `habitCount` /
`habitActive` against `/api/habits`'s rows to detect any active, unnamed index — used both by
`SetupFlow.tsx` (onboarding, inline recovery form) and, importantly, by `HabitList.tsx` on every
ongoing dashboard load (`RecoverHabitsModal.tsx`, non-dismissible), since the same failure mode
can happen any time "+ Add Habit" is used later, not just during setup. The same hook's
`activeCount` is also what gates "+ Add Habit" itself (see the habit-cap gotcha below).

### Mobile responsiveness

The app had essentially zero mobile handling until a dedicated pass added it — worth knowing
because most components still default to a single, unconditional class list, and any new one
should consider a phone-width viewport from the start rather than needing a second retrofit pass.
`app/layout.tsx` has an explicit `viewport` export (`width: "device-width", initialScale: 1`) —
prerequisite for anything else to render at the right scale. The breakpoint strategy is additive
`sm:` classes on existing elements, not a parallel mobile layout: `ChatSidebar.tsx` goes
full-width below `sm:` (see above); `AppHeader.tsx`'s pill row gets `flex-wrap` plus a
`max-w-[7rem] sm:max-w-none truncate` guard on the balance pill so a long formatted balance can't
blow out the row at 320–375px; `HabitDayGroups.tsx`'s `HabitRow` wraps the habit name in `min-w-0
flex-1 truncate` (previously unconstrained against a `shrink-0` action-button cluster — a real
overflow risk with a long habit name on a narrow screen). `SetupFlow.tsx`'s 2-column penalty-type
grid was checked and left as-is — not actually overflow-prone down to ~320px, so no breakpoint
restructure was justified there.

### Chain config

`apps/web/lib/wagmi.ts` (client) and `lib/chain.ts` (server) both key off
`NEXT_PUBLIC_MONAD_NETWORK` (`"mainnet"` or default testnet) and use `monad`/`monadTestnet`
from `wagmi/chains` / `viem/chains` directly — never hand-define these chain objects. Contract
addresses come from `NEXT_PUBLIC_HABIT_MANAGER_ADDRESS` / `NEXT_PUBLIC_PENALTY_ENGINE_ADDRESS`
/ `NEXT_PUBLIC_ARGUS_FACTORY_ADDRESS` / `NEXT_PUBLIC_USDC_ADDRESS` (`lib/contracts.ts`).

`wagmiConfig` (`lib/wagmi.ts`) turns on two batching layers, per a direct "make every wallet
action fast" instruction — before this, a screen like the Wallet modal (`useAccountabilityWallet
.ts` alone fires up to 8 separate contract reads for one vault) issued one `eth_call` round-trip
per read even though most land in the same render tick: `batch: { multicall: true }` makes viem
auto-batch same-tick `readContract` calls into one `Multicall3.aggregate3` call instead (both
`monad`/`monadTestnet`'s viem chain definitions already carry the canonical Multicall3 address,
so this needed no extra deployment/wiring); each transport's own `{ batch: true }` additionally
coalesces same-tick JSON-RPC calls Multicall3 can't wrap (e.g. `useBalance`'s native-MON
`eth_getBalance`) into one HTTP POST. `pollingInterval` is also dropped from wagmi's 4s default to
1s, matching Monad's own ~400ms block time / ~800ms finality — the 4s default meant a `watch`-ed
read (balances, streak) could lag up to 4s behind a transaction that had already confirmed.

### Design constraints (Figma spec, current phase)

Dark-only theme, no light mode. Exact tokens in `apps/web/app/globals.css`: background
`#090806` (a direct brand-color update — was `#141514`), card `#111211` (left as-is; the update
only specified background, so the page is now technically a touch darker than the card, a subtle
flip from before but not something to "fix" without being asked), foreground `#ffffff`
(`--foreground` — every "primary button" in the app is a plain white fill, `bg-foreground`, with
dark text, `text-background`; a brief pass introduced a separate gold `--primary` token and moved
all ~30 of those call sites onto it, since reverted back to `bg-foreground` — the user's actual
brand-color request only covered the page background and the glow/mint palette below, not the
button convention, so there is no `--primary` token anymore), translucent white pill/surface fill
`rgba(255,255,255,0.04)` (`--surface`), divider `rgba(255,255,255,0.2)` (`--border`), plus three
accents — coral `#FE7667` (`--warning`, used for today's countdown / "Missed"), mint `#67FE90`
(`--success`, used for "Completed" — a deliberately distinct semantic green, not part of the
glow/mint→gold conversion below), and amber `#FDBA3B` (`--flame`, reserved for exactly two
gamification/AI-flavored spots: `AppHeader.tsx`'s streak-flame badge and `InsightCard.tsx` — not
a general-purpose accent, don't reach for it elsewhere without a similar reason). Text uses
opacity tiers on white rather than separate grey colors (`--muted` = 0.6; several one-off opacity
classes like `text-white/45` are used inline for tiers the token set doesn't cover — check
`HabitList.tsx`/`page.tsx` before adding a new one).

Fonts: `DM Sans` for everything else (`next/font/google`, wired in `app/layout.tsx`). `Rakkas`
(`font-display`) briefly went vestigial when the wordmark became a real PNG (see below) — it's
back in use now, but for `LandingScreen.tsx`'s headline ("Commit your money. Keep your word."),
not the logo. Don't reintroduce `font-display` text as a logo stand-in; if a new screen needs the
mark itself, reuse the actual PNGs below, not live text.

**Logo/brand assets — real PNGs now, not a Phosphor icon + live text.** `public/argus-
wordmark.png` (894×313, icon+"Argus" lockup) and `public/argus-logomark.png` (157×157, icon
only) are both white-on-transparent, designed to sit on the app's dark surfaces — composite them
onto something dark to actually see the mark; they render as blank on a white background. Used
via `next/image` (not a plain `<img>` — these are static files in `public/`, the normal
next/image case, unlike the dynamic per-wallet data-URI icons in `ConnectButton.tsx` which stay
plain `<img>`): the full wordmark appears exactly once, in `LandingScreen.tsx`'s top bar (the
most spacious brand-mark spot, pre-auth); every other screen (i.e. `AppHeader.tsx`, mounted on
every authenticated screen) uses the icon-only logomark, no accompanying text — replaced the old
`<Eye weight="fill"/><span className="font-display">Argus</span>` placeholder in both spots.
`WelcomeModal.tsx`'s own `Eye` icon (one of four step-illustration icons) is unrelated and was
left alone — it's a thematic "watching/verifying" glyph for that one step, not a brand-logo
placement.

**Brand texture (gold glow, grain, dots) — infused subtly across more surfaces, per a direct
branding decision.** Two separate changes, done together:
1. **Color**: `GlowBackground.tsx`'s 5-stop radial-gradient glow and the "Chat with Argus"
   button's conic-gradient hover glow (`app/page.tsx`) both moved from an original 5-color
   rainbow (pink/gold/mint/blue/purple) to a monochromatic gold family anchored on the brand
   gold — `#fde9be` (pale gold tint) → `#f5b94c` (the exact brand gold, kept as an anchor) →
   `#e0a233` (medium gold) → `#c08a2e` (deeper amber) → `#7a5518` (dark shade) — same
   positions/shapes each stop already had, only the colors changed. (A brief intermediate pass
   repainted this as a green/mint family instead — `#a8ffd1` → `#6bffb8` → `#3ddc97` → `#1fae66`
   → `#0d7a4a` — since reverted back to gold per the user's actual request, which was
   specifically "background to `#090806`, and anywhere there's green mint → `#F5B94C` and its
   tints/shades.") The two glow moments are kept in sync deliberately (documented since
   `GlowBackground.tsx` was first written — "the two glow moments read as the same family of
   color").
2. **Texture reach**: `components/GrainOverlay.tsx` (new) extracted the fractal-noise SVG data
   URI that used to live only inline inside `DotGrid.tsx` into a shared constant, and mounts one
   always-on, viewport-pinned copy once in `app/layout.tsx` (`fixed inset-0 -z-10
   opacity-[0.02]` — negative z-index specifically so it paints *behind* ordinary in-flow content
   rather than over it, since a positive z-index on a positioned element paints after normal-flow
   siblings in the same stacking context) — every screen gets the same faint grain uniformly now,
   including ones that never mount `GlowBackground`/`DotGrid` at all. `DotGrid.tsx` imports the
   same constant instead of keeping its own duplicate copy. Separately, the `GlowBackground`/
   `DotGrid` pairing itself was extended to two surfaces that didn't have it before: `Modal.tsx`
   (intensity `0.4` — since every overlay in the app routes through this one component, this
   brands all of them — Settings/Wallet/Streak/History/Recover/the `ConnectButton` wallet-picker —
   at once) and `LandingScreen.tsx`'s hero (intensity `0.5`). Both lower than the dashboard card's
   `1` baseline, deliberately — "very subtle" was an explicit instruction, and both are smaller,
   more content-dense surfaces than the big dashboard card. `AppHeader.tsx` was deliberately left
   untouched — it's a thin chrome strip directly on the page background, not a bounded card/panel
   the way everything else using these components is; forcing the same treatment onto a slim row
   risked looking clipped rather than branded. `ChatSidebar.tsx` was also explicitly left
   untouched in this pass (still at its earlier diagnostic `intensity={1.4}` and still carrying a
   `TEMPORARY DEBUG PROBE` div from an unresolved visibility investigation) — held back
   specifically until that's confirmed working in a real browser, not part of this change.

**No outlines/borders anywhere** — selection state and grouping are shown by fill
(`bg-foreground text-background` vs `bg-surface`) or opacity, never a border, with exactly two
intentional exceptions: the per-day divider inside `HabitDayGroups.tsx` (deliberately fainter,
`border-white/10`, than the section-level one) and the single divider under the "Habits" section
heading in `HabitList.tsx` (`border-t border-border`) — `ChatSidebar.tsx`'s old composer divider
was removed as part of its floating-composer redesign (see below), so the exception count stayed
at two rather than growing. If you add a new component, don't reach for `border` as a default —
check how the existing ones distinguish state first.

Icons: `@phosphor-icons/react` exclusively (`weight="fill"` for filled marks like `Eye`/`Fire`/
`GearSix`, `weight="bold"` for line marks like `ArrowUp`/`ArrowLeft`/`CaretDoubleRight`) — no
hand-rolled inline SVGs or unicode glyphs (↑, ←, », ↗) for anything icon-shaped.

Native `<input type="date">` / `<input type="time">` (in `HabitDurationPicker.tsx` /
`HabitDeadlineTimePicker.tsx`) over hand-rolled pickers — deliberate, to get a real
industry-standard picker UI without a much bigger custom-component build. Add
`[color-scheme:dark]` to them so the native picker itself renders dark, matching the rest of the
theme instead of popping up as a jarring light-mode control.

Hover-revealed controls (the Wallet modal's disconnect icon, header balance-pill breakdown,
`StreakPanel.tsx`'s download button, and `HabitDayGroups.tsx`'s Upload Proof/Edit-icon reveal)
use Tailwind's `group`/`group-hover` with an opacity transition — no JS hover state. Every one of
these is now also gated behind a `[@media(hover:hover)]:` arbitrary variant, e.g.
`[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100` — touch devices
have no reliable hover state, so without this gate a hover-revealed control (especially Upload
Proof, a primary CTA) would be permanently invisible on a phone. This was a real gap found during
the mobile-responsiveness pass: `StreakPanel.tsx`'s download button had no touch fallback at all
before this. `components/Tooltip.tsx` is the one exception that's genuinely tap-accessible
without the media-query gate — it toggles on click (works everywhere) *and* peeks on hover
(desktop-only, media-gated), rather than being hover-only. This only reacts to *real* pointer
events; a synthetic `element.dispatchEvent(new MouseEvent(...))` in a test/automation context
will not trigger the hover variants.

### Design-polish primitives (`Spinner.tsx` / `Toast.tsx` / `Tooltip.tsx`, `ease-emil-out`)

Added during a full UI-polish pass (emil-design-eng skill) — three small, dependency-free shared
components, no framer-motion or other animation library installed, pure CSS transitions/
keyframes throughout:
- **`components/Spinner.tsx`** — Phosphor `CircleNotch` + Tailwind's built-in `animate-spin`.
  Paired with (not replacing) every existing inline busy-text state across the app ("Saving…",
  "Confirm in wallet…", etc.) — the text still says what's pending, the spinner adds the missing
  motion cue.
- **`components/Toast.tsx`** — `ToastProvider` (mounted once in `app/providers.tsx`) +
  `useToast()`. Success-acknowledgment only (habit created, deposit confirmed, settings saved,
  chat-confirmed actions, proof verified/rejected) — existing inline error text
  (`text-xs text-red-500`) is untouched and still the pattern for failures, since those shouldn't
  auto-dismiss.
- **`components/Tooltip.tsx`** — click-toggled (touch-safe) + hover-peek (media-gated, desktop).
  Applied at a curated set of confusing spots rather than everywhere: `WalletStatus.tsx`'s
  Available/Committed/Savings Vault rows (this is what actually explains "Committed reads 0
  despite a configured stake" — Committed is `stake × active habit count`, so it's correctly 0
  with no habits yet), `SettingsSheet.tsx`'s penalty section, `DeployWalletForm.tsx`'s asset
  picker.
- **`--ease-emil-out: cubic-bezier(0.23, 1, 0.32, 1)`** (`app/globals.css`, registered in
  `@theme inline` so it's usable as the `ease-emil-out` class) — a stronger, more intentional
  curve than Tailwind's built-in `ease-out`. Used everywhere in place of `ease-out` now. Paired
  with a standard press-feedback class string, `transition-transform duration-150 ease-emil-out
  active:scale-[0.97]`, applied directly (not abstracted into a utility) to essentially every
  clickable button in the app.
- `--animate-modal-in` / `--animate-toast-in` / `--animate-scan-line` / `--animate-glow-spin`
  (same file) back four more keyframes: `Modal.tsx`/`ConfirmDialog.tsx`'s mount-in (opacity +
  `scale(0.95→1)`, never `scale(0)`), the toast stack's entrance, `LiveCameraCapture.tsx`'s
  scanning-sweep overlay shown over a captured photo while Gemini verifies it, and the "Chat with
  Argus" button's hover glow (a blurred, rotating conic-gradient clipped to the button's own
  `overflow-hidden rounded-full` shape, not bleeding onto the page around it).

`Modal.tsx`'s Close control changed from a muted underlined "Close" text link to a Phosphor `X`
icon button, top-right, and its backdrop went from flat `bg-black/50` to `bg-black/60
backdrop-blur-sm`. `ConfirmDialog.tsx` (a separate, historically inconsistent overlay
implementation) was brought in line with the same backdrop/radius/title treatment — **but
deliberately did not get a close icon**: its lack of any dismiss affordance beyond
Cancel/Confirm is a safety property for on-chain-affecting confirmations, not an oversight.

`SettingsSheet.tsx`'s display-name field lost its own inline Save button — a single "Save
Settings" button at the bottom now covers both fields, but the two underlying operations stay
genuinely different under the hood: a name-only change saves directly (still a plain off-chain
write, still no confirmation needed), while a stake/penalty-type change still opens the same
`ConfirmDialog` on-chain safety prompt as before (only the entry point was unified, not the
safety gate). `nameDirty`/`penaltyDirty` are tracked against the initial snapshot to decide which
path a click takes; if both changed, the name saves first (before the wallet-signature prompt) so
a rejected/cancelled signature doesn't lose an already-valid name change, and `nameError`/
`penaltyError` stay independent so a partial success is still visible rather than reading as
"nothing happened."

## Known gaps (intentional, not yet built)

- ~~No real cron calls `HabitManager.settle()` daily~~ — **closed.** `app/api/cron/settle/route.ts`
  (gated by a `CRON_SECRET` bearer-token check, since it acts across every wallet rather than a
  single session) loops `lib/chain.ts`'s `settlePendingDays()` over every wallet with an active
  habit. Two independent triggers call this same endpoint now, per a direct instruction to settle
  faster than once a day without needing a paid Vercel plan:
  1. **`.github/workflows/settle-cron.yml`** — a GitHub Actions scheduled workflow, `*/15 * * * *`
     (every 15 minutes), `curl`s the endpoint with `Authorization: Bearer ${{ secrets.CRON_SECRET
     }}`. This is the primary mechanism now — a missed day's penalty fires within minutes of the
     real UTC-midnight boundary rather than up to ~24h later. The `CRON_SECRET` value is set as a
     GitHub Actions repo secret (`gh secret set CRON_SECRET`, already done — value lives only in
     GitHub's secret store and `.env.local`, never printed anywhere). Also has `workflow_dispatch:`
     so it can be triggered manually (Actions tab, or `gh workflow run settle-cron.yml`) without
     waiting for the next tick. GitHub disables a scheduled workflow after 60 days of zero repo
     activity, which is what (2) below guards against.
  2. **`vercel.json`'s own `crons` entry** — reverted back to once-daily (`5 0 * * *`, shortly
     after UTC midnight), kept deliberately as a fallback backstop rather than removed outright,
     in case (1) is ever paused or its secret drifts out of sync. Vercel's Hobby plan caps cron
     jobs at once per day, which is exactly why the faster cadence moved to GitHub Actions instead
     of just raising this schedule's frequency (a sub-daily `vercel.json` schedule silently doesn't
     run at that cadence on Hobby).
  Settling stays whole-day/all-or-nothing regardless of which trigger fires it or how often — this
  only changes how promptly the existing settlement logic gets invoked, not the logic itself (see
  the Committed section above for why a per-habit, immediate-on-its-own-deadline version was
  deliberately not built instead: it would need a new on-chain `settleHabit()` and would complicate
  how streaks aggregate per-day success across habits with different deadline times). This was the
  original root cause behind two related live reports — penalties not firing and streaks looking
  stale — since previously nothing settled a day unless a user happened to open the app or verify
  a habit around that day's boundary. The opportunistic calls from `/api/state` and `/api/verify`
  (via `after()`, so they don't block the response) still exist too, as an even-faster
  same-session catch-up; the two cron triggers above are backstops for wallets that never open the
  app. Separately, `HabitDayGroups.tsx` already shows a habit as "Missed" the instant its own
  (UI-only) `deadline_time` passes, well before any real settlement runs — that per-habit,
  immediate *display* signal was already correct and needed no change; only the actual on-chain
  execution timing did. Requires `CRON_SECRET`
  set in `.env.local`, the Vercel project's env vars, and (see above) as a GitHub Actions repo
  secret — Vercel sends it automatically as `Authorization: Bearer $CRON_SECRET` for its own
  scheduled invocations once the env var exists, nothing else to wire up on that side.
  **`vercel.json` must live at `apps/web/vercel.json`**,
  the Vercel project's configured Root Directory — not the monorepo root. Vercel only ever reads
  `vercel.json` from Root Directory, so one sitting at the repo root (easy to create by accident
  in a monorepo) is silently never read and its `crons` entry never registers, even though the
  route's own `CRON_SECRET` check is entirely correct. Confirmed live as the actual root cause of
  the daily settlement cron never firing — check *where* the file lives before debugging the
  cron route itself.
- `habits.deadline_time` is UI-only (see the off-chain metadata note above) — there is no
  timezone-aware on-chain deadline enforcement, only the real UTC-midnight settlement. Don't
  assume "Missed" shown in the UI means a penalty has actually moved funds.

## Gotchas

- **The 3-habit cap gates *active* habits, not lifetime `habitCount`.** This changed after a
  redeploy (see git history / current `.env.local` addresses) specifically because the earlier
  lifetime-based rule caused a real reported bug (users blocked from adding a habit after
  deactivating one, and the AI chat coach refusing all new-habit requests with stale "3 is a
  lifetime cap" wording — see the AI section above). `HabitManager.createHabit()` now reverts
  only when `_activeCount(user) >= MAX_HABITS`; `habitCountOf` still only ever grows (no slot
  reuse — a deactivated index is never reused), so `habitCount` alone is *not* a valid "can they
  add another?" check. There's also no external `activeCount` view — `_activeCount` is internal.
  The frontend re-derives it itself by scanning `habitActive(user, i)` for every index up to
  `habitCount` (`hooks/useUnmirroredHabits.ts`'s `scanHabits`, exposed as `activeCount`) rather
  than trusting Supabase's `active` column, since on-chain stays the source of truth and mirror
  drift is exactly what that hook exists to catch. If you add a new place that needs to know "can
  this wallet create another habit," reuse `useUnmirroredHabits()`'s `activeCount` — don't
  reintroduce a raw `habitCount()` read for this purpose.
  **A direct, real consequence of "index only ever grows, never reused":** `contract_index` is
  unbounded above (any wallet that creates/deletes enough habits over time will legitimately
  reach index 3, 4, 5...) — every Zod schema and the `habits` table's own check constraint used to
  cap it at `max(2)` / `between 0 and 2`, wrongly treating "index" as if it meant the same thing
  as "active count." Confirmed live as a real, severe bug: a wallet with an active on-chain habit
  at index 3 got permanently stuck on a non-dismissible "Existing habits found" recovery modal
  that could never actually save, since the mirror write was rejected at both the API validation
  layer and the database layer every single time. Fixed by dropping the upper bound everywhere it
  appeared — `app/api/habits/route.ts` (both schemas), `app/api/verify/route.ts`, `app/api/verify/
  challenge/route.ts`, and `packages/supabase/migrations/0006_habits_index_no_upper_bound.sql`
  (only `contract_index >= 0` now). If you ever add a new route that takes a `contractIndex`,
  don't reintroduce a `.max(2)` — there is no valid upper bound on this value, only `>= 0`.
- **A Supabase column referenced in a route's `select`/`insert` before its migration is applied
  fails the whole query silently** (PostgREST returns a generic error, not "column doesn't
  exist" in an obvious spot) — this has caused real, confusing cascading bugs live: adding
  `deadline_time` to `/api/habits`'s `select` before migration `0004` was applied broke that
  route entirely, which broke `/api/habits/history` too, which made
  `useUnmirroredHabits`/`RecoverHabitsModal` treat *every* habit as permanently unmirrored (an
  infinite-feeling "can't move from here" loop) even though the actual root cause was three
  layers away. When a route starts failing right after adding a new column reference, check
  whether its migration has actually been run in Supabase before debugging application logic.
  There's no automated migration runner here — migrations under `packages/supabase/migrations/`
  must be applied by hand (the SQL editor in the Supabase dashboard); writing `add column if not
  exists` / `create index if not exists` makes a migration script safe to re-run if you're not
  sure exactly which of several have already landed.
- **Every wagmi read/write needs an explicit `chainId`.** Without it, wagmi silently uses
  whatever network the wallet extension currently has active instead of Monad — confirmed live
  as a `createHabit` call that showed up in the wallet as an ETH-denominated tx. Always pass
  `chainId: activeChain.id`.
- **Don't guess which injected wallet connector to use.** With multiple extensions installed
  (Phantom + MetaMask is the confirmed-live repro), wagmi registers one connector per
  EIP-6963-announced provider, and blindly picking "the first `injected` one" can grab a
  non-EVM provider that returns a malformed address. List every `connectors` entry and let the
  user choose — `ConnectButton.tsx` renders a single "Connect Wallet" button on the landing
  screen and moved the actual connector list (one row per detected extension, still every
  `connectors` entry, not just the first) into a `Modal.tsx` popup instead of stacking every
  connector as its own button directly on the page — that stack was fine with one extension
  installed but read as alarming/cluttered with several. The same popup's second step (address +
  Sign in/Disconnect, shown once `isConnected`) is non-dismissible (`Modal`'s `dismissible={false}`)
  since Sign In or Disconnect are the only useful next actions there; `open={modalOpen ||
  isConnected}` (not just local `modalOpen` state) so a reload that lands here already connected
  but not yet signed in (session cookie missing/expired) reopens straight to that step instead of
  a bare button with no obvious next move. Each row's icon is the real wallet logo, not a
  hardcoded/bundled brand asset — every EIP-6963-announced provider (how `injected()` discovers
  each installed extension) reports its own `icon` as a data URI on the `Connector` object itself
  (`connector.icon`, `@wagmi/core`'s `createConnector` type), so MetaMask/Rabby/Phantom/etc. show
  their actual mark for free; only a connector with no EIP-6963 announcement (bare
  `window.ethereum`, no `icon`) falls back to a generic Phosphor `Wallet` glyph. Same `icon` field
  off `useAccount().connector` (the currently-active one) is reused for the second step's badge.
- **A valid session can outlive the actual wallet connection.** The session cookie (7-day TTL)
  survives a browser restart; the wagmi/wallet connection does not always reconnect cleanly
  after one. Any component that writes on-chain must check `useAccount().isConnected` itself
  and render `WalletReconnect.tsx` if false — don't assume "has a session" means "wallet is
  live" (confirmed live as `ConnectorNotConnectedError` after a browser restart).
- **Postgres/PostgREST returns `timestamptz` as `...+00:00`, not `...Z`.** If you build a
  message/signature/hash from a timestamp on write and reconstruct it on read for comparison
  (see the nonce sign-in flow), route both through `new Date(x).toISOString()` or the strings
  won't match byte-for-byte even though they represent the same instant.
- A wallet request (`eth_sendTransaction`, `wallet_switchEthereumChain`, ...) has no
  `AbortController` — if the extension never responds (conflicting extensions, a popup opening
  off-screen), the UI hangs forever with no built-in recovery. `SetupFlow.tsx`'s `cancelledRef`
  pattern is the template for adding a "stuck? cancel" escape hatch to any new wallet-write flow.
- `tsconfig.json` target is `ES2020` (bumped from create-next-app's default `ES2017`) —
  required for viem/wagmi's `BigInt` literals. Don't lower it.
- ESLint's `react-hooks/set-state-in-effect` rule fires on the common
  "call an async data-loader function directly inside `useEffect`" pattern — inline the fetch
  with a `cancelled` flag instead (see `app/page.tsx`'s state-loading effect for the pattern
  used here). The same rule also fires if a `useCallback`-wrapped loader (one that itself calls
  `setState`) is invoked from an effect body, even indirectly — the fix used throughout this repo
  (`hooks/useUnmirroredHabits.ts`, `components/HabitList.tsx`'s `load`) is to duplicate a small
  plain async function outside the hook chain and call it via `.then()` in the mount effect,
  keeping a separate `useCallback` version only for imperative re-triggering (e.g. after a save).
  For a modal that must stay mounted-but-reset between opens rather than reset-in-effect, prefer
  a `key`-remount over manual state clearing (see `EditHabitModal`'s
  `key={editing?.contractIndex ?? "none"}` usage in `HabitList.tsx`).
- `apps/web/lib/abi/*.json` are generated artifacts (`npm run sync-abi` from repo root, wraps
  `forge inspect <Contract> abi --json`) — never hand-edit them.
- `contracts/lib/` (forge-std, openzeppelin-contracts) is gitignored; run
  `forge install --no-git OpenZeppelin/openzeppelin-contracts` after a fresh clone.
- `apps/web/.gitignore`'s `.env*` pattern also matched `.env.local.example` until it was fixed
  with a `!.env*.example` exception — if you add a new example/template env file anywhere,
  double check `git status` actually picks it up.
