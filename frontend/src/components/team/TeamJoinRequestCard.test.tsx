import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamJoinRequestCard } from "./TeamJoinRequestCard";

function renderCard(
  overrides: Partial<Parameters<typeof TeamJoinRequestCard>[0]> = {},
) {
  const props: Parameters<typeof TeamJoinRequestCard>[0] = {
    teamName: "U12 Blue",
    existingRequest: undefined,
    selectedRole: "player",
    onSelectedRoleChange: vi.fn(),
    teamChildren: [],
    selectedChildForLink: "",
    onSelectedChildForLinkChange: vi.fn(),
    newChildName: "",
    onNewChildNameChange: vi.fn(),
    isSubmitting: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<TeamJoinRequestCard {...props} />) };
}

describe("TeamJoinRequestCard", () => {
  it("submits the selected role", () => {
    const { props } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Request to Join as player" }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("disables submission for a parent role until a child is selected", () => {
    renderCard({ selectedRole: "parent" });
    expect(
      screen.getByRole("button", { name: "Request to Join as parent" }),
    ).toBeDisabled();
  });

  it("enables submission once a new child name is entered", () => {
    const { props } = renderCard({
      selectedRole: "parent",
      newChildName: "Alex",
    });
    expect(
      screen.getByRole("button", { name: "Request to Join as parent" }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Request to Join as parent" }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("shows a pending badge instead of the form when a request already exists", () => {
    renderCard({ existingRequest: { role: "team_admin" } });
    expect(screen.getByText("Request Pending")).toBeInTheDocument();
    expect(screen.getByText(/team admin/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request to Join/ })).not.toBeInTheDocument();
  });
});
