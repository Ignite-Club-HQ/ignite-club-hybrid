import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  clearNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notificationRepository";

const notificationMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  listInbox: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  deleteNotification: vi.fn(),
  clearInbox: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    notificationMocks.backend === "icp"
      ? providers.icp({ identity: {}, target: { alias: "test" } })
      : providers.supabase(),
}));
vi.mock("@/live/features/notifications", () => ({
  listLiveInbox: (...args: unknown[]) => notificationMocks.listInbox(...args),
  markLiveNotificationRead: (...args: unknown[]) => notificationMocks.markRead(...args),
  markAllLiveNotificationsRead: (...args: unknown[]) => notificationMocks.markAllRead(...args),
  deleteLiveNotification: (...args: unknown[]) => notificationMocks.deleteNotification(...args),
  clearLiveInbox: (...args: unknown[]) => notificationMocks.clearInbox(...args),
}));

type IgniteSupabaseClient = SupabaseClient<Database>;
type Call = { method: string; args: unknown[] };

function fakeClient(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "or", "update", "delete"]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject);
  return {
    calls,
    client: { from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return query;
    } } as unknown as IgniteSupabaseClient,
  };
}

const scope = "club-a";
const scopeExpression = "club_id.eq.club-a,type.in.(direct_message,streak_progress,reward_unlocked)";

describe.runIf(supabaseMode)("notification repository — Supabase", () => {
  it("loads newest notifications with a bounded global query and maps is_read", async () => {
    const fake = fakeClient({ data: [{
      id: "notification-a", user_id: "user-a", type: "event", message: "Game",
      related_id: "event-a", is_read: false, created_at: "2026-08-18T00:00:00Z", club_id: "club-a",
    }] });
    await expect(listNotifications("user-a", null, fake.client)).resolves.toEqual([{
      id: "notification-a", user_id: "user-a", type: "event", message: "Game",
      related_id: "event-a", read: false, created_at: "2026-08-18T00:00:00Z",
    }]);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["user_id", "user-a"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [500] },
    ]));
    expect(fake.calls.some((call) => call.method === "or")).toBe(false);
  });

  it("scopes lists to the active club while retaining only explicit global types", async () => {
    const fake = fakeClient({ data: [] });
    await listNotifications("user-a", scope, fake.client);
    expect(fake.calls).toContainEqual({ method: "or", args: [scopeExpression] });
  });

  it("marks exactly one notification read", async () => {
    const fake = fakeClient();
    await expect(markNotificationRead("notification-a", fake.client)).resolves.toBe("notification-a");
    expect(fake.calls).toEqual(expect.arrayContaining([
      { method: "update", args: [{ is_read: true }] },
      { method: "eq", args: ["id", "notification-a"] },
    ]));
  });

  it("marks only unread notifications for the user and active club scope", async () => {
    const fake = fakeClient();
    await markAllNotificationsRead("user-a", scope, fake.client);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { method: "eq", args: ["user_id", "user-a"] },
      { method: "eq", args: ["is_read", false] },
      { method: "or", args: [scopeExpression] },
    ]));
  });

  it("deletes exactly one notification", async () => {
    const fake = fakeClient();
    await expect(deleteNotification("notification-a", fake.client)).resolves.toBe("notification-a");
    expect(fake.calls).toEqual(expect.arrayContaining([
      { method: "delete", args: [] },
      { method: "eq", args: ["id", "notification-a"] },
    ]));
  });

  it("clears all user notifications globally without a club expression", async () => {
    const fake = fakeClient();
    await clearNotifications("user-a", null, fake.client);
    expect(fake.calls).toContainEqual({ method: "eq", args: ["user_id", "user-a"] });
    expect(fake.calls.some((call) => call.method === "or")).toBe(false);
  });

  it("applies the same active-club scope when clearing notifications", async () => {
    const fake = fakeClient();
    await clearNotifications("user-a", scope, fake.client);
    expect(fake.calls).toContainEqual({ method: "or", args: [scopeExpression] });
  });

  it.each([
    ["list", (client: IgniteSupabaseClient) => listNotifications("user-a", null, client)],
    ["mark one", (client: IgniteSupabaseClient) => markNotificationRead("notification-a", client)],
    ["mark all", (client: IgniteSupabaseClient) => markAllNotificationsRead("user-a", null, client)],
    ["delete one", (client: IgniteSupabaseClient) => deleteNotification("notification-a", client)],
    ["clear", (client: IgniteSupabaseClient) => clearNotifications("user-a", null, client)],
  ] as const)("propagates database errors from %s", async (_name, operation) => {
    const error = { code: "42501", message: "denied" };
    await expect(operation(fakeClient({ error }).client)).rejects.toBe(error);
  });
});

