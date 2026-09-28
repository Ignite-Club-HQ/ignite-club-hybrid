import { describe, expect, it } from 'vitest';

type InvitePlan = {
  recipients: string[];
  invalidRecipients: string[];
  duplicatesRemoved: number;
};

function buildBulkInvitePlan(recipients: string[], existingSent: Set<string>, clubId: string): InvitePlan {
  const cleaned = recipients
    .map((recipient) => recipient.trim())
    .filter(Boolean)
    .filter((recipient) => recipient.includes('@'))
    .filter((recipient) => !existingSent.has(`${clubId}:${recipient}`));

  const deduped = [...new Set(cleaned)];
  const invalidRecipients = recipients.filter((recipient) => !recipient.includes('@'));

  return {
    recipients: deduped,
    invalidRecipients,
    duplicatesRemoved: recipients.length - deduped.length,
  };
}

describe('bulk invitation workflow', () => {
  it('deduplicates recipients, rejects malformed emails and avoids resending already-sent invites', () => {
    const plan = buildBulkInvitePlan(
      ['alice@example.com', 'alice@example.com', 'bob', 'carol@example.com'],
      new Set(['club-1:carol@example.com']),
      'club-1',
    );

    expect(plan).toEqual({
      recipients: ['alice@example.com'],
      invalidRecipients: ['bob'],
      duplicatesRemoved: 3,
    });
  });
});
