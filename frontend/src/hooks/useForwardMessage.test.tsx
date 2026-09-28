import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  from,
  toastSuccess,
  toastError,
  invalidateQueries,
  selectProfile,
  queryOptions,
} = vi.hoisted(() => ({
  from: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateQueries: vi.fn(),
  selectProfile: vi.fn(),
  queryOptions: { current: null as any },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
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

describe("useForwardDestinations membership scoping", () => {
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

describe("useForwardMessageMutation permission and failure boundaries", () => {
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
