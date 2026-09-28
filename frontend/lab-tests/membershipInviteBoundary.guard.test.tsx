import { describe, expect, it } from 'vitest';

type InviteRequest = {
  inviterClubId: string;
  inviteeClubId: string;
  canInvite: boolean;
};

function validateInviteBoundary(request: InviteRequest) {
  if (!request.canInvite) {
    return { ok: false, reason: 'not-authorized' } as const;
  }
  if (request.inviterClubId !== request.inviteeClubId) {
    return { ok: false, reason: 'cross-club-invite' } as const;
  }
  return { ok: true } as const;
}

describe('membership invite boundary guard', () => {
  it('rejects cross-club invites and allows in-club invitations only', () => {
    expect(validateInviteBoundary({ inviterClubId: 'club-1', inviteeClubId: 'club-2', canInvite: true })).toEqual({ ok: false, reason: 'cross-club-invite' });
    expect(validateInviteBoundary({ inviterClubId: 'club-1', inviteeClubId: 'club-1', canInvite: true })).toEqual({ ok: true });
  });
});
