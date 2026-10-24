/** Recovery is device-local coordination, never authority or proof of upload success. */
type Page = { ids: string[]; next: [] | [string] };
type Scan = { cursor: string; pending?: Promise<void>; completedAt?: number };
const scans = new WeakMap<object, Map<string, Scan>>();

export function scheduleVaultUploadRecovery(
  identity: object,
  scope: string,
  read: (after: string) => Promise<Page>,
  recover: (id: string) => Promise<unknown>,
): Promise<void> {
  let scopes = scans.get(identity);
  if (!scopes) { scopes = new Map(); scans.set(identity, scopes); }
  let scan = scopes.get(scope);
  if (!scan) { scan = { cursor: "" }; scopes.set(scope, scan); }
  if (scan.pending) return scan.pending;
  if (scan.completedAt !== undefined && Date.now() - scan.completedAt < 60_000) return Promise.resolve();
  const state = scan;
  const run = async () => {
    // The canister caps its journal at 10,000 rows, scanning 40 per page.
    for (let pages = 0; pages < 250; pages += 1) {
      const page = await read(state.cursor);
      const next = page.next[0];
      if (page.ids.length > 40 || new Set(page.ids).size !== page.ids.length || page.ids.some(id => !id || id <= state.cursor || (next !== undefined && id > next)) || (next !== undefined && next <= state.cursor)) throw new Error("Invalid Vault recovery continuation");
      // A failed or unknown recovery keeps this page's cursor for later reconciliation.
      // The canister alone decides whether an acknowledged intent is recoverable.
      for (const id of page.ids) await recover(id);
      if (next === undefined) { state.cursor = ""; state.completedAt = Date.now(); return; }
      state.cursor = next;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  };
  state.pending = run().finally(() => { state.pending = undefined; });
  return state.pending;
}