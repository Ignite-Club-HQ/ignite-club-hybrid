import { describe, expect, it } from "vitest";
import {
  collectDirectMessagePeerIds,
  collectPersonalGroupIds,
  filterInboxChatGroups,
  filterInboxClubs,
  filterInboxDirectMessages,
  filterInboxLeagueChats,
  filterInboxTeams,
  normalizeInboxSearchQuery,
  partitionInboxGroups,
} from "./inboxFilterPolicy";

const teams = [
  { id: "team-a", name: "U8 Blue", clubs: { id: "club-a", name: "Riverside" } },
  { id: "team-b", name: "U9 Gold", clubs: { id: "club-b", name: "Lakeside" } },
];

describe("inboxFilterPolicy", () => {
  it("normalizes search without changing its matching semantics", () => {
    expect(normalizeInboxSearchQuery("  RiVeR  ")).toBe("river");
  });

  it("partitions league chats without reordering either partition", () => {
    const rows = [{ id: "a" }, { id: "b", mini_league_id: "league" }, { id: "c" }];
    const result = partitionInboxGroups(rows);
    expect(result.regularChatGroups.map((row) => row.id)).toEqual(["a", "c"]);
    expect(result.leagueChats.map((row) => row.id)).toEqual(["b"]);
  });

  it("collects only personal group ids and unique eligible DM peer positions", () => {
    expect(collectPersonalGroupIds([
      { id: "personal" }, { id: "club", club_id: "club-a" },
      { id: "competition", competition_id: "comp" },
    ])).toEqual(["personal"]);
    expect(collectDirectMessagePeerIds([
      { id: "1", other_user: { id: "me" } },
      { id: "2", other_user: { id: "peer" } },
      { id: "3", other_user: null },
    ], "me")).toEqual(["peer"]);
  });

  it("filters league chats by exact club before searching group and club names", () => {
    const rows = [
      { id: "a", name: "Junior League", club_id: "club-a", clubs: { name: "Riverside" } },
      { id: "b", name: "Junior League", club_id: "club-b", clubs: { name: "Lakeside" } },
    ];
    expect(filterInboxLeagueChats({ groups: rows, clubId: "club-a", query: "river" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterInboxLeagueChats({ groups: rows, clubId: "club-a", query: "lake" })).toEqual([]);
  });

  it("isolates club and team groups to the selected club", () => {
    const groups = [
      { id: "club-a", club_id: "club-a" }, { id: "club-b", club_id: "club-b" },
      { id: "team-a", team_id: "team-a" }, { id: "team-b", team_id: "team-b" },
    ];
    const result = filterInboxChatGroups({
      groups, query: "", effectiveClubId: "club-a", activeClubId: "club-a",
      activeClubTeamIds: ["team-a"], displayedTeams: teams,
    });
    expect(result.map((row) => row.id)).toEqual(["club-a", "team-a"]);
  });

  it("uses displayed team relations when the selected club is not the active club", () => {
    const groups = [{ id: "a", team_id: "team-a" }, { id: "b", team_id: "team-b" }];
    expect(filterInboxChatGroups({
      groups, query: "", effectiveClubId: "club-b", activeClubId: null,
      activeClubTeamIds: [], displayedTeams: teams,
    }).map((row) => row.id)).toEqual(["b"]);
  });

  it("shows competition groups only when the selected club has an entered team", () => {
    const groups = [{ id: "allowed", competition_id: "comp-a" }, { id: "denied", competition_id: "comp-b" }];
    expect(filterInboxChatGroups({
      groups, query: "", effectiveClubId: "club-a", activeClubTeamIds: [], displayedTeams: teams,
      competitionClubMap: { "comp-a": new Set(["club-a"]), "comp-b": new Set(["club-b"]) },
    }).map((row) => row.id)).toEqual(["allowed"]);
  });

  it("keeps personal groups while club membership is loading, then filters by another member", () => {
    const groups = [{ id: "mine" }, { id: "other" }, { id: "solo" }];
    const base = { groups, query: "", effectiveClubId: "club-a", activeClubTeamIds: [], displayedTeams: teams };
    expect(filterInboxChatGroups(base).map((row) => row.id)).toEqual(["mine", "other", "solo"]);
    expect(filterInboxChatGroups({
      ...base, currentUserId: "me", usersInClub: new Set(["member-a"]),
      groupMembersMap: new Map([["mine", ["me", "member-a"]], ["other", ["me", "member-b"]], ["solo", ["me"]]]),
    }).map((row) => row.id)).toEqual(["mine", "solo"]);
  });

  it("keeps hidden personal groups hidden until search or a newer message revives them", () => {
    const base = { groups: [{ id: "personal", name: "Grounds" }], effectiveClubId: null, activeClubTeamIds: [], displayedTeams: teams };
    const hiddenGroupMap = new Map([["personal", "2026-01-02T00:00:00Z"]]);
    expect(filterInboxChatGroups({ ...base, query: "", hiddenGroupMap, latestGroupMessages: {} })).toEqual([]);
    expect(filterInboxChatGroups({ ...base, query: "grounds", hiddenGroupMap, latestGroupMessages: {} })).toHaveLength(1);
    expect(filterInboxChatGroups({ ...base, query: "", hiddenGroupMap, latestGroupMessages: { personal: { created_at: "2026-01-03T00:00:00Z" } } })).toHaveLength(1);
  });

  it("searches regular groups across group, team and club names", () => {
    const groups = [
      { id: "name", name: "Grounds" },
      { id: "team", name: "Parents", teams: { name: "U8 Blue" } },
      { id: "club", name: "Committee", clubs: { name: "Riverside" } },
    ];
    const base = { groups, effectiveClubId: null, activeClubTeamIds: [], displayedTeams: teams };
    expect(filterInboxChatGroups({ ...base, query: "grounds" }).map((r) => r.id)).toEqual(["name"]);
    expect(filterInboxChatGroups({ ...base, query: "u8" }).map((r) => r.id)).toEqual(["team"]);
    expect(filterInboxChatGroups({ ...base, query: "river" }).map((r) => r.id)).toEqual(["club"]);
  });

  it("filters teams and clubs by exact club without disturbing source order", () => {
    expect(filterInboxTeams({ teams, query: "", effectiveClubId: "club-a", activeClubId: "club-a", activeClubTeamIds: [] }).map((r) => r.id)).toEqual(["team-a"]);
    expect(filterInboxTeams({ teams, query: "lake", effectiveClubId: null, activeClubId: null, activeClubTeamIds: [] }).map((r) => r.id)).toEqual(["team-b"]);
    expect(filterInboxClubs({ clubs: [{ id: "club-a", name: "Riverside" }, { id: "club-b", name: "Lakeside" }], query: "", clubId: "club-b" }).map((r) => r.id)).toEqual(["club-b"]);
  });

  it("hides empty DM stubs but retains genuine messages and trimmed drafts", () => {
    const rows = [
      { id: "empty", other_user: { id: "a", display_name: "A" } },
      { id: "message", other_user: { id: "b", display_name: "B" }, last_message: { created_at: "2026-01-01" } },
      { id: "draft", other_user: { id: "c", display_name: "C" } },
    ];
    expect(filterInboxDirectMessages({ conversations: rows, query: "", drafts: { draft: { text: " hello " } }, isSupportUser: () => false }).map((r) => r.id)).toEqual(["message", "draft"]);
  });

  it("keeps DMs during club lookup then isolates peers, except Ignite Support", () => {
    const rows = [
      { id: "member", other_user: { id: "member", display_name: "Member" }, last_message: {} },
      { id: "outsider", other_user: { id: "outsider", display_name: "Outsider" }, last_message: {} },
      { id: "support", other_user: { id: "support", display_name: "Ignite Support" }, last_message: {} },
    ];
    const base = { conversations: rows, query: "", drafts: {}, effectiveClubId: "club-a", isSupportUser: (id?: string | null) => id === "support" };
    expect(filterInboxDirectMessages(base)).toHaveLength(3);
    expect(filterInboxDirectMessages({ ...base, usersInClub: new Set(["member"]) }).map((r) => r.id)).toEqual(["member", "support"]);
  });

  it("search reveals a hidden matching DM but not a different peer", () => {
    const rows = [
      { id: "hidden", other_user: { id: "a", display_name: "Alex River" }, last_message: { created_at: "2026-01-01" } },
      { id: "other", other_user: { id: "b", display_name: "Taylor Lake" }, last_message: {} },
    ];
    expect(filterInboxDirectMessages({
      conversations: rows, query: "river", drafts: {},
      hiddenMap: new Map([["hidden", "2026-02-01"]]), isSupportUser: () => false,
    }).map((r) => r.id)).toEqual(["hidden"]);
  });
});
