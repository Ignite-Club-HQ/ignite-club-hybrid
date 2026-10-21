// Real local router/identity/club transport; no production admission or routing activation.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
import { idlFactory as identityIdl } from '../lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as clubIdl } from '../lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as routerIdl } from '../lab/bindings/shard_router/declarations/shard_router.did.js';
import { createIdentityAccessClient } from '../lab/identityAccessClient';
const seam=vi.hoisted(() => ({ connect: undefined as any, identity: undefined as any, session: undefined as any }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: true }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => true, generalRoutingStatus: async () => ({ active: true, missing: [] }), cachedGeneralRoutingActive: () => true, clearGeneralRoutingCache: () => {} }));
vi.mock('./identityAccess', () => ({ connectLiveIdentityAccessClientWithIdentity: (...a: any[]) => seam.identity(...a) }));
vi.mock('./domains', () => ({ connectLiveClubDomain: (...a: any[]) => seam.connect(...a) }));
vi.mock('./groupSessionLive', () => ({ openLiveGroupReadSession: (...a: any[]) => seam.session(...a) }));
import { eraseIcpAccountAsAdmin, cancelIcpAccountDeletion } from './adminAccountDeletion';
import { GROUP_DOMAINS } from './groupRouting';
const enabled=Boolean(process.env.IDENTITY_ACCESS_WASM && process.env.CLUB_DOMAIN_WASM && process.env.SHARD_ROUTER_WASM && process.env.POCKET_IC_BIN);
const p=(n:number)=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1), user=p(2), linked=p(3), bystander=p(4), stranger=p(5);
const ok=(r:any)=>{ expect(r.Err).toBeUndefined(); expect('Ok' in r).toBe(true); return r.Ok; };
let server:PocketIcServer, pic:PocketIc;
describe.skipIf(!enabled)('real local admin deletion registry reservation',()=>{
  beforeAll(async()=>{ server=await PocketIcServer.start(); pic=await PocketIc.create(server.getUrl()); },60000);
  afterAll(async()=>{ await pic?.tearDown(); await server?.stop(); },60000);
  async function fixture(){
    const env=[{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}];
    const shared=await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],environmentVariables:env,
      arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
    const router=await pic.setupCanister({idlFactory:routerIdl,wasm:process.env.SHARD_ROUTER_WASM,sender:governor,controllers:[governor],
      arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
    router.actor.setPrincipal(governor); ok(await router.actor.set_deletion_authority(shared.canisterId));
    const clubs=[];
    for(const name of ['legacy','new']){
      const c=await pic.setupCanister({idlFactory:clubIdl,wasm:process.env.CLUB_DOMAIN_WASM,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
      c.actor.setPrincipal(governor); ok(await c.actor.create_club(name,name,name,[],[]));
      for(const principal of [user,linked,bystander]) ok(await c.actor.add_role_grant(principal,name,'player',[]));
      await pic.updateCanisterSettings({canisterId:c.canisterId,sender:governor,environmentVariables:env});
      ok(await c.actor.set_identity_access_canister(shared.canisterId));
      await pic.updateCanisterSettings({canisterId:c.canisterId,sender:governor,environmentVariables:[]});
      clubs.push(c);
    }
    const id=shared.actor; id.setPrincipal(governor); ok(await id.register_account()); ok(await id.set_club_authorities(clubs.map(c=>c.canisterId)));
    id.setPrincipal(user); const account=ok(await id.register_account()); const challenge=ok(await id.begin_link(linked));
    id.setPrincipal(linked); ok(await id.accept_link(challenge.id));
    for(const c of clubs){c.actor.setPrincipal(linked);ok(await c.actor.sync_my_linked_account());}
    const subnet=p(90); let revision=0n;
    const groups=clubs.map((c,i)=>({id:i?'new':'legacy',target_alias:'mainnet',domains:GROUP_DOMAINS.map((domain,n)=>({domain,canister:domain==='club_domain'?c.canisterId:domain==='secret_workload_identity'?p(70):p(20+i*20+n)})),
      accepting:true,max_clubs:100,assigned_clubs:0,heap_budget_bytes:1000000n,heap_bytes:0n,min_cycles:1n,cycles:1n,observed_at_ns:0n,photo_store:[]}));
    for(const g of groups){
      revision=ok(await router.actor.register_group(g,revision));
      revision=ok(await router.actor.register_group_placement({group_id:g.id,deployment_id:'boundary',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet',
        primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet}))},revision));
    }
    id.setPrincipal(governor); const manifest=ok(await id.read_removal_history_manifest());
    ok(await id.set_group_inventory_binding({registry:router.canisterId,registry_revision:revision,target_alias:'mainnet',deployment_id:'boundary',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'},manifest.revision));
    const targets=clubs.map(c=>({alias:'mainnet',host:'https://icp-api.io',networkKind:'public_mainnet',canisterIds:{club_domain:c.canisterId.toText(),identity_access:shared.canisterId.toText(),shard_router:router.canisterId.toText()}} as IcpTargetConfig));
    let beforePrepare: (()=>Promise<void>)|undefined, beforeCommit:(()=>Promise<void>)|undefined;
    const attempted:any[]=[];
    seam.identity=async(_t:any,human:Identity)=>{
      id.setPrincipal(human.getPrincipal()); const client=createIdentityAccessClient(id);
      return {client:{...client,prepareAccountDeletion:async(a:string,r:bigint)=>{await beforePrepare?.();id.setPrincipal(human.getPrincipal());return client.prepareAccountDeletion(a,r);},
        commitAccountDeletion:async(a:string)=>{await beforeCommit?.();id.setPrincipal(human.getPrincipal());return client.commitAccountDeletion(a);}}};
    };
    seam.connect=async(t:IcpTargetConfig,human:Identity)=>{
      const c=clubs.find(c=>c.canisterId.toText()===t.canisterIds.club_domain);if(!c)throw Error('Unknown club');
      c.actor.setPrincipal(human.getPrincipal());return {actor:c.actor};
    };
    seam.session=async()=>({deletionRegistryRevision:revision,dispose:()=>{},readEveryGroup:async()=>targets,
      assertRegistryUnchanged:async()=>{router.actor.setPrincipal(governor);const s=ok(await router.actor.read_group_registry('mainnet'));if(s.revision!==revision)throw Error('Group registry changed');}});
    const roles=async(i:number,subject:Principal)=>{clubs[i].actor.setPrincipal(subject);return clubs[i].actor.my_role_grants();};
    return {id,shared,router,clubs,targets,account,revision,groups,roles,attempted,
      beforePrepare:(f:()=>Promise<void>)=>{beforePrepare=f;},beforeCommit:(f:()=>Promise<void>)=>{beforeCommit=f;}};
  }
  it('blocks final-window group activation and placement, then erases all aliases while preserving other members',async()=>{
    const f=await fixture();
    f.beforeCommit(async()=>{
      f.router.actor.setPrincipal(governor);
      f.attempted.push(await f.router.actor.register_group({...f.groups[1],accepting:false},f.revision));
      f.attempted.push(await f.router.actor.place_my_new_club('00000000-0000-4000-8000-000000000001','mainnet'));
    });
    await eraseIcpAccountAsAdmin({getPrincipal:()=>governor} as Identity,f.targets[0],f.account.id);
    expect(f.attempted).toHaveLength(2);for(const result of f.attempted)expect(result).toEqual({Err:'Deletion registry locked'});
    for(const subject of [user,linked]){for(let i=0;i<2;i++)expect(await f.roles(i,subject)).toEqual([]);f.id.setPrincipal(subject);expect(await f.id.register_account()).toHaveProperty('Err');}
    for(let i=0;i<2;i++)expect(await f.roles(i,bystander)).toHaveLength(1);
    f.router.actor.setPrincipal(governor);expect(ok(await f.router.actor.record_group_health('new',1n,2n,f.revision))).toBe(f.revision+1n);
  },60000);
  it('rejects registry drift before reservation without deleting any membership',async()=>{
    const f=await fixture();f.beforePrepare(async()=>{f.router.actor.setPrincipal(governor);ok(await f.router.actor.record_group_health('new',1n,2n,f.revision));});
    await expect(eraseIcpAccountAsAdmin({getPrincipal:()=>governor} as Identity,f.targets[0],f.account.id)).rejects.toThrow('revision changed');
    for(let i=0;i<2;i++)expect(await f.roles(i,user)).toHaveLength(1);
    f.id.setPrincipal(user);expect(ok(await f.id.whoami()).id).toBe(f.account.id);
  },60000);
  it('does not commit until every real club denies every captured alias; locks survive upgrades and unauthorized release',async()=>{
    const f=await fixture();f.id.setPrincipal(governor);ok(await f.id.prepare_account_deletion(f.account.id,f.revision));
    expect(await f.id.erase_account(f.account.id)).toEqual({Err:'Bound deletion required'});
    expect(await f.id.commit_account_deletion(f.account.id)).toHaveProperty('Err');
    expect(await f.id.settle_account_deletion(f.account.id)).toHaveProperty('Err');
    f.router.actor.setPrincipal(stranger);expect(await f.router.actor.release_deletion_lock(f.account.id,f.revision)).toEqual({Err:'Deletion authority required'});
    await pic.upgradeCanister({canisterId:f.router.canisterId,sender:governor,wasm:process.env.SHARD_ROUTER_WASM});
    await pic.upgradeCanister({canisterId:f.shared.canisterId,sender:governor,wasm:process.env.IDENTITY_ACCESS_WASM});
    f.router.actor.setPrincipal(governor);expect(await f.router.actor.record_group_health('new',1n,2n,f.revision)).toEqual({Err:'Deletion registry locked'});
    await eraseIcpAccountAsAdmin({getPrincipal:()=>governor} as Identity,f.targets[0],f.account.id);
    for(let i=0;i<2;i++)expect(await f.roles(i,linked)).toEqual([]);
  },60000);
  it('retains reservation when the identity commit reply is lost and settles by confirmed erasure',async()=>{
    const f=await fixture();
    const original=seam.identity;
    seam.identity=async(...args:any[])=>{const c=await original(...args);return {client:{...c.client,
      commitAccountDeletion:async(a:string)=>{await c.client.commitAccountDeletion(a);throw Error('Commit reply lost');}}};};
    await expect(eraseIcpAccountAsAdmin({getPrincipal:()=>governor} as Identity,f.targets[0],f.account.id)).rejects.toThrow('reply lost');
    f.router.actor.setPrincipal(governor);expect(await f.router.actor.record_group_health('new',1n,2n,f.revision)).toEqual({Err:'Deletion registry locked'});
    for(let i=0;i<2;i++)expect(await f.roles(i,linked)).toEqual([]);
    f.id.setPrincipal(governor);ok(await f.id.settle_account_deletion(f.account.id));
    f.router.actor.setPrincipal(governor);ok(await f.router.actor.record_group_health('new',1n,2n,f.revision));
  },60000);
  it('blocks new and already-issued links, unlink and status changes while deletion holds the snapshot',async()=>{
    const f=await fixture();f.id.setPrincipal(user);const challenge=ok(await f.id.begin_link(stranger));
    f.id.setPrincipal(governor);ok(await f.id.prepare_account_deletion(f.account.id,f.revision));
    expect(await f.id.set_account_status(f.account.id,{Suspended:null})).toEqual({Err:'Deletion reservation pending'});
    expect(await f.id.rekey_principal(user,stranger,false)).toEqual({Err:'Deletion reservation pending'});
    f.id.setPrincipal(user);expect(await f.id.begin_link(stranger)).toEqual({Err:'Deletion reservation pending'});
    expect(await f.id.revoke(linked,ok(await f.id.whoami()).version)).toEqual({Err:'Deletion reservation pending'});
    f.id.setPrincipal(stranger);expect(await f.id.accept_link(challenge.id)).toEqual({Err:'Deletion reservation pending'});
    f.id.setPrincipal(governor);expect(await f.id.commit_account_deletion(f.account.id)).toHaveProperty('Err');
    f.router.actor.setPrincipal(governor);expect(await f.router.actor.record_group_health('new',1n,2n,f.revision)).toEqual({Err:'Deletion registry locked'});
    f.id.setPrincipal(user);expect(ok(await f.id.whoami()).id).toBe(f.account.id);
  },60000);
  it('cancel releases the reservation, preserves the account and memberships, and retries safely',async()=>{
    const f=await fixture();f.id.setPrincipal(governor);ok(await f.id.prepare_account_deletion(f.account.id,f.revision));
    f.router.actor.setPrincipal(governor);expect(await f.router.actor.record_group_health('new',1n,2n,f.revision)).toEqual({Err:'Deletion registry locked'});
    await cancelIcpAccountDeletion({getPrincipal:()=>governor} as Identity,f.targets[0],f.account.id);
    f.router.actor.setPrincipal(governor);const bumped=ok(await f.router.actor.record_group_health('new',1n,2n,f.revision));
    expect(await f.id.cancel_account_deletion(f.account.id)).toEqual({Err:'Missing deletion ticket'});
    f.id.setPrincipal(user);expect(ok(await f.id.whoami()).id).toBe(f.account.id);
    for(let i=0;i<2;i++)expect(await f.roles(i,user)).toHaveLength(1);
    // After cancellation the operator may repin to the advanced revision and delete normally.
    f.id.setPrincipal(governor);const manifest=ok(await f.id.read_removal_history_manifest());
    ok(await f.id.set_group_inventory_binding({registry:f.router.canisterId,registry_revision:bumped,target_alias:'mainnet',deployment_id:'boundary',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'},manifest.revision));
    ok(await f.id.prepare_account_deletion(f.account.id,bumped));
    for(const c of f.clubs){c.actor.setPrincipal(governor);ok(await c.actor.erase_account_membership(f.account.id));}
    f.id.setPrincipal(governor);ok(await f.id.commit_account_deletion(f.account.id));ok(await f.id.settle_account_deletion(f.account.id));
    for(let i=0;i<2;i++)expect(await f.roles(i,linked)).toEqual([]);
  },60000);
  it('refuses cancel after commit and recovers through settle',async()=>{
    const f=await fixture();f.id.setPrincipal(governor);ok(await f.id.prepare_account_deletion(f.account.id,f.revision));
    for(const c of f.clubs){c.actor.setPrincipal(governor);ok(await c.actor.erase_account_membership(f.account.id));}
    f.id.setPrincipal(governor);ok(await f.id.commit_account_deletion(f.account.id));
    expect(await f.id.cancel_account_deletion(f.account.id)).toEqual({Err:'Deletion already committed; settle instead'});
    ok(await f.id.settle_account_deletion(f.account.id));
    f.router.actor.setPrincipal(governor);ok(await f.router.actor.record_group_health('new',1n,2n,f.revision));
  },60000);
  it('retains the ticket when the reservation call fails and recovers by retry then cancel',async()=>{
    const f=await fixture();f.id.setPrincipal(governor);
    const manifest=ok(await f.id.read_removal_history_manifest());
    ok(await f.id.set_group_inventory_binding({registry:f.router.canisterId,registry_revision:f.revision+1n,target_alias:'mainnet',deployment_id:'boundary',deployment_revision:1n,host:'https://icp-api.io',network_kind:'public_mainnet'},manifest.revision));
    // The router is still at the old revision, so the reservation fails AFTER the ticket persists.
    expect(await f.id.prepare_account_deletion(f.account.id,f.revision+1n)).toEqual({Err:'Deletion registry revision changed'});
    // No lock was acquired: the registry stays writable and may drift.
    f.router.actor.setPrincipal(governor);const bumped=ok(await f.router.actor.record_group_health('new',1n,2n,f.revision));
    expect(bumped).toBe(f.revision+1n);
    // Retrying the exact same ticket now acquires the reservation.
    f.id.setPrincipal(governor);ok(await f.id.prepare_account_deletion(f.account.id,f.revision+1n));
    f.router.actor.setPrincipal(governor);expect(await f.router.actor.record_group_health('new',1n,2n,bumped)).toEqual({Err:'Deletion registry locked'});
    // And the retained reservation can still be abandoned cleanly.
    await cancelIcpAccountDeletion({getPrincipal:()=>governor} as Identity,f.targets[0],f.account.id);
    f.router.actor.setPrincipal(governor);ok(await f.router.actor.record_group_health('new',1n,2n,bumped));
    f.id.setPrincipal(user);expect(ok(await f.id.whoami()).id).toBe(f.account.id);
  },60000);
  it('opens the protocol with the production release flag alone, and stays closed without it',async()=>{
    const setup=async(environmentVariables:{name:string,value:string}[])=>{
      const c=await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.IDENTITY_ACCESS_WASM,sender:governor,controllers:[governor],environmentVariables,
        arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
      c.actor.setPrincipal(governor); ok(await c.actor.register_account()); return c.actor;
    };
    // No flag: the protocol stays closed.
    const closed=await setup([]);
    expect(await closed.prepare_account_deletion('anything',0n)).toEqual({Err:'Bound deletion not released'});
    // Production release flag alone (no local rehearsal flag): the gate opens and
    // the call proceeds to the real precondition checks.
    const released=await setup([{name:'IGNITE_BOUND_DELETION_RELEASE',value:'1'}]);
    expect(await released.prepare_account_deletion('anything',0n)).toEqual({Err:'Deletion registry not pinned'});
    for(const m of ['commit_account_deletion','cancel_account_deletion','settle_account_deletion'] as const){
      expect(await released[m]('anything')).toEqual({Err:'Missing deletion ticket'});
    }
  },60000);
});