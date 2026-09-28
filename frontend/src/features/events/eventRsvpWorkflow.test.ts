import { describe, expect, it, vi } from "vitest";
import {
  adminSaveChildRsvp,
  adminUpdateRsvpStatus,
  adminUpsertRsvp,
  saveGuardianChildRsvp,
  saveParentMiniLeaguePlayerRsvp,
  savePersonalRsvp,
} from "@/features/events/eventRsvpWorkflow";

function clientWith(results: Array<{ data?: unknown; error?: unknown }>) {
  const operations: Array<{ table: string; kind: string; payload?: unknown; filters: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const operation = { table, kind: "", payload: undefined as unknown, filters: [] as unknown[] };
    const builder: any = {
      update: (payload: unknown) => { operation.kind = "update"; operation.payload = payload; operations.push(operation); return builder; },
      insert: (payload: unknown) => { operation.kind = "insert"; operation.payload = payload; operations.push(operation); return builder; },
      select: () => { if (!operation.kind) { operation.kind = "select"; operations.push(operation); } return builder; },
      eq: (column: string, value: unknown) => { operation.filters.push([column, value]); return builder; },
      single: () => Promise.resolve(results.shift() ?? { data: null, error: null }),
      maybeSingle: () => Promise.resolve(results.shift() ?? { data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve),
    };
    return builder;
  });
  return { client: { from }, operations, from };
}

describe("personal RSVP workflow", () => {
  const input = {
    eventId: "event-1", userId: "adult-1", status: "going" as const,
    notes: "Bringing oranges", existingRsvpId: null, online: true,
  };

  it("queues an offline RSVP without touching Supabase", async () => {
    const { client, from } = clientWith([]);
    const enqueue = vi.fn();
    await expect(savePersonalRsvp(client, { ...input, online: false }, enqueue)).resolves.toEqual({
      queued: true, rsvpId: null,
    });
    expect(enqueue).toHaveBeenCalledWith({
      eventId: "event-1", userId: "adult-1", status: "going",
      notes: "Bringing oranges", existingRsvpId: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("updates an existing personal row by id and preserves user source", async () => {
    const { client, operations } = clientWith([{ error: null }]);
    await expect(savePersonalRsvp(client, { ...input, existingRsvpId: "rsvp-1" }, vi.fn()))
      .resolves.toEqual({ queued: false, rsvpId: "rsvp-1" });
    expect(operations).toEqual([{
      table: "rsvps", kind: "update",
      payload: { status: "going", notes: "Bringing oranges", source: "user" },
      filters: [["id", "rsvp-1"]],
    }]);
  });

  it("creates a new adult RSVP owned by the authenticated user", async () => {
    const { client, operations } = clientWith([{ data: { id: "rsvp-2" }, error: null }]);
    await expect(savePersonalRsvp(client, input, vi.fn())).resolves.toEqual({
      queued: false, rsvpId: "rsvp-2",
    });
    expect(operations[0]).toMatchObject({
      table: "rsvps", kind: "insert",
      payload: { event_id: "event-1", user_id: "adult-1", status: "going", notes: "Bringing oranges", source: "user" },
    });
  });

  it("propagates a personal RSVP write failure", async () => {
    const denied = { code: "42501", message: "denied" };
    const { client } = clientWith([{ data: null, error: denied }]);
    await expect(savePersonalRsvp(client, input, vi.fn())).rejects.toBe(denied);
  });
});

describe("mini-league parent and administrator RSVP workflows", () => {
  it("creates a parent-owned mini-league player RSVP with user source", async () => {
    const { client, operations } = clientWith([{ error: null }]);
    await saveParentMiniLeaguePlayerRsvp(client, {
      eventId: "event-1", parentUserId: "parent-1", playerId: "player-1",
      status: "going", existingRsvpId: null,
    });
    expect(operations[0]).toMatchObject({
      kind: "insert",
      payload: {
        event_id: "event-1", user_id: "parent-1", mini_league_player_id: "player-1",
        status: "going", source: "user",
      },
    });
  });

  it("updates an existing mini-league player RSVP only by its canonical id", async () => {
    const { client, operations } = clientWith([{ error: null }]);
    await saveParentMiniLeaguePlayerRsvp(client, {
      eventId: "event-1", parentUserId: "parent-1", playerId: "player-1",
      status: "not_going", existingRsvpId: "rsvp-1",
    });
    expect(operations).toEqual([{
      table: "rsvps", kind: "update", payload: { status: "not_going", source: "user" },
      filters: [["id", "rsvp-1"]],
    }]);
  });

  it("uses the privileged upsert RPC for an adult member", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await adminUpsertRsvp({ rpc }, {
      eventId: "event-1", actingUserId: "admin-1", subjectUserId: "adult-1", status: "maybe",
    });
    expect(rpc).toHaveBeenCalledWith("admin_upsert_rsvp", {
      p_event_id: "event-1", p_user_id: "adult-1", p_status: "maybe", p_acting_user_id: "admin-1",
    });
  });

  it("uses distinct privileged arguments for child-linked and standalone league players", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await adminUpsertRsvp({ rpc }, {
      eventId: "event-1", actingUserId: "admin-1", subjectUserId: "parent-1",
      childId: "child-1", status: "going",
    });
    await adminUpsertRsvp({ rpc }, {
      eventId: "event-1", actingUserId: "admin-1", subjectUserId: "admin-1",
      miniLeaguePlayerId: "player-1", status: "going",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "admin_upsert_rsvp", expect.objectContaining({
      p_user_id: "parent-1", p_child_id: "child-1",
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_upsert_rsvp", expect.objectContaining({
      p_user_id: "admin-1", p_mini_league_player_id: "player-1",
    }));
  });

  it("updates an existing RSVP through the privileged status RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await adminUpdateRsvpStatus({ rpc }, {
      rsvpId: "rsvp-1", status: "not_going", actingUserId: "admin-1",
    });
    expect(rpc).toHaveBeenCalledWith("admin_update_rsvp_status", {
      p_rsvp_id: "rsvp-1", p_status: "not_going", p_acting_user_id: "admin-1",
    });
  });

  it("admin child save updates the canonical row or creates with supplied parent ownership", async () => {
    const existingClient = clientWith([{ data: { id: "rsvp-1" }, error: null }, { error: null }]);
    await adminSaveChildRsvp(existingClient.client, {
      eventId: "event-1", parentUserId: "parent-1", childId: "child-1", status: "maybe",
    });
    expect(existingClient.operations[1]).toMatchObject({
      kind: "update", payload: { status: "maybe" }, filters: [["id", "rsvp-1"]],
    });

    const newClient = clientWith([{ data: null, error: null }, { error: null }]);
    await adminSaveChildRsvp(newClient.client, {
      eventId: "event-1", parentUserId: "parent-1", childId: "child-1", status: "going",
    });
    expect(newClient.operations[1]).toMatchObject({
      kind: "insert", payload: {
        event_id: "event-1", user_id: "parent-1", child_id: "child-1", status: "going",
      },
    });
  });

  it("propagates every privileged RPC failure", async () => {
    const denied = { code: "42501", message: "denied" };
    await expect(adminUpsertRsvp({ rpc: vi.fn().mockResolvedValue({ error: denied }) }, {
      eventId: "event-1", actingUserId: "admin-1", subjectUserId: "adult-1", status: "going",
    })).rejects.toBe(denied);
    await expect(adminUpdateRsvpStatus({ rpc: vi.fn().mockResolvedValue({ error: denied }) }, {
      rsvpId: "rsvp-1", actingUserId: "admin-1", status: "going",
    })).rejects.toBe(denied);
  });
});

