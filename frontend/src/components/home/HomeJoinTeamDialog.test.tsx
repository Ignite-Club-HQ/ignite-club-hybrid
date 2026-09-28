import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HomeJoinTeamDialog,
  type HomeLeagueRole,
  type HomeTeamRole,
} from "./HomeJoinTeamDialog";

vi.mock("@/components/MobileCardSelect", () => ({
  MobileCardSelect: ({
    label,
    options,
    onValueChange,
  }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

function renderDialog(
  overrides: Partial<Parameters<typeof HomeJoinTeamDialog>[0]> = {},
) {
  const props: Parameters<typeof HomeJoinTeamDialog>[0] = {
    open: true,
    activeClubFilter: null,
    clubs: [
      {
        id: "club-1",
        name: "Ignite FC",
        sport: "soccer",
        class_mode_enabled: false,
      },
    ],
    teams: [
      {
        id: "team-1",
        name: "U12",
        club_id: "club-1",
        clubs: { name: "Ignite FC", sport: "soccer" },
      },
    ],
    miniLeagues: [],
    selectedClubForTeam: "",
    selectedTeam: "team-1",
    isLeagueSelected: false,
    isAlreadyTeamMember: false,
    existingTeamRoles: [],
    pendingTeamRequests: [],
    additionalAccessPending: false,
    additionalAccessRole: undefined,
    selectedLeagueRole: "league_admin",
    selectedTeamRole: "player",
    showChildLinker: false,
    teamChildren: [],
    selectedChildForLink: "",
    newChildName: "",
    hasExistingTeamRole: false,
    hasExistingLeagueRole: false,
    submitPending: false,
    onOpenChange: vi.fn(),
    onSelectedClubForTeamChange: vi.fn(),
    onSelectedTeamChange: vi.fn(),
    onSelectedLeagueRoleChange: vi.fn(),
    onSelectedTeamRoleChange: vi.fn(),
    onSelectedChildForLinkChange: vi.fn(),
    onNewChildNameChange: vi.fn(),
    onRequestAdditionalAccess: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<HomeJoinTeamDialog {...props} />) };
}

describe("HomeJoinTeamDialog", () => {
  it("submits an eligible team request", () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("requires a child name when requesting parent access without an existing child", () => {
    renderDialog({
      selectedTeamRole: "parent",
      showChildLinker: true,
      selectedChildForLink: "__new__",
    });
    expect(screen.getByRole("button", { name: "Submit Request" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Enter your child's full name")).toBeInTheDocument();
  });

  it("shows pending elevated access without resubmitting it", () => {
    const onRequestAdditionalAccess = vi.fn();
    renderDialog({
      isAlreadyTeamMember: true,
      existingTeamRoles: ["player"] as HomeTeamRole[],
      pendingTeamRequests: ["coach"] as HomeTeamRole[],
      onRequestAdditionalAccess,
    });
    expect(screen.getByText("Pending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(onRequestAdditionalAccess).toHaveBeenCalledWith("team_admin");
  });

  it("uses class and league-specific copy and role selection", () => {
    const onSelectedLeagueRoleChange = vi.fn();
    renderDialog({
      activeClubFilter: "club-1",
      clubs: [
        {
          id: "club-1",
          name: "Ignite Classes",
          sport: "soccer",
          class_mode_enabled: true,
        },
      ],
      isLeagueSelected: true,
      selectedTeam: "league-league-1",
      selectedLeagueRole: "parent" as HomeLeagueRole,
      onSelectedLeagueRoleChange,
    });
    expect(screen.getByText("Request to Join Class")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Select Role"), {
      target: { value: "league_admin" },
    });
    expect(onSelectedLeagueRoleChange).toHaveBeenCalledWith("league_admin");
  });
});
