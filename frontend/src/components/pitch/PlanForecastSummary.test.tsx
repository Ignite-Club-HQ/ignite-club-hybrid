import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlanModeToggles, PlanStatusCard } from "./PlanForecastSummary";

describe("PlanForecastSummary", () => {
  it("shows an adjustment warning for a plan with a wide minutes spread", () => {
    const { container } = render(
      <PlanStatusCard
        totalSubs={8}
        spreadMin={7}
        shortShifts={0}
        hasHalftimeClash={false}
      />,
    );

    expect(screen.getByText("Minutes diff")).toBeInTheDocument();
    expect(screen.getByText("7.0m")).toHaveClass("text-amber-600");
    expect(container.firstChild).toHaveClass("border-amber-500/40");
  });

  it("does not render rotation controls when the parent makes them read-only", () => {
    render(
      <PlanModeToggles
        activeMode={1}
        onChange={vi.fn()}
        readOnly
      />,
    );

    expect(screen.queryByText("Rotation mode")).not.toBeInTheDocument();
  });

  it("does not select a mode disabled for the current squad", () => {
    const onChange = vi.fn();
    render(
      <PlanModeToggles
        activeMode={1}
        onChange={onChange}
        readOnly={false}
        disabledModes={[2]}
      />,
    );

    const frequent = screen.getByRole("button", { name: /^Frequent/ });
    expect(frequent).toBeDisabled();
    fireEvent.click(frequent);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects an available rotation mode", () => {
    const onChange = vi.fn();
    render(
      <PlanModeToggles
        activeMode={1}
        onChange={onChange}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Frequent/ }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
