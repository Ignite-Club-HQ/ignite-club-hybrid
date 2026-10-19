/** Production operator transport rehearsal: a real Ed25519 operator identity
 * signs management-canister status checks and configuration calls over the
 * live HTTP gateway, then health and business read-backs go through the same
 * transport. Mirrors the mainnet path; nothing is registered or enabled. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { configureProvisionGroup, groupConfigurationPlan } from './groupProvisionConfiguration';
import { createOperatorTransport, loadOperatorIdentity } from './operatorTransport';
import { PER_GROUP_DOMAINS, type Provision } from './groupProvisioner';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const enabled = Boolean(process.env.NEW_GROUP_OPERATOR_REPLICA && process.env.POCKET_IC_BIN);
const ok = (r: any) => { expect(r.Err).toBeUndefined(); expect('Ok' in r).toBe(true); return r.Ok; };
const contracts = import.meta.glob('../lab/bindings/*/declarations/*.did.js');
let server: PocketIcServer, pic: PocketIc;

describe.skipIf(!enabled)('production operator transport (real signed calls)', () => {
  beforeAll(async () => {
    server = await PocketIcServer.start();
    pic = await PocketIc.create(server.getUrl(), { nns: { state: { type: 'new' } }, application: [{ state: { type: 'new' } }] });
  }, 60000);
  afterAll(async () => { await pic?.stopLive().catch(() => {}); await pic?.tearDown(); await server?.stop(); }, 60000);

  it('installs every service, configures through the signed transport and reads back health and business state', async () => {
    const operator = Ed25519KeyIdentity.generate();
    const governor = operator.getPrincipal();
    const member = Principal.fromUint8Array(Uint8Array.from([2, 1]));
    const load = async (name: string) => {
      const fn = contracts[`../lab/bindings/${name}/declarations/${name}.did.js`];
      if (!fn) throw Error(`Missing real contract: ${name}`);
      return await fn() as { idlFactory: any };
    };
    const services = new Map<string, any>();
    const install = async (name: string) => {
      const wasm = process.env[`${name.toUpperCase()}_WASM`];
      if (!wasm) throw Error(`Missing real artifact: ${name}`);
      const { idlFactory } = await load(name);
      const environmentVariables = name === 'pii_access_control' ? [{ name: 'VETKD_KEY_NAME', value: 'key_1' }] : name === 'media_blob_store' ? [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] : [];
      const service = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables,
        arg: IDL.encode(name === 'timer_jobs' ? [] : [IDL.Principal], name === 'timer_jobs' ? [] : [governor]) });
      services.set(name, service);
      return service;
    };
    for (const domain of PER_GROUP_DOMAINS) await install(domain);
    const blob = await install('media_blob_store');
    const identityModule = await load('identity_access');
    const identity = await pic.setupCanister({ idlFactory: identityModule.idlFactory, wasm: process.env.IDENTITY_ACCESS_WASM,
      sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
    const worker = Principal.fromUint8Array(Uint8Array.from([4, 1]));
    const globals = { identityAccess: identity.canisterId.toText(), pushWorker: worker.toText(), mediaBlobStore: blob.canisterId.toText() };

    // The PEM loader is the production identity path; round-trip it on disk.
    const pemDir = mkdtempSync(join(tmpdir(), 'operator-pem-'));
    const pemPath = join(pemDir, 'operator.pem');
    writeFileSync(pemPath, `-----BEGIN PRIVATE KEY-----\n${Buffer.from(operator.getKeyPair().secretKey).toString('base64')}\n-----END PRIVATE KEY-----\n`);
    const loaded = loadOperatorIdentity(pemPath);
    expect(loaded.getPrincipal().toText()).toBe(governor.toText());

    const port = await pic.makeLive();
    const idls = new Map<string, any>();
    for (const [name, service] of services) idls.set(service.canisterId.toText(), (await load(name)).idlFactory);
    // PocketIC's management canister refuses ingress canister_status, so the
    // rehearsal proves controllers through the server API; the signed
    // management-call path in the transport is the mainnet path.
    const statusOverride = async (canisterId: string, expected: string) => {
      const status = await pic.canisterStatus({ canisterId: Principal.fromText(canisterId), sender: governor });
      if (!status.settings.controllers.some(c => c.toText() === expected)) throw new Error(`Operator does not control ${canisterId}`);
    };
    const transport = await createOperatorTransport({ host: `http://127.0.0.1:${port}`, identity: loaded, idls, fetchRootKey: true, statusOverride });

    // Governor verification is real: a foreign principal is rejected before any call.
    await expect(transport.verifyGovernor(services.get('club_domain').canisterId.toText(), member.toText())).rejects.toThrow('does not match');
    await transport.verifyGovernor(services.get('club_domain').canisterId.toText(), governor.toText());

    let saved: Provision = { id: 'operator-rehearsal', groupId: 'new', deploymentId: 'local', subnetId: Principal.fromUint8Array(Uint8Array.from([80, 1])).toText(), phase: 'installed', expectedRevision: 0n,
      installedDomains: [...PER_GROUP_DOMAINS], canisters: Object.fromEntries(PER_GROUP_DOMAINS.map(d => [d, services.get(d).canisterId.toText()])) };
    const checkpoints: Provision[] = [];
    await configureProvisionGroup(saved, async p => { saved = structuredClone(p); checkpoints.push(saved); }, transport, governor.toText(), globals);
    expect(saved.configuration?.completed).toHaveLength(groupConfigurationPlan(saved, globals).length);
    // Resume is idempotent through the real transport: no signed call repeats.
    await configureProvisionGroup(saved, async p => { saved = structuredClone(p); }, transport, governor.toText(), globals);

    // Health read-back through the signed transport on every service.
    for (const [name, service] of services) {
      const cycles = await transport.call(service.canisterId.toText(), 'cycles_balance', []);
      expect(BigInt(cycles as unknown as bigint), name).toBeGreaterThan(0n);
      const stats = await transport.call(service.canisterId.toText(), 'memory_stats', []) as unknown as { memory_bytes: bigint };
      expect(stats.memory_bytes, name).toBeGreaterThan(0n);
    }

    // Business read-back through the signed transport: configured wiring works.
    const clubId = services.get('club_domain').canisterId.toText();
    const eventsId = services.get('events_domain').canisterId.toText();
    ok(await transport.call(clubId, 'create_club', ['op-club', 'Operator club', 'op-club', [], []]));
    ok(await transport.call(clubId, 'add_role_grant', [governor, 'op-club', 'club_admin', []]));
    const event = ok(await transport.call(eventsId, 'create_event', ['op-club', [], 'Training', 'Operator session', 'training', [], [], [], [], 2000000000000n, 2000003600000n, [], false, [], []])) as { id: string };
    const events = await transport.call(eventsId, 'list_events', [['op-club'], []]) as unknown as { id: string }[];
    expect(events.some(e => e.id === event.id)).toBe(true);

    expect(saved.phase).toBe('installed'); expect(saved.registration).toBeUndefined(); // Never enabled/registered.
    await pic.stopLive();
  }, 300000);
});
