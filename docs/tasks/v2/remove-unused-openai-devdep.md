# Remove unused `openai` devDependency from packages/ai

## Status

**Backlog.** Follow-up from final review of `chore/llm-layer-fix`
(Checkpoint 01 campaign, merged to main as ac10840). Minor finding #1.

## Current state

`packages/ai/package.json` line 23 declares `"openai": "^4.0.0"` in
`devDependencies`, but no source file in `packages/ai` imports the
`openai` package. The three adapters
(`src/providers/openai-adapter.ts`, `ollama-llm.ts`, `census-llm.ts`)
all talk to their providers with raw `fetch` via an internal `post()`
helper — the OpenAI SDK is not used anywhere in the package.

Verified at ticket time (repro):
```bash
grep -rn "from ['\"]openai\|require('openai')" packages/ai/src   # no matches
```

## Target

Remove `"openai": "^4.0.0"` from `packages/ai/package.json`
(`devDependencies`), then `npm install` to refresh the root lockfile.

## Why this is a real (small) change

- Dead dependency — declares a runtime SDK the code never loads as a
  dependency in the wrong section (a provider SDK is a runtime dep if
  used at all, not a devDep).
- Keeps `npm audit` noise down (openai pulls a sizeable transitive
  tree, including the `uuid` moderate chain noted in CLAUDE.md).
- If a future provider conversion moves adapters onto SDK-based
  calls, add it back as a proper **runtime** dependency then.

## What it touches

- `packages/ai/package.json` (1 line)
- `package-lock.json` (root regenerate)
- Verify: `npx -w packages/ai tsc --noEmit` clean,
  `npx vitest run packages/ai` still 31/31.
