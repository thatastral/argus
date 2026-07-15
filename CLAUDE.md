# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Argus: AI-powered accountability wallet on Monad. Users create habits, verify completion with
Gemini, and earn access to spend from a wallet; missing a habit triggers an on-chain penalty
(save/donate/accountability-partner/surprise). This scaffold covers the **core** of the PRD:
the Desktop web app, the on-chain contracts, and Supabase. Mobile (Expo) and the Chrome
extension (Hard Mode enforcement) are not built yet — Hard Mode can be *selected* in setup but
doesn't block spending without the extension.

Contracts are deployed on Monad testnet; addresses live in `apps/web/.env.local` (gitignored,
not in git history — see `.env.local.example` for the shape).

## Structure

```
apps/web/          Next.js 16 app — frontend + backend (Next.js API routes, no separate server)
  hooks/             useAccountabilityWallet — shared vault/asset/balance reads
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

Inside `contracts/` (requires Foundry — `curl -L https://foundry.paradigm.xyz | bash && foundryup`):

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
4. Deploy `ArgusFactory(address(habitManager), address(penaltyEngine))`.
5. `habitManager.setFactory(...)` and `penaltyEngine.setFactory(...)` — both settable once.
6. `habitManager.setVerifier(verifierAddress)`.
7. (testnet only) Deploy `MockUSDC()` — no wiring needed, it's just a token.

Any change to these four contracts' constructors needs this sequence re-verified in
`contracts/test/utils/ArgusTestBase.sol` (mirrors the same bootstrap for tests) and
`script/Deploy.s.sol`.

### Non-custodial, dual-asset vault pattern (why there are 4-5 contracts, not the PRD's 3)

`ArgusFactory.deployWallet(asset)` deploys a fresh `AccountabilityWallet` per user, **owned
entirely by that user's wallet address** — Argus never custodies funds or keys. `asset` is
fixed at deploy time: `address(0)` for native MON, or an ERC-20 address (e.g. `MockUSDC` on
testnet) — a vault only ever holds one asset, and `deposit()`/`depositERC20()` are separate
paths that each revert (`WrongAssetPath`) if called on the wrong kind of vault. `withdraw()`
checks `HabitManager.isUnlockedToday(owner)`; only `PenaltyEngine` may pull funds via
`executePenalty()`, and only when a day was missed. Frontend looks up a user's vault address
and asset on-chain via `ArgusFactory.walletOf(user)` / `AccountabilityWallet.asset()` — this is
the source of truth, not the `accountability_wallet_address` mirror column in Supabase.
`apps/web/hooks/useAccountabilityWallet.ts` is the one place both reads happen; the home
screen's balance hero and the Wallet bottom sheet both consume it rather than re-deriving.

**MockUSDC is testnet-only** (open `mint()`, 6 decimals) — `Deploy.s.sol`'s `deployMockUsdc`
flag must be `false` on mainnet; point `NEXT_PUBLIC_USDC_ADDRESS` at real USDC there instead.

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
row without clobbering an existing one's `display_name`/`wallet_mode`.

### AI has exactly two jobs (`apps/web/lib/gemini.ts`)

1. `verifyHabitProof` — Gemini 2.5 Flash with `responseSchema` (structured JSON output:
   `{verified, confidence, reason}`). Business logic must never depend on free-form text.
   `POST /api/verify` uploads the proof image to the Supabase `proofs` storage bucket, calls
   this, and — if `verified && confidence >= 0.7` — relays `HabitManager.completeHabit()`
   on-chain using a separate backend "verifier" signer (`VERIFIER_PRIVATE_KEY` in
   `lib/chain.ts`, distinct from the contracts' `owner`/deployer key; holds no user funds).
2. `progressCoachReply` — explains the user's own structured data back to them via a system
   instruction that explicitly refuses unrelated questions. Never a general-purpose assistant.
   This is the home screen's primary interface (`components/ChatHero.tsx`), not a side panel.

### Home screen: hero + bottom sheets, not a static dashboard

`app/page.tsx`'s signed-in view is a centered balance hero (big number, `LOCKED`/`UNLOCKED` +
streak caption) with `ChatHero` as the dominant element below it — habits and wallet
controls are *not* rendered inline; two chips open `components/BottomSheet.tsx` (portal to
`document.body`, backdrop, slide-up transition) containing `HabitList` / `WalletStatus`
respectively. If you're adding a new dashboard feature, default to a bottom sheet over a new
inline section unless there's a specific reason it needs to always be visible.

### Chain config

`apps/web/lib/wagmi.ts` (client) and `lib/chain.ts` (server) both key off
`NEXT_PUBLIC_MONAD_NETWORK` (`"mainnet"` or default testnet) and use `monad`/`monadTestnet`
from `wagmi/chains` / `viem/chains` directly — never hand-define these chain objects. Contract
addresses come from `NEXT_PUBLIC_HABIT_MANAGER_ADDRESS` / `NEXT_PUBLIC_PENALTY_ENGINE_ADDRESS`
/ `NEXT_PUBLIC_ARGUS_FACTORY_ADDRESS` / `NEXT_PUBLIC_USDC_ADDRESS` (`lib/contracts.ts`).

### Design constraints (PRD, current phase only)

White / black / grey only — no gradients, no glassmorphism, no decorative UI or unnecessary
animation. Closer to ChatGPT than a crypto dashboard. See `apps/web/app/globals.css` for the
CSS variables (`--background`, `--foreground`, `--muted`, `--border`, `--surface`).

## Known gaps (intentional, not yet built)

- No keeper calls `HabitManager.settle()` daily — needs a cron (e.g. Vercel Cron hitting a new
  `/api/cron/settle` route) before this is a real daily loop instead of a manual one.
- `PenaltyEngine`'s Surprise type resolves via `block.prevrandao`-based pseudo-randomness —
  manipulable by a block producer within a narrow window. Acceptable for small self-imposed
  hackathon stakes; swap for a VRF before real value is at stake.
- Hard Mode is selectable in setup but the Chrome Extension that would actually block spending
  doesn't exist yet — habits/streaks still track fully on-chain in that mode, penalties just
  don't move funds (no vault gets deployed).

## Gotchas

- **Every wagmi read/write needs an explicit `chainId`.** Without it, wagmi silently uses
  whatever network the wallet extension currently has active instead of Monad — confirmed live
  as a `createHabit` call that showed up in the wallet as an ETH-denominated tx. Always pass
  `chainId: activeChain.id`.
- **Don't guess which injected wallet connector to use.** With multiple extensions installed
  (Phantom + MetaMask is the confirmed-live repro), wagmi registers one connector per
  EIP-6963-announced provider, and blindly picking "the first `injected` one" can grab a
  non-EVM provider that returns a malformed address. List every `connectors` entry and let the
  user choose (`ConnectButton.tsx`).
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
  used here).
- `apps/web/lib/abi/*.json` are generated artifacts (`npm run sync-abi` from repo root, wraps
  `forge inspect <Contract> abi --json`) — never hand-edit them.
- `contracts/lib/` (forge-std, openzeppelin-contracts) is gitignored; run
  `forge install --no-git OpenZeppelin/openzeppelin-contracts` after a fresh clone.
- `apps/web/.gitignore`'s `.env*` pattern also matched `.env.local.example` until it was fixed
  with a `!.env*.example` exception — if you add a new example/template env file anywhere,
  double check `git status` actually picks it up.
