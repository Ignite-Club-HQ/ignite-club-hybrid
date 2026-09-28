import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  results: new Map<string, { data: unknown[]; error: null }>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));

import { ClubWideRsvpBreakdown } from "./ClubWideRsvpBreakdown";

function queryFor(table: string) {
  const chain: any = {};
  for (const method of ["select", "eq", "in"]) chain[method] = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: any, reject: any) =>
      Promise.resolve(mocks.results.get(table) ?? { data: [], error: null }).then(resolve, reject),
  });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

function seedResults() {
  mocks.results.set("teams", { data: [
    { id: "team-u10", name: "U10 Blue", age_group: "U10" },
    { id: "team-u8", name: "U8 Red", age_group: "U8" },
  ], error: null });
  mocks.results.set("user_roles", { data: [
    { user_id: "adult-1", team_id: "team-u10", role: "coach", profiles: { id: "adult-1", display_name: "Alex Adult" } },
    // A second role in the same team must not double count the person.
    { user_id: "adult-1", team_id: "team-u10", role: "team_admin", profiles: { id: "adult-1", display_name: "Alex Adult" } },
    { user_id: "adult-2", team_id: "team-u8", role: "parent", profiles: { id: "adult-2", display_name: "Blair Adult" } },
  ], error: null });
  mocks.results.set("child_team_assignments", { data: [
    { child_id: "child-1", team_id: "team-u10", children: { id: "child-1", name: "Casey Child" } },
    { child_id: "child-2", team_id: "team-u8", children: { id: "child-2", name: "Drew Child" } },
  ], error: null });
  mocks.results.set("rsvps", { data: [
    { user_id: "adult-1", child_id: null, status: "going" },
    { user_id: null, child_id: "child-1", status: "maybe" },
    { user_id: "adult-2", child_id: null, status: "not_going" },
  ], error: null });
}

describe("ClubWideRsvpBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.clear();
    seedResults();
    mocks.from.mockImplementation(queryFor);
  });

  it("groups adults and children by age level with accurate RSVP and no-response counts", async () => {
    render(
      <ClubWideRsvpBreakdown eventId="event-1" clubId="club-1" grouping="level" />,
      { wrapper },
    );

    expect(await screen.findByText("Attendance by age level")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("U8");
    expect(buttons[0]).toHaveTextContent("0 going");
    expect(buttons[0]).toHaveTextContent("1 no");
    expect(buttons[0]).toHaveTextContent("1 n/r");
    expect(buttons[1]).toHaveTextContent("U10");
    expect(buttons[1]).toHaveTextContent("1 going");
    expect(buttons[1]).toHaveTextContent("1 maybe");

    fireEvent.click(buttons[1]);
    expect(await screen.findByText("Alex Adult")).toBeInTheDocument();
    expect(screen.getByText("Casey Child")).toBeInTheDocument();
  });

  it("groups by exact team name and deduplicates multiple roles in one team", async () => {
    render(
      <ClubWideRsvpBreakdown eventId="event-1" clubId="club-1" grouping="team" />,
      { wrapper },
    );

    const u10 = await screen.findByRole("button", { name: /U10 Blue/ });
    expect(u10).toHaveTextContent("(2)");
    expect(u10).toHaveTextContent("1 going");
    expect(u10).toHaveTextContent("1 maybe");
    fireEvent.click(u10);
    const content = screen.getByText("Alex Adult").parentElement!.parentElement!;
    expect(within(content).getByText("Alex Adult")).toBeInTheDocument();
  });

  it("scopes every data source to the requested club, its teams, and the event", async () => {
    render(
      <ClubWideRsvpBreakdown eventId="event-safe" clubId="club-safe" grouping="team" />,
      { wrapper },
    );
    await screen.findByText("Attendance by team");

    const teams = mocks.from.mock.results.find((_: unknown, i: number) => mocks.from.mock.calls[i][0] === "teams")!.value;
    const roles = mocks.from.mock.results.find((_: unknown, i: number) => mocks.from.mock.calls[i][0] === "user_roles")!.value;
    const assignments = mocks.from.mock.results.find((_: unknown, i: number) => mocks.from.mock.calls[i][0] === "child_team_assignments")!.value;
    const rsvps = mocks.from.mock.results.find((_: unknown, i: number) => mocks.from.mock.calls[i][0] === "rsvps")!.value;
    expect(teams.eq).toHaveBeenCalledWith("club_id", "club-safe");
    expect(roles.eq).toHaveBeenCalledWith("club_id", "club-safe");
    expect(assignments.in).toHaveBeenCalledWith("team_id", ["team-u10", "team-u8"]);
    expect(rsvps.eq).toHaveBeenCalledWith("event_id", "event-safe");
  });

  it("restricts grouped attendance to the selected target teams", async () => {
    mocks.results.set("teams", { data: [
      { id: "team-u10", name: "U10 Blue", age_group: "U10" },
    ], error: null });

    render(
      <ClubWideRsvpBreakdown
        eventId="event-targeted"
        clubId="club-1"
        grouping="team"
        targetTeamIds={["team-u10"]}
      />,
      { wrapper },
    );

    expect(await screen.findByRole("button", { name: /U10 Blue/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /U8 Red/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Blair Adult")).not.toBeInTheDocument();
    expect(screen.queryByText("Drew Child")).not.toBeInTheDocument();

    const teamsQuery = mocks.from.mock.results.find(
      (_: unknown, index: number) => mocks.from.mock.calls[index][0] === "teams",
    )!.value;
    const assignmentsQuery = mocks.from.mock.results.find(
      (_: unknown, index: number) =>
        mocks.from.mock.calls[index][0] === "child_team_assignments",
    )!.value;
    expect(teamsQuery.in).toHaveBeenCalledWith("id", ["team-u10"]);
    expect(assignmentsQuery.in).toHaveBeenCalledWith("team_id", ["team-u10"]);
  });

  it("keeps the complete club audience when target teams are null", async () => {
    render(
      <ClubWideRsvpBreakdown
        eventId="event-all-club"
        clubId="club-1"
        grouping="team"
        targetTeamIds={null}
      />,
      { wrapper },
    );

    expect(await screen.findByRole("button", { name: /U10 Blue/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /U8 Red/ })).toBeInTheDocument();
    const teamsQuery = mocks.from.mock.results.find(
      (_: unknown, index: number) => mocks.from.mock.calls[index][0] === "teams",
    )!.value;
    expect(teamsQuery.in).not.toHaveBeenCalled();
  });
});
