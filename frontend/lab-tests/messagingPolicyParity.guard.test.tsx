import { describe, expect, it } from 'vitest';

type MessagePolicyInput = {
  senderId: string;
  recipientId: string;
  threadMembers: string[];
  blockedUsers: string[];
};

function evaluateMessagePolicy(input: MessagePolicyInput) {
  if (input.blockedUsers.includes(input.senderId) || input.blockedUsers.includes(input.recipientId)) {
    return { ok: false, reason: 'blocked-recipient' } as const;
  }
  if (!input.threadMembers.includes(input.senderId) || !input.threadMembers.includes(input.recipientId)) {
    return { ok: false, reason: 'not-in-thread' } as const;
  }
  return { ok: true } as const;
}

describe('messaging policy parity guard', () => {
  it('keeps the conversation membership and recipient block list in sync before a message is accepted', () => {
    expect(evaluateMessagePolicy({
      senderId: 'u-1',
      recipientId: 'u-2',
      threadMembers: ['u-1', 'u-2'],
      blockedUsers: ['u-2'],
    })).toEqual({ ok: false, reason: 'blocked-recipient' });

    expect(evaluateMessagePolicy({
      senderId: 'u-1',
      recipientId: 'u-3',
      threadMembers: ['u-1', 'u-2'],
      blockedUsers: [],
    })).toEqual({ ok: false, reason: 'not-in-thread' });

    expect(evaluateMessagePolicy({
      senderId: 'u-1',
      recipientId: 'u-2',
      threadMembers: ['u-1', 'u-2'],
      blockedUsers: [],
    })).toEqual({ ok: true });
  });
});
