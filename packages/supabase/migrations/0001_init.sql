-- Argus initial schema.
--
-- Auth model: wallet-based, no email/OAuth. Clients never talk to Supabase directly —
-- every request goes through Next.js API routes using the service role key, after the
-- route verifies a wallet signature and reads the wallet address from a signed session
-- cookie. RLS is therefore enabled with a default-deny policy on every table; the
-- service role bypasses RLS by design, so these policies exist as a backstop against a
-- leaked anon key, not as the primary access control.
--
-- On-chain vs off-chain split: HabitManager/AccountabilityWallet/PenaltyEngine on Monad
-- are the source of truth for streaks, unlock state, and fund movement. Everything here
-- is a fast-read cache (for chat/UI) plus data that has no reason to be on-chain (display
-- names, uploaded proof images, chat history).

create extension if not exists "pgcrypto";

-- One row per wallet that has connected to Argus.
create table users (
    wallet_address text primary key check (wallet_address = lower(wallet_address)),
    display_name text not null,
    wallet_mode text not null check (wallet_mode in ('easy', 'hard')),
    accountability_wallet_address text check (accountability_wallet_address = lower(accountability_wallet_address)),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Mirrors HabitManager.habitsOf on-chain; contract_index must match the on-chain array index.
create table habits (
    id uuid primary key default gen_random_uuid(),
    wallet_address text not null references users (wallet_address) on delete cascade,
    contract_index int not null check (contract_index between 0 and 2),
    name text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (wallet_address, contract_index)
);

-- One row per proof upload + Gemini verification result. `day` is the UTC calendar day
-- (matches HabitManager's block.timestamp / 1 days bucketing) this proof counts toward.
create table habit_completions (
    id uuid primary key default gen_random_uuid(),
    wallet_address text not null references users (wallet_address) on delete cascade,
    contract_index int not null,
    day date not null,
    image_path text not null, -- Supabase Storage path
    verified boolean not null,
    confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
    reason text not null default '',
    onchain_tx_hash text, -- set once the backend relays completeHabit() on success
    created_at timestamptz not null default now(),
    unique (wallet_address, contract_index, day)
);

-- User's chosen consequence. Mirrors PenaltyEngine.configurePenalty() args for fast reads;
-- the contract call remains the source of truth for what actually executes.
create table penalty_configs (
    wallet_address text primary key references users (wallet_address) on delete cascade,
    penalty_type text not null check (penalty_type in ('save', 'donate', 'partner', 'surprise')),
    partner_address text check (partner_address = lower(partner_address)),
    amount_wei numeric(78, 0) not null default 0,
    updated_at timestamptz not null default now()
);

-- Audit log of HabitManager.settle() calls, written by the backend keeper after each call.
-- Powers the Progress Coach ("why is my wallet locked", streak cards) without an RPC round trip.
create table daily_settlements (
    id uuid primary key default gen_random_uuid(),
    wallet_address text not null references users (wallet_address) on delete cascade,
    day date not null,
    success boolean not null,
    resolved_penalty_type text check (resolved_penalty_type in ('save', 'donate', 'partner', 'surprise')),
    onchain_tx_hash text,
    created_at timestamptz not null default now(),
    unique (wallet_address, day)
);

-- Denormalized current-state cache, refreshed by the backend after every settlement so the
-- Progress Coach and dashboard don't need to call HabitManager on every page load.
create table streak_cache (
    wallet_address text primary key references users (wallet_address) on delete cascade,
    current_streak int not null default 0,
    longest_streak int not null default 0,
    completion_rate_bps int not null default 0,
    last_synced_day date,
    updated_at timestamptz not null default now()
);

-- Wallet-signature login. Backend issues a nonce, wallet signs it, backend verifies and
-- mints the session cookie. Nonces are single-use and short-lived.
create table auth_nonces (
    wallet_address text not null,
    nonce text primary key,
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
);

-- Chat history for the Progress Coach interface.
create table chat_messages (
    id uuid primary key default gen_random_uuid(),
    wallet_address text not null references users (wallet_address) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamptz not null default now()
);

create index habit_completions_wallet_day_idx on habit_completions (wallet_address, day desc);
create index daily_settlements_wallet_day_idx on daily_settlements (wallet_address, day desc);
create index chat_messages_wallet_created_idx on chat_messages (wallet_address, created_at desc);
create index auth_nonces_expires_idx on auth_nonces (expires_at);

alter table users enable row level security;
alter table habits enable row level security;
alter table habit_completions enable row level security;
alter table penalty_configs enable row level security;
alter table daily_settlements enable row level security;
alter table streak_cache enable row level security;
alter table auth_nonces enable row level security;
alter table chat_messages enable row level security;

-- Default-deny: no policies are created for the anon/authenticated roles. All access goes
-- through the service role (used exclusively by Next.js API routes), which bypasses RLS.
