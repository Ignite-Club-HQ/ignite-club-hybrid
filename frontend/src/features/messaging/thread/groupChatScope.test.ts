import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { groupChatReadScope } from './groupChatScope';

describe('group chat owner routing', () => {
  it('reuses the exact listed coaches club instead of discovering every group', () => {
    const client = new QueryClient();
    client.setQueryData(['my-chat-groups-with-messages', 'paul'], { groups: [{ id: 'coaches', club_id: 'giddy-goat' }, { id: 'committee', club_id: 'other-club' }] });
    expect(groupChatReadScope(client, 'paul', 'coaches')).toEqual({ clubId: 'giddy-goat' });
    expect(groupChatReadScope(client, 'paul', 'committee')).toEqual({ clubId: 'other-club' });
  });
  it('never uses another account or another conversation as ownership', () => {
    const client = new QueryClient();
    client.setQueryData(['my-chat-groups-with-messages', 'someone-else'], { groups: [{ id: 'coaches', club_id: 'private' }] });
    expect(groupChatReadScope(client, 'paul', 'coaches')).toEqual({ conversationId: 'coaches' });
    expect(groupChatReadScope(client, 'someone-else', 'different')).toEqual({ conversationId: 'different' });
  });
  it('uses the returned metadata owner for subsequent reads', () => {
    expect(groupChatReadScope(new QueryClient(), 'paul', 'coaches', 'authorized-club')).toEqual({ clubId: 'authorized-club' });
  });
});