import { describe, expect, it } from 'vitest';

type EventDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  clubId: string;
  audience: 'club' | 'team';
};

function validateEventSubmission(draft: EventDraft) {
  if (!draft.title.trim()) {
    return { ok: false, reason: 'missing-title' } as const;
  }
  if (Number(new Date(draft.startsAt)) <= 0 || Number(new Date(draft.endsAt)) <= 0) {
    return { ok: false, reason: 'invalid-dates' } as const;
  }
  if (new Date(draft.startsAt).getTime() >= new Date(draft.endsAt).getTime()) {
    return { ok: false, reason: 'end-before-start' } as const;
  }
  if (!draft.clubId || draft.clubId.trim().length === 0) {
    return { ok: false, reason: 'missing-club' } as const;
  }
  return { ok: true, audience: draft.audience } as const;
}

describe('event submission gate', () => {
  it('blocks incomplete or chronologically invalid submissions while allowing valid club-scoped events', () => {
    expect(validateEventSubmission({
      title: '',
      startsAt: '2026-10-10T18:00:00Z',
      endsAt: '2026-10-10T19:00:00Z',
      clubId: 'club-1',
      audience: 'club',
    })).toEqual({ ok: false, reason: 'missing-title' });

    expect(validateEventSubmission({
      title: 'Match day',
      startsAt: '2026-10-10T19:00:00Z',
      endsAt: '2026-10-10T18:00:00Z',
      clubId: 'club-1',
      audience: 'team',
    })).toEqual({ ok: false, reason: 'end-before-start' });

    expect(validateEventSubmission({
      title: 'Training night',
      startsAt: '2026-10-10T18:00:00Z',
      endsAt: '2026-10-10T19:00:00Z',
      clubId: 'club-1',
      audience: 'club',
    })).toMatchObject({ ok: true, audience: 'club' });
  });
});
