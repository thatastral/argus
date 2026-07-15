# Argus contracts

Foundry project for Argus's on-chain layer on Monad.

## Contracts

- **HabitManager** — habit slots (max 3/user), daily completion, streaks, unlock eligibility,
  and `settle()` (permissionless keeper call that closes out a day and triggers a penalty
  on failure). Deliberately does **not** store habit names — a label is display metadata with
  no need for trustless enforcement, so it lives in Supabase only. On-chain tracks just an
  active/inactive slot per index and whether it's been verified complete on a given day; that's
  the part that actually needs to be tamper-proof (see `packages/supabase`'s schema comment for
  the fuller on-chain-vs-off-chain rationale).
- **PenaltyEngine** — user-configured consequence (Save / Donate / Accountability Partner /
  Surprise), executed by HabitManager on a missed day.
- **AccountabilityWallet** — one per user, deployed by ArgusFactory, **owned entirely by the
  user's own wallet address**. Argus never takes custody of funds or keys. Withdrawals check
  `HabitManager.isUnlockedToday()`; only PenaltyEngine may pull funds, and only on a missed day.
  Denominated in either native MON (`asset == address(0)`) or an ERC-20 like USDC, fixed per
  vault at deploy time — `deposit()`/`depositERC20()` are separate paths and each reverts on
  the wrong one for a given vault.
- **ArgusFactory** — deploys each user's AccountabilityWallet (`deployWallet(asset)`) and
  records `walletOf(user)` so HabitManager/PenaltyEngine can find it.
- **MockUSDC** — testnet-only ERC-20 stand-in for USDC (6 decimals, open `mint()`). Deployed
  alongside the others on testnet; **never deploy this on mainnet** — point the frontend at
  real USDC's address there instead.

This is 4 contracts, not the PRD's suggested 3 — the factory pattern (a fresh vault owned by
the user, rather than one shared custodial contract) was an explicit non-custodial requirement
added during scaffolding, so a factory was necessary.

## Why deployment order matters

PenaltyEngine needs HabitManager's address (`onlyHabitManager` on `execute()`), and
HabitManager needs PenaltyEngine's address (to call `execute()` on a missed day) — a
constructor cycle. It's broken with a two-step bootstrap: deploy PenaltyEngine first with a
settable-once `habitManager` address, then deploy HabitManager pointing at the already-known
PenaltyEngine, then wire PenaltyEngine back. Same story for ArgusFactory, which both other
contracts need to look up `walletOf(user)`. `script/Deploy.s.sol` runs this exact sequence —
read it before changing constructor signatures.

## Setup

```bash
forge install --no-git OpenZeppelin/openzeppelin-contracts   # already done if you're reading this from git history
cp .env.example .env   # fill in PRIVATE_KEY (funded with testnet MON)
```

## Test

```bash
forge test -vv
```

## Deploy

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url monad_testnet --broadcast \
  --sig "run(address,address,bool)" <VERIFIER_ADDRESS> <DONATION_ADDRESS> <DEPLOY_MOCK_USDC>
```

- `VERIFIER_ADDRESS` — the backend signer that will call `completeHabit()` after Gemini
  verifies a proof (`VERIFIER_PRIVATE_KEY` in `apps/web/.env.local`). Holds no user funds.
- `DONATION_ADDRESS` — where "Donate" penalties are sent.
- `DEPLOY_MOCK_USDC` — `true` on testnet (also deploys MockUSDC), **`false` on mainnet**
  (`--rpc-url monad_mainnet`) — point `NEXT_PUBLIC_USDC_ADDRESS` at real USDC there instead.

Copy the logged addresses into `apps/web/.env.local` as `NEXT_PUBLIC_HABIT_MANAGER_ADDRESS`,
`NEXT_PUBLIC_PENALTY_ENGINE_ADDRESS`, `NEXT_PUBLIC_ARGUS_FACTORY_ADDRESS`, and (testnet only)
`NEXT_PUBLIC_USDC_ADDRESS`. Then from the repo root run `npm run sync-abi` to refresh
`apps/web/lib/abi/*.json` from the compiled contracts.

## Verify

Use the monskills verification API (verifies on MonadVision, Socialscan, and Monadscan in one
call) for each deployed contract (four, or five on testnet with MockUSDC) — see the `scaffold`
skill for the exact `curl` invocation, or fall back to `forge verify-contract --verifier sourcify`
if the API is down.

## Known simplifications (hackathon MVP — revisit before mainnet with real value at stake)

- `PenaltyEngine._resolve`'s Surprise type uses `block.prevrandao`-based pseudo-randomness,
  which a block producer can bias within a narrow window. Fine for small self-imposed
  penalties; swap for a VRF if amounts get meaningful.
- `HabitManager.settle()` is permissionless but settles one day per call — a keeper (cron in
  `apps/web`, or just the user's own next interaction) needs to call it. No keeper is wired up
  yet in this scaffold.
- No gas-limit tuning has been done on the frontend side yet — see the `gas` monskill before
  wiring up transaction UI (Monad charges on `gas_limit`, not gas used).
