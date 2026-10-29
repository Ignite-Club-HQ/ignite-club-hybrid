// Explicit preparation adapter; existing prod build commands remain unchanged.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertMainDevOnly } from './prod-main-dev-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveProdHybridEnv(env) {
  assertMainDevOnly(env);
  if (env.IGNITE_BUILD_TARGET !== 'hybrid') throw new Error('Explicit IGNITE_BUILD_TARGET=hybrid is required.');
  const expected = env.IGNITE_EXPECTED_SUPABASE_URL?.trim();
  if (!expected) throw new Error('IGNITE_EXPECTED_SUPABASE_URL must identify the independently verified target.');
  const parsed = new URL(expected);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('The verified target must be an HTTPS origin.');
  }
  const urls = ['VITE_SUPABASE_URL', 'SUPABASE_URL', 'IGNITE_LIVE_SUPABASE_URL'].map(k => env[k]?.trim()).filter(Boolean);
  if (!urls.length || urls.some(value => new URL(value).href !== parsed.href)) throw new Error('Missing or conflicting Supabase targets; no fallback is allowed.');
  const keys = ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'IGNITE_LIVE_SUPABASE_ANON_KEY'].map(k => env[k]?.trim()).filter(Boolean);
  if (!keys.length || keys.some(value => value !== keys[0])) throw new Error('Missing or conflicting public Supabase keys.');
  const key = keys[0];
  if (key.startsWith('sb_secret_')) throw new Error('A private Supabase key cannot enter a browser build.');
  if (!key.startsWith('sb_publishable_')) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString()); }
    catch { throw new Error('A public publishable or anon key is required.'); }
    if (payload.role !== 'anon') throw new Error('Only an anon key can enter a browser build.');
    const project = parsed.hostname.split('.')[0];
    if (parsed.hostname.endsWith('.supabase.co') && payload.ref !== project) throw new Error('The anon key belongs to another project.');
  }
  if (['1', 'true', 'yes'].includes((env.IGNITE_LIVE_ICP_ONLY || '').toLowerCase())) throw new Error('Production hybrid verification cannot skip Supabase.');
  return { ...env, IGNITE_LIVE_BUILD: '1', IGNITE_LIVE_SUPABASE_URL: parsed.origin, IGNITE_LIVE_SUPABASE_ANON_KEY: key };
}

export function runProdHybridBuild(env, execute, publish) {
  const verified = resolveProdHybridEnv(env);
  for (const step of ['config', 'install', 'guards', 'build']) {
    if (execute(step, verified) !== 0) throw new Error(`Hybrid ${step} failed; existing output is untouched.`);
  }
  publish();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const frontend = path.join(root, 'frontend');
    runProdHybridBuild(process.env, (step, env) => {
      const files = {
        config: path.join(frontend, 'scripts/check-live-config.mjs'),
        install: path.join(root, 'scripts/ensure-frontend-deps.mjs'),
        guards: path.join(frontend, 'scripts/check-icp-guards.mjs'),
        build: path.join(frontend, 'node_modules/vite/bin/vite.js'),
      };
      const args = [files[step], ...(step === 'build' ? ['build', '--config', 'vite.live.config.ts', '--mode', 'live'] : [])];
      const result = spawnSync(process.execPath, args, { cwd: frontend, env, stdio: 'inherit' });
      if (result.error) throw result.error;
      return result.status ?? 1;
    }, () => {
      const source = path.join(frontend, 'dist-live');
      if (!existsSync(path.join(source, 'live-index.html'))) throw new Error('Hybrid app shell is absent; existing output is untouched.');
      const target = path.join(root, 'dist');
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true });
      cpSync(path.join(source, 'live-index.html'), path.join(target, 'index.html'));
      // Keep retained production public assets, including share/deep-link files.
      if (existsSync(path.join(root, 'public'))) cpSync(path.join(root, 'public'), target, { recursive: true, force: false });
    });
  } catch (error) {
    // Do not print environment values or keys on failure.
    console.error(error.message);
    process.exitCode = 1;
  }
}