import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, '..');
const vitestCli = path.join(frontendDirectory, 'node_modules/vitest/vitest.mjs');
const arguments_ = process.argv.slice(2);
const modeArgument = arguments_.find((argument) => argument.startsWith('--backend-mode='));
const requestedMode = modeArgument?.slice('--backend-mode='.length);

if (requestedMode && !['supabase', 'icp'].includes(requestedMode)) {
  throw new Error(`Unsupported backend mode: ${requestedMode}`);
}

const backendModes = requestedMode ? [requestedMode] : ['supabase', 'icp'];
const vitestArguments = arguments_.filter((argument) => argument !== modeArgument);
const outputArgument = vitestArguments.find((argument) => argument.startsWith('--output-dir='));
const outputDirectoryArgument = outputArgument?.slice('--output-dir='.length);
const forwardedArguments = vitestArguments.filter((argument) => argument !== outputArgument);
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDirectory = path.resolve(
  process.cwd(),
  outputDirectoryArgument ?? process.env.IGNITE_TEST_RESULTS_DIR ??
    path.join(frontendDirectory, '.test-results', 'backend-modes', timestamp),
);
const summaryPath = path.join(outputDirectory, 'summary.json');
const results = backendModes.map((backendMode) => ({
  backendMode,
  status: 'pending',
  exitCode: null,
  signal: null,
  log: path.join(outputDirectory, `${backendMode}.log`),
}));
const summary = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: 'running',
  results,
};

await mkdir(outputDirectory, { recursive: true });

async function saveSummary() {
  const temporaryPath = `${summaryPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await rename(temporaryPath, summaryPath);
}

await saveSummary();

for (const result of results) {
  result.status = 'running';
  await saveSummary();
  console.log(`\n=== Vitest backend mode: ${result.backendMode} ===`);
  console.log(`Saving output to ${result.log}`);

  const log = createWriteStream(result.log, { flags: 'w' });
  log.write(`=== Vitest backend mode: ${result.backendMode} ===\n`);

  const child = spawn(
    process.execPath,
    [vitestCli, 'run', '--config', 'vitest.legacy.config.mjs', ...forwardedArguments],
    {
      cwd: frontendDirectory,
      env: { ...process.env, IGNITE_TEST_BACKEND_MODE: result.backendMode },
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log.write(chunk);
    process.stderr.write(chunk);
  });

  const outcome = await new Promise((resolve) => {
    child.once('error', (error) => {
      log.write(`${error.stack ?? error}\n`);
      console.error(error);
      resolve({ exitCode: 1, signal: null });
    });
    child.once('close', (exitCode, signal) => resolve({ exitCode: exitCode ?? 1, signal }));
  });

  await new Promise((resolve) => log.end(resolve));
  result.exitCode = outcome.exitCode;
  result.signal = outcome.signal;
  result.status = outcome.exitCode === 0 ? 'passed' : 'failed';
  await saveSummary();
}

summary.finishedAt = new Date().toISOString();
summary.status = 'completed';
await saveSummary();

console.log(`\nRun summary: ${summaryPath}`);
process.exitCode = results.every((result) => result.exitCode === 0) ? 0 : 1;