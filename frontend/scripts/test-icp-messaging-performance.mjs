#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const root = path.resolve(import.meta.dirname, '../..');

function parseArgs(argv) {
  const options = {
    messages: 40,
    pageSize: 20,
    json: false,
    configPath: path.join(root, '.local-icp', 'public.json'),
    host: 'http://127.0.0.1:4943',
    maxSendP95Ms: 1_500,
    maxPageP95Ms: 500,
    maxUnreadP95Ms: 500,
  };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    if (arg.startsWith('--messages=')) options.messages = Number(arg.slice(11));
    if (arg.startsWith('--page-size=')) options.pageSize = Number(arg.slice(12));
    if (arg.startsWith('--config=')) options.configPath = path.resolve(arg.slice(9));
    if (arg.startsWith('--host=')) options.host = arg.slice(7);
    if (arg.startsWith('--max-send-p95-ms=')) options.maxSendP95Ms = Number(arg.slice(18));
    if (arg.startsWith('--max-page-p95-ms=')) options.maxPageP95Ms = Number(arg.slice(18));
    if (arg.startsWith('--max-unread-p95-ms=')) options.maxUnreadP95Ms = Number(arg.slice(20));
  }
  if (!Number.isInteger(options.messages) || options.messages < 1 || options.messages > 1_000) throw new Error('--messages must be an integer from 1 to 1000');
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 100) throw new Error('--page-size must be an integer from 1 to 100');
  for (const [name, value] of Object.entries({
    '--max-send-p95-ms': options.maxSendP95Ms,
    '--max-page-p95-ms': options.maxPageP95Ms,
    '--max-unread-p95-ms': options.maxUnreadP95Ms,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  }
  const url = new URL(options.host);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('--host must be an http loopback URL');
  return options;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) throw new Error(`Missing ${configPath}; run npm run test:messaging:icp:performance to deploy local ICP first`);
  const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (value.network !== 'local' || !/^[0-9a-f]{266}$/i.test(value.rootKey)) throw new Error('Invalid local ICP configuration');
  const messagingId = value.canisterIds?.messaging_domain;
  if (!/^[a-z0-9-]+$/.test(messagingId ?? '')) throw new Error('Missing local messaging_domain canister ID');
  return { ...value, messagingId };
}

async function actorFor(config, host, persona) {
  const agent = await HttpAgent.create({
    host,
    identity: syntheticIdentity(persona),
    rootKey: Uint8Array.from(config.rootKey.match(/../g), byte => parseInt(byte, 16)),
    shouldFetchRootKey: false,
    shouldSyncTime: false,
    useQueryNonces: true,
    retryTimes: 1,
  });
  return Actor.createActor(messagingIdl, { agent, canisterId: config.messagingId });
}

async function requireLoopbackReplica(host) {
  const response = await fetch(new URL('/api/v2/status', host), { cache: 'no-store' }).catch(error => {
    throw new Error(`Local ICP replica is not reachable at ${host}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) throw new Error(`Local ICP replica status check failed at ${host}: HTTP ${response.status}`);
}

function ok(result, label) {
  if ('Err' in result) throw new Error(`${label}: ${result.Err}`);
  return result.Ok;
}

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

async function measure(samples, fn) {
  const started = performance.now();
  const value = await fn();
  samples.push(performance.now() - started);
  return value;
}

function summarize(samples) {
  return {
    count: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
    maxMs: Number(percentile(samples, 1).toFixed(2)),
  };
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig(options.configPath);
await requireLoopbackReplica(options.host);
const governor = syntheticIdentity('governor');
const teamMember = syntheticIdentity('team_member').getPrincipal();
const admin = await actorFor(config, options.host, 'governor');
const member = await actorFor(config, options.host, 'team_member');
const club = `perf-club-${randomUUID()}`;
const team = `perf-team-${randomUUID()}`;

ok(await admin.grant_role(governor.getPrincipal(), 'club_admin', [club], []), 'grant governor club admin');
ok(await admin.grant_role(teamMember, 'team_admin', [club], [team]), 'grant team member admin');
const conversation = ok(
  await admin.create_conversation(club, [team], [governor.getPrincipal(), teamMember]),
  'create conversation',
);

const sendSamples = [];
const pageSamples = [];
const unreadSamples = [];

for (let index = 0; index < options.messages; index += 1) {
  const message = await measure(sendSamples, () =>
    admin.send_message(conversation.id, `local ICP perf message ${index}`, `perf-${index}-${randomUUID()}`),
  );
  ok(message, `send message ${index}`);
}

let cursor = [];
let fetched = 0;
while (fetched < options.messages) {
  const page = ok(
    await measure(pageSamples, () => member.list_messages_page(conversation.id, cursor, options.pageSize)),
    'list message page',
  );
  if (page.messages.length === 0) throw new Error('Message page stalled before all messages were fetched');
  fetched += page.messages.length;
  cursor = page.next_sequence;
}
if (fetched !== options.messages) throw new Error(`Expected ${options.messages} fetched messages, received ${fetched}`);

for (let index = 0; index < Math.min(10, options.messages); index += 1) {
  const unread = ok(await measure(unreadSamples, () => member.unread_count(conversation.id)), `unread count ${index}`);
  if (unread.count !== BigInt(options.messages)) throw new Error(`Expected unread count ${options.messages}, received ${unread.count}`);
}

const report = {
  kind: 'local-icp-messaging-performance',
  localOnly: true,
  host: options.host,
  canister: config.messagingId,
  messages: options.messages,
  pageSize: options.pageSize,
  thresholds: {
    sendP95Ms: options.maxSendP95Ms,
    pageP95Ms: options.maxPageP95Ms,
    unreadP95Ms: options.maxUnreadP95Ms,
  },
  send: summarize(sendSamples),
  page: summarize(pageSamples),
  unread: summarize(unreadSamples),
};

const failures = [];
if (report.send.p95Ms > options.maxSendP95Ms) failures.push(`send p95 ${report.send.p95Ms}ms > ${options.maxSendP95Ms}ms`);
if (report.page.p95Ms > options.maxPageP95Ms) failures.push(`page p95 ${report.page.p95Ms}ms > ${options.maxPageP95Ms}ms`);
if (report.unread.p95Ms > options.maxUnreadP95Ms) failures.push(`unread p95 ${report.unread.p95Ms}ms > ${options.maxUnreadP95Ms}ms`);

if (options.json) {
  console.log(JSON.stringify({ ...report, failures }, null, 2));
} else {
  console.log('Local ICP messaging performance test (loopback PocketIC only; not a mainnet capacity claim)');
  console.log(`messages=${report.messages} pageSize=${report.pageSize} canister=${report.canister}`);
  console.log(`send:   count=${report.send.count} p50=${report.send.p50Ms}ms p95=${report.send.p95Ms}ms max=${report.send.maxMs}ms`);
  console.log(`page:   count=${report.page.count} p50=${report.page.p50Ms}ms p95=${report.page.p95Ms}ms max=${report.page.maxMs}ms`);
  console.log(`unread: count=${report.unread.count} p50=${report.unread.p50Ms}ms p95=${report.unread.p95Ms}ms max=${report.unread.maxMs}ms`);
}

if (failures.length) {
  for (const failure of failures) console.error(`Performance threshold failed: ${failure}`);
  process.exitCode = 1;
}
