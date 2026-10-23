#!/usr/bin/env node
/**
 * migrate-github-repo.mjs — copy GitHub repo setup from this repo to another
 * (e.g. ignite-club-hq-prod) before a merge.
 *
 * What it can and cannot do:
 *  - GitHub NEVER returns secret values via any API. This tool lists secret
 *    NAMES on both repos, diffs them, and can SET secrets on the target from
 *    values you supply locally (env var or prompt). Values are never printed.
 *  - Actions VARIABLES are readable, so they are copied value-and-all.
 *  - Files (workflows, scripts, docs, anything tracked) are copied via git.
 *
 * Usage:
 *   export GITHUB_TOKEN=<PAT with repo + workflow scope on BOTH repos>
 *   export SOURCE_REPO=owner/ignite-canister-connect   (this repo)
 *   export TARGET_REPO=owner/ignite-club-hq-prod
 *
 *   node scripts/migrate-github-repo.mjs compare
 *   node scripts/migrate-github-repo.mjs copy-variables
 *   node scripts/migrate-github-repo.mjs copy-files [--path .github/workflows] [--path ...]
 *   node scripts/migrate-github-repo.mjs copy-secrets --from-env DEPLOYER_PEM,ICP_PUSH_WORKER_SEED
 *
 * copy-secrets reads each named value from your LOCAL environment and writes
 * it to the TARGET repo only. It never echoes values. It needs
 * libsodium-wrappers for GitHub's sealed-box encryption:
 *   npm install --no-save libsodium-wrappers   (run from repo root, or set
 *   NODE_PATH to anywhere that has it)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const API = 'https://api.github.com';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} environment variable`);
  return v;
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} failed [${res.status}]: ${text}`);
  }
  return json;
}

async function listAll(token, path, key) {
  const out = [];
  let page = 1;
  for (;;) {
    const data = await gh(token, 'GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = data?.[key] ?? [];
    out.push(...items);
    if (items.length < 100) return out;
    page += 1;
  }
}

export function diffNames(sourceNames, targetNames) {
  const target = new Set(targetNames);
  const source = new Set(sourceNames);
  return {
    missingInTarget: sourceNames.filter((n) => !target.has(n)),
    extraInTarget: targetNames.filter((n) => !source.has(n)),
    inBoth: sourceNames.filter((n) => target.has(n)),
  };
}

export function planFileCopy(paths) {
  // Default set: everything repo-level that the merge doc says must move.
  const defaults = ['.github/workflows'];
  const seen = new Set();
  const out = [];
  for (const p of [...defaults, ...paths]) {
    const clean = p.replace(/\/+$/, '');
    if (!clean || clean.startsWith('/') || clean.includes('..')) {
      throw new Error(`Refusing unsafe path: ${p}`);
    }
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

async function cmdCompare(token, source, target) {
  const [sSecrets, tSecrets, sVars, tVars, sWf, tWf] = await Promise.all([
    listAll(token, `/repos/${source}/actions/secrets`, 'secrets'),
    listAll(token, `/repos/${target}/actions/secrets`, 'secrets'),
    listAll(token, `/repos/${source}/actions/variables`, 'variables'),
    listAll(token, `/repos/${target}/actions/variables`, 'variables'),
    listAll(token, `/repos/${source}/actions/workflows`, 'workflows'),
    listAll(token, `/repos/${target}/actions/workflows`, 'workflows'),
  ]);
  const secretDiff = diffNames(sSecrets.map((s) => s.name), tSecrets.map((s) => s.name));
  const varDiff = diffNames(sVars.map((v) => v.name), tVars.map((v) => v.name));
  const wfDiff = diffNames(sWf.map((w) => w.path), tWf.map((w) => w.path));

  console.log('=== Secrets (names only — values are never readable) ===');
  console.log('missing in target:', secretDiff.missingInTarget.join(', ') || '(none)');
  console.log('already in both:  ', secretDiff.inBoth.join(', ') || '(none)');
  console.log('extra in target:  ', secretDiff.extraInTarget.join(', ') || '(none)');
  console.log('\n=== Variables ===');
  console.log('missing in target:', varDiff.missingInTarget.join(', ') || '(none)');
  console.log('extra in target:  ', varDiff.extraInTarget.join(', ') || '(none)');
  console.log('\n=== Workflow files ===');
  console.log('missing in target:', wfDiff.missingInTarget.join(', ') || '(none)');
  console.log('extra in target:  ', wfDiff.extraInTarget.join(', ') || '(none)');
  return { secretDiff, varDiff, wfDiff };
}

async function cmdCopyVariables(token, source, target) {
  const sVars = await listAll(token, `/repos/${source}/actions/variables`, 'variables');
  const tVars = await listAll(token, `/repos/${target}/actions/variables`, 'variables');
  const existing = new Map(tVars.map((v) => [v.name, v]));
  for (const v of sVars) {
    if (existing.has(v.name)) {
      await gh(token, 'PATCH', `/repos/${target}/actions/variables/${encodeURIComponent(v.name)}`, { name: v.name, value: v.value });
      console.log(`updated variable ${v.name}`);
    } else {
      await gh(token, 'POST', `/repos/${target}/actions/variables`, { name: v.name, value: v.value });
      console.log(`created variable ${v.name}`);
    }
  }
  if (sVars.length === 0) console.log('source repo has no variables');
}

async function sealSecret(publicKey, value) {
  let sodium;
  try {
    const mod = await import('libsodium-wrappers');
    sodium = mod.default ?? mod;
    await sodium.ready;
  } catch {
    throw new Error(
      'libsodium-wrappers not found. Run: npm install --no-save libsodium-wrappers (repo root), then retry.',
    );
  }
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

async function cmdCopySecrets(token, source, target, names) {
  const sSecrets = await listAll(token, `/repos/${source}/actions/secrets`, 'secrets');
  const sourceNames = new Set(sSecrets.map((s) => s.name));
  const keyInfo = await gh(token, 'GET', `/repos/${target}/actions/secrets/public-key`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (const name of names) {
    if (!sourceNames.has(name)) {
      console.log(`skip ${name}: not a secret on the source repo`);
      continue;
    }
    let value = process.env[name];
    if (!value) {
      value = await rl.question(`Enter value for ${name} (input hidden from logs, never echoed back): `);
    }
    if (!value) {
      console.log(`skip ${name}: no value supplied`);
      continue;
    }
    const encrypted = await sealSecret(keyInfo.key, value);
    await gh(token, 'PUT', `/repos/${target}/actions/secrets/${encodeURIComponent(name)}`, {
      encrypted_value: encrypted,
      key_id: keyInfo.key_id,
    });
    console.log(`set secret ${name} on target`);
  }
  rl.close();
}

function cmdCopyFiles(source, target, paths, token) {
  const planned = planFileCopy(paths);
  const dir = mkdtempSync(join(tmpdir(), 'repo-migrate-'));
  try {
    const auth = token ? `x-access-token:${token}@` : '';
    const run = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    run(['clone', '--depth', '1', `https://${auth}github.com/${source}.git`, 'source'], dir);
    run(['clone', '--depth', '1', `https://${auth}github.com/${target}.git`, 'target'], dir);
    const srcDir = join(dir, 'source');
    const dstDir = join(dir, 'target');
    for (const p of planned) {
      execFileSync('cp', ['-a', join(srcDir, p), join(dstDir, p)], { stdio: 'inherit' });
      console.log(`copied ${p}`);
    }
    run(['add', '-A'], dstDir);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dstDir, encoding: 'utf8' });
    if (!status.trim()) {
      console.log('no file differences — nothing to commit');
      return;
    }
    run(['-c', 'user.name=repo-migrate', '-c', 'user.email=repo-migrate@local',
      'commit', '-m', `Migrate repo setup from ${source}\n\nPaths: ${planned.join(', ')}`], dstDir);
    run(['push'], dstDir);
    console.log('pushed to target repo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const paths = [];
  let fromEnv = null;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--path') { paths.push(rest[++i]); }
    else if (rest[i] === '--from-env') { fromEnv = rest[++i]; }
    else throw new Error(`Unknown argument: ${rest[i]}`);
  }

  if (!command || command === 'help' || command === '--help') {
    console.log('Commands: compare | copy-variables | copy-files [--path P]... | copy-secrets --from-env NAME,NAME');
    console.log('Env: GITHUB_TOKEN, SOURCE_REPO=owner/repo, TARGET_REPO=owner/repo');
    return;
  }

  const token = requireEnv('GITHUB_TOKEN');
  const source = requireEnv('SOURCE_REPO');
  const target = requireEnv('TARGET_REPO');

  switch (command) {
    case 'compare':
      await cmdCompare(token, source, target);
      break;
    case 'copy-variables':
      await cmdCopyVariables(token, source, target);
      break;
    case 'copy-files':
      cmdCopyFiles(source, target, paths, token);
      break;
    case 'copy-secrets': {
      if (!fromEnv) throw new Error('copy-secrets needs --from-env NAME,NAME (values read from your local env, or prompted)');
      await cmdCopySecrets(token, source, target, fromEnv.split(',').map((s) => s.trim()).filter(Boolean));
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
