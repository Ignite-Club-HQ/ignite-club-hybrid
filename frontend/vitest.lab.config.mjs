import { defineConfig } from 'vitest/config';
import path from 'node:path';
const forcedBackend = process.env.IGNITE_LAB_FORCED_BACKEND;
if (forcedBackend !== undefined && forcedBackend !== 'icp' && forcedBackend !== 'supabase') {
  throw new Error('IGNITE_LAB_FORCED_BACKEND must be "icp" or "supabase"');
}
export default defineConfig({
  server: { host: '127.0.0.1' }, cacheDir: '.lab-cache',
  define: { __IGNITE_LAB_FORCED_BACKEND__: JSON.stringify(forcedBackend ?? null) },
  resolve: { alias: { '@': path.resolve('src') } },
  esbuild: { jsx: 'automatic' },
  test: { include: ['lab-tests/*.test.tsx'], environment: 'jsdom', globals: true },
});
