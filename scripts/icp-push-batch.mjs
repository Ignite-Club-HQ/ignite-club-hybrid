import { unwrapQueueResult } from './icp-push-results.mjs';
import { notificationKey } from './icp-push-contract.mjs';

/** Explicit operator queue set, no discovery/fallback across deployments. */
export function pushQueueIds(raw, fallback, parsePrincipal) {
  const ids = raw === undefined || raw === '' ? [fallback] : JSON.parse(raw);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 32) throw new Error('Invalid approved push queue set');
  const canonical = ids.map(id => {
    if (typeof id !== 'string') throw new Error('Invalid push queue ID');
    return parsePrincipal(id).toText();
  });
  if (new Set(canonical).size !== canonical.length) throw new Error('Duplicate push queue');
  return canonical;
}

/** Shared device directory; authorization and settlement always use the source queue.
 * A failed queue never prevents another approved queue from being attempted. */
export async function runPushQueues(ids, run) {
  const errors = [];
  for (const id of ids) {
    try { await run(id); } catch (error) { errors.push(new Error(`Queue ${id}: ${error.message}`)); }
  }
  if (errors.length) throw new AggregateError(errors, `${errors.length} push queues failed`);
}

export async function deliverPushItem(queue, notification, tokens, send) {
  let delivered = 0;
  const dead = [];
  let error = 'delivery failed';
  // Check even no-device rows; a revoked private notification is not delivered.
  const permitted = () => queue.authorize_delivery(notification.id, notificationKey(notification)).then(r => unwrapQueueResult(r, 'delivery authorization'));
  if (!await permitted()) return { status: 'denied', delivered, dead };
  if (!tokens.length) return { status: 'no_tokens', delivered, dead };
  for (const token of tokens) {
    // Recheck after token/OAuth lookup and between devices, not just at claim.
    if (!await permitted()) return { status: delivered ? 'delivered' : 'denied', delivered, dead };
    try {
      const result = await send(token, notification);
      if (result === null) delivered++;
      else if (result.prune) dead.push(token);
      else error = result.error;
    } catch (e) { error = e.message; }
  }
  return { status: delivered ? 'delivered' : 'failed', delivered, dead, error };
}