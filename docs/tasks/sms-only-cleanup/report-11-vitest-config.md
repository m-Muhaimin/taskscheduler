# Report 11 — `apps/api/vitest.config.ts` (test-flake config)

Scope: one config-only change so the branch's "all tests green" evidence is trustworthy.
Status: **done, uncommitted.**

## File created

`apps/api/vitest.config.ts` — the only file created. Nothing else in the repo was modified.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20_000,
    maxWorkers: 4,
  },
});
```

(the shipped file carries comments recording the diagnosis and the measured cost of the
alternatives; the settings themselves are only the two above)

## Import style, and why

`import { defineConfig } from 'vitest/config'` + default export.

This is the established repo style, copied from the only sibling Vitest config in the
workspace, `packages/ai/vitest.config.ts`, which uses the identical form. Resolution was
checked before writing, as instructed:

- `apps/api/package.json` declares `vitest: ^3.2.3` in **its own** `devDependencies`, and
  `apps/api/node_modules/vitest` is a separate install pinned at **3.2.7** — distinct from
  the hoisted root `node_modules/vitest` at **5.0.1**. `npm run test --workspace=apps/api`
  resolves the v3 copy, so `defineConfig`'s types come from v3. `maxWorkers?: number | string`
  and `testTimeout` both confirmed present in the v3.2.7 type surface.

`test` settings only. No `globalSetup`, reporters, coverage, aliases, plugins, `include`,
or `environment` — the diagnosing agent found no DB/globalSetup need, and `include` /
`environment: 'node'` were deliberately left at their defaults so the discovered file set
and environment are bit-for-bit what they were before this change (default `include` still
finds the same 34 files).

## tsconfig note (the anticipated case — flagging, not restructuring)

`apps/api/tsconfig.json` sets `"include": ["src"]` and `"rootDir": "src"`. A root-level
`apps/api/vitest.config.ts` is therefore **outside the typecheck program** — it is not
typechecked by `npm run typecheck`, and adding it to `include` would be wrong anyway
(`rootDir: "src"` would then raise TS6059). Per the brief I did **not** restructure tsconfig.

Consequence: the `defineConfig` typing is validated at runtime by Vitest's own config load
rather than by `tsc`. This is not a silent-failure risk — Vitest errors loudly at startup on
an invalid config shape, and the config demonstrably loaded (both runs below executed under
it). The plain-default-export fallback was therefore not needed.

## Verification — exact numbers

### `npm run typecheck --workspace=apps/api` → **exit 0**

```
> @tradescheduler/api@0.1.0 typecheck
> tsc --noEmit
EXIT_CODE=0
```

### `npm run test --workspace=apps/api` — run 1 → **green**

```
 Test Files  34 passed (34)
      Tests  536 passed (536)
   Duration  24.13s (transform 2.54s, setup 0ms, collect 48.74s, tests 27.46s, environment 10ms, prepare 6.23s)
```

### `npm run test --workspace=apps/api` — run 2 (stability re-run) → **green**

```
 Test Files  34 passed (34)
      Tests  536 passed (536)
   Duration  14.89s (transform 2.14s, setup 0ms, collect 31.13s, tests 8.59s, environment 11ms, prepare 5.57s)
```

Two consecutive full-suite greens, same counts both times.

**On the test count: 536, not the 534 quoted in the brief.** The +2 is the concurrent
agent's in-flight work in `process-inbound-sms.test.ts`. No failure occurred in that file in
either run, so nothing to report there. Run 1's 24.13s vs run 2's 14.89s is cold-vs-warm
transform cache (run 1 `collect` 48.74s across workers vs 31.13s), not a regression.

## Confirmations

- Created exactly one file: `apps/api/vitest.config.ts` (`git status` shows a single `??`
  entry under `apps/api`).
- Zero tracked files modified by me — `git diff --stat` for the config is empty and the
  only untracked path in `apps/api` is the config itself. All other entries in
  `git status` were already dirty before I started and are the pre-existing
  uncommitted SMS-only change.
- No existing test file modified. `apps/web` untouched.
- Not committed, per the brief.
