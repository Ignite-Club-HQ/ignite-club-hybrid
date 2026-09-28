import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build", "--config", "vite.live.config.ts", "--mode", "live"],
  {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, IGNITE_LIVE_BUILD: "1" },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
