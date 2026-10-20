import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  from,
  toastSuccess,
  toastError,
  invalidateQueries,
  selectProfile,
  queryOptions,
  mode,
  context,
  roleGrants,
  clubGroups,
  teamGroups,
  clubProfile,
  forwardLiveMessage,
  notifyLive,
} = vi.hoisted(() => ({
  from: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateQueries: vi.fn(),
  selectProfile: vi.fn(),
  queryOptions: { current: null as any },
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: { getPrincipal: () => ({ toText: () => "principal-sender" }) }, target: {} },
  roleGrants: vi.fn(),
  clubGroups: vi.fn(),
  teamGroups: vi.fn(),
  clubProfile: vi.fn(),
  forwardLiveMessage: vi.fn(),
  notifyLive: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mode === "icp" ? providers.icp(context) : providers.supabase(),
}));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: (...args: unknown[]) => roleGrants(...args) }));
vi.mock("@/live/features/messaging", () => ({
  listLiveGroupsByClub: (...args: unknown[]) => clubGroups(...args),
  listLiveGroupsByTeam: (...args: unknown[]) => teamGroups(...args),
  forwardLiveMessage: (...args: unknown[]) => forwardLiveMessage(...args),
}));
vi.mock("@/live/features/club", () => ({ getLiveClubProfile: (...args: unknown[]) => clubProfile(...args) }));
vi.mock("@/live/features/notifications", () => ({ recordLiveChatNotifyBatch: (...args: unknown[]) => notifyLive(...args) }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: selectProfile }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: (options: any) => {
    queryOptions.current = options;
    return { data: undefined, isLoading: false };
  },
  useMutation: (options: any) => ({
    mutateAsync: async (input: any) => {
      try {
        const value = await options.mutationFn(input);
        options.onSuccess?.(value);
        return value;
      } catch (error) {
        options.onError?.(error);
        throw error;
      }
    },
  }),
}));

import {
  useForwardDestinations,
  useForwardMessageMutation,
} from "./useForwardMessage";

function resolvedQuery(result: { data?: any; error?: any }) {
  const query: any = {};
  for (const method of ["select", "eq", "in", "is", "not", "insert"]) {
    query[method] = vi.fn(() => query);
  }
  Object.defineProperty(query, "then", {
    value: (resolve: any) =>
      Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve),
  });
  return query;
}

function rejectedQuery(error: unknown) {
  const query: any = {};
  for (const method of ["select", "eq", "in", "is", "not", "insert"]) {
    query[method] = vi.fn(() => query);
  }
  Object.defineProperty(query, "then", {
    value: (_resolve: any, reject: any) => Promise.reject(error).catch(reject),
  });
  return query;
}

const source = {
  text: "Please bring the match kit",
  imageUrl: null,
  authorId: "author-1",
  sourceLabel: "Team chat",
};

