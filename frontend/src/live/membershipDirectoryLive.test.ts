import { describe, it, expect, vi } from 'vitest';
import { MEMBERSHIP_LOOKUP_RELEASE_ENABLED, requireVerifiedDirectoryReply, convertReleasedDirectoryReply, releasedMembershipDirectoryReader } from './membershipDirectoryLive';
import type { Reply } from '../lab/bindings/identity_access/declarations/identity_access.did';

const diagnostic = (): Reply => ({ caller: { toText: () => 'caller' } as Reply['caller'], account_version: 7n,
  generation: 1n, registry_revision: 9n, inventory_digest: new Uint8Array(32), rows: [], next: [], verified_current: false });
describe('live lookup diagnostic release boundary', () => {
  it('constructs a lazy reader without requesting any memberships', async () => {
    expect(MEMBERSHIP_LOOKUP_RELEASE_ENABLED).toBe(true);
    expect(typeof releasedMembershipDirectoryReader()).toBe('function');
  });
  it('rejects diagnostic replies even when they are populated and identity-bound', () => {
    const reply = diagnostic();
    reply.rows = [{ club_id: 'club', group_id: 'g1', authority: reply.caller }];
    expect(() => requireVerifiedDirectoryReply(reply, 'caller')).toThrow('Stage A');
  });
  it('rejects changed callers, generations and oversized pages before using rows', () => {
    expect(() => requireVerifiedDirectoryReply(diagnostic(), 'other')).toThrow('changed');
    expect(() => requireVerifiedDirectoryReply({ ...diagnostic(), generation: 0n }, 'caller')).toThrow('changed');
    expect(() => requireVerifiedDirectoryReply({ ...diagnostic(), inventory_digest: new Uint8Array(31) }, 'caller')).toThrow('changed');
    expect(() => requireVerifiedDirectoryReply({ ...diagnostic(), rows: Array.from({ length: 101 }, () => ({ club_id: 'club', group_id: 'g1', authority: diagnostic().caller })) }, 'caller')).toThrow('changed');
  });
});
const mockActor = vi.hoisted(()=>({read:vi.fn(),create:vi.fn()}));
vi.mock('./icpAgent',()=>({createLiveActor:mockActor.create}));
describe('lazy actor traversal binding',()=>{
  const context = () => ({identity:{getPrincipal:()=>principal('caller')},target:{host:'https://icp-api.io',canisterIds:{identity_access:'identity'}}}) as unknown as import('./featureRouter').FeatureBackendContext;
  it('keeps one consumer across pages and separates concurrent traversals',async()=>{
    mockActor.create.mockResolvedValue({actor:{read_my_membership_directory:mockActor.read}});
    mockActor.read.mockResolvedValue({Ok:released()});
    const read=releasedMembershipDirectoryReader(),ctx=context();
    await read(ctx,null,fingerprint);await read(ctx,{instance:8n,sequence:1n},fingerprint);
    const calls=mockActor.read.mock.calls;
    expect(calls.at(-2)?.[0]).toBe(calls.at(-1)?.[0]);expect(calls.at(-1)?.[1]).toEqual([{instance:8n,sequence:1n}]);
    await releasedMembershipDirectoryReader()(ctx,null,fingerprint);
    expect(mockActor.read.mock.calls.at(-1)?.[0]).not.toBe(calls.at(-2)?.[0]);
  });
  it('rejects identity and target changes during the actual actor await',async()=>{
    for(const change of [(ctx:ReturnType<typeof context>)=>{ctx.identity={getPrincipal:()=>principal('other')} as typeof ctx.identity;},
      (ctx:ReturnType<typeof context>)=>{ctx.target.host='https://foreign.invalid';}]){
      const ctx=context();mockActor.create.mockResolvedValue({actor:{read_my_membership_directory:mockActor.read}});
      mockActor.read.mockImplementation(async()=>{change(ctx);return {Ok:released()};});
      await expect(releasedMembershipDirectoryReader()(ctx,null,fingerprint)).rejects.toThrow('changed');
    }
  });
});
const principal = (value: string) => ({ toText: () => value });
const registry = () => ({ revision: 9n, groups: [{ id:'g2',target_alias:'mainnet',domains:[{domain:'club_domain',canister:principal('g2-club')}]}],
  placements:[{group_id:'g2',host:'https://icp-api.io',network_kind:'public_mainnet',deployment_id:'mainnet',deployment_revision:1n,
    primary_subnet:principal('subnet'),approved_subnets:[principal('subnet')],additional_subnets_enabled:false,
    domains:[{domain:'club_domain',canister:principal('g2-club'),subnet:principal('subnet')}]}] });
const fingerprint = JSON.stringify({revision:'9',groups:[{id:'g2',targetAlias:'mainnet',domains:[{domain:'club_domain',canisterId:'g2-club'}]}],
  deployment:{host:'https://icp-api.io',networkKind:'public_mainnet',id:'mainnet',revision:'1',primarySubnet:'subnet',approvedSubnets:['subnet'],additionalSubnetsEnabled:false},
  bindings:[{groupId:'g2',deploymentId:'mainnet',deploymentRevision:'1',domains:[{domain:'club_domain',canisterId:'g2-club',subnetId:'subnet'}]}]});
const released = () => ({ page:{...diagnostic(),verified_current:true,rows:[{club_id:'club',group_id:'g2',authority:principal('g2-club')}]},instance:8n,release:'a'.repeat(40),registry:registry(),photo_stores:[['g2',[]]] }) as unknown as import('../lab/bindings/identity_access/declarations/identity_access.did').ReleasedReply;
describe('released page conversion',()=>{
  it('accepts populated owner-bound replies and terminal instance without fabricating registry evidence',()=>{
    const page=convertReleasedDirectoryReply(released(),'caller',fingerprint);
    expect(page.assignments).toEqual([{clubId:'club',groupId:'g2',revision:9n}]);expect(page.instance).toBe(8n);expect(page.next).toBeNull();
  });
  it('rejects caller, release, authority and complete registry drift',()=>{
    expect(()=>convertReleasedDirectoryReply(released(),'other',fingerprint)).toThrow();
    for(const change of [
      (r: ReturnType<typeof released>)=>{r.release='bad';},
      (r: ReturnType<typeof released>)=>{r.registry.revision=10n;},
      (r: ReturnType<typeof released>)=>{r.registry.groups=[];},
      (r: ReturnType<typeof released>)=>{r.registry.placements[0].host='https://foreign.invalid';},
      (r: ReturnType<typeof released>)=>{r.page.rows[0].authority=principal('foreign') as Reply['caller'];},
      (r: ReturnType<typeof released>)=>{r.instance=0n;},
      (r: ReturnType<typeof released>)=>{r.photo_stores=[['g2',[principal('foreign-store') as Reply['caller']]]];},
      (r: ReturnType<typeof released>)=>{r.registry.groups[0].domains=[r.registry.groups[0].domains[0],r.registry.groups[0].domains[0]];},
    ]){const r=released();change(r);expect(()=>convertReleasedDirectoryReply(r,'caller',fingerprint)).toThrow();}
  });
  it('allows only pinned original G1 as an unregistered legacy source',()=>{
    const r=released();r.page.rows=[{club_id:'legacy',group_id:'g1',authority:principal('mzzzv-taaaa-aaaal-qxlrq-cai') as Reply['caller']}];
    expect(convertReleasedDirectoryReply(r,'caller',fingerprint).legacyClubs).toEqual(['legacy']);
    r.page.rows[0].group_id='g3';expect(()=>convertReleasedDirectoryReply(r,'caller',fingerprint)).toThrow('legacy');
  });
});
