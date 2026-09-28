import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build", "--config", "vite.product.config.ts", "--mode", "staging"],
  {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, IGNITE_PRODUCT_BUILD: "1" },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
