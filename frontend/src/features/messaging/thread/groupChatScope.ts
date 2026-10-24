import type { QueryClient } from '@tanstack/react-query';
import type { ClubScope } from '@/live/featureRouter';

/** Inbox rows locate a chat only; the destination still checks participation. */
export function groupChatReadScope(queryClient: QueryClient, userId: string | undefined, groupId: string, clubId?: string | null): ClubScope {
  if (clubId) return { clubId };
  if (userId) {
    const inbox = queryClient.getQueryData<{ groups?: Array<{ id: string; club_id?: string | null }> }>(['my-chat-groups-with-messages', userId]);
    const owner = inbox?.groups?.find(group => group.id === groupId)?.club_id;
    if (owner) return { clubId: owner };
  }
  return { conversationId: groupId };
}