import { describe, expect, it } from 'vitest';
import { hydrateRsvpDisplayProfiles } from './rsvpDisplayProfiles';

describe('RSVP display profiles', () => {
  it.each(['going', 'maybe', 'not_going'])('retains Paul’s known name on refreshed %s RSVP rows', status => {
    const row = { id: 'event:principal:paul:self', user_id: 'principal:paul', child_id: null, status, profiles: null };
    const [result] = hydrateRsvpDisplayProfiles([row], [{ id: 'paul', display_name: 'Paul Cranwell', avatar_url: 'avatar' }]);
    expect(result).toMatchObject({ id: row.id, user_id: row.user_id, status, profiles: { display_name: 'Paul Cranwell', avatar_url: 'avatar' } });
    expect(row.profiles).toBeNull();
  });
  it('uses the signed-in profile when shared profile hydration is unavailable', () => {
    const [result] = hydrateRsvpDisplayProfiles([{ user_id: 'paul', profiles: null }], [], { id: 'principal:paul', profile: { display_name: 'Paul Cranwell' } });
    expect(result.profiles?.display_name).toBe('Paul Cranwell');
  });
  it('preserves authoritative names and never assigns an adult name to a child or another account', () => {
    const rows = [{ user_id: 'paul', profiles: { display_name: 'Updated Paul' } }, { user_id: 'paul', child_id: 'child', profiles: null }, { user_id: 'other', profiles: null }];
    const result = hydrateRsvpDisplayProfiles(rows, [{ id: 'paul', display_name: 'Paul Cranwell' }]);
    expect(result[0].profiles?.display_name).toBe('Updated Paul');
    expect(result[1]).toBe(rows[1]);
    expect(result[2]).toBe(rows[2]);
  });
});