/**
 * Rule-based intent parser (build-sequence.md Step 5).
 *
 * Canonical implementation now lives in `@tradescheduler/shared`
 * (packages/shared/src/intent-parser.ts), moved there in Checkpoint 01 so the
 * LLM fallback in packages/ai can use it without depending on apps/api.
 *
 * This module re-exports it so existing apps/api consumers keep their import
 * path (`./intent-service.js`). Do not fork the parser here — edit the shared
 * copy so the LLM fallback and the worker never drift apart.
 */
export { parseIntent } from '@tradescheduler/shared';
