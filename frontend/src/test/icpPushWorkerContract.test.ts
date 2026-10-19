import { describe, expect, it } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
// @ts-expect-error Worker modules execute directly in Node.
import { createPushQueueIdl, notificationKey } from '../../../scripts/icp-push-contract.mjs';
import { idlFactory } from '../lab/bindings/notification_queue/declarations/notification_queue.did.js';

describe('push worker canonical contract', () => {
  it('matches every worker method argument, result and consensus annotation', () => {
    const canonical = new Map(idlFactory({ IDL })._fields);
    for (const [name, fn] of createPushQueueIdl({ IDL })._fields) {
      const expected = canonical.get(name);
      expect(expected, name).toBeDefined();
      expect(fn.argTypes.map((t: IDL.Type) => t.display()), name).toEqual(expected?.argTypes.map(t => t.display()));
      expect(fn.retTypes.map((t: IDL.Type) => t.display()), name).toEqual(expected?.retTypes.map(t => t.display()));
      expect(fn.annotations, name).toEqual(expected?.annotations);
    }
  });
  it('preserves the complete idempotency key rather than its first character', () => {
    expect(notificationKey({ idempotency_key: 'message-long-key' })).toBe('message-long-key');
    expect(notificationKey({ idempotency_key: '' })).toBe('');
    expect(() => notificationKey({ idempotency_key: ['old-wire-shape'] })).toThrow('Invalid');
  });
});