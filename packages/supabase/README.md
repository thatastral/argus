# @argus/supabase

Schema and migrations for Argus's Supabase project.

## Apply the migration

Via the Supabase CLI (recommended):

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste `migrations/0001_init.sql` directly into the Supabase SQL editor.

## Storage bucket

Create a `proofs` storage bucket (private) for habit-completion images uploaded via
`POST /api/verify`. The backend uses the service role key to read/write, so the bucket
does not need public policies.

## Auth model

No Supabase Auth (no email/OAuth). See the comment block at the top of
`migrations/0001_init.sql` — every table is RLS-enabled with no policies, so only the
service role (used server-side by `apps/web`) can read or write. The wallet-signature
login flow lives in `apps/web/app/api/auth/*`.
