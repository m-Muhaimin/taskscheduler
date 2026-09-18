# Next.js Upgrade Plan: 15.5.25 → 16.x

## Status

**Deferred.** Not started. The high-severity `postcss` CVE chain
(GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849,
GHSA-qx2v-qp2m-jg93) is only fixed by bumping Next.js to ≥16.3.5,
which is a semver-major jump. `npm audit fix --force` would do this
unreviewed — we won't do that. This doc captures what the upgrade
would touch so it can be scheduled and reviewed properly.

## Current state

| Package | Version in repo | Source |
|---------|----------------|--------|
| next | 15.5.25 | apps/web/package.json line 19 |
| react | 19.3.0 | apps/web/package.json line 22 |
| typescript | 5.9.3 | apps/api + apps/web |
| postcss (repo-managed) | 8.5.28 | apps/web/package.json line 38 (devDep) |
| postcss (bundled by next) | 8.4.31 | next 15.5.25 internal dep |

The `postcss` vulnerability hits the `next/node_modules/postcss`
tree (8.4.31), which is the version Next.js 15 bundles internally.
The repo's own `postcss@8.5.28` in `apps/web/devDependencies` is
already above the CVE threshold — it is not the vulnerable copy.

## Target

Next.js 16.3.5 or later (the earliest version pulling in
postcss ≥8.5.23). At time of writing:
- `next@16.3.5` is latest stable 16.
- `react@19.3.0` is current — React 19 is compatible with Next 16.
- No React major bump required.

## Why this is a real change, not a patch

`npm audit fix --force` would change `"next": "15.5.25"` →
`"next": "16.3.5"` in `apps/web/package.json` and rewrite the lockfile.
That is a major-version upgrade. Next.js major bumps carry real
breaking changes; we treat this like any other major dep upgrade and
scope it deliberately.

## Files likely affected

- `apps/web/package.json` — `"next": "15.5.25"` → `"next": "16.x.y"`.
- `apps/web/next.config.ts` — currently minimal (only an `/api`
  rewrite). Next 16 may deprecate config keys; review against the
  16 migration guide before bumping.
- `apps/web/middleware.ts` — not present today (no middleware file).
  If added later, Next 16 middleware runtime may differ.
- `apps/web/src` — any direct use of deprecated Next APIs. The grep
  below lists files importing from `next/*`; most are standard App
  Router primitives that survive across 15→16, but each should be
  checked against the 16 changelog. Files found:
  - `app/dashboard/jobs/[jobId]/page.tsx` — `next/link`
  - `app/dashboard/page.tsx` — `next/link`
  - `app/dashboard/week/page.tsx` — `next/link`
  - `app/layout.tsx` — `next/font/google` (Outfit, Raleway)
  - `app/login/page.tsx` — `next/link`
  - `app/register/page.tsx` — `next/link`
  - `components/app-sidebar.tsx` — `next/link`
  - `components/job-card.tsx` — `next/link`
- `apps/web/tests/session-core.test.mts` — the web test runner is a
  standalone `tsx` script, not Vitest. Re-run after the bump to
  confirm it still passes.
- `package-lock.json` — full re-resolve of the web workspace.

## Known risks

1. **postcss nesting source**: if anything in the build still depends
   on the older postcss behavior bundled inside Next 15, the upgrade
   could shift CSS output. Tailwind 4 + `@tailwindcss/postcss` is the
   active postcss pipeline; confirm Tailwind's peer postcss range is
   compatible with 8.5.23+ before merging.
2. **`next/font/google`**: font loading behavior changes across majors
   are rare but possible; verify the Outfit/Raleway fonts still load
   after the bump.
3. **App Router internals**: Next 16 may change server component
   boundaries, `generateStaticParams`, or route segment config. Run
   `next build` on the upgraded tree and fix any new warnings before
   treating this as done.
4. **Lockfile scope**: this is a workspace — upgrading `apps/web`'s
   `next` re-resolves shared transitive deps across the monorepo.
   Watch for unrelated bumps to the API workspace's tree.

## Non-goals for this upgrade

- Not switching to the Next.js built-in Tailwind killer or changing the
  styling pipeline beyond whatever postcss version ships.
- Not migrating off `@tailwindcss/postcss` / Tailwind 4.
- Not touching the API workspace's dependencies (googleapis, twilio,
  etc.) in the same commit — that's a separate concern.

## Suggested sequence

1. Read the official Next 16 upgrade guide / blog post for 15→16.
2. Run `npm install next@16.3.5 --workspace=apps/web` in a branch.
3. Run `npx tsc --noEmit` under `apps/web` (and `apps/api`) — confirm
   no new type errors.
4. Run `npm run build --workspace=apps/web` — confirm the build
   completes and the postcss warning is gone from `npm audit`.
5. Run `apps/web/tests/session-core.test.mts` — confirm the session
   core test passes.
6. If anything breaks, decide per-issue whether to fix, pin, or hold.
7. Commit with a clear message once the build and tests are green.

## Decision record

- **Chosen approach**: document now, upgrade later as a planned major
  dep bump, not via `npm audit fix --force`.
- **Owner**: unowned. Flagged for scheduling once the core SMS/booking
  flow is verified end-to-end (see V2 Priority 3 gate).
- **Related audit item**: `npm audit` — postcss high-severity chain,
  tracked here rather than fixed by force.
