/**
 * Regression tests for filterClubScopedNotifications — proves that when
 * ownership lookup for a KNOWN club-scoped notification type fails, the row
 * is dropped (fail closed) rather than leaked into the active-club view.
 * Global types and unknown/future types continue to pass through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- supabase mock -----------------------------------------------------
// Each `from(table)` returns a fluent builder. Callers do:
//   supabase.from(t).select(cols).in(col, ids)   → awaited → { data, error }
// or for user_roles:
//   supabase.from("user_roles").select(cols).in(...).eq(...)  → awaited
// The mock records the awaited terminal by returning a thenable.

type Rows = Record<string, any[]>;
let tableRows: Rows = {};
let errorTables = new Set<string>();

function makeBuilder(table: string): any {
  const state: any = { table, filters: {} };
  const builder: any = {};
  const chain = () => builder;
  builder.select = () => chain();
  builder.in = (_col: string, ids: string[]) => {
    state.ids = ids;
    return builder;
  };
  builder.eq = (col: string, val: any) => {
    state.filters[col] = val;
    return builder;
  };
  builder.then = (resolve: (v: any) => any) => {
    if (errorTables.has(table)) {
      return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
    }
    let data = tableRows[table] || [];
    if (state.ids) data = data.filter((r: any) => state.ids.includes(r.id));
    for (const [k, v] of Object.entries(state.filters)) {
      data = data.filter((r: any) => r[k] === v);
    }
    return Promise.resolve({ data, error: null }).then(resolve);
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => makeBuilder(t) },
}));

import { filterClubScopedNotifications } from "./filterClubScopedNotifications";

const ACTIVE = "club-A";
const OTHER = "club-B";
const ME = "user-me";

beforeEach(() => {
  tableRows = {};
  errorTables = new Set();
});

describe("filterClubScopedNotifications", () => {
  it("keeps rows explicitly scoped to the active club", async () => {
    const rows = [{ id: "n1", type: "event_note", related_id: "e1", club_id: ACTIVE }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id)).toEqual(["n1"]);
  });

  it("drops rows explicitly scoped to a foreign club", async () => {
    const rows = [{ id: "n1", type: "event_note", related_id: "e1", club_id: OTHER }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("keeps global notification types even when unresolved", async () => {
    const rows = [
      { id: "g1", type: "system_update", related_id: null, club_id: null },
      { id: "g2", type: "role_request_approved", related_id: null, club_id: null },
      { id: "g3", type: "child_added", related_id: null, club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id).sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("drops reward_claimed from a foreign club (resolves via reward_redemptions)", async () => {
    tableRows.reward_redemptions = [{ id: "r1", club_id: OTHER }];
    const rows = [{ id: "n1", type: "reward_claimed", related_id: "r1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("keeps reward_claimed from the active club", async () => {
    tableRows.reward_redemptions = [{ id: "r1", club_id: ACTIVE }];
    const rows = [{ id: "n1", type: "reward_claimed", related_id: "r1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id)).toEqual(["n1"]);
  });

  it("fails closed on reward_claimed when the redemption lookup finds nothing", async () => {
    tableRows.reward_redemptions = [];
    const rows = [{ id: "n1", type: "reward_claimed", related_id: "gone", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("drops reward_proximity from a foreign club (resolves via club_rewards)", async () => {
    tableRows.club_rewards = [{ id: "rw1", club_id: OTHER }];
    const rows = [{ id: "n1", type: "reward_proximity", related_id: "rw1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("scopes reward/streak types whose related_id is the owning club id", async () => {
    const rows = [
      { id: "k1", type: "reward_unlocked", related_id: ACTIVE, club_id: null },
      { id: "k2", type: "early_rsvp_points", related_id: ACTIVE, club_id: null },
      { id: "d1", type: "reward_unlocked", related_id: OTHER, club_id: null },
      { id: "d2", type: "streak_progress", related_id: OTHER, club_id: null },
      { id: "d3", type: "streak_bonus", related_id: OTHER, club_id: null },
      { id: "d4", type: "leaderboard_update", related_id: OTHER, club_id: null },
      // Legacy rows without related_id cannot be resolved → fail closed.
      { id: "d5", type: "reward_unlocked", related_id: null, club_id: null },
      { id: "d6", type: "streak_progress", related_id: null, club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id).sort()).toEqual(["k1", "k2"]);
  });

  it("resolves early RSVP reminders whose related_id is an event id", async () => {
    tableRows.events = [
      { id: "event-active", club_id: ACTIVE, team_id: null },
      { id: "event-other", club_id: OTHER, team_id: null },
    ];
    const rows = [
      { id: "keep", type: "early_rsvp_points", related_id: "event-active", club_id: null },
      { id: "drop", type: "early_rsvp_points", related_id: "event-other", club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id)).toEqual(["keep"]);
  });

  it("resolves points_awarded via event → club and drops foreign-club rows", async () => {
    tableRows.events = [{ id: "e1", club_id: OTHER, team_id: null }];
    const rows = [{ id: "n1", type: "points_awarded", related_id: "e1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("keeps unknown / future notification types when unresolved", async () => {
    const rows = [
      { id: "u1", type: "some_future_type", related_id: "x", club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id)).toEqual(["u1"]);
  });

  it("resolves active-club event notifications and keeps them", async () => {
    tableRows.events = [{ id: "e1", club_id: ACTIVE, team_id: null }];
    const rows = [{ id: "n1", type: "event_note", related_id: "e1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id)).toEqual(["n1"]);
  });

  it("resolves foreign-club event notifications and drops them", async () => {
    tableRows.events = [{ id: "e1", club_id: OTHER, team_id: null }];
    const rows = [{ id: "n1", type: "event_note", related_id: "e1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("fails closed on known club-scoped types when ownership lookup returns no row", async () => {
    // events table has no row for e1 → unresolved
    tableRows.events = [];
    const rows = [
      { id: "n1", type: "event_note", related_id: "missing", club_id: null },
      { id: "n2", type: "team_message", related_id: "missing", club_id: null },
      { id: "n3", type: "club_message", related_id: "missing", club_id: null },
      { id: "n4", type: "group_message", related_id: "missing", club_id: null },
      { id: "n5", type: "photo_comment", related_id: "missing", club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("fails closed on known club-scoped types when the lookup errors", async () => {
    errorTables.add("events");
    const rows = [
      { id: "n1", type: "event_note", related_id: "e1", club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("resolves team_message via team → club and drops when club differs", async () => {
    tableRows.team_messages = [{ id: "m1", team_id: "t1" }];
    tableRows.teams = [{ id: "t1", club_id: OTHER }];
    const rows = [{ id: "n1", type: "team_message", related_id: "m1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out).toEqual([]);
  });

  it("resolves photo_comment via photo → club and keeps when it matches", async () => {
    tableRows.photo_comments = [{ id: "c1", photo_id: "p1" }];
    tableRows.photos = [{ id: "p1", club_id: ACTIVE, team_id: null }];
    const rows = [{ id: "n1", type: "photo_comment", related_id: "c1", club_id: null }];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.map((r) => r.id)).toEqual(["n1"]);
  });

  it("must not expose a known club-scoped notification when ownership lookup fails", async () => {
    // Simulate a foreign-club team_message where lookups fail entirely.
    errorTables.add("team_messages");
    errorTables.add("teams");
    const rows = [
      { id: "leak", type: "team_message", related_id: "m-foreign", club_id: null },
    ];
    const out = await filterClubScopedNotifications(rows, ME, ACTIVE);
    expect(out.find((r) => r.id === "leak")).toBeUndefined();
  });
});
