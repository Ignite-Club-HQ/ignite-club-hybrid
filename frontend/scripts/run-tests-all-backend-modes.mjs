import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, '..');
const vitestCli = path.join(frontendDirectory, 'node_modules/vitest/vitest.mjs');
const cliArguments = process.argv.slice(2);
const modeArgument = cliArguments.find((argument) => argument.startsWith('--backend-mode='));
const requestedMode = modeArgument?.slice('--backend-mode='.length);
if (requestedMode && !['supabase', 'icp'].includes(requestedMode)) {
  throw new Error(`Unsupported backend mode: ${requestedMode}`);
}
const backendModes = requestedMode ? [requestedMode] : ['supabase', 'icp'];
const vitestArguments = cliArguments.filter((argument) => argument !== modeArgument);
let exitCode = 0;

for (const backendMode of backendModes) {
  console.log(`\n=== Vitest backend mode: ${backendMode} ===\n`);
  const result = spawnSync(
    process.execPath,
    [vitestCli, 'run', '--config', 'vitest.legacy.config.mjs', ...vitestArguments],
    {
      cwd: frontendDirectory,
      env: { ...process.env, IGNITE_TEST_BACKEND_MODE: backendMode },
      stdio: 'inherit',
    },
  );

  if (result.error) {
    console.error(result.error);
    exitCode = 1;
  } else if (result.status !== 0) {
    exitCode = result.status ?? 1;
  }
}

process.exitCode = exitCode;