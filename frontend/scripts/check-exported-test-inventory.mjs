import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(frontendRoot, '..');
const bundle = path.join(repositoryRoot, 'docs', 'ignite-all-refactoring-icp-export.bundle');
const manifestPath = path.join(frontendRoot, 'exported-test-mapping.json');
const expectedRef = 'refs/heads/integration/all-refactoring-icp-export';
const expectedCommit = '7f3a86ba449d2e847843ea9a77ff7e9b76751019';

function countFiles(directory, predicate) {
  return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return count + countFiles(entryPath, predicate);
    return count + Number(predicate(entryPath));
  }, 0);
}

function readBundlePaths() {
  const temporaryRepository = mkdtempSync(path.join(tmpdir(), 'ignite-export-inventory-'));
  try {
    execFileSync('git', ['init', '--quiet', '--bare', temporaryRepository]);
    execFileSync(
      'git',
      [
        `--git-dir=${temporaryRepository}`,
        'fetch',
        '--quiet',
        bundle,
        `${expectedRef}:refs/heads/export`,
      ],
      { stdio: 'pipe' },
    );
    return execFileSync(
      'git',
      [`--git-dir=${temporaryRepository}`, 'ls-tree', '-r', '--name-only', expectedCommit],
      { encoding: 'utf8' },
    ).trim().split('\n');
  } finally {
    rmSync(temporaryRepository, { recursive: true, force: true });
  }
}

function isSourceTest(file) {
  return file.startsWith('src/') && /\.(?:test|spec)\.(?:ts|tsx)$/.test(file);
}

function isNonBrowserExternalTest(file) {
  return (
    (file.startsWith('archive/') && /\.(?:test|spec)\.(?:ts|tsx)$/.test(file))
    || (/^(?:tests\/integration|tests\/local-supabase)\/.+\.test\.ts$/.test(file))
    || (file.startsWith('supabase/functions/') && /(?:\.test|_test)\.ts$/.test(file))
    || (file.startsWith('supabase/tests/') && /_test\.sql$/.test(file))
  );
}

function isBrowserTest(file) {
  return /^(?:e2e-baseline|e2e)\/.+\.spec\.ts$/.test(file);
}

if (!existsSync(bundle)) throw new Error(`Missing authoritative export bundle: ${bundle}`);
if (!existsSync(manifestPath)) throw new Error(`Missing exported-test mapping: ${manifestPath}`);

