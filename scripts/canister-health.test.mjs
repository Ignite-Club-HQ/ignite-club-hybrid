import { test } from "node:test";
import assert from "node:assert/strict";
import { cyclesT, memoryMB, rowNote } from "./canister-health.mjs";

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
