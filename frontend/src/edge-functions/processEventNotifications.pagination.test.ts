/**
 * Pagination + fail-closed tests for event-notification recipient resolution.
 *
 * Defects covered:
 *  1. mini-league recipients truncated at the PostgREST row cap
 *  2. targeted guardian discovery truncated at the row cap
 *  3-6. team / mini-league / child-assignment / guardian read failures treated
 *       as a valid empty or partial audience
 */
import { describe, it, expect } from "vitest";
import {
  AudienceResolutionError,
  PAGE_SIZE,
  paginateColumn,
  resolveRecipients,
} from "../../supabase/functions/process-event-notifications/recipients.ts";
import { FakeSupabase } from "../../supabase/functions/process-event-notifications/testFakeSupabase.ts";

const CLUB = "club-1";
const TEAM = "team-a";
const CREATOR = "user-creator";
const EVENT = "event-1";

const pad = (n: number) => String(n).padStart(6, "0");

function many(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => `${prefix}-${pad(i)}`);
}

/** Simulate a hard PostgREST per-request row cap. */
function capped(tables: Record<string, any[]>, cap = 250) {
  const db = new FakeSupabase(tables);
  db.defaultLimit = cap;
  return db;
}

describe("recipient pagination — mini-league", () => {
  it("returns 1,205 mini-league parents plus administrators completely", async () => {
    const parents = many(1205, "parent");
    const admins = many(7, "mladmin");
    const db = capped({
      mini_league_players: parents.map((id) => ({
        mini_league_id: "ml-1",
        parent_user_id: id,
      })),
      mini_league_admins: admins.map((id) => ({ mini_league_id: "ml-1", user_id: id })),
      user_roles: [{ user_id: "la1", role: "league_admin", club_id: CLUB, team_id: null }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR);
    expect(ids).toHaveLength(1205 + 7 + 1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("parent-001204");
  });

  for (const n of [PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, 999, 1000, 1001]) {
    it(`does not truncate at ${n} mini-league parents`, async () => {
      const parents = many(n, "parent");
      const db = capped({
        mini_league_players: parents.map((id) => ({
          mini_league_id: "ml-1",
          parent_user_id: id,
        })),
      });
      const ids = await resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR);
      expect(ids).toHaveLength(n);
    });
  }

  it("excludes the creator from the mini-league audience", async () => {
    const db = capped({
      mini_league_players: [
        { mini_league_id: "ml-1", parent_user_id: CREATOR },
        { mini_league_id: "ml-1", parent_user_id: "p1" },
      ],
      mini_league_admins: [{ mini_league_id: "ml-1", user_id: CREATOR }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR);
    expect(ids).toEqual(["p1"]);
  });
});

describe("recipient pagination — targeted club-wide", () => {
  it("returns 1,205 targeted child assignments and their guardians completely", async () => {
    const children = many(1205, "child");
    const db = capped({
      user_roles: [{ user_id: "u1", role: "player", team_id: TEAM, club_id: CLUB }],
      child_team_assignments: children.map((child_id) => ({ team_id: TEAM, child_id })),
      child_guardians: children.map((child_id, i) => ({
        child_id,
        guardian_id: `guardian-${pad(i)}`,
      })),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect(ids).toContain("guardian-001204");
    expect(ids.filter((i) => i.startsWith("guardian-"))).toHaveLength(1205);
  });

  it("gives duplicate guardians and multi-role users exactly one notification", async () => {
    const db = capped({
      user_roles: [
        { user_id: "dual", role: "coach", team_id: TEAM, club_id: CLUB },
        { user_id: "dual", role: "club_admin", team_id: null, club_id: CLUB },
      ],
      child_team_assignments: [
        { team_id: TEAM, child_id: "c1" },
        { team_id: TEAM, child_id: "c2" },
      ],
      child_guardians: [
        { child_id: "c1", guardian_id: "g1" },
        { child_id: "c2", guardian_id: "g1" },
      ],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect([...ids].sort()).toEqual(["dual", "g1"]);
  });

  it("excludes the creator from targeted team, admin and guardian paths", async () => {
    const db = capped({
      user_roles: [
        { user_id: CREATOR, role: "coach", team_id: TEAM, club_id: CLUB },
        { user_id: CREATOR, role: "club_admin", team_id: null, club_id: CLUB },
        { user_id: "u1", role: "player", team_id: TEAM, club_id: CLUB },
      ],
      child_team_assignments: [{ team_id: TEAM, child_id: "c1" }],
      child_guardians: [{ child_id: "c1", guardian_id: CREATOR }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect(ids).toEqual(["u1"]);
  });
});

describe("recipient pagination — club-wide and team", () => {
  it("does not truncate a 1,001-member club-wide event", async () => {
    const db = capped({
      user_roles: many(1001, "member").map((user_id) => ({
        user_id,
        role: "player",
        club_id: CLUB,
        team_id: null,
      })),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: null }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect(ids).toHaveLength(1001);
  });

  it("does not truncate a 1,001-member team event", async () => {
    const db = capped({
      user_roles: many(1001, "member").map((user_id) => ({
        user_id,
        role: "player",
        club_id: CLUB,
        team_id: TEAM,
      })),
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
    expect(ids).toHaveLength(1001);
  });
});

describe("fail-closed on every recipient-source read failure", () => {
  const err = { code: "57014", message: "canceling statement due to statement timeout" };

  it("team membership read failure aborts instead of returning []", async () => {
    const db = new FakeSupabase({ user_roles: [] });
    db.errors.user_roles = err;
    await expect(
      resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it("mini-league membership read failure aborts instead of returning []", async () => {
    const db = new FakeSupabase({ mini_league_players: [] });
    db.errors.mini_league_players = err;
    await expect(
      resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it("mini-league admin read failure aborts", async () => {
    const db = new FakeSupabase({ mini_league_players: [] });
    db.errors.mini_league_admins = err;
    await expect(
      resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it("targeted child-assignment read failure aborts instead of a partial audience", async () => {
    const db = new FakeSupabase({
      user_roles: [{ user_id: "u1", role: "player", team_id: TEAM, club_id: CLUB }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    db.errors.child_team_assignments = err;
    await expect(
      resolveRecipients(db, EVENT, CLUB, null, null, CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it("targeted guardian-relation read failure aborts instead of a partial audience", async () => {
    const db = new FakeSupabase({
      user_roles: [{ user_id: "u1", role: "player", team_id: TEAM, club_id: CLUB }],
      child_team_assignments: [{ team_id: TEAM, child_id: "c1" }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    db.errors.child_guardians = err;
    await expect(
      resolveRecipients(db, EVENT, CLUB, null, null, CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it("the thrown error is sanitised — no DB text, SQL or URLs", async () => {
    const db = new FakeSupabase({ user_roles: [] });
    db.errors.user_roles = {
      code: "42501",
      message: "permission denied for table user_roles at https://reference.invalid",
    };
    await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR).then(
      () => {
        throw new Error("should have thrown");
      },
      (e) => {
        expect(e).toBeInstanceOf(AudienceResolutionError);
        const raw = `${e.name}:${e.message}:${e.code}`;
        expect(raw).not.toMatch(/permission denied/i);
        expect(raw).not.toMatch(/https?:\/\//);
        expect(raw).not.toMatch(/42501/);
      },
    );
  });

  it("a retry after a transient read failure succeeds without duplicates", async () => {
    const db = new FakeSupabase({
      user_roles: [
        { user_id: "u1", role: "player", team_id: TEAM, club_id: CLUB },
        { user_id: "u1", role: "coach", team_id: TEAM, club_id: CLUB },
        { user_id: "u2", role: "player", team_id: TEAM, club_id: CLUB },
      ],
    });
    db.errors.user_roles = err;
    await expect(
      resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
    delete db.errors.user_roles;
    const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
    expect([...ids].sort()).toEqual(["u1", "u2"]);
  });
});

/**
 * Cancellation / update fan-out derives its audience from `rsvps` in
 * `index.ts`. That read now goes through the same paginated, fail-closed
 * helper, so a >1,000-RSVP event cannot under-notify and a read error cannot
 * degrade into an empty audience.
 */
describe("RSVP-derived audience (cancel / update)", () => {
  const rsvpQuery = (db: any, eventId: string) =>
    paginateColumn(
      () =>
        db
          .from("rsvps")
          .select("user_id")
          .eq("event_id", eventId)
          .not("user_id", "is", null),
      "user_id",
      "rsvps",
    );

  for (const n of [PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, 999, 1000, 1001, 1205]) {
    it(`does not truncate ${n} RSVP recipients`, async () => {
      const db = capped({
        rsvps: many(n, "rsvpuser").map((user_id) => ({ event_id: EVENT, user_id })),
      });
      const ids = await rsvpQuery(db, EVENT);
      expect(ids).toHaveLength(n);
      expect(new Set(ids).size).toBe(n);
    });
  }

  it("skips null user_id rows and other events", async () => {
    const db = capped({
      rsvps: [
        { event_id: EVENT, user_id: "u1" },
        { event_id: EVENT, user_id: null },
        { event_id: "other", user_id: "u9" },
      ],
    });
    expect(await rsvpQuery(db, EVENT)).toEqual(["u1"]);
  });

  it("aborts fail-closed when the RSVP read fails", async () => {
    const db = new FakeSupabase({ rsvps: [] });
    db.errors.rsvps = { code: "57014", message: "timeout" };
    await expect(rsvpQuery(db, EVENT)).rejects.toBeInstanceOf(AudienceResolutionError);
  });
});
