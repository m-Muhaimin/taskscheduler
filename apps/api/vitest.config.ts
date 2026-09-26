import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 15 test files `await import()` inside the test body (the vi.resetModules()
    // house pattern), so module-transform cost is charged against testTimeout.
    // `require('googleapis')` alone measured 913 ms / 545 surfaces, parking the
    // first test of google-auth-service.test.ts and process-inbound-sms.test.ts
    // at 2.2-2.9 s of the default 5000 ms budget while the other 532 tests each
    // finish in <=258 ms. Under parallel load that slope reached ~4.75 s and
    // timed out, which also produced a misleading "spy called 2 times" cascade
    // from the timed-out test's in-flight work firing after the next test's
    // mockReset(). Budget for the transform, not just the assertions.
    testTimeout: 20_000,
    // Default is availableParallelism() - 1 (7 forks on this host). Capping at 4
    // is the cheap fix: testTimeout alone costs +2% wall clock, while
    // maxWorkers: 2 costs +48% and fileParallelism: false costs +136%.
    maxWorkers: 4,
  },
});
