import { defineConfig } from 'vitest/config';
import path from 'node:path';
const forcedBackend = process.env.IGNITE_LAB_FORCED_BACKEND;
if (forcedBackend !== undefined && forcedBackend !== 'icp' && forcedBackend !== 'supabase') {
  throw new Error('IGNITE_LAB_FORCED_BACKEND must be "icp" or "supabase"');
}

// Runs the original imported app test suite from `src/**/*.test.ts(x)`.
//
// These files are reference/unit tests only: none of them are part of the
// lab runtime bundle (see lab-runtime-files.json + check-isolation.mjs).
// Every test here either exercises pure logic/hooks/components in isolation,
// or is a "guard" test that statically inspects source text - none call
// real network endpoints or production Supabase (the Supabase client is
// always vi.mock'd/vi.doMock'd where imported). This config exists purely
// to run those pre-existing assertions; it does not add new product-domain
// backend wiring and must not be treated as proof of ICP canister parity -
// that is what frontend/lab-tests/imported-*-baseline.test.tsx covers.
export default defineConfig({
  cacheDir: '.lab-cache-legacy',
  define: { __IGNITE_LAB_FORCED_BACKEND__: JSON.stringify(forcedBackend ?? null) },
  resolve: { alias: { '@': path.resolve('src') } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Excluded: these test files assert against production infrastructure
    // that intentionally does not exist as live config in this lab repo -
    // running them would either fail on missing paths or require recreating
    // out-of-scope production/native surfaces (forbidden by the lab boundary):
    //  - Supabase Edge Function/deployment governance (supabase/config.toml,
    //    supabase/functions/*, supabase/migrations/*, promote-to-prod.yml).
    //    Backend source lives only as inert reference text under
    //    reference/backend and must not be treated as deployed config.
    //  - Native Capacitor app harnesses (Android/iOS OS resume tests) -
    //    native app signing/build tooling is explicitly out of scope.
    //  - Lab-disabled billing/checkout surfaces - member checkout is
    //    intentionally disconnected in this repo and must not be re-enabled
    //    just to satisfy imported production-payment tests.
    exclude: [
      '**/node_modules/**',
      'src/edge-functions/**/*.test.ts',
      'src/test/clubAnnouncementDiagnosability.guard.test.ts',
      'src/test/notificationDispatchPromotionSafety.test.ts',
      'src/test/parentInviteProvisioningSecurity.guard.test.ts',
      'src/test/promotionNotificationSafety.guard.test.ts',
      'src/test/androidOsHarness.guard.test.ts',
      'src/test/iosOsHarness.guard.test.ts',
      'src/pages/EditEventRecurringConversion.security.test.ts',
      'src/components/pitch/timerSchemaMarker.guard.test.ts',
      'src/lib/memberCheckout.test.ts',
    ],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.legacy.setup.ts'],
  },
});
