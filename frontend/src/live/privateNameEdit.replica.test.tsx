import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IDL } from '@icp-sdk/core/candid';
import { act, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Only actor construction, feature dispatch and fixture evidence are replaced.
// Writes, ciphertext, authorization, key relay, SDK crypto and UI remain real.
const local = vi.hoisted(() => ({ fixture: null as any, context: null as any }));
vi.mock('./domains', () => ({
  connectLivePiiAccessControl: async (_target: unknown, identity: any) => local.fixture.connect('pii_access_control', identity.getPrincipal()),
  connectLiveMessagingDomain: async (_target: unknown, identity: any) => local.fixture.connect('messaging_domain', identity.getPrincipal()),
  connectLiveClubDomain: async (_target: unknown, identity: any) => local.fixture.connect('club_domain', identity.getPrincipal()),
}));
vi.mock('./identityAccess', async () => {
  const { createIdentityAccessClient } = await import('../lab/identityAccessClient');
  return { connectLiveIdentityAccessClientWithIdentity: async (_target: unknown, identity: any) => {
    const connection = local.fixture.connect('identity_access', identity.getPrincipal());
    return { canisterId: connection.canisterId, client: createIdentityAccessClient(connection.actor) };
  }, isLiveIdentityAccessConfigured: () => true };
});
vi.mock('./features/membership', () => ({ getLiveMyRoleGrants: async () => [{ club: [local.fixture.clubId] }] }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: any) => providers.icp(local.context) }));
vi.mock('./privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: () => true }));
vi.mock('./loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => true }));
// Closed action sheets are outside name-display acceptance and otherwise
// demand the complete application authentication shell.
vi.mock('../components/chat/ForwardMessageSheet', () => ({ ForwardMessageSheet: () => null }));
vi.mock('../components/chat/ReportMessageDialog', () => ({ ReportMessageDialog: () => null }));
vi.mock('../components/BlockUserDialog', () => ({ BlockUserDialog: () => null }));
vi.mock('./privateProfileEvidence', () => ({ readPrivateProfileEvidence: async () => ({ disposableOnly: true }) }));
vi.mock('./privateProfileAuthority', () => ({ createLivePrivateProfileAuthorityResolver: () => async (authority: string) => {
  if (authority !== local.context.target.canisterIds.pii_access_control) throw Error('Foreign fixture authority');
  return { context: local.context, confirm: async () => {} };
} }));

import { createNameEditFixture } from '../../scripts/private-name-edit-fixture.mjs';
import { preparePrivateOwnProfileName, refreshPrivateOwnClubNames, privateProfileNameReference } from './privateProfileNames';
import { usePrivateChatProfiles } from '../hooks/usePrivateChatProfiles';
import { readRelationshipProfiles } from './relationshipProfileRead';
import { hydrateRsvpDisplayProfiles } from '../features/events/rsvpDisplayProfiles';
import { EventAttendeeCard } from '../components/event/EventAttendeeCard';
import { GroupChatMessageRow } from '../components/chat/GroupChatMessageRow';
import { saveIcpIdentityProfile } from './identityProfile';

describe.runIf(process.env.IGNITE_NAME_EDIT_REPLICA === '1')('real disposable encrypted person-name edit', () => {
  beforeAll(async () => {
    vi.stubGlobal('crypto', webcrypto);
    local.fixture = await createNameEditFixture();
  }, 120000);
  afterAll(async () => { await local.fixture?.close(); vi.unstubAllGlobals(); });

  it('updates saved club ciphertext, refreshes mounted chat names and decrypts event attendees using one cached club key', async () => {
    const f = local.fixture;
    const context = (user: any) => ({ identity: { getPrincipal: () => user }, target: { alias: 'disposable-name-edit', host: 'http://127.0.0.1:4943', networkKind: 'public_mainnet', canisterIds: Object.fromEntries(Object.entries(f.services).map(([domain, service]: [string, any]) => [domain, service.canisterId.toText()])) } });
    const ownerContext = context(f.owner), viewerContext = context(f.viewer);
    const subject = f.owner.toText();
    const beforeName = 'Acceptance Person Before', afterName = 'Acceptance Person After';
    const reference = await preparePrivateOwnProfileName(ownerContext as any, beforeName);
    expect(reference).toBe(privateProfileNameReference(f.services.pii_access_control.canisterId.toText(), subject));
    const identity = f.connect('identity_access', f.owner).actor;
    f.ok(await identity.set_profile(reference, [])); // Disposable conversion fixture only.
    await refreshPrivateOwnClubNames(ownerContext as any, beforeName, async () => [f.clubId]);
    const pii = f.connect('pii_access_control', f.owner).actor;
    const oldCopy = f.ok(await pii.read_private_club_name_lifecycle(f.owner, f.clubId, []))[0];
    expect(oldCopy.master_key_id).toBe(`vetkey-club-names-v1:${f.clubId}`);
    const storedProfile = f.ok(await identity.get_profile());
    expect(storedProfile.display_name).toBe(reference);
    // Real trusted service caller, not an owner/browser alias list.
    const cleanupReader = f.connect('identity_access', f.services.club_domain.canisterId).actor;
    const routing = f.ok(await cleanupReader.read_private_name_cleanup_account(f.owner));
    expect(routing.principals.map((p: any) => p.toText())).toEqual([subject]);
    expect(routing.original_authority).toEqual({ Existing: { sink: f.services.pii_access_control.canisterId, subject: f.owner } });
    expect(Object.keys(routing).sort()).toEqual(['account_id','account_version','original_authority','principals','revision']);
    expect('Err' in await identity.read_private_name_cleanup_account(f.owner)).toBe(true);
    expect('Err' in await f.connect('identity_access', f.outsider).actor.read_private_name_cleanup_account(f.owner)).toBe(true);
    const unrelatedService = f.connect('identity_access', f.services.pii_access_control.canisterId).actor;
    expect('Err' in await unrelatedService.read_private_name_cleanup_account(f.owner)).toBe(true);
    expect(f.ok(await cleanupReader.read_private_name_cleanup_account(f.outsider)).original_authority).toEqual({ NoName: null });
    const viewerIdentity = f.connect('identity_access', f.viewer).actor;
    f.ok(await viewerIdentity.set_profile('Unconverted person', []));
    expect(f.ok(await cleanupReader.read_private_name_cleanup_account(f.viewer)).original_authority).toEqual({ NoName: null });
    local.context = viewerContext;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const msg = { id: f.message.id, text: f.message.text, image_url: null, created_at: new Date().toISOString(), author_id: subject, group_id: f.conversationId, reply_to_id: null };
    function Chat() {
      const getProfile = usePrivateChatProfiles(f.conversationId, f.viewer.toText(), [subject], true);
      return <GroupChatMessageRow msg={msg} messagesById={new Map([[msg.id, msg]])} isOwnMessage={false} isAdmin={false} highlightedMessageId={null} messageReactions={[]} userId={f.viewer.toText()} getProfile={getProfile} readFrontier={{}} readCounts={{}} handleReply={() => {}} handleEdit={() => {}} deleteMessageMutation={{ mutate: () => {} }} toggleReactionMutation={{ mutate: () => {} }} />;
    }
    const chat = render(<QueryClientProvider client={queryClient}><Chat /></QueryClientProvider>);
    await waitFor(() => expect(within(chat.container).getByText(beforeName)).toBeTruthy(), { timeout: 15000 });
    expect(f.counters.clubUnlocks).toBe(1);

    // Exercise the shared save used by both Edit Profile and immediate avatar
    // changes, not just standalone encryption/copy helpers.
    const saved = await saveIcpIdentityProfile(ownerContext.identity as any, subject, { displayName: afterName }, ownerContext.target as any);
    expect(saved.privateNameMaintained).toBe(true);
    expect(saved.displayName).toBe(afterName);
    const newCopy = f.ok(await pii.read_private_club_name_lifecycle(f.owner, f.clubId, []))[0];
    expect(Array.from(newCopy.ciphertext)).not.toEqual(Array.from(oldCopy.ciphertext));
    expect(newCopy.master_key_id).toBe(oldCopy.master_key_id);
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    act(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
    await waitFor(() => expect(within(chat.container).getByText(afterName)).toBeTruthy(), { timeout: 15000 });
    expect(within(chat.container).queryByText(beforeName)).toBeNull();

    // Separate authorized event-reader call, not a plaintext chat-name prop.
    const eventProfiles = await readRelationshipProfiles(viewerContext as any, [subject], { kind: 'club', resource: f.clubId });
    const rsvp = { id: 'acceptance-rsvp', user_id: subject, status: 'going', profiles: null };
    const rows = hydrateRsvpDisplayProfiles([rsvp], eventProfiles.map(row => ({ id: row.account_id, display_name: row.display_name })));
    expect(rows[0].user_id).toBe(subject); expect(rows[0].status).toBe('going');
    expect(rows[0].profiles?.display_name).toBe(afterName);
    const event = render(<EventAttendeeCard rsvp={rows[0]} currentStatus="going" />);
    expect(within(event.container).getByText(afterName)).toBeTruthy();
    expect(within(event.container).queryByText(beforeName)).toBeNull();
    expect(f.counters.clubUnlocks).toBe(1);
    const unchangedBytes = Array.from(newCopy.ciphertext);
    await saveIcpIdentityProfile(ownerContext.identity as any, subject, { displayName: afterName, avatarRef: 'acceptance-avatar' }, ownerContext.target as any);
    expect(Array.from(f.ok(await pii.read_private_club_name_lifecycle(f.owner, f.clubId, []))[0].ciphertext)).toEqual(unchangedBytes);
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    const denied = f.connect('pii_access_control', f.outsider).actor;
    const audience = { kind: 'club', authority: f.services.club_domain.canisterId, resource: f.clubId, profile_revision: 0n };
    expect('Err' in await denied.get_private_profile_names_batch([subject], audience)).toBe(true);
    event.unmount(); chat.unmount(); queryClient.clear();
    await f.pic.upgradeCanister({canisterId:f.services.identity_access.canisterId,sender:f.governor,wasm:readFileSync('../target/private-name-cleanup/wasm32-unknown-unknown/release/identity_access.wasm'),arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor:f.governor}])});
    // Disable private read/conversion rehearsal on the real disposable sinks.
    // Automatic cleanup must work under its separate production switch only.
    await f.pic.updateCanisterSettings({ canisterId:f.services.club_domain.canisterId,sender:f.governor,environmentVariables:[{name:'IGNITE_PRIVATE_NAME_CLEANUP_RELEASE',value:'1'}] });
    await f.pic.upgradeCanister({ canisterId:f.services.club_domain.canisterId,sender:f.governor,wasm:readFileSync('../backend/club_domain/.mops/.build/club_domain.wasm'),arg:IDL.encode([IDL.Principal],[f.governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]} });
    const releasePiiSettings=[{name:'IGNITE_PRIVATE_NAME_CLEANUP_RELEASE',value:'1'},{name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:f.services.identity_access.canisterId.toText()},{name:'VETKD_KEY_NAME',value:'key_1'}];
    await f.pic.updateCanisterSettings({canisterId:f.services.pii_access_control.canisterId,sender:f.governor,environmentVariables:releasePiiSettings});
    await f.pic.upgradeCanister({canisterId:f.services.pii_access_control.canisterId,sender:f.governor,wasm:readFileSync('../backend/pii_access_control/.mops/.build/pii_access_control.wasm'),arg:IDL.encode([IDL.Principal],[f.governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]} });
    // Ordinary authorized removal, not the operator helper, persists an intent
    // and automatically invokes the original PII receiver as the club itself.
    const club = f.connect('club_domain', f.governor).actor;
    const governorPii = f.connect('pii_access_control', f.governor).actor;
    expect(await club.read_has_club_membership(f.owner, f.clubId)).toBe(true);
    expect('Err' in await governorPii.read_private_club_name_lifecycle(f.owner,f.clubId,[])).toBe(true);
    const cleanupPii=f.connect('pii_access_control',f.services.identity_access.canisterId).actor;
    expect(f.ok(await cleanupPii.read_private_name_cleanup_absence([f.owner],[f.clubId]))).toBe(false);
    // Removing one role must preserve names while another role grants access.
    f.ok(await club.add_role_grant(f.owner, f.clubId, 'coach', []));
    f.ok(await club.remove_role_grant(f.owner, f.clubId, 'coach', []));
    expect(f.ok(await club.read_private_name_cleanup_pending())).toEqual([]);
    expect(f.ok(await cleanupPii.read_private_name_cleanup_absence([f.owner],[f.clubId]))).toBe(false);
    expect('Err' in await denied.purge_removed_private_club_name('forged', f.clubId, f.owner)).toBe(true);
    console.log('BEFORE (disposable account): membership=true; club-name copies=1; original private name=retained');
    f.ok(await club.remove_member(f.clubId, f.owner));
    for (let step = 0; step < 60; step++) {
      await f.pic.tick();
      if (f.ok(await club.read_private_name_cleanup_pending()).length === 0) break;
    }
    expect(f.ok(await club.read_private_name_cleanup_pending())).toEqual([]);
    expect(await club.read_has_club_membership(f.owner, f.clubId)).toBe(false);
    expect(f.ok(await cleanupPii.read_private_name_cleanup_absence([f.owner],[f.clubId]))).toBe(true);
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    expect(f.ok(await governorPii.get_encrypted_pii_batch([subject], 'display_name', 'read', 'Verify original retained'))).toHaveLength(1);
    console.log('AFTER (disposable account): membership=false; club-name copies=0; original private name=retained; automatic cleanup completed');
    // Recreate the disposable membership/copy for a last-role removal, stop
    // routing, and upgrade the club before resuming the same retained intent.
    f.ok(await club.restore_member(f.clubId, f.owner));
    f.ok(await club.add_role_grant(f.owner, f.clubId, 'member', []));
    await f.pic.updateCanisterSettings({canisterId:f.services.pii_access_control.canisterId,sender:f.governor,environmentVariables:[...releasePiiSettings,{name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'1'}]});
    await f.pic.upgradeCanister({canisterId:f.services.pii_access_control.canisterId,sender:f.governor,wasm:readFileSync('../backend/pii_access_control/.mops/.build/pii_access_control.wasm'),arg:IDL.encode([IDL.Principal],[f.governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]} });
    await refreshPrivateOwnClubNames(ownerContext as any, afterName, async () => [f.clubId]);
    await f.pic.updateCanisterSettings({canisterId:f.services.pii_access_control.canisterId,sender:f.governor,environmentVariables:releasePiiSettings});
    await f.pic.upgradeCanister({canisterId:f.services.pii_access_control.canisterId,sender:f.governor,wasm:readFileSync('../backend/pii_access_control/.mops/.build/pii_access_control.wasm'),arg:IDL.encode([IDL.Principal],[f.governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]} });
    await f.pic.stopCanister({ canisterId: f.services.identity_access.canisterId, sender: f.governor });
    f.ok(await club.remove_role_grant(f.owner, f.clubId, 'member', []));
    for (let step = 0; step < 10; step++) await f.pic.tick();
    const held = f.ok(await club.read_private_name_cleanup_pending());
    expect(held).toHaveLength(1); expect(held[0].submitted).toBe(false);
    expect(f.ok(await cleanupPii.read_private_name_cleanup_absence([f.owner],[f.clubId]))).toBe(false);
    const identityClub=f.connect('club_domain',f.services.identity_access.canisterId).actor;
    expect('Err' in await identityClub.revoke_linked_principal(routing.account_id,f.owner,routing.account_version)).toBe(true);
    expect(f.ok(await club.read_private_name_cleanup_pending())).toEqual(held);
    await expect(club.add_role_grant(f.owner, f.clubId, 'member', [])).rejects.toThrow('Name cleanup pending');
    await f.pic.upgradeCanister({ canisterId: f.services.club_domain.canisterId, sender: f.governor,
      wasm: readFileSync('../backend/club_domain/.mops/.build/club_domain.wasm'),
      arg: IDL.encode([IDL.Principal], [f.governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    expect(f.ok(await club.read_private_name_cleanup_pending())).toEqual(held);
    await f.pic.startCanister({ canisterId: f.services.identity_access.canisterId, sender: f.governor });
    f.ok(await club.resume_private_name_cleanup());
    expect(f.ok(await club.read_private_name_cleanup_pending())).toEqual([]);
    expect(f.ok(await cleanupPii.read_private_name_cleanup_absence([f.owner],[f.clubId]))).toBe(true);
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    console.log('RECOVERY (disposable account): last-role cleanup retained through service outage and club upgrade; resumed with original name preserved');
    // Ordinary unconverted names have no replicas; authoritative all-sink
    // absence settles the no-op instead of locking every membership forever.
    f.ok(await club.remove_member(f.clubId,f.viewer));
    for(let step=0;step<60;step++){await f.pic.tick();if(f.ok(await club.read_private_name_cleanup_pending()).length===0)break;}
    expect(f.ok(await club.read_private_name_cleanup_pending())).toEqual([]);
    expect(f.ok(await viewerIdentity.get_profile()).display_name).toBe('Unconverted person');
    const governorIdentity = f.connect('identity_access', f.governor).actor;
    // Cleanup-only identity uses ordinary production status semantics; no
    // private-name conversion/read rehearsal was activated by its upgrade.
    f.ok(await governorIdentity.set_account_status(routing.account_id, { Suspended: null }));
    const retainedRouting = f.ok(await cleanupReader.read_private_name_cleanup_account(f.owner));
    expect(retainedRouting.principals.map((p: any) => p.toText())).toEqual([subject]);
    expect(retainedRouting.original_authority).toEqual(routing.original_authority);
    // Registry mutation cannot silently repin the cleanup authority.
    const router = f.services.shard_router.actor;
    router.setPrincipal(f.governor);
    const group = f.ok(await router.list_groups())[0];
    f.ok(await router.register_group({ ...group, max_clubs: group.max_clubs + 1 }, await router.version()));
    expect('Err' in await cleanupReader.read_private_name_cleanup_account(f.owner)).toBe(true);
  }, 120000);
});