describe.runIf(mode === "supabase")("useForwardDestinations membership scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryOptions.current = null;
  });

  it("does not enable destination discovery without a signed-in user", () => {
    renderHook(() => useForwardDestinations(undefined, true));
    expect(queryOptions.current.enabled).toBe(false);
  });

  it("returns no destinations without querying groups when membership is empty", async () => {
    from.mockReturnValueOnce(resolvedQuery({ data: [] }));
    renderHook(() => useForwardDestinations("user-1", true));

    await expect(queryOptions.current.queryFn()).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("group_members");
  });

  it("lists only group ids returned by membership lookup and sorts them by name", async () => {
    const memberships = resolvedQuery({
      data: [{ group_id: "group-b" }, { group_id: "group-a" }],
    });
    const groups = resolvedQuery({
      data: [
        { id: "group-b", name: "Zebras", club_id: "club-1", team_id: null },
        { id: "group-a", name: "Alphas", club_id: "club-1", team_id: "team-1" },
      ],
    });
    const clubs = resolvedQuery({ data: [{ id: "club-1", name: "Riverside" }] });
    from.mockReturnValueOnce(memberships).mockReturnValueOnce(groups).mockReturnValueOnce(clubs);
    renderHook(() => useForwardDestinations("user-1", true));

    await expect(queryOptions.current.queryFn()).resolves.toEqual([
      { id: "group-a", name: "Alphas", club_id: "club-1", team_id: "team-1", club_name: "Riverside" },
      { id: "group-b", name: "Zebras", club_id: "club-1", team_id: null, club_name: "Riverside" },
    ]);
    expect(groups.in).toHaveBeenCalledWith("id", ["group-b", "group-a"]);
    expect(groups.is).toHaveBeenCalledWith("deleted_at", null);
    expect(groups.not).toHaveBeenCalledWith("club_id", "is", null);
  });

  it("stops when membership or group discovery returns a permission error", async () => {
    from.mockReturnValueOnce(resolvedQuery({ error: { message: "membership denied" } }));
    renderHook(() => useForwardDestinations("user-1", true));
    await expect(queryOptions.current.queryFn()).rejects.toEqual({ message: "membership denied" });
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe.runIf(mode === "supabase")("useForwardMessageMutation permission and failure boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectProfile.mockResolvedValue({ data: { display_name: "Casey Coach" } });
  });

  it("rejects forwarding without a signed-in sender before any mutation", async () => {
    const { result } = renderHook(() => useForwardMessageMutation(undefined));

    await expect(
      act(async () => result.current.mutateAsync({ source, destinationGroupIds: ["group-1"] })),
    ).rejects.toThrow("Not signed in");
    expect(from).not.toHaveBeenCalled();
  });

  it("treats an empty destination selection as a successful no-op", async () => {
    const { result } = renderHook(() => useForwardMessageMutation("user-1"));

    await expect(
      act(async () => result.current.mutateAsync({ source, destinationGroupIds: [] })),
    ).resolves.toEqual({ forwarded: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("writes the current sender identity and preserved source attribution to every destination", async () => {
    const messageInsert = resolvedQuery({
      data: [{ id: "message-1", group_id: "group-1" }, { id: "message-2", group_id: "group-2" }],
    });
    const groupLookup = resolvedQuery({
      data: [
        { id: "group-1", name: "Coaches", club_id: "club-1" },
        { id: "group-2", name: "Volunteers", club_id: "club-1" },
      ],
    });
    const notificationInsert = resolvedQuery({ data: [] });
    from.mockReturnValueOnce(messageInsert).mockReturnValueOnce(groupLookup).mockReturnValueOnce(notificationInsert);
    const { result } = renderHook(() => useForwardMessageMutation("user-1"));

    await act(async () =>
      result.current.mutateAsync({ source, destinationGroupIds: ["group-1", "group-2"] }),
    );

    expect(messageInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ group_id: "group-1", author_id: "user-1", forwarded_from_user_id: "author-1" }),
      expect.objectContaining({ group_id: "group-2", author_id: "user-1", forwarded_from_user_id: "author-1" }),
    ]);
    expect(notificationInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: "author-1", related_id: "message-1", club_id: "club-1" }),
      expect.objectContaining({ user_id: "author-1", related_id: "message-2", club_id: "club-1" }),
    ]);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["group-messages"] });
  });

  it("does not notify or invalidate caches when the message insert is denied", async () => {
    from.mockReturnValueOnce(resolvedQuery({ error: { message: "not a group member" } }));
    const { result } = renderHook(() => useForwardMessageMutation("user-1"));

    await expect(
      act(async () => result.current.mutateAsync({ source, destinationGroupIds: ["foreign-group"] })),
    ).rejects.toEqual({ message: "not a group member" });

    expect(from).toHaveBeenCalledTimes(1);
    expect(selectProfile).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("not a group member");
  });

  it("does not notify a user when they forward their own message", async () => {
    const messageInsert = resolvedQuery({ data: [{ id: "message-1", group_id: "group-1" }] });
    from.mockReturnValueOnce(messageInsert);
    const ownSource = { ...source, authorId: "user-1" };
    const { result } = renderHook(() => useForwardMessageMutation("user-1"));

    await act(async () =>
      result.current.mutateAsync({ source: ownSource, destinationGroupIds: ["group-1"] }),
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(selectProfile).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Message forwarded");
  });

  it("keeps the forward successful when author notification delivery fails", async () => {
    const messageInsert = resolvedQuery({ data: [{ id: "message-1", group_id: "group-1" }] });
    const groupLookup = resolvedQuery({
      data: [{ id: "group-1", name: "Coaches", club_id: "club-1" }],
    });
    const failedNotification = rejectedQuery(new Error("notification delivery failed"));
    from.mockReturnValueOnce(messageInsert).mockReturnValueOnce(groupLookup).mockReturnValueOnce(failedNotification);
    const { result } = renderHook(() => useForwardMessageMutation("user-1"));

    await expect(
      act(async () => result.current.mutateAsync({ source, destinationGroupIds: ["group-1"] })),
    ).resolves.toEqual({ forwarded: 1 });
    expect(toastSuccess).toHaveBeenCalledWith("Message forwarded");
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe.runIf(mode === "icp")("useForwardMessage ICP provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleGrants.mockResolvedValue([
      { club: ["club-1"], team: ["team-1"] },
    ]);
    clubGroups.mockResolvedValue([
      { conversationId: "club-group", name: "Club", clubId: "club-1", teamId: null, isMember: true },
    ]);
    teamGroups.mockResolvedValue([
      { conversationId: "team-group", name: "Team", clubId: "club-1", teamId: "team-1", isMember: true },
      { conversationId: "not-member", name: "Other", clubId: "club-1", teamId: "team-1", isMember: false },
    ]);
    clubProfile.mockResolvedValue([{ name: "Riverside" }]);
    forwardLiveMessage.mockResolvedValue({ id: "forwarded-message" });
    notifyLive.mockResolvedValue(undefined);
  });

  it("discovers only member groups through club/team canister queries", async () => {
    renderHook(() => useForwardDestinations("principal-sender", true));
    await expect(queryOptions.current.queryFn()).resolves.toEqual([
      { id: "club-group", name: "Club", club_id: "club-1", team_id: null, club_name: "Riverside" },
      { id: "team-group", name: "Team", club_id: "club-1", team_id: "team-1", club_name: "Riverside" },
    ]);
    expect(roleGrants).toHaveBeenCalledWith(context);
    expect(clubGroups).toHaveBeenCalledWith(context, "club-1");
    expect(teamGroups).toHaveBeenCalledWith(context, "team-1");
    expect(from).not.toHaveBeenCalled();
  });

  it("forwards the source message to selected canister conversations and notifies its author", async () => {
    const { result } = renderHook(() => useForwardMessageMutation("principal-sender"));
    await expect(result.current.mutateAsync({
      source: { ...source, messageId: "source-message" },
      destinationGroupIds: ["team-group"],
    })).resolves.toEqual({ forwarded: 1 });
    expect(forwardLiveMessage).toHaveBeenCalledWith(context, "source-message", "team-group");
    expect(notifyLive).toHaveBeenCalledWith(context, expect.objectContaining({
      conversationId: "team-group",
      recipients: ["author-1"],
    }));
    expect(from).not.toHaveBeenCalled();
  });

  it("does not enable destination discovery without a signed-in principal", () => {
    renderHook(() => useForwardDestinations(undefined, true));

    expect(queryOptions.current.enabled).toBe(false);
    expect(roleGrants).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns no destinations without querying groups when the caller has no role grants", async () => {
    roleGrants.mockResolvedValueOnce([]);
    renderHook(() => useForwardDestinations("principal-sender", true));

    await expect(queryOptions.current.queryFn()).resolves.toEqual([]);

    expect(clubGroups).not.toHaveBeenCalled();
    expect(teamGroups).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("treats an empty destination selection as a successful no-op", async () => {
    const { result } = renderHook(() => useForwardMessageMutation("principal-sender"));

    await expect(result.current.mutateAsync({ source, destinationGroupIds: [] })).resolves.toEqual({ forwarded: 0 });

    expect(forwardLiveMessage).not.toHaveBeenCalled();
    expect(notifyLive).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects forwarding without a signed-in sender before canister calls", async () => {
    const { result } = renderHook(() => useForwardMessageMutation(undefined));

    await expect(
      result.current.mutateAsync({ source: { ...source, messageId: "source-1" }, destinationGroupIds: ["team-group"] }),
    ).rejects.toThrow("Not signed in");

    expect(forwardLiveMessage).not.toHaveBeenCalled();
    expect(notifyLive).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("does not notify the author when forwarding their own message", async () => {
    const { result } = renderHook(() => useForwardMessageMutation("principal-sender"));

    await expect(result.current.mutateAsync({
      source: { ...source, authorId: "principal-sender", messageId: "source-1" },
      destinationGroupIds: ["team-group"],
    })).resolves.toEqual({ forwarded: 1 });

    expect(forwardLiveMessage).toHaveBeenCalledWith(context, "source-1", "team-group");
    expect(notifyLive).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps forwarding successful when author notification recording fails", async () => {
    notifyLive.mockRejectedValueOnce(new Error("notification unavailable"));
    const { result } = renderHook(() => useForwardMessageMutation("principal-sender"));

    await expect(result.current.mutateAsync({
      source: { ...source, messageId: "source-1" },
      destinationGroupIds: ["team-group"],
    })).resolves.toEqual({ forwarded: 1 });

    expect(forwardLiveMessage).toHaveBeenCalledWith(context, "source-1", "team-group");
    expect(notifyLive).toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
