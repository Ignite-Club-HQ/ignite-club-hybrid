import { render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TeamAdminLinkCard } from "./TeamAdminLinkCard";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("TeamAdminLinkCard", () => {
  it("renders an unlocked card linking to the feature route", () => {
    renderWithRouter(
      <TeamAdminLinkCard to="/teams/1/roles" icon={Settings} label="Manage Roles" />,
    );
    expect(screen.getByText("Manage Roles")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/teams/1/roles");
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
  });

  it("renders a locked card linking to the upgrade route with a badge", () => {
    renderWithRouter(
      <TeamAdminLinkCard
        to="/teams/1/attendance"
        lockedTo="/teams/1/upgrade"
        unlocked={false}
        lockedBadgeLabel="Pro"
        icon={Settings}
        label="Attendance Stats"
      />,
    );
    expect(screen.getByText("Attendance Stats")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/teams/1/upgrade");
  });
});
