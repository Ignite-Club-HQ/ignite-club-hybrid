import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoveTeamChildDialog, RemoveTeamMemberDialog } from "./TeamRemoveMemberDialogs";

describe("RemoveTeamMemberDialog", () => {
  it("confirms removal of the named member", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveTeamMemberDialog
        memberName="Jamie Smith"
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/Jamie Smith/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("RemoveTeamChildDialog", () => {
  it("disables removal until the child's name is typed exactly", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveTeamChildDialog
        childName="Alex Jones"
        open
        onOpenChange={vi.fn()}
        confirmText="Alex"
        onConfirmTextChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove Player" })).toBeDisabled();
  });

  it("enables removal once the confirmation text matches (case-insensitive)", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveTeamChildDialog
        childName="Alex Jones"
        open
        onOpenChange={vi.fn()}
        confirmText="alex jones"
        onConfirmTextChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const button = screen.getByRole("button", { name: "Remove Player" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
