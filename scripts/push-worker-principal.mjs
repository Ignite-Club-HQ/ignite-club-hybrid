#!/usr/bin/env node
// Prints the principal derived from ICP_PUSH_WORKER_SEED (64 hex chars,
// 32-byte Ed25519 seed). The deploy workflow passes the secret in CI;
// locally, resolve @icp-sdk/core from frontend/node_modules, or point
// PUSH_WORKER_NODE_PATH at a node_modules dir that has it installed.

import { createRequire } from "node:module";

function requireIc() {
  const candidates = [];
  if (process.env.PUSH_WORKER_NODE_PATH) {
    candidates.push(createRequire(`${process.env.PUSH_WORKER_NODE_PATH}/resolve.js`));
  }
  candidates.push(createRequire(new URL("../frontend/package.json", import.meta.url)));
  candidates.push(createRequire(import.meta.url));
  for (const req of candidates) {
    try {
      return req("@icp-sdk/core/identity");
    } catch {}
  }
  throw new Error("@icp-sdk/core not resolvable — set PUSH_WORKER_NODE_PATH to a node_modules dir containing it");
}

const { Ed25519KeyIdentity } = requireIc();
const hex = process.env.ICP_PUSH_WORKER_SEED ?? "";
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.error("ICP_PUSH_WORKER_SEED must be set to 64 hex characters (32-byte seed)");
  process.exit(1);
}
const seed = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
console.log(Ed25519KeyIdentity.fromSecretKey(seed).getPrincipal().toText());
