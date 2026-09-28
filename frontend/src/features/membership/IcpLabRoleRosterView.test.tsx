import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { IcpLabRoleRosterView, type IcpLabRoleRosterViewProps } from "./IcpLabRoleRosterView";

const baseRoster = [
  {
    profile: { id: "user-1", display_name: "Ada Lovelace" },
    roles: [{ id: "user-1-coach", role: "coach" }],
  },
];

function renderView(overrides: Partial<IcpLabRoleRosterViewProps> = {}) {
  return render(
    <MemoryRouter>
      <IcpLabRoleRosterView
        title="Club Roles"
        source="fixture"
        isLoading={false}
        error={null}
        errorFallbackMessage="Unable to load role data."
        roster={baseRoster}
        roleBadgeClassName={(role) => `badge-${role}`}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("IcpLabRoleRosterView", () => {
  it("renders the page-local title and roster cards with the caller's badge classNames", () => {
    renderView({ title: "Team Roles" });

    expect(screen.getByRole("heading", { name: "Team Roles" })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    const badge = screen.getByText("Coach");
    expect(badge).toHaveClass("badge-coach");
  });

  it("shows the fixture-source description when the roster is not backed by the canister", () => {
    renderView({ source: "fixture" });

    expect(
      screen.getByText(/local identity_access canister is not configured/i),
    ).toBeInTheDocument();
  });

  it("shows the canister-source description when data is loaded from the local canister", () => {
    renderView({ source: "icp" });

    expect(
      screen.getByText(/Loaded from the local identity_access canister/i),
    ).toBeInTheDocument();
  });

  it("renders a skeleton while loading", () => {
    const { container } = renderView({ isLoading: true });

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("surfaces an Error instance's own message instead of the caller's fallback text", () => {
    renderView({ error: new Error("boom"), errorFallbackMessage: "Unable to load role data." });

    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("Unable to load role data.")).toBeNull();
  });

  it("falls back to the caller-provided error text for non-Error rejections", () => {
    renderView({ error: "unexpected", errorFallbackMessage: "Unable to load team role data." });

    expect(screen.getByText("Unable to load team role data.")).toBeInTheDocument();
  });

  it("navigates back when the back button is clicked", async () => {
    navigateMock.mockClear();
    renderView();

    screen.getByRole("button", { name: "Back" }).click();

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });
});