const heads = execFileSync('git', ['bundle', 'list-heads', bundle], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
if (!heads.includes(`${expectedCommit} ${expectedRef}`)) {
  throw new Error(`Export bundle does not contain ${expectedRef} at ${expectedCommit}`);
}

for (const config of ['vitest.lab.config.mjs', 'vitest.legacy.config.mjs', 'playwright.config.ts']) {
  if (!existsSync(path.join(frontendRoot, config))) {
    throw new Error(`Missing runnable test config: ${config}`);
  }
}

const bundlePaths = readBundlePaths();
const nonBrowserSources = bundlePaths.filter(
  (file) => isSourceTest(file) || isNonBrowserExternalTest(file),
);
const browserNativeSources = bundlePaths.filter(
  (file) => isBrowserTest(file) || file === 'tests/ios-os/resume.e2e.mjs',
);
const authoritativeSources = [...nonBrowserSources, ...browserNativeSources].sort();
const sourceTests = countFiles(path.join(frontendRoot, 'src'), (file) =>
  /\.(?:test|spec)\.(?:ts|tsx)$/.test(file),
);
const labTests = countFiles(path.join(frontendRoot, 'lab-tests'), (file) =>
  /\.(?:test|spec)\.(?:ts|tsx|mjs)$/.test(file),
);
const translatedBaselines = countFiles(path.join(frontendRoot, 'lab-tests'), (file) =>
  /imported-.*\.test\.tsx$/.test(file),
);
const browserSpecs = countFiles(path.join(frontendRoot, 'e2e'), (file) =>
  /\.spec\.ts$/.test(file),
);

if (nonBrowserSources.length !== 586) {
  throw new Error(`Expected exactly 586 non-browser bundle tests, found ${nonBrowserSources.length}`);
}
if (nonBrowserSources.filter(isSourceTest).length !== 536) {
  throw new Error('Expected exactly 536 frontend/src bundle tests');
}
if (nonBrowserSources.filter((file) => file.startsWith('src/edge-functions/')).length !== 20) {
  throw new Error('Expected exactly 20 Edge-oriented frontend/src bundle tests');
}
if (browserNativeSources.length !== 11) {
  throw new Error(`Expected exactly 11 browser/native bundle tests, found ${browserNativeSources.length}`);
}
if (sourceTests !== 434) throw new Error(`Expected exactly 434 retained source tests, found ${sourceTests}`);
if (labTests !== 168) throw new Error(`Expected exactly 168 lab tests, found ${labTests}`);
if (translatedBaselines !== 39) {
  throw new Error(`Expected exactly 39 translated baselines, found ${translatedBaselines}`);
}
if (browserSpecs !== 3) throw new Error(`Expected exactly 3 loopback browser specs, found ${browserSpecs}`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1) throw new Error('Unsupported exported-test mapping schema');
if (manifest.authoritativeRef !== expectedRef || manifest.authoritativeCommit !== expectedCommit) {
  throw new Error('Exported-test mapping does not identify the authoritative bundle ref');
}
if (!Array.isArray(manifest.entries)) throw new Error('Exported-test mapping entries must be an array');

const manifestSources = manifest.entries.map((entry) => entry.source).sort();
if (new Set(manifestSources).size !== manifestSources.length) {
  throw new Error('Exported-test mapping contains duplicate source paths');
}
if (JSON.stringify(manifestSources) !== JSON.stringify(authoritativeSources)) {
  const expected = new Set(authoritativeSources);
  const actual = new Set(manifestSources);
  const missing = authoritativeSources.filter((source) => !actual.has(source));
  const extra = manifestSources.filter((source) => !expected.has(source));
  throw new Error(
    `Exported-test mapping does not match the bundle; missing=${missing.join(',')}; extra=${extra.join(',')}`,
  );
}

const dispositions = {
  'direct-retained': 0,
  'local-equivalent': 0,
  'irreducible-boundary': 0,
};
for (const entry of manifest.entries) {
  if (!(entry.disposition in dispositions)) {
    throw new Error(`Unknown disposition for ${entry.source}: ${entry.disposition}`);
  }
  dispositions[entry.disposition] += 1;
  if (!Array.isArray(entry.targets) || entry.targets.length === 0) {
    throw new Error(`Mapping for ${entry.source} has no evidence target`);
  }
  for (const target of entry.targets) {
    const resolvedTarget = path.resolve(frontendRoot, target);
    if (!resolvedTarget.startsWith(`${frontendRoot}${path.sep}`) || !existsSync(resolvedTarget)) {
      throw new Error(`Mapping target for ${entry.source} does not exist: ${target}`);
    }
  }
  if (entry.disposition === 'direct-retained') {
    if (!isSourceTest(entry.source) || entry.targets[0] !== entry.source) {
      throw new Error(`Invalid direct-retained mapping for ${entry.source}`);
    }
  } else if (entry.disposition === 'local-equivalent') {
    if (!entry.targets.every((target) => /\.(?:test|spec)\.(?:ts|tsx|mjs)$/.test(target))) {
      throw new Error(`Local equivalent for ${entry.source} must point only to test files`);
    }
  } else if (typeof entry.reason !== 'string' || entry.reason.length < 80) {
    throw new Error(`Boundary exclusion for ${entry.source} needs a specific evidence-backed reason`);
  }
}

const expectedDispositions = {
  'direct-retained': 412,
  'local-equivalent': 181,
  'irreducible-boundary': 4,
};
if (JSON.stringify(dispositions) !== JSON.stringify(expectedDispositions)) {
  throw new Error(
    `Unexpected mapping dispositions: ${JSON.stringify(dispositions)}; expected ${JSON.stringify(expectedDispositions)}`,
  );
}

console.log(`Authoritative export: ${expectedRef} (${expectedCommit})`);
console.log('Authoritative bundle inventory: 586 non-browser tests (536 frontend/src; 20 Edge-oriented)');
console.log('Additional browser/native inventory: 11 sources');
console.log(
  `Runnable tiers: ${sourceTests} retained source files; ${labTests} lab-tests files; `
  + `${translatedBaselines} translated hybrid baselines; ${browserSpecs} loopback browser specs`,
);
console.log(
  `Path-level mapping: ${dispositions['direct-retained']} direct retained; `
  + `${dispositions['local-equivalent']} local equivalents; `
  + `${dispositions['irreducible-boundary']} irreducible boundary exclusions`,
);
