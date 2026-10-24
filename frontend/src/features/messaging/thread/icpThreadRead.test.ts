import { describe, expect, it, vi } from 'vitest';
import { readIcpThreadPage, readIcpGroupMetadata } from './icpThreadRead';
describe('ICP existing thread opening', () => {
  it.each(['Open conversation', 'List latest messages', 'List messages'])('repairs a confirmed absent thread after %s refuses access', async (label) => {
    const read = vi.fn().mockRejectedValueOnce(new Error(`${label} failed: Conversation access forbidden`)).mockResolvedValue({ messages: [{ id: 'saved' }] });
    const confirmAbsent = vi.fn().mockResolvedValue(true);
    const provision = vi.fn().mockResolvedValue(undefined);
    expect(await readIcpThreadPage(read, provision, confirmAbsent)).toEqual({ messages: [{ id: 'saved' }] });
    expect(confirmAbsent).toHaveBeenCalledOnce();
    expect(provision).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(confirmAbsent.mock.invocationCallOrder[0]).toBeLessThan(provision.mock.invocationCallOrder[0]);
  });
  it('does not repair an existing forbidden conversation', async () => {
    const error = new Error('Open conversation failed: Conversation access forbidden');
    const read = vi.fn().mockRejectedValue(error);
    const provision = vi.fn();
    await expect(readIcpThreadPage(read, provision, async () => false)).rejects.toBe(error);
    expect(provision).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
  });
  it('does not provision after a failed absence check', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Open conversation failed: Conversation access forbidden'));
    const provision = vi.fn();
    await expect(readIcpThreadPage(read, provision, async () => { throw new Error('Account admission denied or unavailable'); })).rejects.toThrow('Account admission denied');
    expect(provision).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
  });
  it('never replays a failed provisioning write', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Open conversation failed: Conversation access forbidden'));
    const provision = vi.fn().mockRejectedValue(new Error('Unknown write outcome'));
    await expect(readIcpThreadPage(read, provision, async () => true)).rejects.toThrow('Unknown write outcome');
    expect(provision).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });
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