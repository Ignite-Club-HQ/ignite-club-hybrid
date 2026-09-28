import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit and guard tests for the live application. Module resolution mirrors
// vite.live.config.ts so tests exercise the same live Supabase client and
// fail-closed replacements for removed lab-only runtime modules.
const src = path.resolve('src');
const disabledLabRuntime = path.join(src, 'live/disabledLabRuntime.ts');

export default defineConfig({
  cacheDir: '.vitest-cache',
  resolve: {
    alias: [
      { find: '@/integrations/supabase/client', replacement: path.join(src, 'integrations/supabase/liveClient.ts') },
      { find: '@/lab/internetIdentityAuth', replacement: path.join(src, 'live/internetIdentityAuth.ts') },
      { find: '@/lab/localRuntimeMode', replacement: path.join(src, 'live/localRuntimeMode.ts') },
      {
        find: /^@\/lab\/(fixtureDataLayer|localActor|localCompetitionService|localEventsService|localIdentityAccess|localMediaMetadata|localMessagingService|syntheticIdentities\.mjs)$/,
        replacement: disabledLabRuntime,
      },
      { find: '@', replacement: src },
    ],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Synthetic, non-routable values so modules that build the live target
    // registry can load; tests mock the Supabase client instead of calling it.
    env: {
      IGNITE_LIVE_SUPABASE_ALIAS: 'test',
      IGNITE_LIVE_SUPABASE_URL: 'https://example.invalid',
      IGNITE_LIVE_SUPABASE_ANON_KEY: 'synthetic-public-anon-key',
      IGNITE_LIVE_ICP_HOST: 'https://icp-api.io',
      IGNITE_LIVE_ICP_CANISTER_IDS_JSON: '{}',
    },
    // These source-inspection guards read Supabase migrations/functions,
    // native Capacitor harnesses or deploy workflows that are not part of
    // this repository yet. Re-enable each one when its source is added.
    exclude: [
      '**/node_modules/**',
      'src/pages/EditEventRecurringConversion.security.test.ts',
      'src/test/androidOsHarness.guard.test.ts',
      'src/test/iosOsHarness.guard.test.ts',
      'src/test/clubAnnouncementDiagnosability.guard.test.ts',
      'src/test/notificationDispatchPromotionSafety.test.ts',
      'src/test/parentInviteProvisioningSecurity.guard.test.ts',
      'src/test/promotionNotificationSafety.guard.test.ts',
      'src/test/parentInviteAtomicAcceptance.guard.test.ts',
      'src/components/pitch/timerSchemaMarker.guard.test.ts',
      // Member checkout stays disconnected until billing is separately approved.
      'src/lib/memberCheckout.test.ts',
    ],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.legacy.setup.ts'],
  },
});
