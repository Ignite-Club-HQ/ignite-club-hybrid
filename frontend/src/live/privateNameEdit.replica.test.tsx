import { webcrypto } from 'node:crypto';
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
import { removeMemberAndReconcileNames } from '../../../scripts/private-name-replica-lifecycle.mjs';
import { createPrivateNameLifecycleAdapter } from '../../../scripts/private-name-canister-adapters.mjs';
import { Principal } from '@icp-sdk/core/principal';

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
    expect(f.ok(await cleanupReader.read_private_name_cleanup_account(f.viewer)).original_authority).toEqual({ Unresolved: null });
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
    // One retained operation connects actual authorized club removal to the
    // governor-only exact-byte cleanup. Both lost replies settle without replay.
    const club = f.connect('club_domain', f.governor).actor;
    const governorPii = f.connect('pii_access_control', f.governor).actor;
    const target = { sink: f.services.pii_access_control.canisterId.toText(), subject, club: f.clubId, ciphertext: unchangedBytes };
    const adapter = createPrivateNameLifecycleAdapter({ targets: [target], actors: new Map([[target.sink, governorPii]]), Principal, assertFence: async () => true });
    let journal: any = null, purges = 0, removals = 0;
    const cleanup = { ...adapter, accounts: [{ accountId: subject, principals: [subject] }], assertEvidence: async () => true,
      readMembership: async (t: any) => club.read_has_club_membership(Principal.fromText(t.subject), t.club),
      removeMember: async (t: any) => { removals++; f.ok(await club.remove_member(t.club, Principal.fromText(t.subject))); throw Error('Lost committed member-removal reply'); },
      readJournal: async () => structuredClone(journal), persistJournal: async (value: any) => { journal = structuredClone(value); },
      purgeExactReplica: async (value: any) => { purges++; await adapter.purgeExactReplica(value); throw Error('Lost removed-member purge reply'); },
    };
    const cleanupPlan = { operationId: 'acceptance-member-removal', action: 'purge', targets: [target] };
    await expect(removeMemberAndReconcileNames(cleanupPlan, cleanup)).rejects.toThrow('Lost committed member-removal reply');
    expect(purges).toBe(0); expect(removals).toBe(1);
    await expect(removeMemberAndReconcileNames(cleanupPlan, cleanup)).rejects.toThrow('Lost removed-member purge reply');
    expect(await removeMemberAndReconcileNames(cleanupPlan, cleanup)).toEqual({ completed: 1, action: 'purge' });
    expect(removals).toBe(1);
    expect(purges).toBe(1); expect(f.ok(await governorPii.read_private_club_name_lifecycle(f.owner, f.clubId, []))).toEqual([]);
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    expect(f.ok(await governorPii.get_encrypted_pii_batch([subject], 'display_name', 'read', 'Verify original retained'))).toHaveLength(1);
    const governorIdentity = f.connect('identity_access', f.governor).actor;
    // Existing coordinated suspension cannot be bypassed for a fixture.
    expect('Err' in await governorIdentity.set_account_status(routing.account_id, { Suspended: null })).toBe(true);
    const retainedRouting = f.ok(await cleanupReader.read_private_name_cleanup_account(f.owner));
    expect(retainedRouting.principals.map((p: any) => p.toText())).toEqual([subject]);
    expect(retainedRouting.original_authority).toEqual(routing.original_authority);
    // Registry mutation cannot silently repin the cleanup authority.
    const router = f.services.shard_router.actor;
    router.setPrincipal(f.governor);
    f.ok(await router.stop_group_new_placements('g1', 'mainnet', await router.version()));
    expect('Err' in await cleanupReader.read_private_name_cleanup_account(f.owner)).toBe(true);
  }, 120000);
});