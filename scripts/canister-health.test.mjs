import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBytes, parseCyclesT } from "./canister-health.mjs";

// ICP CLI emits settings before the actual usage fields.
const status = `Canister Status Report:
  Memory allocation: 0
  Reserved cycles limit: 5000000000000
  Wasm memory limit: 0
  Memory size: 201_326_592
  Cycles: 14321000000000
  Reserved cycles: 900000000000
  Idle cycles burned per day: 5000000`;

test("actual balance is not the 5T reserved-cycles limit", () => {
  assert.equal(parseCyclesT(status), 14.321);
});
test("actual memory is not zero memory allocation", () => {
  assert.equal(parseBytes(status), 201326592);
});
test("settings alone cannot establish health", () => {
  assert.equal(parseCyclesT("Reserved cycles limit: 5000000000000"), null);
  assert.equal(parseBytes("Memory allocation: 0\nWasm memory limit: 0"), null);
});
test("supports decimal cycles units", () => {
  assert.equal(parseCyclesT("Balance: 3.21 TCycles"), 3.21);
  assert.equal(parseCyclesT("Cycles: 400,000,000,000"), 0.4);
});
test("binary memory units retain their actual byte size", () => {
  assert.equal(parseBytes("Memory size: 12.5 MiB"), 13107200);
  assert.equal(parseBytes("Memory size: 12.5 MB"), 12500000);
});
test("zero actual values remain valid and ambiguous or malformed values fail closed", () => {
  assert.equal(parseCyclesT("Cycles: 0"), 0);
  assert.equal(parseBytes("Memory size: 0"), 0);
  assert.equal(parseCyclesT("Cycles: unknown"), null);
  assert.equal(parseBytes("Memory size: unknown"), null);
  assert.equal(parseCyclesT("Cycles: 1\nCycles: 2"), null);
  assert.equal(parseBytes("Memory size: 1\nMemory size: 2"), null);
});