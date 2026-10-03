// Single, serialized owner of frontend/node_modules for the Lovable sandbox.
//
// Why this exists: the platform install step (lovable.toml `install`) used to
// run `npm ci` on every message. `npm ci` DELETES node_modules first, so the
// running preview server lost its dependencies for ~40s each time — module
// requests 404'd, lazy pages failed to load, the app reloaded itself, and the
// preview showed "Not found" / spinners. The dev and build scripts also ran
// their own `npm ci` concurrently with the platform one, corrupting the
// install (e.g. recharts unable to resolve lodash).
//
// Now: install only when package-lock.json actually changed (stamp file), and
// serialize every caller through one lock so installs never overlap.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(projectRoot, "frontend");
const nodeModules = path.join(frontendDir, "node_modules");
const viteBin = path.join(nodeModules, "vite", "bin", "vite.js");
const stampFile = path.join(nodeModules, ".ignite-install-stamp");
const lockDir = path.join(os.tmpdir(), "ignite-frontend-install.lock");
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_MS = 10 * 60_000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockfileHash() {
  const lock = readFileSync(path.join(frontendDir, "package-lock.json"));
  return createHash("sha256").update(lock).update(process.version).digest("hex");
}

function isUpToDate() {
  if (!existsSync(viteBin) || !existsSync(stampFile)) return false;
  try {
    return readFileSync(stampFile, "utf8").trim() === lockfileHash();
  } catch {
    return false;
  }
}

function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let announced = false;
  while (true) {
    try {
      mkdirSync(lockDir);
      return;
    } catch {
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for frontend install lock");
      if (!announced) {
        console.log("waiting for another frontend dependency install to finish...");
        announced = true;
      }
      sleep(1000);
    }
  }
}

/** Ensures frontend deps are installed and current. Returns true if an install ran. */
export function ensureFrontendDeps() {
  if (isUpToDate()) return false;
  acquireLock();
  try {
    // Another caller may have finished the install while we waited.
    if (isUpToDate()) return false;
    // Existing healthy install from before stamps existed: adopt it instead of
    // wiping it (avoids one needless delete/reinstall under a running server).
    const hiddenLock = path.join(nodeModules, ".package-lock.json");
    if (existsSync(viteBin) && existsSync(hiddenLock)) {
      const npmLs = spawnSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["ls", "--depth=0", "--silent"],
        { cwd: frontendDir, stdio: "ignore" },
      );
      if (npmLs.status === 0) {
        writeFileSync(stampFile, lockfileHash());
        return false;
      }
    }
    console.log("installing frontend dependencies (npm ci)...");
    const install = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ci", "--no-fund", "--no-audit"],
      { cwd: frontendDir, stdio: "inherit" },
    );
    if (install.status !== 0) throw new Error(`npm ci failed with status ${install.status}`);
    if (!existsSync(viteBin)) throw new Error("frontend dependencies still missing after npm ci");
    writeFileSync(stampFile, lockfileHash());
    // Fresh deps invalidate Vite's pre-bundle cache.
    rmSync(path.join(nodeModules, ".vite"), { recursive: true, force: true });
    return true;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export { frontendDir, projectRoot, viteBin };

// CLI: used as the lovable.toml install command.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ran = ensureFrontendDeps();
    console.log(ran ? "frontend dependencies installed" : "frontend dependencies already up to date");
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}
