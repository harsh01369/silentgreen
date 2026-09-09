# @silentgreen/web

The marketing site and the dashboard. Next.js App Router, deployed on Vercel.

## Local

```bash
cd apps/web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
npm run dev
```

The API (`apps/api`) must be running for auth and the dashboard to work.

## Deploy (Vercel)

- Root directory: `apps/web`
- Framework preset: Next.js (auto-detected)
- Environment variable: `NEXT_PUBLIC_API_URL` = the Railway API URL

The web app and the API should share a parent domain in production (for example
`silentgreen.dev` and `api.silentgreen.dev`) so the session cookie is sent on
`/v1` requests. Set `WEB_ORIGIN` on the API to the web app's URL.

## Design

Tokens live in `src/app/globals.css`. One material: `.glass`. The palette is
built around the three verdicts, with `unproven` a deliberately unsaturated
slate so it reads as withheld judgement rather than an error. The 3D hero
(`src/components/hero-scene.tsx`) loads after first paint and is skipped
entirely under reduced-motion.
