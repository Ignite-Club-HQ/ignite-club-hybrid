// Copies the deployed mainnet canister ID table committed by the deploy
// workflow (deploy/mainnet/.icp/data/mappings/ic.ids.json) into the frontend
// source tree so targetRegistry.ts can bundle it as the build-time default
// when IGNITE_LIVE_ICP_CANISTER_IDS_JSON is not set. Missing file is fine —
// the app then starts with no pre-configured IDs, exactly as before.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(projectRoot, "deploy", "mainnet", ".icp", "data", "mappings", "ic.ids.json");
const targetDir = path.join(projectRoot, "frontend", "src", "live", "generated");
const target = path.join(targetDir, "deployedCanisterIds.json");

export function syncCanisterIds() {
  if (!existsSync(source)) return false;
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log("synced deployed canister IDs -> frontend/src/live/generated/deployedCanisterIds.json");
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  syncCanisterIds();
}
