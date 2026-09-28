import { describe, expect, it } from 'vitest';

type ChatThread = { teamId: string; id: string; messages: string[] };

function recreateChatThreadForTeam(previous: ChatThread | null, newTeamId: string) {
  if (!previous) {
    return { id: `team:${newTeamId}:chat`, teamId: newTeamId, messages: [] } as const;
  }
  return { id: `team:${newTeamId}:chat`, teamId: newTeamId, messages: previous.messages.filter(() => false) } as const;
}

describe('team recreation chat isolation guard', () => {
  it('creates a fresh thread for a recreated team and does not copy old conversation payloads across team IDs', () => {
    const oldThread: ChatThread = { teamId: 'team-1', id: 'chat-old', messages: ['old-message'] };
    const newThread = recreateChatThreadForTeam(oldThread, 'team-1-recreated');

    expect(newThread).toMatchObject({ teamId: 'team-1-recreated', id: 'team:team-1-recreated:chat' });
    expect(newThread.messages).toEqual([]);
  });
});
