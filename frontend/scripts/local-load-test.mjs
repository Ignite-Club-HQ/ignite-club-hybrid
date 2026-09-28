#!/usr/bin/env node

// Local-only signed query load test. It refuses non-loopback configuration and
// never discovers or contacts a mainnet endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { idlFactory } from '../src/lab/bindings/declarations/club_links.did.js';
import { syntheticIdentity, CLUB_A, CLUB_B } from '../src/lab/syntheticIdentities.mjs';

const root = path.resolve(import.meta.dirname, '../..');
function parseArgs(argv) {
  const options = { requests: 200, concurrency: [1, 4, 16, 32], configPath: path.join(root, '.local-icp', 'public.json'), host: 'http://127.0.0.1:4943', canisters: [] };
  for (const arg of argv) {
    if (arg.startsWith('--requests=')) options.requests = Number(arg.slice(11));
    if (arg.startsWith('--concurrency=')) options.concurrency = arg.slice(14).split(',').map(Number);
    if (arg.startsWith('--config=')) options.configPath = path.resolve(arg.slice(9));
    if (arg.startsWith('--host=')) options.host = arg.slice(7);
    if (arg.startsWith('--canisters=')) options.canisters = arg.slice(12).split(',').filter(Boolean);
  }
  if (!Number.isInteger(options.requests) || options.requests < 1 || options.requests > 10_000) throw new Error('--requests must be an integer from 1 to 10000');
  if (!options.concurrency.length || options.concurrency.some((n) => !Number.isInteger(n) || n < 1 || n > 128)) throw new Error('--concurrency must contain integers from 1 to 128');
  const url = new URL(options.host);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('--host must be an http loopback URL');
  return options;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) throw new Error(`Missing ${configPath}; start and deploy the local ICP lab first`);
  const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (value.network !== 'local' || !/^[0-9a-f]{266}$/i.test(value.rootKey)) throw new Error('Invalid local ICP configuration');
  if (!/^[a-z0-9-]+$/.test(value.canisterId)) throw new Error('Invalid local canister ID');
  return value;
}

async function actorFor(config, host) {
  const agent = await HttpAgent.create({
    host,
    identity: syntheticIdentity('app_admin'),
    rootKey: Uint8Array.from(config.rootKey.match(/../g), (byte) => parseInt(byte, 16)),
    shouldFetchRootKey: false,
    shouldSyncTime: false,
    useQueryNonces: true,
    retryTimes: 1,
  });
  return Actor.createActor(idlFactory, { agent, canisterId: config.canisterId });
}

async function runBatch(actors, requests, concurrency) {
  let next = 0;
  const samples = [];
  let failures = 0;
  let firstError = '';
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= requests) return;
      const started = performance.now();
      try {
        const actor = actors[index % actors.length];
        const result = await actor.list_links(index % 2 ? CLUB_B : CLUB_A, true);
        if ('Err' in result) throw new Error(result.Err);
      } catch (error) {
        failures += 1;
        if (!firstError) firstError = error instanceof Error ? error.message : String(error);
      } finally {
        samples.push(performance.now() - started);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  samples.sort((a, b) => a - b);
  const at = (p) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))] ?? 0;
  return { requests, concurrency, failures, firstError, p50Ms: Number(at(0.5).toFixed(2)), p95Ms: Number(at(0.95).toFixed(2)), maxMs: Number(at(1).toFixed(2)) };
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig(options.configPath);
const canisterIds = options.canisters.length ? options.canisters : [config.canisterId];
if (canisterIds.some((id) => !/^[a-z0-9-]+$/.test(id))) throw new Error('Invalid canister ID in --canisters');
const actors = await Promise.all(canisterIds.map((canisterId) => actorFor({ ...config, canisterId }, options.host)));
console.log('Local ICP signed query load test (loopback only; not a mainnet or subnet capacity claim)');
console.log(`canisters: ${canisterIds.length}`);
console.log('concurrency  requests  failures  p50 ms  p95 ms  max ms');
for (const concurrency of options.concurrency) {
  const result = await runBatch(actors, options.requests, concurrency);
  console.log(`${String(result.concurrency).padStart(11)} ${String(result.requests).padStart(9)} ${String(result.failures).padStart(8)} ${result.p50Ms.toFixed(2).padStart(7)} ${result.p95Ms.toFixed(2).padStart(7)} ${result.maxMs.toFixed(2).padStart(7)}`);
  if (result.firstError) console.log(`  first failure: ${result.firstError}`);
  if (result.failures > 0) process.exitCode = 1;
}
