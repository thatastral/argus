# Argus

AI-powered accountability wallet on Monad. See `Argus PRD.md` (in Downloads, not checked in
here) for full product spec.

This scaffold covers the **core** of the PRD: the Desktop web app (accountability wallet + AI
chat), the four on-chain contracts, and Supabase. Users connect their own wallet and deploy a
personal Accountability Wallet — their wallet itself is never locked, only funds they explicitly
commit toward a habit are governed. Mobile (React Native/Expo) isn't scaffolded yet — see PRD for
scope when picking that up.

## Structure

```
apps/web/         Next.js app — frontend + API routes (backend lives in Next.js API routes)
contracts/        Foundry project — HabitManager, PenaltyEngine, ArgusFactory, AccountabilityWallet
packages/supabase/ SQL migrations + schema notes
```

## Setup

1. **Contracts** — see `contracts/README.md`. Install deps, run tests, deploy to Monad
   testnet, note the three deployed addresses.
2. **Supabase** — see `packages/supabase/README.md`. Create a project, run the migration,
   create the `proofs` storage bucket.
3. **Web app**:
   ```bash
   npm install   # from repo root — npm workspaces
   cp apps/web/.env.local.example apps/web/.env.local
   # fill in: contract addresses from step 1, Supabase creds from step 2,
   # SESSION_SECRET (openssl rand -base64 32), GEMINI_API_KEY, VERIFIER_PRIVATE_KEY
   npm run dev
   ```

## Auth model

Wallet-signature login only (no email/OAuth) — see the header comment in
`packages/supabase/migrations/0001_init.sql`. The client never talks to Supabase directly;
every read/write goes through a Next.js API route using the service-role key, gated by a
signed session cookie set after the wallet-signature challenge in `/api/auth/nonce` +
`/api/auth/verify`.

## On-chain vs off-chain

HabitManager/AccountabilityWallet/PenaltyEngine on Monad are the source of truth for streaks,
unlock state, and fund movement. Supabase is a fast-read cache for the UI/chat plus data that
has no reason to be on-chain (display names, proof images, chat history) — see the comment
block at the top of the SQL migration for the full breakdown.

## Notes on this scaffold

- Built with guidance from the `monskill` skill (Monad-specific patterns: chain definitions,
  gas model, contract verification). See `.monskills` for provenance.
- `HabitManager.settle()` runs on a real daily cron (`vercel.json` + `/api/cron/settle`), on top
  of opportunistic catch-up calls from `/api/state` and `/api/verify` — see CLAUDE.md's "Known
  gaps" for the full picture.
- Design system intentionally minimal per PRD: white/black/grey only, no gradients — see
  `apps/web/app/globals.css`.
