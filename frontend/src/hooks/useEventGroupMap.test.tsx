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
        if (table === "teams") return teamsBuilder();
        if (table === "user_roles") return simple(ROLES);
        return simple(ASSIGNMENTS);
      },
    },
  };
});

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
  });

  it("merges multiple teams with the same age level into one group", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const labels = result.current.orderedGroups.map((g) => g.label);
    expect(labels.filter((l) => l === "U8")).toHaveLength(1);
  });

  it("keeps selected teams separate when grouping by team", async () => {
    const { result } = renderHook(
      () => useEventGroupMap({ ...scopedParams, grouping: "team" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const labels = result.current.orderedGroups.map((g) => g.label);
    expect(labels).toContain("U8 Blue");
    expect(labels).toContain("U8 Red");
  });

  it("returns null (out of scope) for a child on an unselected team", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupOf({ childId: "kid-u12" })).toBeNull();
    expect(result.current.groupOf({ childId: "kid-u8" })?.label).toBe("U8");
  });

  it("places an in-scope club-level admin without a team into Other", async () => {
    const { result } = renderHook(() => useEventGroupMap(scopedParams), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupOf({ userId: "club-admin" })?.label).toBe("Other");
    expect(result.current.groupOf({ userId: "adult-1" })?.label).toBe("U8");
  });

  it("keeps the whole-club audience when there is no target list", async () => {
    const { result } = renderHook(
      () => useEventGroupMap({ ...scopedParams, targetTeamIds: null }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isScoped).toBe(false);
    expect(result.current.groupOf({ childId: "kid-unknown" })?.label).toBe("Other");
  });

  it("exposes isError and refetch when the roster query fails", async () => {
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
});
