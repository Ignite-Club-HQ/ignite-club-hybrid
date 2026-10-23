import { describe, expect, it, vi } from 'vitest';
import { readIcpThreadPage, readIcpGroupMetadata } from './icpThreadRead';
describe('ICP existing thread opening', () => {
  it('distinguishes confirmed missing metadata from a retryable admission failure', async () => {
    expect(await readIcpGroupMetadata(async () => { throw new Error('Get group metadata failed: Group metadata not found'); })).toBeNull();
    const denied = new Error('Account admission denied or unavailable');
    await expect(readIcpGroupMetadata(async () => { throw denied; })).rejects.toBe(denied);
    expect(await readIcpGroupMetadata(async () => ({ name: 'Giddy Goat' }))).toEqual({ name: 'Giddy Goat' });
  });
  it('returns readable messages without invoking a stalled provisioning mutation', async () => {
    const provision = vi.fn(() => new Promise(() => {}));
    const read = vi.fn().mockResolvedValue({ messages: [{ id: 'saved-message' }] });
    expect((await readIcpThreadPage(read, provision)).messages[0].id).toBe('saved-message');
    expect(provision).not.toHaveBeenCalled();
  });
  it('provisions exactly once only after explicit conversation absence', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('Conversation not found')).mockResolvedValue('opened');
    const provision = vi.fn().mockResolvedValue(undefined);
    expect(await readIcpThreadPage(read, provision)).toBe('opened');
    expect(provision).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('preserves admission and transport errors without provisioning or replay', async () => {
    const error = new Error('Account admission denied or unavailable');
    const read = vi.fn().mockRejectedValue(error);
    const provision = vi.fn();
    await expect(readIcpThreadPage(read, provision)).rejects.toBe(error);
    expect(provision).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
  });
});