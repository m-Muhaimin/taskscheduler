# Step 0 — Project bootstrap

**Source:** docs/build-sequence.md Step 0
**Depends on:** nothing (repository state: root/apps/api/apps/web `package.json` exist; NO `packages/`, NO tsconfigs, NO src, NO `.env.example`, NO `.gitignore`, NO git repo)
**Gate on completion:** `npm install` succeeds; all workspaces build; API boots with no `.env` and answers `/api/health`; web renders placeholder; git repo has one clean commit. **Compiles-and-runs rule: nothing may be left broken, even temporarily, when this step is gated.**

## Environment facts (fixed, do not re-derive)

- Repo root: `H:\tradescheduling` (Git Bash: `/h/tradescheduling`)
- Node v24.15.0, npm 11.14.1, Git 2.54.0, Windows, Git Bash shell.
- Shell is **non-interactive**: no TTY, no pagers, no editors, no `git add -p`, no `npm init` prompts. Commands below are already non-interactive.
- All `package.json` deps in this repo are **exact-pinned** (no `^`/`~`). Any dependency added in later steps must use `--save-exact`.

## Global constraints in force for this step

1. **Exact pins only.** Do not change existing dependency versions in any `package.json` unless section "TS fallback rule" below triggers.
2. **No env at boot.** The API must boot and serve `/api/health` with **no `.env` file and no environment variables set**. Therefore: no source file may read `process.env` at module scope (the only allowed exception is `process.env.PORT` in `apps/api/src/index.ts`), and no external client (Twilio/Supabase/pg/Google) may be constructed at module scope. This is the "lazy client construction" rule — clients get constructed inside functions, when first used, in later steps.
3. **ESM + nodenext in `apps/api` and `packages/shared`.** All relative imports in those two workspaces MUST use explicit `.js` extensions (e.g. `import { x } from './app.js'`), because `"type": "module"` and `moduleResolution: "nodenext"` produce real ESM that Node runs directly. (Not needed in Step 0, but binding from here on.)
4. **No `composite: true` anywhere.** It conflicts with the required per-workspace `tsc --noEmit` verifies (TS error TS5074). The root `references` block is IDE-navigation scaffolding only; **`tsc -b` from the root is intentionally NOT part of any build/verify flow.** Do not "fix" this by adding `composite`.
5. **Reports over silence.** If any command fails, stop at the failing command, report the exact error, and do not paper over it (no `|| true`, no `2>/dev/null` on failing commands except where the script below says so).

## Files to create (7 config/source files; then git)

Repo-root-relative paths. Create exactly these; do not create anything else (no Tailwind config, no postcss config, no README, no tests, no `src` files beyond those listed).

### 1. `packages/shared/package.json` (new)

```json
{
  "name": "@tradescheduler/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
```

Notes (do not change):
- `@tradescheduler/shared` is the chosen name (decision record: docs/briefs/README.md). It must resolve as `node_modules/@tradescheduler/shared` via the npm workspace symlink — do not add `dependencies` entries for it anywhere yet.
- No `exports` map, no `main`: this package is **types-only**. It must only ever be imported with `import type`. The `types` field points directly at source.

### 2. `packages/shared/tsconfig.json` (new)

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2023",
    "lib": ["ES2023"],
    "noEmit": true
  },
  "include": ["src"]
}
```

### 3. `packages/shared/src/index.ts` (new)

Single line content:

```ts
// Placeholder for shared domain types. Step 1 replaces this with `export * from './types.js';`
```

### 4. `tsconfig.json` (root, new)

```json
{
  "files": [],
  "references": [
    { "path": "./apps/api" },
    { "path": "./apps/web" },
    { "path": "./packages/shared" }
  ],
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "target": "ES2023",
    "lib": ["ES2023"]
  }
}
```

Every child tsconfig extends this root. Child arrays/compilerOptions override as needed.

### 5. `apps/api/tsconfig.json` (new)

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### 6. `apps/web/tsconfig.json` (new) + `apps/web/next-env.d.ts` (new)

`apps/web/tsconfig.json` — Next 15 App Router shape, extending root:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next-env.d.ts` — exact content:

```
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

### 7. `apps/api/src/index.ts` (new)

Behavioral spec, exact semantics:

```ts
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
```

Semantics, must hold exactly:
- `GET /api/health` → HTTP 200, body exactly `{"status":"ok"}` (Express `res.json` serialization).
- Listens on `Number(process.env.PORT ?? 3001)` → default 3001; `PORT=4000` overrides.
- **No other routes. No middleware. No `process.env` reads besides `PORT`. No dotenv loading.** The app must start successfully with no `.env` and no env vars.
- Express 5.2.1 + `@types/express` 5.0.0, strict TS — this exact file compiles as-is.

### 8. `apps/web/src/app/layout.tsx` (new) — REQUIRED companion

Next 15 App Router **requires** a root layout; `page.tsx` alone fails `next build`. Exact content:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'tradescheduler',
  description: 'AI scheduling assistant for tradespeople',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Server component (no `"use client"`). No Tailwind classes (Tailwind is wired in a later step).

### 9. `apps/web/src/app/page.tsx` (new)

```tsx
export default function HomePage() {
  return (
    <main>
      <h1>tradescheduler</h1>
      <p>AI scheduling assistant for tradespeople.</p>
    </main>
  );
}
```

Server component. Placeholder only.

### 10. `.env.example` (root, new) — exact content

```
# ------------------------------------------------------------------
# tradescheduler environment template
# Copy to .env and fill in real values. Never commit .env.
#
# The API is designed to boot WITHOUT this file (no env at boot):
# external clients are constructed lazily, only when first used.
# ------------------------------------------------------------------

# Twilio (SMS)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Auth (dashboard JWT)
JWT_SECRET=

