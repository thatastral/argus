# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Argus: AI-powered accountability wallet on Monad. Users create habits, verify completion with
Gemini, and earn access to spend from a wallet; missing a habit triggers an on-chain penalty
(save/donate/accountability-partner/surprise). This scaffold covers the **core** of the PRD:
the Desktop web app, the four on-chain contracts, and Supabase. Mobile (Expo) and the Chrome
extension (Hard Mode) are not built yet.

## Structure

```
apps/web/          Next.js 16 app — frontend + backend (Next.js API routes, no separate server)
contracts/          Foundry project — HabitManager, PenaltyEngine, ArgusFactory, AccountabilityWallet
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

Inside `contracts/` (requires Foundry — `curl -L https://foundry.paradigm.xyz | bash && foundryup`):

```bash
forge build
forge test -vv
forge test --match-contract HabitManagerTest        # one test file
forge test --match-test test_settle_successIncrementsStreak -vvvv   # one test, verbose traces
forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast \
  --sig "run(address,address)" <VERIFIER_ADDRESS> <DONATION_ADDRESS>
```

## Architecture

### Contract deployment has a forced order — read before touching constructors

`PenaltyEngine.execute()` is `onlyHabitManager`, and `HabitManager.settle()` calls
`PenaltyEngine.execute()` — a constructor cycle. It's broken with a two-step bootstrap that
`script/Deploy.s.sol` implements exactly:

1. Deploy `PenaltyEngine(deployer, donationAddress)` — `habitManager` address starts unset.
2. Deploy `HabitManager(deployer, address(penaltyEngine))` — takes PenaltyEngine's address directly.
3. `penaltyEngine.setHabitManager(address(habitManager))` — settable once, then locked.
4. Deploy `ArgusFactory(address(habitManager), address(penaltyEngine))`.
5. `habitManager.setFactory(...)` and `penaltyEngine.setFactory(...)` — both settable once.
6. `habitManager.setVerifier(verifierAddress)`.

Any change to these four contracts' constructors needs this sequence re-verified in
`contracts/test/utils/ArgusTestBase.sol` (mirrors the same bootstrap for tests) and
`script/Deploy.s.sol`.

### Non-custodial vault pattern (why there are 4 contracts, not the PRD's 3)

`ArgusFactory.deployWallet()` deploys a fresh `AccountabilityWallet` per user, **owned entirely
by that user's wallet address** — Argus never custodies funds or keys. `withdraw()` checks
`HabitManager.isUnlockedToday(owner)`; only `PenaltyEngine` may pull funds via
`executePenalty()`, and only when a day was missed. Frontend/backend look up a user's vault
address on-chain via `ArgusFactory.walletOf(user)` — this is the source of truth, not the
`accountability_wallet_address` mirror column in Supabase.

### On-chain vs off-chain split

HabitManager/AccountabilityWallet/PenaltyEngine are the source of truth for streaks, unlock
state, and fund movement. Supabase (`packages/supabase/migrations/0001_init.sql`) is a
fast-read cache for the UI/chat, plus data with no reason to be on-chain (display names, proof
images, chat history). `habit_completions.contract_index` and `habits.contract_index` must
match the on-chain habit array index exactly — off-chain rows are written only after the
corresponding on-chain tx confirms (see `apps/web/components/SetupFlow.tsx` and
`app/api/habits/route.ts`).

### Auth: wallet-signature only, no Supabase Auth

Every Supabase table has RLS enabled with **no policies** — the anon/authenticated roles get
nothing; only the service-role key (used exclusively server-side via
`apps/web/lib/supabase/server.ts`) can read/write. The client never talks to Supabase directly.
Login is `POST /api/auth/nonce` (mints a single-use nonce + message) → wallet signs it →
`POST /api/auth/verify` (reconstructs the message server-side from the stored nonce row, never
trusts a client-supplied message, verifies via `viem`'s `publicClient.verifyMessage` — covers
both EOAs and ERC-1271 contract wallets) → signs an httpOnly JWT cookie (`lib/session.ts`,
`jose`). `getSessionWallet()` gates every other API route.

### AI has exactly two jobs (`apps/web/lib/gemini.ts`)

1. `verifyHabitProof` — Gemini 2.5 Flash with `responseSchema` (structured JSON output:
   `{verified, confidence, reason}`). Business logic must never depend on free-form text.
   `POST /api/verify` uploads the proof image to the Supabase `proofs` storage bucket, calls
   this, and — if `verified && confidence >= 0.7` — relays `HabitManager.completeHabit()`
   on-chain using a separate backend "verifier" signer (`VERIFIER_PRIVATE_KEY` in
   `lib/chain.ts`, distinct from the contracts' `owner`/deployer key; holds no user funds).
2. `progressCoachReply` — explains the user's own structured data back to them via a system
   instruction that explicitly refuses unrelated questions. Never a general-purpose assistant.

### Chain config

`apps/web/lib/wagmi.ts` (client) and `lib/chain.ts` (server) both key off
`NEXT_PUBLIC_MONAD_NETWORK` (`"mainnet"` or default testnet) and use `monad`/`monadTestnet`
from `wagmi/chains` / `viem/chains` directly — never hand-define these chain objects. Contract
addresses come from `NEXT_PUBLIC_HABIT_MANAGER_ADDRESS` / `NEXT_PUBLIC_PENALTY_ENGINE_ADDRESS`
/ `NEXT_PUBLIC_ARGUS_FACTORY_ADDRESS` (`lib/contracts.ts`), populated after running
`script/Deploy.s.sol`.

### Design constraints (PRD, current phase only)

White / black / grey only — no gradients, no glassmorphism, no decorative UI or unnecessary
animation. Closer to ChatGPT than a crypto dashboard. See `apps/web/app/globals.css` for the
CSS variables (`--background`, `--foreground`, `--muted`, `--border`, `--surface`).

## Known gaps (intentional, not yet built)

- No keeper calls `HabitManager.settle()` daily — needs a cron (e.g. Vercel Cron hitting a new
  `/api/cron/settle` route) before this is a real daily loop instead of a manual one.
- Contracts are not deployed anywhere yet; `NEXT_PUBLIC_*_ADDRESS` env vars are empty in
  `.env.local.example`. UI code that depends on them checks for `undefined` and shows a
  "contracts not deployed" notice rather than crashing (see `SetupFlow.tsx`).
- `PenaltyEngine`'s Surprise type resolves via `block.prevrandao`-based pseudo-randomness —
  manipulable by a block producer within a narrow window. Acceptable for small self-imposed
  hackathon stakes; swap for a VRF before real value is at stake.

## Gotchas

- `tsconfig.json` target is `ES2020` (bumped from create-next-app's default `ES2017`) —
  required for viem/wagmi's `BigInt` literals. Don't lower it.
- ESLint's `react-hooks/set-state-in-effect` rule fires on the common
  "call an async data-loader function directly inside `useEffect`" pattern — inline the fetch
  with a `cancelled` flag instead (see `app/page.tsx`'s state-loading effect for the pattern
  used here).
- `apps/web/lib/abi/*.json` are generated artifacts (`npm run sync-abi` from repo root, wraps
  `forge inspect <Contract> abi --json`) — never hand-edit them.
- `contracts/lib/` (forge-std, openzeppelin-contracts) is gitignored; run
  `forge install --no-git OpenZeppelin/openzeppelin-contracts` after a fresh clone.
