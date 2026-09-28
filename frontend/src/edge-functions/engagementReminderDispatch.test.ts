/**
 * Reliability tests for engagement-reminder dispatch.
 *
 * Defects covered:
 *  1. cooldown logs written for notification batches that failed to insert
 *  2. cooldown-log write failures ignored, letting the run report success
 *  3. non-atomic notification/cooldown writes (a crash between the two writes
 *     re-notified every recipient on the next run)
 */
import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  dispatchReminders,
  type ReminderEntry,
} from "../../supabase/functions/send-engagement-reminders/dispatch.ts";

const entry = (n: number): ReminderEntry => ({
  notification: { user_id: `u${n}`, type: "engagement_reminder", message: `m${n}` },
  log: { user_id: `u${n}`, unread_messages_count: n, unread_photos_count: 0 },
});

type Behaviour = (call: number, rows: any[]) => { error: any } | undefined;

function fakeClient(behaviour: Behaviour = () => undefined) {
  const rpcCalls: Array<{ fn: string; rows: any[] }> = [];
  const committed: any[][] = [];
  return {
    rpcCalls,
    committed,
    async rpc(fn: string, args: any) {
      const rows = args?.p_rows ?? [];
      const call = rpcCalls.length;
      rpcCalls.push({ fn, rows });
      const res = behaviour(call, rows);
      if (res?.error) return { data: null, error: res.error };
      committed.push(rows);
      return { data: rows.length, error: null };
    },
  };
}

const flat = (b: any[][]) => b.flat();

describe("engagement reminder dispatch", () => {
  it("persists notifications and cooldowns atomically in one RPC call", async () => {
    const c = fakeClient();
    const res = await dispatchReminders(c, [entry(1), entry(2)]);
    expect(res).toEqual({ totalSent: 2, failedBatches: 0 });
    expect(c.rpcCalls).toHaveLength(1);
    expect(c.rpcCalls[0].fn).toBe("insert_engagement_reminders_atomic");
    // Every row carries both the notification message and its cooldown counts,
    // so the two can never be written separately.
    expect(c.rpcCalls[0].rows).toEqual([
      { user_id: "u1", message: "m1", unread_messages_count: 1, unread_photos_count: 0 },
      { user_id: "u2", message: "m2", unread_messages_count: 2, unread_photos_count: 0 },
    ]);
  });

  it("commits nothing for a failed batch, so no cooldowns are left behind", async () => {
    const c = fakeClient(() => ({ error: { code: "23505" } }));
    const res = await dispatchReminders(c, [entry(1), entry(2)]);
    expect(res).toEqual({ totalSent: 0, failedBatches: 1 });
    expect(c.committed).toEqual([]);
  });

  it("keeps successful batches and reports failures on mixed results", async () => {
    const entries = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => entry(i));
    const c = fakeClient((call) => (call === 0 ? { error: { code: "XX000" } } : undefined));
    const res = await dispatchReminders(c, entries);
    expect(res).toEqual({ totalSent: 3, failedBatches: 1 });
    expect(flat(c.committed).map((r) => r.user_id)).toEqual([
      `u${BATCH_SIZE}`,
      `u${BATCH_SIZE + 1}`,
      `u${BATCH_SIZE + 2}`,
    ]);
  });

  it("keeps notification-to-cooldown association across batches larger than 500", async () => {
    const entries = Array.from({ length: BATCH_SIZE * 2 + 7 }, (_, i) => entry(i));
    const c = fakeClient();
    const res = await dispatchReminders(c, entries);
    expect(res.totalSent).toBe(entries.length);
    expect(c.rpcCalls).toHaveLength(3);
    const rows = flat(c.committed);
    expect(rows.length).toBe(entries.length);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].user_id).toBe(`u${i}`);
      expect(rows[i].message).toBe(`m${i}`);
      expect(rows[i].unread_messages_count).toBe(i);
    }
    // No duplicate cooldown entries.
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(rows.length);
  });

  it("does not retry or duplicate a batch during the same invocation", async () => {
    const c = fakeClient((call) => (call === 0 ? { error: { code: "40001" } } : undefined));
    await dispatchReminders(c, [entry(1)]);
    expect(c.rpcCalls).toHaveLength(1);
  });

  it("reports a failed batch without leaking database detail", async () => {
    const c = fakeClient(() => ({
      error: { code: "42501", message: "permission denied for relation engagement_reminder_log" },
    }));
    const res = await dispatchReminders(c, [entry(1)]);
    // Caller turns failedBatches > 0 into a sanitized 500; the error text itself
    // is never returned from dispatch.
    expect(res.failedBatches).toBe(1);
    expect(JSON.stringify(res)).not.toMatch(/permission denied/);
  });

  it("is a no-op for an empty reminder list", async () => {
    const c = fakeClient();
    expect(await dispatchReminders(c, [])).toEqual({ totalSent: 0, failedBatches: 0 });
    expect(c.rpcCalls).toEqual([]);
  });
});
