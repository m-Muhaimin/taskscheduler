# Align `vitest` devDependency in packages/ai with repo standard

## Status

**Backlog.** Follow-up from final review of `chore/llm-layer-fix`
(Checkpoint 01 campaign, merged to main as ac10840). Minor finding #2.

## Current state

| Where | Declared | Reality |
|-------|----------|---------|
| `packages/ai/package.json` line 25 | `vitest: ^2.0.0` | tests execute under **root vitest 5.0.1** via npm workspaces hoisting |
| repo root `package.json` | `vitest: ^5.0.1` | the runner that actually runs `npx vitest run packages/ai` |
| `apps/api/package.json` line 36 | `vitest: ^3.2.3` | also skews from root, but api tests pass under root's 5 |

The `packages/ai` declaration is the stale one — **^2.0.0** predates the
workspace consolidation and misleads anyone running the package's
tests standalone (they would get a vitest 2 runner, different API
surface than what CI/root actually uses).

## Target

Set `packages/ai/package.json` `devDependencies.vitest` to `^5.0.1`
to match the root, then `npm install` to refresh the root lockfile.
(Optional but recommended while there: align `apps/api` to `^5.0.1`
too, in a separate commit.)

## Why this is a real (small) change

- One source of truth for the test runner across the monorepo.
- Prevents a future contributor from running the ai suite with a
  mismatched vitest major and hitting API differences (config,
  `vi`/mock surface) that don't exist in CI.

## What it touches

- `packages/ai/package.json` (1 line); optionally `apps/api/package.json` (1 line)
- `package-lock.json` (root regenerate)
- Verify: `npx vitest run packages/ai` → 31/31 under the aligned
  version; `npx vitest run` in `apps/api` → 195 pass + the 1
  known pre-existing `reschedule-service` failure.