# Supabase (client + service-role access)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Postgres direct connection (job queue worker in Step 4)
DATABASE_URL=

# Google Calendar
GOOGLE_CALENDAR_CREDENTIALS=
GOOGLE_CALENDAR_ID=

# API port. The API reads process.env.PORT; default 3001.
# API_PORT=3001
```

### 11. `.gitignore` (root, new) — exact content

```
# dependencies
node_modules/

# environment (never commit secrets; .env.example is intentionally committed)
.env

# next.js
.next/

# build output
dist/

# test output
coverage/

# typescript
*.tsbuildinfo
```

## Execution sequence (in this order — order matters)

Run from repo root `/h/tradescheduler` (Git Bash). Stop-on-failure at every step.

```bash
# 0. Preflight: confirm the workspace gap is closed before install
ls packages/shared/package.json tsconfig.json apps/api/tsconfig.json apps/web/tsconfig.json

# 1. Install. Must exit 0. Warnings (engines/peer) are OK; errors are not.
npm install

# 2. Build all three workspaces. Must exit 0.
npm run build --workspaces
```

Expected build behavior per workspace (all three must succeed):
- `apps/api` (`tsc`) → emits `apps/api/dist/index.js` (ESM), exit 0, no output.
- `apps/web` (`next build`) → production build, `.next/` populated, exit 0. **If `next build` fails inside its type-check stage or `tsc` errors anywhere in a way that is NOT attributable to our code, apply the TS fallback rule below and re-run this step from `npm install` (package.json changed → reinstall).**
- `packages/shared` (`tsc`, `noEmit`) → type-checks the placeholder, exit 0.

```bash
# 3. Boot API from BUILT output, with NO .env and NO env vars, and health-check it.
node apps/api/dist/index.js &
API_PID=$!
sleep 2
curl -s -i http://localhost:3001/api/health
kill $API_PID
# Expect: HTTP/1.1 200 ... {"status":"ok"}
# Also assert nothing stale: the repo must contain no .env file right now:
test ! -f .env && echo "env-free boot confirmed"
```

If port 3001 is already in use ("EADDRINUSE"), stop and report — do not kill unknown processes.

```bash
# 4. Boot web from its production build and check the placeholder renders.
npm run start --workspace=apps/web &
WEB_PID=$!
ok=0
for i in $(seq 1 15); do
  code=$(curl -s -o /tmp/web.html -w "%{http_code}" http://localhost:3000 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 1
done
grep -q "tradescheduler" /tmp/web.html && echo "PLACEHOLDER RENDERED" || echo "PLACEHOLDER MISSING"
kill $WEB_PID
[ "$ok" = "1" ] || echo "WEB DID NOT COME UP"
# Expect: "PLACEHOLDER RENDERED" and ok=1
```

If port 3000 is busy, stop and report.

```bash
# 5. Initialize git and make the initial commit.
git init
git add .
git status --short
# Review: only intended files staged. In particular .env.example IS staged
# (it is not matched by the `.env` ignore pattern) and node_modules/.env/.next/dist are NOT.
git commit -m "chore: initial project scaffold"
git --no-pager log --oneline -1
```

- If the commit fails with a "Please tell me who you are" identity error, set **repo-local only** identity and retry:

```bash
git config user.name "tradescheduler-dev"
git config user.email "dev@tradescheduler.local"
git commit -m "chore: initial project scaffold"
```

- Post-commit sanity: `git status --short` must be empty. Anything unstaged/untracked after the commit is a failure to report.

## TS fallback rule (TERMS: triggers, action, record)

**Trigger:** any of these fails under TypeScript 7.0.2, with an error not caused by our own code:
- `npm run build --workspaces` (any workspace), or
- a later step's `tsc --noEmit` / `tsc` invocation, or
- `next build`'s type-check stage (TS 7.0.2 is the Go-native compiler with no stable programmatic API, so Next's internal type-checker importing `typescript` is the highest-risk spot).

**Action (non-interactive, exact):**

```bash
# 1. Find the newest 5.x stable the registry offers.
npm view typescript@5 version --json
# Take the LAST (highest) version string in that output, e.g. 5.9.3.

# 2. Pin it EXACTLY in every TypeScript workspace (must stay identical everywhere).
npm install --save-dev --save-exact typescript@<that-version> --workspace=apps/api --workspace=apps/web --workspace=packages/shared

# 3. Re-run from the top of this step (npm install, build, boot checks, git).
```

**Record:** append one line to `docs/ledger-briefs.md` under Step 0 Notes, e.g. `typescript pinned to 5.9.3 (7.0.2 failed: <one-line reason>)`, or `typescript 7.0.2 works — no fallback needed`. Also update the Typescript row in `docs/briefs/README.md`'s decision table to match reality. Do NOT silently keep a mixed set of versions — all four places (api, web, shared; root has none) must carry the same number.

## Where this fits

Step 0 turns an empty git-less workspace (two app package.json files, no `packages/`) into a compilable, bootable, committed monorepo. Every later brief builds on these exact tsconfigs, the env-free-boot rule, and the `@tradescheduler/shared` types-only package.

## Fits-gate checklist (all must hold before marking done in the ledger)

- [ ] `npm install` exit 0
- [ ] `npm run build --workspaces` exit 0 (all three workspaces)
- [ ] `curl http://localhost:3001/api/health` → 200 + `{"status":"ok"}`, booted with no `.env`
- [ ] web placeholder rendered (200 + page contains "tradescheduler")
- [ ] `git log --oneline -1` → `chore: initial project scaffold`; `git status --short` empty
- [ ] `.env.example` staged, no `.env`/`node_modules`/`.next`/`dist` staged
- [ ] TS outcome recorded in ledger (7.0.2 kept, or fallback version + reason)