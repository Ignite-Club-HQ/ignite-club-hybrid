import { describe, it, expect, vi } from "vitest";
import {
  getEventRecipientScope,
  resolveEventRecipients,
  eventRecipientContext,
} from "@/features/events/eventRecipientPolicy";

const EVENT_ID = "e1";

/** Minimal chainable PostgREST stub. */
function makeClient(opts: {
  rpc?: (name: string, args: any) => { data: any; error: any };
  userRoles?: { data: any[]; error?: any };
  miniLeague?: any;
  miniLeaguePlayers?: any[];
}) {
  const rpc = vi.fn(async (name: string, args: any) =>
    opts.rpc ? opts.rpc(name, args) : { data: null, error: new Error("no rpc") },
  );
  const from = vi.fn((table: string) => {
    const builder: any = {
      select: () => builder,
      eq: () => (table === "mini_leagues"
        ? { ...builder, single: async () => ({ data: opts.miniLeague ?? null, error: null }) }
        : builder),
      in: () => builder,
      not: () => builder,
      single: async () => ({ data: opts.miniLeague ?? null, error: null }),
      then: (resolve: any) => {
        if (table === "user_roles") {
          return Promise.resolve({
            data: opts.userRoles?.data ?? [],
            error: opts.userRoles?.error ?? null,
          }).then(resolve);
        }
        if (table === "mini_league_players") {
          return Promise.resolve({ data: opts.miniLeaguePlayers ?? [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return builder;
  });
  return { rpc, from } as any;
}

describe("event recipient scope", () => {
  it("classifies each event shape", () => {
    expect(getEventRecipientScope({ eventId: EVENT_ID, teamId: "t1" })).toBe("team");
    expect(getEventRecipientScope({ eventId: EVENT_ID, clubId: "c1" })).toBe("club_untargeted");
    expect(
      getEventRecipientScope({ eventId: EVENT_ID, clubId: "c1", targetTeamIds: ["t1"] }),
    ).toBe("club_targeted");
    expect(getEventRecipientScope({ eventId: EVENT_ID, miniLeagueId: "m1" })).toBe("mini_league");
    // A team event with stray targets is still a team event.
    expect(
      getEventRecipientScope({ eventId: EVENT_ID, teamId: "t1", targetTeamIds: ["t2"] }),
    ).toBe("team");
  });
});

describe("targeted club-wide events", () => {
  const ctx = { eventId: EVENT_ID, clubId: "c1", targetTeamIds: ["t1", "t2"] };

  it("uses the scoped RPC and never reads club-wide user_roles", async () => {
    const client = makeClient({
      rpc: () => ({
        data: [
          { user_id: "player-on-t1" },
          { user_id: "primary-parent" },
          { user_id: "extra-guardian" },
        ],
        error: null,
      }),
      userRoles: { data: [{ user_id: "unrelated-committee", role: "committee_member" }] },
    });

    const ids = await resolveEventRecipients(client, ctx);

    expect(ids.sort()).toEqual(["extra-guardian", "player-on-t1", "primary-parent"]);
    expect(ids).not.toContain("unrelated-committee");
    expect(client.rpc).toHaveBeenCalledWith(
      "get_targeted_event_notification_recipients",
      { p_event_id: EVENT_ID },
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns each user once across multiple teams/children and drops nulls", async () => {
    const client = makeClient({
      rpc: () => ({
        data: [
          { user_id: "multi" },
          { user_id: "multi" },
          { user_id: null },
          { user_id: "solo" },
        ],
        error: null,
      }),
    });
    expect((await resolveEventRecipients(client, ctx)).sort()).toEqual(["multi", "solo"]);
  });

  it("propagates RPC failure instead of falling back to a wider audience", async () => {
    const client = makeClient({
      rpc: () => ({ data: null, error: new Error("not authorized") }),
      userRoles: { data: [{ user_id: "whole-club", role: "player" }] },
    });
    await expect(resolveEventRecipients(client, ctx)).rejects.toThrow("not authorized");
  });
});

describe("unchanged behaviour", () => {
  it("team event reads every role row on the team", async () => {
    const client = makeClient({
      userRoles: { data: [{ user_id: "a", role: "player" }, { user_id: "a", role: "coach" }] },
    });
    expect(await resolveEventRecipients(client, { eventId: EVENT_ID, teamId: "t1" })).toEqual(["a"]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("untargeted club-wide event keeps the whole club", async () => {
    const client = makeClient({
      userRoles: { data: [{ user_id: "a", role: "player" }, { user_id: "b", role: "committee_member" }] },
    });
    expect(
      (await resolveEventRecipients(client, { eventId: EVENT_ID, clubId: "c1" })).sort(),
    ).toEqual(["a", "b"]);
  });

  it("restricted-role social event still filters by role", async () => {
    const client = makeClient({
      userRoles: {
        data: [
          { user_id: "coach", role: "coach" },
          { user_id: "player", role: "player" },
          { user_id: "admin", role: "club_admin" },
        ],
      },
    });
    const ids = await resolveEventRecipients(client, {
      eventId: EVENT_ID,
      clubId: "c1",
      restrictedToRoles: ["coach"],
    });
    expect(ids.sort()).toEqual(["admin", "coach"]);
  });

  it("mini-league event keeps parents + league officials", async () => {
    const client = makeClient({
      miniLeague: { club_id: "c1" },
      miniLeaguePlayers: [{ parent_user_id: "parent" }, { parent_user_id: null }],
      userRoles: { data: [{ user_id: "league-admin", role: "league_admin" }] },
    });
    const ids = await resolveEventRecipients(client, { eventId: EVENT_ID, miniLeagueId: "m1" });
    expect(ids.sort()).toEqual(["league-admin", "parent"]);
  });

  it("builds context from an events row", () => {
    expect(
      eventRecipientContext(
        { team_id: null, club_id: "c1", mini_league_id: null, target_team_ids: ["t1"], restricted_to_roles: null },
        EVENT_ID,
      ),
    ).toEqual({
      eventId: EVENT_ID,
      teamId: null,
      clubId: "c1",
      miniLeagueId: null,
      targetTeamIds: ["t1"],
      restrictedToRoles: null,
    });
  });
});
