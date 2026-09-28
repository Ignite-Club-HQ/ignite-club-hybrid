/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/process-event-notifications/testFakeSupabase.ts.md`.
 *
 * Minimal in-memory fake of the PostgREST query builder surface used by
 * `recipients.ts` / `fanout.ts`. Records every issued query so tests can
 * assert on query shape as well as results.
 *
 * The sanitized reference copy predates a `writeErrors` field that the
 * exported characterization suite exercises (per-write, per-table scheduled
 * outcomes, used to model exactly one failed batch among several successful
 * ones during a multi-batch insert). It is reconstructed here — a pure
 * test-double behaviour, not production logic — from the documented
 * assertions in the exported suite: each write consumes the next scheduled
 * outcome for its table (falling back to the persistent `errors` entry),
 * and a scheduled error suppresses that write's row commit exactly like a
 * real failed upsert would.
 */

export interface FakeQueryRecord {
  table: string;
  select: string;
  filters: Array<[string, string, unknown]>;
  order?: string;
  range?: [number, number];
}

export class FakeSupabase {
  tables: Record<string, any[]>;
  queries: FakeQueryRecord[] = [];
  inserts: Array<{ table: string; rows: any[]; options: any }> = [];
  /** Optional per-table error injection (persists across every read/write). */
  errors: Record<string, any> = {};
  /** Optional per-write outcomes, used to model one failed fan-out batch. */
  writeErrors: Record<string, Array<any | null>> = {};
  /** Row cap applied when no explicit range is given (PostgREST default). */
  defaultLimit = 1000;

  constructor(tables: Record<string, any[]> = {}) {
    this.tables = tables;
  }

  from(table: string) {
    const rec: FakeQueryRecord = { table, select: '', filters: [] };
    const self = this;

    const run = () => {
      if (self.errors[table]) return { data: null, error: self.errors[table] };
      let rows = [...(self.tables[table] || [])];
      for (const [op, col, val] of rec.filters) {
        if (op === 'eq') rows = rows.filter((r) => r[col] === val);
        else if (op === 'neq') rows = rows.filter((r) => r[col] !== val);
        else if (op === 'in') rows = rows.filter((r) => (val as any[]).includes(r[col]));
        else if (op === 'notNull') rows = rows.filter((r) => r[col] !== null && r[col] !== undefined);
      }
      if (rec.order) {
        rows.sort((a, b) => String(a[rec.order!]).localeCompare(String(b[rec.order!])));
      }
      if (rec.range) {
        rows = rows.slice(rec.range[0], rec.range[1] + 1);
      } else {
        rows = rows.slice(0, self.defaultLimit);
      }
      return { data: rows, error: null };
    };

    const builder: any = {
      select(cols: string) { rec.select = cols; return builder; },
      eq(col: string, val: unknown) { rec.filters.push(['eq', col, val]); return builder; },
      neq(col: string, val: unknown) { rec.filters.push(['neq', col, val]); return builder; },
      in(col: string, val: unknown[]) { rec.filters.push(['in', col, val]); return builder; },
      not(col: string, _op: string, _val: unknown) { rec.filters.push(['notNull', col, null]); return builder; },
      order(col: string) { rec.order = col; return builder; },
      range(from: number, to: number) {
        rec.range = [from, to];
        self.queries.push({ ...rec, filters: [...rec.filters] });
        return Promise.resolve(run());
      },
      maybeSingle() {
        self.queries.push({ ...rec, filters: [...rec.filters] });
        const res = run();
        return Promise.resolve({ data: res.data?.[0] ?? null, error: res.error });
      },
      upsert(rows: any[], options: any) {
        self.inserts.push({ table, rows, options });
        const scheduledError = self.writeErrors[table]?.shift() ?? self.errors[table] ?? null;
        const withIds = rows.map((r, i) => ({
          ...r,
          id: r.id || `notif-${self.inserts.length}-${i}`,
        }));
        if (!scheduledError) {
          self.tables[table] = [...(self.tables[table] || []), ...withIds];
        }
        return {
          select: () => Promise.resolve({
            data: scheduledError ? null : withIds,
            error: scheduledError,
          }),
        };
      },
      then(resolve: any, reject?: any) {
        self.queries.push({ ...rec, filters: [...rec.filters] });
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }
}
