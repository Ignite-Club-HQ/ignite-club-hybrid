// Pure safety rules for removing isolated paid photo-store test canisters.
export const REMOVE_CONFIRM = 'DELETE TEST STORES';
const RUN_ID = /^media-[a-z0-9][a-z0-9-]{1,40}$/;
const CANISTER = /^[a-z0-9]{5}(-[a-z0-9]{5}){3}-cai$/;

export function parseRunIds(text) {
  const ids = [...new Set(String(text ?? '').split(/[\s,]+/).filter(Boolean))];
  if (ids.length === 0 || ids.length > 5) throw new Error('Give 1–5 test ids');
  for (const id of ids) if (!RUN_ID.test(id)) throw new Error(`Not a photo-store test id: ${id}`);
  return ids;
}

/** Finds every controllers list in CLI JSON output, whatever its nesting. */
export function controllersFrom(statusJson) {
  const found = [];
  (function walk(x) {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
      if (/^controllers$/i.test(k) && Array.isArray(v)) found.push(v.map(p => String(p?.toText?.() ?? p)));
      else walk(v);
    }
  })(statusJson);
  if (found.length !== 1) throw new Error('Could not read exactly one controller list');
  return found[0];
}

/** Throws unless the target is provably this run's own isolated store, solely controlled by the deploy key. */
export function assertRemovable({ runId, receipt, controllers, deployPrincipal, protectedIds }) {
  if (!receipt || receipt.binding?.runId !== runId) throw new Error(`${runId}: receipt missing or for another run`);
  const id = receipt.canisterId;
  if (!CANISTER.test(String(id ?? ''))) throw new Error(`${runId}: receipt never created a store; nothing to remove`);
  if (receipt.binding?.governor !== deployPrincipal) throw new Error(`${runId}: store was not created by the deploy key`);
  if (protectedIds.has(id)) throw new Error(`${runId}: ${id} is a live or group service; refusing`);
  if (controllers.length !== 1 || controllers[0] !== deployPrincipal) throw new Error(`${runId}: ${id} has other controllers; refusing`);
  return id;
}
