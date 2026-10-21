import { describe, expect, it } from 'vitest';
import { clubCreationFailureKind } from './clubCreationError';

describe('club creation failure classification', () => {
  it('recognizes the reported indexed membership rejection as access refusal', () => {
    expect(clubCreationFailureKind(new Error('The replica returned a rejection error: Reject code: 4 Reject text: Account admission denied or unavailable Error code: IC0406 Call context: method name: read_my_club_memberships_indexed'))).toBe('admission');
  });
  it('does not label other replica failures as account refusal', () => {
    expect(clubCreationFailureKind(new Error('The replica returned a rejection error: IC0207 out of cycles'))).toBe('technical');
  });
  it('keeps ordinary validation distinct from service failures', () => {
    expect(clubCreationFailureKind(new Error('A club with this name already exists.'))).toBe('ordinary');
  });
});