# @silentgreen/api

The hosted verification service. Imports the engine from the repo root, adds
Neon storage, Better Auth identity, and the ingest API.

## Local

```bash
cd apps/api
npm install
cp .env.example .env      # fill in DATABASE_URL and BETTER_AUTH_SECRET
npx @better-auth/cli@latest generate   # reconcile schema.ts with the installed version
npm run db:generate                    # create the SQL migration
npm run db:migrate
npm run dev
```

## Deploy (Railway)

- Root directory: `apps/api`
- Build: `npm install` (the root engine is a `file:` dependency, so it builds via its
  `prepare` hook)
- Start: `npm run db:migrate && npm start`
- Variables: `DATABASE_URL` (Neon), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
  (the Railway public URL), `WEB_ORIGIN` (the Vercel URL)

## The one call

```bash
curl -X POST https://api.example/v1/batches \
  -H "x-api-key: sg_..." \
  -H "content-type: application/x-ndjson" \
  --data-binary @tasks.jsonl
```

Returns the summary, the per-kind counts, the ledger sequence and hash, and any
unreadable lines. The key carries the organisation; pass `project` (a slug) in
the body, or use a project-scoped key.

## What is stored

Per-task verdicts and a redacted description of each finding. On the free tier the
personal value inside a finding (an invented email, a snippet of output) is never
written: only its kind, its length, and whether it was found in the source. Full
evidence, encrypted, is a paid-tier addition.
