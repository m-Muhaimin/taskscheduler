# Deploying to Render (RidgeLine production)

Infrastructure-as-code lives in the repo-root `render.yaml` (Render Blueprints).
Provisioning creates three services:

| Service | Type | Runs |
|---|---|---|
| `ridgeline-api` | Web | Express API, `dist/index.js`, health `/api/health` |
| `ridgeline-worker` | Background worker | SMS poll loop, `dist/worker/index.js` |
| `ridgeline` | Web | Next.js app, proxies `/api/*` to the API |

`preDeployCommand` runs `npm run db:migrate` (idempotent SQL, all `IF NOT EXISTS`)
before the API and worker start, so the schema is current on every deploy.

## One-time setup (after the first push)

1. **Connect the repo**
   Dashboard → New → Blueprint → this GitHub repo (`m-Muhaimin/taskscheduler`).
   Render reads `render.yaml` and creates the three services.

2. **Fill the secret env vars** (all declared `sync: false` — the dashboard
   prompts for them; **they are never committed**). Values come from your
   existing `.env`:

   - `DATABASE_URL` — **Internal** Database URL of the existing Render Postgres
     (`dpg-dan0l6h42hec73cp2s50-a`). In the database dashboard it is the one
     whose host is `dpg-dan0l6h42hec73cp2s50-a` (no `.com` suffix). Do **not**
     use the external `.render.com` URL; the worker and API run on Render's
     internal network.
   - `JWT_SECRET` — same value as local `.env` (logins carry 7-day cookies; a
     changed secret invalidates them).
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — from
     `.env` / Twilio console.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from your Google OAuth
     credentials.
   - `GOOGLE_REDIRECT_URI` — see step 3. Leave blank on first deploy.

3. **After the API service gets its URL** (first deploy assigns
   `https://ridgeline-api-<suffix>.onrender.com`), set on **both** `ridgeline-api`
   and `ridgeline-worker`:

   ```
   GOOGLE_REDIRECT_URI=https://ridgeline-api-<suffix>.onrender.com/api/auth/google/callback
   ```

   Add the exact same URI to the Google Cloud OAuth consent screen for this
   client (Authorized redirect URIs). Then redeploy.

4. **Point Twilio at the webhook**
   Twilio console → your phone number → Messaging → A message comes in:
   ```
   https://ridgeline-api-<suffix>.onrender.com/api/twilio/webhooks
   ```
   (HTTP POST; the app verifies the Twilio X-Twilio-Signature header.)

5. **Verify deploy health**
   - `curl https://ridgeline-api-<suffix>.onrender.com/api/health` → `{"status":"ok"}`
   - Open `https://ridgeline-<suffix>.onrender.com` → login page renders.
   - Send a test SMS to the Twilio number → expect the auto-confirm flow.

## Environments (secrets the web app needs)

The Next.js app only needs `API_BASE_URL`, which `render.yaml` wires
automatically (`fromService` → `RENDER_EXTERNAL_URL` of the API). Previews
inherit it, so PR previews proxy to the same API — fine for UI work.

## Notes

- **Region**: blueprint defaults to `oregon`; the Postgres instance must be in
  the same region for internal-hostname connections. Verify the database's
  region in its dashboard (if it differs, change `region:` in render.yaml).
- **Nodes/runtime**: Render picks its default Node LTS; the API requires Node
  ≥ 20.12 (`process.loadEnvFile`). Pin a newer LTS in the service settings if
  the default is older.
- **Migrations are idempotent** (`IF NOT EXISTS` everywhere), so running
  `db:migrate` on every deploy is safe.
- **Worker and web service restart**: the worker polls at 1s; a deploy
  restarts it harmlessly. Builds cannot write secrets to the repo — the
  dashboard values are re-applied on every sync.

## Local development is unaffected

`render.yaml` and this doc do not change the local `dev` flow (`.env` at repo
root, embedded Postgres on `:5433`). Do **not** set `DATABASE_URL` in `.env`
to the Render URL — that would point local dev at production data.