describe.runIf(!supabaseMode)("notification repository — ICP", () => {
  beforeEach(() => {
    notificationMocks.backend = "icp";
    notificationMocks.listInbox.mockReset();
    notificationMocks.markRead.mockReset();
    notificationMocks.markAllRead.mockReset();
    notificationMocks.deleteNotification.mockReset();
    notificationMocks.clearInbox.mockReset();
  });

  it("maps canister inbox rows into the shared frontend notification shape", async () => {
    notificationMocks.listInbox.mockResolvedValue([{
      id: "notification-icp",
      user: "principal-a",
      kind: "event",
      body: "Game",
      related_id: ["event-a"],
      created_at_ms: 1_786_032_000_000n,
      read: false,
    }]);
    const fake = fakeClient();
    await expect(listNotifications("principal-a", "club-a", fake.client)).resolves.toEqual([{
      id: "notification-icp",
      user_id: "principal-a",
      type: "event",
      message: "Game",
      related_id: "event-a",
      created_at: new Date(1_786_032_000_000).toISOString(),
      read: false,
    }]);
    expect(notificationMocks.listInbox).toHaveBeenCalledWith(expect.anything(), "principal-a", "club-a", 500);
    expect(fake.calls).toEqual([]);
  });

  it("routes inbox mutations through the notification canister", async () => {
    const fake = fakeClient();
    await markNotificationRead("notification-a", fake.client);
    await markAllNotificationsRead("principal-a", "club-a", fake.client);
    await deleteNotification("notification-a", fake.client);
    await clearNotifications("principal-a", null, fake.client);
    expect(notificationMocks.markRead).toHaveBeenCalledTimes(1);
    expect(notificationMocks.markAllRead).toHaveBeenCalledWith(expect.anything(), "principal-a", "club-a");
    expect(notificationMocks.deleteNotification).toHaveBeenCalledTimes(1);
    expect(notificationMocks.clearInbox).toHaveBeenCalledWith(expect.anything(), "principal-a", null);
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ["list", () => {
      notificationMocks.listInbox.mockRejectedValueOnce(new Error("list denied"));
      return listNotifications("principal-a", "club-a", fakeClient().client);
    }],
    ["mark one", () => {
      notificationMocks.markRead.mockRejectedValueOnce(new Error("mark denied"));
      return markNotificationRead("notification-a", fakeClient().client);
    }],
    ["mark all", () => {
      notificationMocks.markAllRead.mockRejectedValueOnce(new Error("mark all denied"));
      return markAllNotificationsRead("principal-a", "club-a", fakeClient().client);
    }],
    ["delete one", () => {
      notificationMocks.deleteNotification.mockRejectedValueOnce(new Error("delete denied"));
      return deleteNotification("notification-a", fakeClient().client);
    }],
    ["clear", () => {
      notificationMocks.clearInbox.mockRejectedValueOnce(new Error("clear denied"));
      return clearNotifications("principal-a", "club-a", fakeClient().client);
    }],
  ] as const)("propagates %s canister failures", async (_name, operation) => {
    await expect(operation()).rejects.toThrow(/denied/);
  });
});
