import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cyclesT, memoryMB, rowNote, healthTargets, readHealthRows } from "./canister-health.mjs";

function inventory(t, groups = {}) {
  const root = mkdtempSync(join(tmpdir(), "health-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mappings = join(root, "deploy/mainnet/.icp/data/mappings");
  mkdirSync(mappings, { recursive: true });
  writeFileSync(join(mappings, "ic.ids.json"), JSON.stringify({
    club_domain: "mzzzv-taaaa-aaaal-qxlrq-cai", shard_router: "jcdfe-vqaaa-aaaal-qxloq-cai",
  }));
  for (const [groupId, group] of Object.entries(groups)) {
    const dir = join(root, "deploy/groups", groupId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "provision.json"), JSON.stringify(group));
  }
  return root;
}

test("health inventory covers both groups, shared router and dedicated photo store", (t) => {
  const root = inventory(t, { g2: {
    groupId: "g2", deploymentId: "mainnet",
    canisters: { messaging_domain: "yluv5-wiaaa-aaaal-qxpzq-cai" },
    dedicatedBlobStore: { canisterId: "ycx6b-aaaaa-aaaal-qxpya-cai" },
  } });
  const { targets } = healthTargets(root);
  assert.deepEqual(targets.map(r => [r.key, r.groupId]), [
    ["club_domain", "g1"], ["shard_router", "shared"],
    ["g2/messaging_domain", "g2"], ["g2/media_blob_store", "g2"],
  ]);
});

test("future provisioned groups are discovered and repeated IDs read once", (t) => {
  const root = inventory(t, { g3: {
    groupId: "g3", deploymentId: "mainnet",
    canisters: { club_domain: "yfwyv-nyaaa-aaaal-qxpyq-cai", shard_router: "jcdfe-vqaaa-aaaal-qxloq-cai" },
  } });
  const { targets } = healthTargets(root);
  assert.equal(targets.length, 3);
  assert.equal(targets.find(r => r.groupId === "g3")?.id, "yfwyv-nyaaa-aaaal-qxpyq-cai");
});

test("invalid group inventory fails instead of quietly omitting the group", (t) => {
  const root = inventory(t, { g2: { groupId: "g2", deploymentId: "mainnet", canisters: {} } });
  assert.throws(() => healthTargets(root), /Invalid mainnet group inventory/);
});

test("a failed group read remains unreadable without hiding the healthy group", async () => {
  const targets = [{ key: "club_domain", id: "g1", groupId: "g1" }, { key: "g2/vault_domain", id: "g2", groupId: "g2" }];
  const rows = await readHealthRows(targets, async ({ id }) => {
    if (id === "g2") throw new Error("unavailable");
    return { cyclesT: 5, memoryMB: 10 };
  });
  assert.equal(rows[0].cyclesT, 5);
  assert.equal(rows[1].cyclesT, null);
  assert.equal(rowNote(rows[1]).problems, 2);
});

// Each service replies with a raw Nat of individual cycles.
test("raw cycle balances become trillions", () => {
  assert.equal(cyclesT(14_321_000_000_000n), 14.321);
  assert.equal(cyclesT(410_000_000_000n), 0.41);
  assert.equal(cyclesT(0n), 0);
});

test("a missing or non-Nat balance is never a healthy zero", () => {
  assert.equal(cyclesT(undefined), null);
  assert.equal(cyclesT(null), null);
  assert.equal(cyclesT("5000000000000"), null);
});

test("memory_bytes becomes megabytes and a missing reading stays null", () => {
  assert.equal(memoryMB({ heap_bytes: 1n, memory_bytes: 201_326_592n, stable_bytes: 1n }), 201.326592);
  assert.equal(memoryMB(null), null);
  assert.equal(memoryMB({ memory_bytes: undefined }), null);
});

test("fuel under 1T is flagged for a top-up", () => {
  const r = rowNote({ cyclesT: 0.41, memoryMB: 6.7, requireMemory: true });
  assert.match(r.note, /LOW FUEL/);
  assert.equal(r.problems, 1);
});

test("1T is the boundary: exactly 1T is not low", () => {
  assert.equal(rowNote({ cyclesT: 1, memoryMB: 100, requireMemory: true }).problems, 0);
  assert.equal(rowNote({ cyclesT: 0.99, memoryMB: 100, requireMemory: true }).problems, 1);
});

test("3 GB memory is the advisory boundary", () => {
  assert.equal(rowNote({ cyclesT: 5, memoryMB: 3000, requireMemory: true }).problems, 0);
  assert.match(rowNote({ cyclesT: 5, memoryMB: 3001, requireMemory: true }).note, /HIGH MEMORY/);
});

test("unreadable fuel or memory fails the run", () => {
  const noFuel = rowNote({ cyclesT: null, memoryMB: 10, requireMemory: true });
  assert.match(noFuel.note, /could not read fuel/);
  assert.equal(noFuel.problems, 1);
  const noMemory = rowNote({ cyclesT: 5, memoryMB: null, requireMemory: true });
  assert.match(noMemory.note, /could not read memory/);
  assert.equal(noMemory.problems, 1);
  // The web-app canister has no memory_stats query of its own.
  assert.equal(rowNote({ cyclesT: 5, memoryMB: null, requireMemory: false }).problems, 0);
});
