import type { FeatureBackendContext } from "../featureRouter";

/**
 * Same-tick request coalescer for canister reads. Single-id helpers call
 * `batched`; every call with the same `name` made in the same microtask
 * (e.g. a page's Promise.all over its clubs/teams/events) becomes ONE
 * batched canister query. Canisters deployed before a batch method existed
 * reject it as a missing method — then that `name` falls back to per-id
 * calls for the rest of the session.
 */
const batchUnsupported = new Set<string>();
type Waiter<R> = { id: string; resolve: (v: R) => void; reject: (e: unknown) => void };
type Pending<R> = { ids: Set<string>; waiters: Waiter<R>[] };
const queues = new WeakMap<object, Map<string, Pending<unknown>>>();

export function isMissingCanisterMethod(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /has no (query|update) method|method not found|IC0302|IC0536|is not a function/i.test(msg);
}

/** Test hook. */
export function resetBatchingState(): void {
  batchUnsupported.clear();
}

export function batched<A, R>(
  ctx: FeatureBackendContext,
  name: string,
  id: string,
  connect: () => Promise<{ actor: A }>,
  runBatch: (actor: A, ids: string[]) => Promise<Map<string, R>>,
  runSingle: (actor: A, id: string) => Promise<R>,
): Promise<R> {
  const scope = JSON.stringify([ctx.target?.alias, ctx.target?.host, ctx.target?.networkKind, ctx.target?.canisterIds ?? {}]);
  const key = `${name}|${scope}`;
  if (batchUnsupported.has(key)) return connect().then(({ actor }) => runSingle(actor, id));
  let byName = queues.get(ctx.identity as object);
  if (!byName) {
    byName = new Map();
    queues.set(ctx.identity as object, byName);
  }
  let pending = byName.get(key) as Pending<R> | undefined;
  if (!pending) {
    const fresh: Pending<R> = { ids: new Set(), waiters: [] };
    pending = fresh;
    const map = byName;
    map.set(key, fresh as Pending<unknown>);
    queueMicrotask(async () => {
      map.delete(key);
      const ids = [...fresh.ids];
      try {
        const { actor } = await connect();
        let results: Map<string, R>;
        try {
          results =
            ids.length === 1 ? new Map([[ids[0], await runSingle(actor, ids[0])]]) : await runBatch(actor, ids);
        } catch (err) {
          // A batch is all-or-nothing on the canister: one id the caller may
          // not read (e.g. one forbidden club) rejects every sibling. Retry
          // each id alone so only the refused one fails.
          if (ids.length === 1) throw err;
          if (isMissingCanisterMethod(err)) batchUnsupported.add(key);
          const singles = await Promise.allSettled(ids.map((i) => runSingle(actor, i)));
          for (const w of fresh.waiters) {
            const r = singles[ids.indexOf(w.id)];
            if (r.status === "fulfilled") w.resolve(r.value);
            else w.reject(r.reason);
          }
          return;
        }
        for (const w of fresh.waiters) w.resolve(results.get(w.id) as R);
      } catch (err) {
        for (const w of fresh.waiters) w.reject(err);
      }
    });
  }
  pending.ids.add(id);
  const queue = pending;
  return new Promise<R>((resolve, reject) => queue.waiters.push({ id, resolve, reject }));
}

/** Groups rows into a Map keyed by every requested id (missing ids map to []). */
export function groupBy<T>(ids: string[], rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>(ids.map((i) => [i, []]));
  for (const r of rows) m.get(keyOf(r))?.push(r);
  return m;
}
