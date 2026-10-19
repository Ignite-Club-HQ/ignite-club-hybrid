import { describe, expect, it, vi } from 'vitest';
import { findRoleRequestOwner } from './roleRequestOwner';

describe('role request owner discovery', () => {
  it('finds only the club whose authorized list contains the request', async () => {
    expect(await findRoleRequestOwner('request-a', async () => [{ id: 'a' }, { id: 'b' }], async club =>
      club === 'b' ? [{ id: 'request-a' }] : [])).toBe('b');
  });
  it('does not treat denied request lists as an ownership claim', async () => {
    expect(await findRoleRequestOwner('request-a', async () => [{ id: 'a' }], async () => {
      throw new Error('List role requests: Club admin required');
    })).toBeNull();
  });
  it('propagates transport loss instead of deciding the request is shared', async () => {
    await expect(findRoleRequestOwner('request-a', async () => [{ id: 'a' }], async () => {
      throw new Error('Network timeout');
    })).rejects.toThrow('Network timeout');
  });
  it('refuses ambiguous ownership', async () => {
    await expect(findRoleRequestOwner('request-a', async () => [{ id: 'a' }, { id: 'b' }], async () =>
      [{ id: 'request-a' }])).rejects.toThrow('multiple clubs');
  });
  it('refuses a truncated directory after forty pages', async () => {
    const clubs = vi.fn(async (cursor: string | null) =>
      Array.from({ length: 100 }, (_, i) => ({ id: `${cursor ?? 'start'}-${i}` })));
    await expect(findRoleRequestOwner('request-a', clubs, async () => [])).rejects.toThrow('page budget');
    expect(clubs).toHaveBeenCalledTimes(40);
  });
});