import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const repoRoot = path.resolve(root, '..');

const required = [
  'netlify.toml',
  'frontend/package.json',
  'frontend/vite.config.ts',
  'frontend/lab-runtime-files.json',
  'frontend/scripts/check-isolation.mjs',
  'frontend/scripts/check-production-secrets.mjs',
];

for (const file of required) {
  const target = path.resolve(repoRoot, file);
  if (!fs.existsSync(target)) {
    throw new Error(`Required staging artifact missing: ${file}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8'));
const hasBuild = !!pkg.scripts?.build;
if (!hasBuild) {
  throw new Error('Frontend package is missing a build script.');
}

console.log('Staging deployment configuration is valid.');
console.log('Netlify target: static frontend build with local ICP-only runtime guardrails.');
console.log('Private staging requirement: deploy only after synthetic provider workers are registered and scoped.');
