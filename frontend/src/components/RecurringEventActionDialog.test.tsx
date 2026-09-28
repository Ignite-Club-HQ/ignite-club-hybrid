import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecurringEventActionDialog } from "./RecurringEventActionDialog";

function renderDialog(isPending = false) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Delete recurring event?",
    description: "Choose the deletion scope.",
    actionLabel: "Delete",
    onSingleAction: vi.fn(),
    onSeriesAction: vi.fn(),
    isPending,
  };
  render(<RecurringEventActionDialog {...props} />);
  return props;
}

describe("RecurringEventActionDialog", () => {
  it("invokes only the single-occurrence action", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete This Event Only" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSingleAction).toHaveBeenCalledOnce();
    expect(props.onSeriesAction).not.toHaveBeenCalled();
  });

  it("invokes only the entire-series action", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Delete Entire Series" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSeriesAction).toHaveBeenCalledOnce();
    expect(props.onSingleAction).not.toHaveBeenCalled();
  });

  it("prevents every decision while a mutation is pending", () => {
    renderDialog(true);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete This Event Only" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Entire Series" })).toBeDisabled();
  });
});
