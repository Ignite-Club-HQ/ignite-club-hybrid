import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TeamLeaveDialog } from "./TeamLeaveDialog";

function renderDialog(onConfirmLeave = vi.fn()) {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <TeamLeaveDialog teamName="U12 Blue" onConfirmLeave={onConfirmLeave} />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  return { onConfirmLeave };
}

describe("TeamLeaveDialog", () => {
  it("renders the Leave Team menu item", () => {
    renderDialog();
    expect(screen.getByText("Leave Team")).toBeInTheDocument();
  });

  it("shows a confirmation dialog naming the team when opened", () => {
    renderDialog();
    fireEvent.click(screen.getByText("Leave Team"));
    expect(screen.getByText("Leave Team?")).toBeInTheDocument();
    expect(screen.getByText(/You will be removed from U12 Blue/)).toBeInTheDocument();
  });

  it("invokes onConfirmLeave when the Leave action is confirmed", () => {
    const { onConfirmLeave } = renderDialog();
    fireEvent.click(screen.getByText("Leave Team"));
    fireEvent.click(screen.getByText("Leave"));
    expect(onConfirmLeave).toHaveBeenCalledTimes(1);
  });
});
