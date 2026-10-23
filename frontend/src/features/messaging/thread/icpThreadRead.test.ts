import { describe, expect, it, vi } from 'vitest';
import { readIcpThreadPage } from './icpThreadRead';
describe('ICP existing thread opening', () => {
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