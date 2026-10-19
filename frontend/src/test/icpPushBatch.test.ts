import { describe, it, expect, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
// @ts-expect-error Node worker helper intentionally uses JavaScript.
import { pushQueueIds, runPushQueues, deliverPushItem } from '../../../scripts/icp-push-batch.mjs';

const notification = { id: 'same-id', user: 'member', idempotency_key: 'whole-key' };
describe('multi-queue private delivery', () => {
  it('validates the full bounded operator queue set before processing', () => {
    const parse = (s: string) => Principal.fromText(s);
    expect(pushQueueIds(undefined, 'aaaaa-aa', parse)).toEqual(['aaaaa-aa']);
    expect(() => pushQueueIds('["aaaaa-aa","aaaaa-aa"]', 'aaaaa-aa', parse)).toThrow('Duplicate');
    expect(() => pushQueueIds('[]', 'aaaaa-aa', parse)).toThrow('Invalid');
    expect(() => pushQueueIds(JSON.stringify(Array(33).fill('aaaaa-aa')), 'aaaaa-aa', parse)).toThrow('Invalid');
    expect(() => pushQueueIds('["bad"]', 'aaaaa-aa', parse)).toThrow();
  });
  it('continues another queue after outage but reports failure, without fallback', async () => {
    const called: string[] = [];
    await expect(runPushQueues(['a', 'b'], async (id: string) => { called.push(id); if (id === 'a') throw new Error('offline'); })).rejects.toThrow('1 push queues failed');
    expect(called).toEqual(['a', 'b']);
  });
  it('denies claimed-but-not-authorized work and never sends to its device', async () => {
    const queue = { authorize_delivery: vi.fn().mockResolvedValue({ Ok: false }) };
    const send = vi.fn();
    expect((await deliverPushItem(queue, notification, [{ token: 'private' }], send)).status).toBe('denied');
    expect(send).not.toHaveBeenCalled();
    expect(queue.authorize_delivery).toHaveBeenCalledWith('same-id', 'whole-key');
  });
  it('rechecks between devices, stopping new sends after club revocation', async () => {
    const queue = { authorize_delivery: vi.fn().mockResolvedValueOnce({ Ok: true }).mockResolvedValueOnce({ Ok: true }).mockResolvedValue({ Ok: false }) };
    const send = vi.fn().mockResolvedValue(null);
    const result = await deliverPushItem(queue, notification, [{ token: 'first' }, { token: 'second' }], send);
    expect(result.delivered).toBe(1); expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not reinterpret unavailable authority as delivered or no-device success', async () => {
    const queue = { authorize_delivery: vi.fn().mockResolvedValue({ Err: 'authority unavailable' }) };
    await expect(deliverPushItem(queue, notification, [], vi.fn())).rejects.toThrow('authority unavailable');
  });
  it('keeps authorization tied to each source queue even with equal IDs', async () => {
    const a = { authorize_delivery: vi.fn().mockResolvedValue({ Ok: false }) };
    const b = { authorize_delivery: vi.fn().mockResolvedValue({ Ok: true }) };
    const send = vi.fn().mockResolvedValue(null);
    expect((await deliverPushItem(a, notification, [{ token: 'device' }], send)).status).toBe('denied');
    expect((await deliverPushItem(b, notification, [{ token: 'device' }], send)).delivered).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});