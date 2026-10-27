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
  } };
});
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

    await preparePrivateOwnProfileName(ownerContext as any, afterName);
    expect(f.ok(await pii.read_private_club_name_lifecycle(f.owner, f.clubId, []))).toEqual([]);
    await refreshPrivateOwnClubNames(ownerContext as any, afterName, async () => [f.clubId, f.clubId]);
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
    const denied = f.connect('pii_access_control', f.outsider).actor;
    const audience = { kind: 'club', authority: f.services.club_domain.canisterId, resource: f.clubId, profile_revision: 0n };
    expect('Err' in await denied.get_private_profile_names_batch([subject], audience)).toBe(true);
    event.unmount(); chat.unmount(); queryClient.clear();
  }, 120000);
});