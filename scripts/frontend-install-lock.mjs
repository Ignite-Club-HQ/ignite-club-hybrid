import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function isInstallLockAbandoned(directory, now = Date.now(), alive = isProcessAlive) {
  try {
    const pid = Number(readFileSync(path.join(directory, 'owner.pid'), 'utf8'));
    if (Number.isSafeInteger(pid) && pid > 0) return !alive(pid);
  } catch {
    // Allow the owner time to write its PID after atomically creating the lock.
  }
  return now - statSync(directory).mtimeMs > 30_000;
}