/**
 * Characterization / regression tests for the event-notification audience
 * resolution fail-closed contract.
 *
 * Defect: when the authoritative `events` lookup (restricted_to_roles /
 * target_team_ids) errored, the code logged and continued with an empty event
 * row, so a targeted or role-restricted event degraded into an unrestricted
 * club-wide fan-out. A transient read failure could therefore notify unrelated
 * club members.
 *
 * Required behaviour: fail closed — throw AudienceResolutionError, create no
 * notification rows and no push-delivery jobs, and return a sanitised,
 * retriable non-2xx response.
 */
import { describe, it, expect } from "vitest";
import {
  AudienceResolutionError,
  resolveRecipients,
} from "../../supabase/functions/process-event-notifications/recipients.ts";
import { FakeSupabase } from "../../supabase/functions/process-event-notifications/testFakeSupabase.ts";

const CLUB = "club-1";
const TEAM = "team-a";
const OTHER_TEAM = "team-b";
const CREATOR = "user-creator";
const EVENT = "event-1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function roles(rows: Array<[string, string, string | null]>) {
  return rows.map(([user_id, role, team_id]) => ({
    user_id,
    role,
    team_id,
    club_id: CLUB,
  }));
}

/**
 * Mirrors the fan-out control flow of
 * `supabase/functions/process-event-notifications/index.ts` for the
 * `event_created` action: resolve audience → enqueue. The real handler can't
 * be imported under Vitest (it calls `Deno.serve` and imports from esm.sh),
 * so this harness reproduces the exact guard being tested.
 */
async function runCreateFanout(db: any) {
  const rpcCalls: Array<{ fn: string; rows: any[] }> = [];
  const supabase = {
    ...db,
    from: db.from.bind(db),
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, rows: args?.p_rows ?? [] });
      return Promise.resolve({
        data: (args?.p_rows ?? []).map(() => ({ created: true, queued: true })),
        error: null,
      });
    },
  };

  let recipients: string[] = [];
  try {
    recipients = await resolveRecipients(supabase, EVENT, CLUB, null, null, CREATOR);
  } catch (e) {
    if (e instanceof AudienceResolutionError) {
      return {
        rpcCalls,
        response: new Response(
          JSON.stringify({ error: "event_audience_lookup_failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        ),
      };
    }
    throw e;
  }

  if (recipients.length > 0) {
    await supabase.rpc("enqueue_event_push_v2", {
      p_url: `/events/${EVENT}`,
      p_rows: recipients.map((user_id) => ({ user_id })),
    });
  }
  return {
    rpcCalls,
    recipients,
    response: new Response(JSON.stringify({ expected: recipients.length }), { status: 200 }),
  };
}

describe("event audience resolution — fail closed", () => {
  it("fails closed instead of notifying the whole club when event audience lookup fails", async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ["u1", "player", TEAM],
        ["u2", "coach", OTHER_TEAM],
        ["admin1", "club_admin", null],
      ]),
      events: [{ id: EVENT, restricted_to_roles: ["coach"], target_team_ids: [TEAM] }],
    });
    db.errors.events = { code: "57014", message: "canceling statement due to statement timeout" };

    await expect(
      resolveRecipients(db, EVENT, CLUB, null, null, CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it("produces zero recipients, no notification insert and no enqueue RPC", async () => {
    const db = new FakeSupabase({
      user_roles: roles([["u1", "player", TEAM], ["admin1", "club_admin", null]]),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    db.errors.events = { code: "PGRST301", message: "JWT expired" };

    const { rpcCalls, response } = await runCreateFanout(db);
    expect(rpcCalls).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
    expect(response.status).toBe(500);
  });

  it("returns a sanitised retriable error that does not reveal the database failure", async () => {
    const db = new FakeSupabase({
      user_roles: roles([["u1", "player", TEAM]]),
      events: [{ id: EVENT, restricted_to_roles: ["coach"], target_team_ids: null }],
    });
    db.errors.events = {
      code: "42501",
      message: 'permission denied for table events at https://reference.invalid',
    };

    const { response } = await runCreateFanout(db);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "event_audience_lookup_failed" });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/permission denied/i);
    expect(raw).not.toMatch(/https?:\/\//);
    expect(raw).not.toMatch(/42501/);
    expect(raw).not.toMatch(/select|table/i);
  });
});

describe("event audience resolution — unchanged behaviour", () => {
  it("a genuinely unrestricted club-wide event still reaches all eligible club members", async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ["u1", "player", TEAM],
        ["u2", "club_admin", null],
        [CREATOR, "club_admin", null],
      ]),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: null }],
    });
    const { recipients, rpcCalls } = await runCreateFanout(db);
    expect([...(recipients ?? [])].sort()).toEqual(["u1", "u2"]);
    expect(rpcCalls).toHaveLength(1);
  });

  it("role-restricted club-wide events still reach only their roles plus club admins", async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ["coach1", "coach", TEAM],
        ["player1", "player", TEAM],
        ["admin1", "club_admin", null],
      ]),
      events: [{ id: EVENT, restricted_to_roles: ["coach"], target_team_ids: null }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect([...ids].sort()).toEqual(["admin1", "coach1"]);
  });

  it("targeted club-wide events still reach only targeted teams, admins and guardians", async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ["t1u1", "player", TEAM],
        ["untargeted", "player", "team-c"],
        ["admin1", "club_admin", null],
      ]),
      child_team_assignments: [{ team_id: TEAM, child_id: "child-1" }],
      child_guardians: [{ child_id: "child-1", guardian_id: "guardian-1" }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect([...ids].sort()).toEqual(["admin1", "guardian-1", "t1u1"]);
  });

  it("ordinary team events never touch the events table and are unaffected", async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ["u1", "player", TEAM],
        ["u2", "parent", TEAM],
        ["u9", "player", OTHER_TEAM],
      ]),
    });
    db.errors.events = { code: "57014", message: "timeout" };
    const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
    expect([...ids].sort()).toEqual(["u1", "u2"]);
    expect(db.queries.some((q: any) => q.table === "events")).toBe(false);
  });

  it("mini-league events are unaffected by events-table failures", async () => {
    const db = new FakeSupabase({
      mini_league_players: [{ mini_league_id: "ml-1", parent_user_id: "p1" }],
      mini_league_admins: [{ mini_league_id: "ml-1", user_id: "a1" }],
      user_roles: [{ user_id: "la1", role: "league_admin", club_id: CLUB, team_id: null }],
    });
    db.errors.events = { code: "57014", message: "timeout" };
    const ids = await resolveRecipients(db, EVENT, CLUB, null, "ml-1", CREATOR);
    expect([...ids].sort()).toEqual(["a1", "la1", "p1"]);
  });
});
