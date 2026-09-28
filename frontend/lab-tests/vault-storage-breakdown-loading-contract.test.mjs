import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const page = readFileSync(resolve(process.cwd(), "src/pages/VaultPage.tsx"), "utf8");

test("VaultPage defers the Recharts storage breakdown until storage details render", () => {
  assert.doesNotMatch(page, /from "recharts"/);
  assert.match(page, /const VaultStorageBreakdown = lazyWithRetry/);
  assert.match(page, /storageBreakdown && \(storageBreakdown\.photos > 0 \|\| storageBreakdown\.documents > 0\)/);
  assert.match(page, /<Suspense fallback=\{null\}>/);
});
