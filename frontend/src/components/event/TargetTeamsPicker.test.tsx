/**
 * Regression tests for TargetTeamsPicker mode semantics.
 *
 *   1. From null, clicking "Only selected teams" reveals the checklist
 *      (value transitions to []).
 *   2. Warning "select at least 2 teams" shown while <2 selected.
 *   3. Selecting a second team emits [id1, id2] with unique ids.
 *   4. "All club members" click emits null.
 *   5. The caller's array is never mutated.
 *   6. Duplicate ids are never emitted.
 *   7. `disabled` blocks interaction.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { TargetTeamsPicker } from "./TargetTeamsPicker";

const TEAMS = [
  { id: "team-a", name: "U8 Blue" },
  { id: "team-b", name: "U8 Red" },
  { id: "team-c", name: "U10 Red" },
];

function StatefulPicker({ initial = null }: { initial?: string[] | null }) {
  const [value, setValue] = useState<string[] | null>(initial);
  return (
    <>
      <TargetTeamsPicker teams={TEAMS} value={value} onChange={setValue} />
      <output data-testid="selection">{JSON.stringify(value)}</output>
    </>
  );
}

describe("TargetTeamsPicker", () => {
  it("(1) from null → 'Only selected teams' opens checklist with []", () => {
    const onChange = vi.fn();
    render(<TargetTeamsPicker teams={TEAMS} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText("Only selected teams"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("(2) shows warning while fewer than 2 teams selected", () => {
    render(<TargetTeamsPicker teams={TEAMS} value={["team-a"]} onChange={() => {}} />);
    expect(screen.getByText(/select at least 2 teams/i)).toBeInTheDocument();
  });

  it("(3) selecting a second team emits both ids uniquely", () => {
    const onChange = vi.fn();
    render(<TargetTeamsPicker teams={TEAMS} value={["team-a"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("U8 Red"));
    const emitted = onChange.mock.calls[0][0] as string[];
    expect(new Set(emitted)).toEqual(new Set(["team-a", "team-b"]));
    expect(emitted.length).toBe(2);
  });

  it("(4) 'All club members' emits null", () => {
    const onChange = vi.fn();
    render(<TargetTeamsPicker teams={TEAMS} value={["team-a", "team-b"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("All club members"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("(5) does not mutate the supplied array", () => {
    const input = ["team-a"];
    const frozen = Object.freeze([...input]);
    const onChange = vi.fn();
    render(<TargetTeamsPicker teams={TEAMS} value={frozen as string[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("U8 Red"));
    expect(frozen).toEqual(["team-a"]);
  });

  it("(6) toggling the same team twice never emits duplicates", () => {
    const onChange = vi.fn();
    render(<TargetTeamsPicker teams={TEAMS} value={["team-a"]} onChange={onChange} />);
    // Attempting to "re-add" team-a would be a toggle-off; but if a stale
    // click ever races, the Set dedupe guarantees no duplicate id ships.
    fireEvent.click(screen.getByText("U8 Blue"));
    const emitted = onChange.mock.calls[0][0] as string[];
    expect(new Set(emitted).size).toBe(emitted.length);
  });

  it("(7) disabled blocks toggle interaction", () => {
    const onChange = vi.fn();
    render(
      <TargetTeamsPicker teams={TEAMS} value={["team-a"]} onChange={onChange} disabled />,
    );
    // The "Only selected teams" button is disabled, and checkboxes are disabled.
    const btn = screen.getByText("Only selected teams").closest("button")!;
    expect(btn).toBeDisabled();
  });

  it("stays in selected-team mode when the array is empty", () => {
    render(<TargetTeamsPicker teams={TEAMS} value={[]} onChange={() => {}} />);
    // Checklist visible (checkboxes rendered) even though value = [].
    expect(screen.getByText("U8 Blue")).toBeInTheDocument();
    expect(screen.getByText(/select at least 2 teams/i)).toBeInTheDocument();
  });

  it("completes the real null → selected-mode render transition", () => {
    render(<StatefulPicker />);

    fireEvent.click(screen.getByRole("button", { name: /Only selected teams/i }));

    expect(screen.getByTestId("selection")).toHaveTextContent("[]");
    expect(screen.getByRole("checkbox", { name: "U8 Blue" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "U8 Red" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "U10 Red" })).toBeInTheDocument();
  });

  it("adds and removes teams while preserving the remaining selection", () => {
    render(<StatefulPicker initial={["team-a", "team-b"]} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "U10 Red" }));
    expect(screen.getByTestId("selection")).toHaveTextContent(
      '["team-a","team-b","team-c"]',
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "U8 Red" }));
    expect(screen.getByTestId("selection")).toHaveTextContent(
      '["team-a","team-c"]',
    );
  });

  it("shows an empty state when selected-team mode has no available teams", () => {
    render(
      <TargetTeamsPicker
        teams={[]}
        value={[]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(/No teams available in this club/i)).toBeInTheDocument();
  });
});