describe("guardian child RSVP workflow", () => {
  const input = {
    eventId: "event-1", guardianUserId: "guardian-1", childId: "child-1",
    status: "maybe" as const, existingRsvpId: null,
  };

  it("updates the canonical child RSVP regardless of which guardian created it", async () => {
    const { client, operations } = clientWith([{ error: null }]);
    await saveGuardianChildRsvp(client, { ...input, existingRsvpId: "canonical-1" });
    expect(operations).toEqual([{
      table: "rsvps", kind: "update", payload: { status: "maybe", source: "user" },
      filters: [["id", "canonical-1"]],
    }]);
  });

  it("creates a child RSVP owned by the acting guardian", async () => {
    const { client, operations } = clientWith([{ data: { id: "rsvp-1" }, error: null }]);
    await saveGuardianChildRsvp(client, input);
    expect(operations[0]).toMatchObject({
      kind: "insert",
      payload: { event_id: "event-1", user_id: "guardian-1", child_id: "child-1", status: "maybe", source: "user" },
    });
  });

  it("resolves the canonical row when a duplicate insert is redirected", async () => {
    const { client, operations } = clientWith([
      { data: null, error: null }, { data: { id: "canonical-1" }, error: null },
    ]);
    await expect(saveGuardianChildRsvp(client, input)).resolves.toEqual({
      queued: false, rsvpId: "canonical-1",
    });
    expect(operations[1]).toMatchObject({
      kind: "select", filters: [["event_id", "event-1"], ["child_id", "child-1"]],
    });
  });

  it("propagates insert and canonical lookup failures", async () => {
    const denied = { code: "42501", message: "denied" };
    await expect(saveGuardianChildRsvp(clientWith([{ error: denied }]).client, input)).rejects.toBe(denied);
    await expect(saveGuardianChildRsvp(clientWith([
      { data: null, error: null }, { data: null, error: denied },
    ]).client, input)).rejects.toBe(denied);
  });
});
