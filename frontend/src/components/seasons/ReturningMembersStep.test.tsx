import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ReturningMembersStep, type ReturningPlayer } from "./ReturningMembersStep";

// jsdom lacks ResizeObserver, which Radix ScrollArea requires.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}


const players: ReturningPlayer[] = [
  {
    club_player_id: "p1",
    display_name: "Alice Smith",
    date_of_birth: null,
    age_years: 11,
    previous_team_id: "t-u12b",
    previous_team_name: "U12 Blue",
    membership_role: "player",
  },
  {
    club_player_id: "p2",
    display_name: "Ben Jones",
    date_of_birth: null,
    age_years: 11,
    previous_team_id: "t-u12b",
    previous_team_name: "U12 Blue",
    membership_role: "player",
  },
  {
    club_player_id: "p3",
    display_name: "Cara Woods",
    date_of_birth: null,
    age_years: 12,
    previous_team_id: "t-u13r",
    previous_team_name: "U13 Red",
    membership_role: "player",
  },
];

const targetTeams = [
  { id: "n1", name: "U12 Blue" },
  { id: "n2", name: "U13 Red" },
];

let rpcPlayers = players;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: rpcPlayers, error: null })),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        is: self,
        order: async () => ({ data: targetTeams, error: null }),
      });
      return chain;
    }),
  },
}));

function Harness({ initialSelected = new Set<string>() }: { initialSelected?: Set<string> }) {
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div data-testid="selected">{Array.from(selected).sort().join(",")}</div>
      <div data-testid="assignments">{JSON.stringify(assignments)}</div>
      <ReturningMembersStep
        sourceSeasonId="s1"
        targetSeasonId="s2"
        selectedIds={selected}
        onChange={setSelected}
        assignments={assignments}
        onAssignmentsChange={setAssignments}
      />
    </QueryClientProvider>
  );
}

const selectedOf = () => screen.getByTestId("selected").textContent;

describe("ReturningMembersStep", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpcPlayers = players;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    cleanup();
  });

  it("renders without any DOM nesting warning", async () => {
    render(<Harness />);
    await screen.findByText("Alice Smith");
    const messages = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).not.toMatch(/validateDOMNesting/);
    expect(messages).not.toMatch(/cannot appear as a descendant/);
  });

  it("group selection selects exactly that group, and deselection clears it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");
    const group = screen.getByRole("checkbox", { name: "Select all players from U12 Blue" });

    await user.click(group);
    expect(selectedOf()).toBe("p1,p2");

    await user.click(group);
    expect(selectedOf()).toBe("");
  });

  it("shows indeterminate state for a partially selected group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");

    await user.click(screen.getByRole("checkbox", { name: "Select Alice Smith" }));
    const group = screen.getByRole("checkbox", { name: "Select all players from U12 Blue" });
    expect(group).toHaveAttribute("data-state", "indeterminate");
  });

  it("individual checkbox activation does not toggle the whole group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");

    await user.click(screen.getByRole("checkbox", { name: "Select Ben Jones" }));
    expect(selectedOf()).toBe("p2");
  });

  it("keyboard Space toggles the group-selection control", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");

    const group = screen.getByRole("checkbox", { name: "Select all players from U12 Blue" });
    group.focus();
    expect(group).toHaveFocus();
    await user.keyboard(" ");
    expect(selectedOf()).toBe("p1,p2");
  });

  it("search filtering preserves selected players", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");

    await user.click(screen.getByRole("checkbox", { name: "Select all players from U12 Blue" }));
    await user.type(screen.getByPlaceholderText("Search players…"), "Cara");

    expect(screen.queryByText("Alice Smith")).toBeNull();
    expect(selectedOf()).toBe("p1,p2");
  });

  it("seeds same-name target team defaults and preserves explicit mappings", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");

    expect(JSON.parse(screen.getByTestId("assignments").textContent!)).toEqual({
      p1: "n1",
      p2: "n1",
      p3: "n2",
    });

    // Explicit mapping survives a re-render triggered by filtering.
    await user.type(screen.getByPlaceholderText("Search players…"), "Alice");
    expect(JSON.parse(screen.getByTestId("assignments").textContent!).p1).toBe("n1");
  });

  it("All and None still work", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Alice Smith");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(selectedOf()).toBe("p1,p2,p3");

    await user.click(screen.getByRole("button", { name: "None" }));
    expect(selectedOf()).toBe("");
  });

  it("keeps the empty returning-player state correct", async () => {
    rpcPlayers = [];
    render(<Harness />);
    expect(
      await screen.findByText("No players from the previous season to carry over."),
    ).toBeInTheDocument();
  });
});
