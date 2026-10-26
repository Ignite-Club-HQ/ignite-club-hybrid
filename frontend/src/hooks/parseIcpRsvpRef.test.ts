import { describe, expect, it } from 'vitest';
import { parseIcpRsvpRef } from './useEventRsvpMutations';
describe('parseIcpRsvpRef', () => {
  it('decodes plain refs', () => expect(parseIcpRsvpRef('e1:abc-def:self', 'e1')).toEqual(['e1', 'abc-def', 'self']));
  it('handles principal-prefixed accounts', () => expect(parseIcpRsvpRef('e1:principal:abc-def:self', 'e1')).toEqual(['e1', 'abc-def', 'self']));
  it('handles event ids containing colons', () => expect(parseIcpRsvpRef('club:e1:abc:kid1', 'club:e1')).toEqual(['club:e1', 'abc', 'kid1']));
  it('treats an empty child as self', () => expect(parseIcpRsvpRef('e1:abc:', 'e1')).toEqual(['e1', 'abc', 'self']));
  it('rejects garbage', () => expect(parseIcpRsvpRef('nonsense', 'e1')).toBeNull());
});
