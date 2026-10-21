import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { configureProvisionGroup, groupConfigurationPlan } from './groupProvisionConfiguration';
import { PER_GROUP_DOMAINS, type Provision } from './groupProvisioner';
const enabled = Boolean(process.env.NEW_GROUP_FULL_REPLICA && process.env.POCKET_IC_BIN);
const principal = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = principal(1), member = principal(2), outsider = principal(3), worker = principal(4);
const ok = (r: any) => { expect(r.Err).toBeUndefined(); expect('Ok' in r).toBe(true); return r.Ok; };
const contracts = import.meta.glob('../lab/bindings/*/declarations/*.did.js');
let server: PocketIcServer, pic: PocketIc;
describe.skipIf(!enabled)('complete closed new-group real-service wiring', () => {
  beforeAll(async () => { server = await PocketIcServer.start(); pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } }); }, 60000);
  afterAll(async () => { await pic?.tearDown(); await server?.stop(); }, 60000);
  it('installs all twelve routed services plus blob storage, configures as governor and reads real business results', async () => {
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
      service.actor.setPrincipal(governor); services.set(name, service);
      if (name === 'timer_jobs') {
        service.actor.setPrincipal(outsider); expect(await service.actor.initialize()).toEqual({ Err: 'Controller required' });
        service.actor.setPrincipal(governor); ok(await service.actor.initialize());
      }
      return service;
    };
    for (const domain of PER_GROUP_DOMAINS) await install(domain);
    const blob = await install('media_blob_store');
    const identityModule = await load('identity_access');
    const identity = await pic.setupCanister({ idlFactory: identityModule.idlFactory, wasm: process.env.IDENTITY_ACCESS_WASM,
      sender: governor, controllers: [governor], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
    const globals = { identityAccess: identity.canisterId.toText(), pushWorker: worker.toText(), mediaBlobStore: blob.canisterId.toText() };
    let saved: Provision = { id: 'closed-complete', groupId: 'new', deploymentId: 'local', subnetId: principal(80).toText(), phase: 'installed', expectedRevision: 0n,
      installedDomains: [...PER_GROUP_DOMAINS], canisters: Object.fromEntries(PER_GROUP_DOMAINS.map(d => [d, services.get(d).canisterId.toText()])) };
    const checkpoints: Provision[] = [];
    let calls = 0;
    const transport = {
      verifyGovernor: async (id: string, operator: string) => {
        expect(operator).toBe(governor.toText());
        const status = await pic.canisterStatus({ canisterId: Principal.fromText(id), sender: governor });
        expect(status.settings.controllers.some(p => p.toText() === operator)).toBe(true);
      },
      call: async (id: string, method: string, args: unknown[]) => {
        const service = [...services.values()].find(s => s.canisterId.toText() === id);
        if (!service) throw Error('Foreign receiver');
        service.actor.setPrincipal(governor); calls++;
        try { return await service.actor[method](...args); } catch (e) { throw Error(`${[...services.entries()].find(([, s]) => s === service)?.[0]}.${method}: ${String(e)}`); }
      },
    };
    await configureProvisionGroup(saved, async p => { saved = structuredClone(p); checkpoints.push(saved); }, transport, governor.toText(), globals);
    expect(saved.configuration?.completed).toHaveLength(groupConfigurationPlan(saved, globals).length);
    expect(checkpoints.filter(p => p.pending?.kind === 'configure')).toHaveLength(calls);
    const firstCalls = calls;
    await configureProvisionGroup(saved, async p => { saved = structuredClone(p); }, transport, governor.toText(), globals);
    expect(calls).toBe(firstCalls); // Real acknowledged calls are not repeated.
    const actor = (name: string, user = governor) => { const a = services.get(name).actor; a.setPrincipal(user); return a; };
    // Actual consensus configuration reads—not the saved setup checklist.
    for (const [name] of services) {
      const reply = await actor(name).read_group_opening_configuration();
      const rows = name === 'timer_jobs' ? ok(reply) : reply;
      expect(Array.isArray(rows), name).toBe(true);
      if (name === 'timer_jobs') expect(await actor(name, outsider).read_group_opening_configuration()).toHaveProperty('Err');
      else await expect(actor(name, outsider).read_group_opening_configuration()).rejects.toThrow();
    }
    const clubConfig = await actor('club_domain').read_group_opening_configuration();
    expect(clubConfig).toContainEqual(['notification_queue', services.get('notification_queue').canisterId.toText()]);
    const blobConfig = await actor('media_blob_store').read_group_opening_configuration();
    expect(blobConfig).toEqual([['club_domain', services.get('club_domain').canisterId.toText()]]);
    const club = actor('club_domain');
    ok(await club.create_club('new-club', 'New club', 'new-club', [], []));
    ok(await club.add_role_grant(member, 'new-club', 'club_admin', []));
    const event = ok(await actor('events_domain', member).create_event('new-club', [], 'Training', 'Team training', 'training', [], [], [], [], 2000000000000n, 2000003600000n, [], false, [], []));
    expect((await actor('events_domain', member).list_events(['new-club'], [])).some((r: any) => r.id === event.id)).toBe(true);
    const chat = actor('messaging_domain', member);
    ok(await actor('club_domain', member).ensure_club_conversations('new-club'));
    const conversation = { id: 'new-club' };
    const message = ok(await chat.send_message(conversation.id, 'Connected group', 'full-group-message', [], []));
    expect(ok(await chat.list_messages_page(conversation.id, [], 10)).messages.some((m: any) => m.id === message.id)).toBe(true);
    const queue = actor('notification_queue', worker);
    const jobs = ok(await queue.claim(100000n, 50)); expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) ok(await queue.acknowledge(job.id, job.idempotency_key));
    await expect(actor('notification_queue', outsider).claim(100000n, 50)).rejects.toThrow();
    const pii = actor('pii_access_control', member);
    ok(await pii.register_pii('local-record', 'name', [1, 2, 3], member));
    expect(ok(await pii.get_encrypted_pii_batch(['local-record'], 'name', 'read', 'full-group')).length).toBe(1);
    const folder = ok(await actor('vault_domain', member).create_folder('folder', 'new-club', [], [], 'Training', [], [], [], 0, [], []));
    expect(folder.id).toBe('folder');
    const points = actor('club_points_domain', member);
    ok(await points.refresh_club_roles('new-club'));
    ok(await points.award_points('new-club', { User: member.toText() }, 'attendance', 'new-event', 7, 'Attendance', [], [], []));
    expect(ok(await points.get_user_points('new-club', member.toText()))).toBe(7);
    const competition = ok(await actor('competition_domain', member).create_competition('new-club', 'Cup', '2026'));
    expect(competition.id).toBeTruthy();
    const league = ok(await actor('mini_league_domain', member).create_mini_league('new-club', 'League', [], [], 5, 3, 10, ['red', 'green'], true));
    expect(league.id).toBeTruthy();
    expect(await actor('mini_league_domain', outsider).create_mini_league('new-club', 'Denied', [], [], 5, 3, 10, ['red'], true)).toHaveProperty('Err');
    const media = actor('media_metadata', member);
    const asset = ok(await media.register_asset('new-club', 'photo', 'image/jpeg', 'checksum', 'clubs/new-club/gallery/one.jpg', 'private', 99999999999999n));
    expect((await media.get_asset(asset.id))[0].id).toBe(asset.id);
    ok(await actor('insights_domain', member).record_web_vital('LCP', 12, 'good', '/group'));
    const timer = actor('timer_jobs');
    const job = ok(await timer.schedule('job', 'new-club', 0n, 'group-job'));
    expect((await timer.get_job(job.id))[0].id).toBe('job');
    expect(ok(await actor('timer_jobs', worker).claim(1n, 10)).some((j: any) => j.id === job.id)).toBe(true);
    ok(await actor('timer_jobs', worker).complete(job.id, 'group-job'));
    blob.actor.setPrincipal(member);
    const verification = DerivedPublicKey.deserialize(Uint8Array.from(await pii.pii_vetkey_verification_key()));
    const mediaIdentity = new TextEncoder().encode('clubmedia:new-club\u001fblob');
    const plain = new TextEncoder().encode('Private complete-group photo');
    const cipher = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(mediaIdentity), plain, IbeSeed.random()).serialize();
    const upload = ok(await blob.actor.begin_upload('clubs/new-club/gallery/one.jpg', 'image/jpeg', BigInt(cipher.length), 1));
    ok(await blob.actor.put_chunk(upload, 0, cipher)); ok(await blob.actor.finalize_upload(upload));
    const decryptPhoto = async () => {
      const transport = TransportSecretKey.random();
      const encryptedKey = ok(await actor('pii_access_control', member).get_club_media_vetkey('new-club', transport.publicKeyBytes()));
      const key = EncryptedVetKey.deserialize(Uint8Array.from(encryptedKey)).decryptAndVerify(transport, verification, mediaIdentity);
      const response = await blob.actor.http_request({ url: '/clubs/new-club/gallery/one.jpg', method: 'GET', headers: [], body: [] });
      expect(Array.from(IbeCiphertext.deserialize(Uint8Array.from(response.body)).decrypt(key))).toEqual(Array.from(plain));
    };
    await decryptPhoto();
    expect((await blob.actor.http_request({ url: '/clubs/new-club/gallery/one.jpg', method: 'GET', headers: [], body: [] })).status_code).toBe(200);
    blob.actor.setPrincipal(outsider);
    expect(await blob.actor.begin_upload('clubs/new-club/gallery/denied.jpg', 'image/jpeg', 3n, 1)).toEqual({ Err: 'Club membership required for upload' });
    for (const [name, service] of services) {
      expect(await service.actor.cycles_balance(), name).toBeGreaterThan(0n);
      let stats; try { stats = await service.actor.memory_stats(); } catch (e) { throw Error(`${name} health: ${String(e)}`); } expect(stats.memory_bytes, name).toBeGreaterThan(0n);
    }
    for (const [name, service] of services) {
      await pic.upgradeCanister({ canisterId: service.canisterId, sender: governor, wasm: process.env[`${name.toUpperCase()}_WASM`],
        ...(name === 'timer_jobs' ? {} : { upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }, arg: IDL.encode([IDL.Principal], [governor]) }) });
    }
    expect((await actor('events_domain', member).list_events(['new-club'], [])).some((r: any) => r.id === event.id)).toBe(true);
    expect(ok(await actor('messaging_domain', member).list_messages_page(conversation.id, [], 10)).messages.some((m: any) => m.id === message.id)).toBe(true);
    expect(ok(await actor('club_points_domain', member).get_user_points('new-club', member.toText()))).toBe(7);
    expect((await actor('media_metadata', member).get_asset(asset.id))[0].id).toBe(asset.id);
    await decryptPhoto();
    ok(await actor('club_domain').remove_member('new-club', member));
    expect(await actor('mini_league_domain', member).create_mini_league('new-club', 'Removed', [], [], 5, 3, 10, ['red'], true)).toHaveProperty('Err');
    expect(await actor('media_blob_store', member).begin_upload('clubs/new-club/gallery/removed.jpg', 'image/jpeg', 3n, 1)).toEqual({ Err: 'Club membership required for upload' });
    expect(await actor('pii_access_control', member).get_club_media_vetkey('new-club', TransportSecretKey.random().publicKeyBytes())).toHaveProperty('Err');
    expect(saved.phase).toBe('installed'); expect(saved.registration).toBeUndefined(); // Never enabled/registered by a health test.
  }, 120000);
});