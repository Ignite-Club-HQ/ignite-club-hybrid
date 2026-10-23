#!/usr/bin/env node
/**
 * migrate-github-repo.mjs — copy GitHub repo setup from this repo to another
 * (e.g. ignite-club-hq-prod) before a merge.
 *
 * Safety model (strong protection for the target repo):
 *  - NOTHING on the target is ever deleted. Secrets and variables are only
 *    created or (with --overwrite) updated; files are only added or (with
 *    --overwrite) replaced — `git add` is scoped to the copied paths, never
 *    `-A`, so target-only files cannot be removed.
 *  - Default mode is SKIP-IF-EXISTS: an existing target secret, variable or
 *    differing file is left untouched and reported. Replacing anything
 *    requires the explicit `--overwrite` flag.
 *  - GitHub NEVER returns secret values via any API. This tool lists secret
 *    NAMES on both repos, diffs them, and can SET secrets on the target from
 *    values you supply locally (env var or prompt). Values are never printed.
 *
 * Usage:
 *   export GITHUB_TOKEN=<PAT with repo + workflow scope on BOTH repos>
 *   export SOURCE_REPO=owner/ignite-canister-connect   (this repo)
 *   export TARGET_REPO=owner/ignite-club-hq-prod
 *
 *   node scripts/migrate-github-repo.mjs compare
 *   node scripts/migrate-github-repo.mjs copy-variables [--overwrite]
 *   node scripts/migrate-github-repo.mjs copy-files [--path P]... [--overwrite]
 *   node scripts/migrate-github-repo.mjs copy-secrets --from-env NAME,NAME [--overwrite]
 *
 * copy-secrets reads each named value from your LOCAL environment and writes
 * it to the TARGET repo only. It never echoes values. It needs
 * libsodium-wrappers for GitHub's sealed-box encryption:
 *   npm install --no-save libsodium-wrappers   (run from repo root, or set
 *   NODE_PATH to anywhere that has it)
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
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

export function parseFlags(args) {
  const paths = [];
  let fromEnv = null;
  let overwrite = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--path') { paths.push(args[++i]); }
    else if (args[i] === '--from-env') { fromEnv = args[++i]; }
    else if (args[i] === '--overwrite') { overwrite = true; }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return { paths, fromEnv, overwrite };
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

async function cmdCopyVariables(token, source, target, overwrite) {
  const sVars = await listAll(token, `/repos/${source}/actions/variables`, 'variables');
  const tVars = await listAll(token, `/repos/${target}/actions/variables`, 'variables');
  const existing = new Map(tVars.map((v) => [v.name, v]));
  for (const v of sVars) {
    if (existing.has(v.name)) {
      if (!overwrite) {
        console.log(`skip variable ${v.name}: already exists on target (use --overwrite to replace)`);
        continue;
      }
      await gh(token, 'PATCH', `/repos/${target}/actions/variables/${encodeURIComponent(v.name)}`, { name: v.name, value: v.value });
      console.log(`overwrote variable ${v.name}`);
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

async function cmdCopySecrets(token, source, target, names, overwrite) {
  const sSecrets = await listAll(token, `/repos/${source}/actions/secrets`, 'secrets');
  const sourceNames = new Set(sSecrets.map((s) => s.name));
  const tSecrets = await listAll(token, `/repos/${target}/actions/secrets`, 'secrets');
  const targetNames = new Set(tSecrets.map((s) => s.name));
  const keyInfo = await gh(token, 'GET', `/repos/${target}/actions/secrets/public-key`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (const name of names) {
    if (!sourceNames.has(name)) {
      console.log(`skip ${name}: not a secret on the source repo`);
      continue;
    }
    if (targetNames.has(name) && !overwrite) {
      console.log(`skip ${name}: already exists on target (use --overwrite to replace)`);
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
    console.log(`${targetNames.has(name) ? 'overwrote' : 'set'} secret ${name} on target`);
  }
  rl.close();
}

function listFilesRecursive(rootAbs, baseAbs) {
  const out = [];
  const st = statSync(rootAbs);
  if (st.isFile()) return [relative(baseAbs, rootAbs)];
  for (const entry of readdirSync(rootAbs)) {
    const abs = join(rootAbs, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...listFilesRecursive(abs, baseAbs));
    } else {
      out.push(relative(baseAbs, abs));
    }
  }
  return out;
}

function cmdCopyFiles(source, target, paths, token, overwrite) {
  const planned = planFileCopy(paths);
  const dir = mkdtempSync(join(tmpdir(), 'repo-migrate-'));
  try {
    const auth = token ? `x-access-token:${token}@` : '';
    const run = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    run(['clone', '--depth', '1', `https://${auth}github.com/${source}.git`, 'source'], dir);
    run(['clone', '--depth', '1', `https://${auth}github.com/${target}.git`, 'target'], dir);
    const srcDir = join(dir, 'source');
    const dstDir = join(dir, 'target');

    const conflicts = [];
    let copied = 0;
    for (const p of planned) {
      const srcAbs = join(srcDir, p);
      if (!existsSync(srcAbs)) {
        console.log(`skip ${p}: not present in source checkout`);
        continue;
      }
      for (const rel of listFilesRecursive(srcAbs, srcDir)) {
        const dstAbs = join(dstDir, rel);
        if (existsSync(dstAbs)) {
          if (readFileSync(dstAbs).equals(readFileSync(join(srcDir, rel)))) continue;
          if (!overwrite) {
            conflicts.push(rel);
            continue;
          }
          console.log(`overwriting file ${rel}`);
        }
        mkdirSync(dirname(dstAbs), { recursive: true });
        copyFileSync(join(srcDir, rel), dstAbs);
        copied += 1;
      }
    }
    if (conflicts.length > 0) {
      console.log(`skipped ${conflicts.length} existing differing file(s) (use --overwrite to replace):`);
      for (const c of conflicts) console.log(`  ${c}`);
    }

    // Stage ONLY the copied top-level paths — never `git add -A`, so files
    // that exist only on the target can never be deleted.
    run(['add', '--', ...planned], dstDir);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dstDir, encoding: 'utf8' });
    if (!status.trim()) {
      console.log('no file differences — nothing to commit');
    } else {
      run(['-c', 'user.name=repo-migrate', '-c', 'user.email=repo-migrate@local',
        'commit', '-m', `Migrate repo setup from ${source}\n\nPaths: ${planned.join(', ')}`], dstDir);
      run(['push'], dstDir);
      console.log(`pushed ${copied} file(s) to target repo`);
    }
    if (conflicts.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    console.log('Commands: compare | copy-variables | copy-files [--path P]... | copy-secrets --from-env NAME,NAME');
    console.log('Flags: --overwrite (replace existing target secrets/variables/files; default is skip-if-exists)');
    console.log('Env: GITHUB_TOKEN, SOURCE_REPO=owner/repo, TARGET_REPO=owner/repo');
    return;
  }

  const { paths, fromEnv, overwrite } = parseFlags(rest);
  const token = requireEnv('GITHUB_TOKEN');
  const source = requireEnv('SOURCE_REPO');
  const target = requireEnv('TARGET_REPO');

  switch (command) {
    case 'compare':
      await cmdCompare(token, source, target);
      break;
    case 'copy-variables':
      await cmdCopyVariables(token, source, target, overwrite);
      break;
    case 'copy-files':
      cmdCopyFiles(source, target, paths, token, overwrite);
      break;
    case 'copy-secrets': {
      if (!fromEnv) throw new Error('copy-secrets needs --from-env NAME,NAME (values read from your local env, or prompted)');
      await cmdCopySecrets(token, source, target, fromEnv.split(',').map((s) => s.trim()).filter(Boolean), overwrite);
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
