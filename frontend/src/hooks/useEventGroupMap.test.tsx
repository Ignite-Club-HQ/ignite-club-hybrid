import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useEventGroupMap } from "./useEventGroupMap";

const TEAMS = [
  { id: "t-u8-blue", name: "U8 Blue", level_age: "U8" },
  { id: "t-u8-red", name: "U8 Red", level_age: "U8" },
];
const ROLES = [{ user_id: "adult-1", team_id: "t-u8-blue" }];
const ASSIGNMENTS = [
  { child_id: "kid-u8", team_id: "t-u8-blue" },
  { child_id: "kid-u8b", team_id: "t-u8-red" },
];

let failTeams = false;
const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  listTeams: vi.fn(),
  roleGrants: vi.fn(),
  supabaseTables: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const teamsBuilder = () => {
    const b: any = {
      select: () => b,
      eq: () => b,
      in: () => b,
      then: (res: any) =>
        Promise.resolve(
          failTeams ? { data: null, error: new Error("permission denied") } : { data: TEAMS, error: null },
        ).then(res),
    };
    return b;
  };
  const simple = (data: any) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      in: () => b,
      then: (res: any) => Promise.resolve({ data, error: null }).then(res),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => {
        backendMocks.supabaseTables.push(table);
        if (table === "teams") return teamsBuilder();
        if (table === "user_roles") return simple(ROLES);
        return simple(ASSIGNMENTS);
      },
    },
  };
});
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => backendMocks.mode === "icp" }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/club", () => ({
  listLiveTeams: (...args: unknown[]) => backendMocks.listTeams(...args),
  myLiveRoleGrants: (...args: unknown[]) => backendMocks.roleGrants(...args),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const scopedParams = {
  clubId: "club-1",
  grouping: "level" as const,
  targetTeamIds: ["t-u8-blue", "t-u8-red"],
  enabled: true,
};

describe("useEventGroupMap scoping", () => {
  beforeEach(() => {
    failTeams = false;
    backendMocks.supabaseTables = [];
    backendMocks.listTeams.mockReset().mockResolvedValue(TEAMS);
    backendMocks.roleGrants.mockReset().mockResolvedValue([
      { user: { toText: () => "adult-1" }, role: "coach", team: "t-u8-blue" },
    ]);
  });

  it.runIf(backendMocks.mode === "supabase")("merges multiple teams with the same age level into one group", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const labels = result.current.orderedGroups.map((g) => g.label);
    expect(labels.filter((l) => l === "U8")).toHaveLength(1);
  });

  it.runIf(backendMocks.mode === "supabase")("keeps selected teams separate when grouping by team", async () => {
    const { result } = renderHook(
      () => useEventGroupMap({ ...scopedParams, grouping: "team" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const labels = result.current.orderedGroups.map((g) => g.label);
    expect(labels).toContain("U8 Blue");
    expect(labels).toContain("U8 Red");
  });

  it.runIf(backendMocks.mode === "supabase")("returns null (out of scope) for a child on an unselected team", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupOf({ childId: "kid-u12" })).toBeNull();
    expect(result.current.groupOf({ childId: "kid-u8" })?.label).toBe("U8");
  });

  it.runIf(backendMocks.mode === "supabase")("places an in-scope club-level admin without a team into Other", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupOf({ userId: "club-admin" })?.label).toBe("Other");
    expect(result.current.groupOf({ userId: "adult-1" })?.label).toBe("U8");
  });

  it.runIf(backendMocks.mode === "supabase")("keeps the whole-club audience when there is no target list", async () => {
    const { result } = renderHook(
      () => useEventGroupMap({ ...scopedParams, targetTeamIds: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isScoped).toBe(false);
    expect(result.current.groupOf({ childId: "kid-unknown" })?.label).toBe("Other");
  });

  it.runIf(backendMocks.mode === "supabase")("exposes isError and refetch when the roster query fails", async () => {
    failTeams = true;
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(typeof result.current.refetch).toBe("function");
  });

  it("uses scoped roster rows for targeted events instead of direct role/assignment queries", async () => {
    const { result } = renderHook(
      () => useEventGroupMap({
        ...scopedParams,
        scopedRosterRows: [
          { kind: "child", person_id: "kid-rpc", team_ids: ["t-u8-red"] },
          { kind: "adult", person_id: "adult-rpc", team_ids: ["t-u8-blue"] },
        ],
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.groupOf({ childId: "kid-rpc" })?.label).toBe("U8");
    expect(result.current.groupOf({ userId: "adult-rpc" })?.label).toBe("U8");
    expect(result.current.groupOf({ childId: "kid-u8" })).toBeNull();
  });

  it.runIf(backendMocks.mode === "icp")("loads team labels and caller role grants from club_domain", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.orderedGroups).toContainEqual({ key: "level:U8", label: "U8" });
    expect(result.current.groupOf({ userId: "adult-1" })?.label).toBe("U8");
    expect(backendMocks.listTeams).toHaveBeenCalledWith(backendMocks.context, "club-1");
    expect(backendMocks.roleGrants).toHaveBeenCalledWith(backendMocks.context);
    expect(backendMocks.supabaseTables).toEqual([]);
  });

  it.runIf(backendMocks.mode === "icp")("merges teams with the same age level and keeps team grouping separate", async () => {
    const level = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(level.result.current.isLoading).toBe(false));
    expect(level.result.current.orderedGroups).toEqual([
      { key: "level:U8", label: "U8" },
      { key: "__other__", label: "Other" },
    ]);

    const byTeam = renderHook(() => useEventGroupMap({ ...scopedParams, grouping: "team" }), { wrapper });
    await waitFor(() => expect(byTeam.result.current.isLoading).toBe(false));
    expect(byTeam.result.current.orderedGroups.map((group) => group.label)).toEqual(["U8 Blue", "U8 Red", "Other"]);
  });

  it.runIf(backendMocks.mode === "icp")("keeps a child outside the selected team scope out of the group map", async () => {
    const { result } = renderHook(() => useEventGroupMap({
      ...scopedParams,
      scopedRosterRows: [{ kind: "child", person_id: "kid-outside", team_ids: ["team-other"] }],
    }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.groupOf({ childId: "kid-outside" })).toBeNull();
  });

  it.runIf(backendMocks.mode === "icp")("keeps whole-club audience members in Other when no team resolves", async () => {
    const { result } = renderHook(() => useEventGroupMap({
      ...scopedParams,
      targetTeamIds: null,
    }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isScoped).toBe(false);
    expect(result.current.groupOf({ childId: "kid-without-team" })).toEqual({ key: "__other__", label: "Other" });
    expect(result.current.groupOf({ userId: "club-admin-without-team" })).toEqual({ key: "__other__", label: "Other" });
  });

  it.runIf(backendMocks.mode === "icp")("surfaces a canister team lookup failure", async () => {
    backendMocks.listTeams.mockRejectedValueOnce(new Error("team lookup denied"));
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.orderedGroups).toEqual([{ key: "__other__", label: "Other" }]);
    expect(backendMocks.supabaseTables).toEqual([]);
  });
});
