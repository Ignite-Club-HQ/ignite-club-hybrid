import { expect, test, vi } from "vitest";
import {
  LocalCompetitionJoinFlow,
  type JoinTokenSnapshot,
  type StorageLike,
} from "../src/lab/exportPageModels";

const activeSnapshot: JoinTokenSnapshot = {
  status: "active",
  competition: { id: "competition-1", name: "Winter League" },
  divisions: [{ id: "division-1", name: "Premier" }],
  entered: [],
};

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function createActor() {
  return {
    listAdministeredTeams: vi.fn(async () => [
      { id: "team-1", name: "Riverside Firsts", administratorId: "user-1" },
    ]),
    join: vi.fn(async () => undefined),
  };
}

test("CompetitionJoinPage export: missing tokens fail closed before any provider call", async () => {
  const getSnapshot = vi.fn();
  const actor = createActor();
  const flow = new LocalCompetitionJoinFlow("", getSnapshot, actor, null);

  await expect(flow.load()).resolves.toMatchObject({
    ok: false,
    message: "This join link is missing its token.",
  });
  expect(getSnapshot).not.toHaveBeenCalled();
  expect(actor.listAdministeredTeams).not.toHaveBeenCalled();
});

test.each([
  ["disabled", "The organiser has disabled this join link."],
  ["archived", "The competition has been archived."],
  ["unknown", "This join link isn't recognised."],
] as const)("CompetitionJoinPage export: explains a %s token safely", async (status, message) => {
  const actor = createActor();
  const getSnapshot = vi.fn(async () => ({
    ...activeSnapshot,
    status,
    competition: null,
  }));
  const flow = new LocalCompetitionJoinFlow("join-token", getSnapshot, actor, null);

  await expect(flow.load()).resolves.toEqual({ ok: false, message });
  expect(actor.listAdministeredTeams).not.toHaveBeenCalled();
});

test("CompetitionJoinPage export: preserves the signed-out join redirect", async () => {
  const actor = createActor();
  const flow = new LocalCompetitionJoinFlow(
    "join-token",
    vi.fn(async () => activeSnapshot),
    actor,
    null,
  );
  await expect(flow.load()).resolves.toEqual({ ok: true });

  const storage = new MemoryStorage();
  const destination = flow.signInDestination(storage);
  const url = new URL(destination, "https://ignite.test");
  expect(storage.getItem("redirectAfterAuth")).toBe("/competitions/join?token=join-token");
  expect(url.pathname).toBe("/auth");
  expect(url.searchParams.get("mode")).toBe("signup");
  expect(url.searchParams.get("next")).toBe("/competitions/join?token=join-token");
  expect(url.searchParams.get("redirect")).toBe("/competitions/join?token=join-token");
  expect(actor.join).not.toHaveBeenCalled();
});

test("CompetitionJoinPage export: loads only the current user's administered teams", async () => {
  const actor = createActor();
  const flow = new LocalCompetitionJoinFlow(
    "join-token",
    vi.fn(async () => activeSnapshot),
    actor,
    "user-1",
  );

  await expect(flow.load()).resolves.toEqual({ ok: true });
  expect(actor.listAdministeredTeams).toHaveBeenCalledWith("user-1");
  expect(flow.eligibleTeams()).toEqual([
    { id: "team-1", name: "Riverside Firsts", administratorId: "user-1" },
  ]);
});

test("CompetitionJoinPage export: joins the sole team with a null division", async () => {
  const actor = createActor();
  const flow = new LocalCompetitionJoinFlow(
    "join-token",
    vi.fn(async () => activeSnapshot),
    actor,
    "user-1",
  );
  await flow.load();

  await expect(flow.join("team-1", null)).resolves.toEqual({ ok: true });
  expect(actor.join).toHaveBeenCalledWith("join-token", "team-1", null);
});

test("CompetitionJoinPage export: excludes accepted entries but keeps rejected entries joinable", async () => {
  const actor = createActor();
  const accepted = new LocalCompetitionJoinFlow(
    "join-token",
    vi.fn(async () => ({
      ...activeSnapshot,
      entered: [{ teamId: "team-1", status: "accepted" }],
    })),
    actor,
    "user-1",
  );
  await accepted.load();
  expect(accepted.hasOnlyAlreadyEnteredTeam()).toBe(true);

  const rejected = new LocalCompetitionJoinFlow(
    "join-token",
    vi.fn(async () => ({
      ...activeSnapshot,
      entered: [
        { teamId: "team-1", status: "rejected" },
        { teamId: "team-1", status: "removed" },
      ],
    })),
    actor,
    "user-1",
  );
  await rejected.load();
  expect(rejected.hasOnlyAlreadyEnteredTeam()).toBe(false);
});

test.each([
  ["not_team_admin", "You don't have admin rights for that team."],
  ["invalid_token", "This join link is no longer valid."],
  ["team_not_found", "That team could not be found."],
  ["auth_required", "Please sign in first."],
] as const)("CompetitionJoinPage export: maps %s failures without false success", async (code, message) => {
  const actor = createActor();
  actor.join.mockRejectedValueOnce(new Error(code));
  const flow = new LocalCompetitionJoinFlow(
    "join-token",
    vi.fn(async () => activeSnapshot),
    actor,
    code === "auth_required" ? null : "user-1",
  );
  await flow.load();

  await expect(flow.join("team-1", null)).resolves.toEqual({ ok: false, message });
});
