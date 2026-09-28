import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdvancedSettingsPanel } from "./AdvancedSettingsPanel";

const renderPanel = (overrides = {}, readOnly = false) => {
  const onChange = vi.fn();
  render(
    <AdvancedSettingsPanel
      open
      onToggle={vi.fn()}
      overrides={overrides}
      readOnly={readOnly}
      onChange={onChange}
      defaultMaxSpreadMinutes={5}
    />,
  );
  return onChange;
};

describe("AdvancedSettingsPanel", () => {
  it("updates only the adjusted expert control", () => {
    const onChange = renderPanel();

    fireEvent.change(
      screen.getByLabelText("Fairer minutes vs fewer stoppages"),
      { target: { value: "360" } },
    );

    expect(onChange).toHaveBeenCalledWith({ standardTargetIntervalSec: 360 });
  });

  it("resets an individual override without changing the remaining settings", () => {
    const onChange = renderPanel({
      standardTargetIntervalSec: 360,
      minShiftSeconds: 240,
    });

    fireEvent.click(screen.getAllByRole("button", { name: "reset" })[0]);

    expect(onChange).toHaveBeenCalledWith({ minShiftSeconds: 240 });
  });

  it("does not mutate parent-controlled overrides", () => {
    const onChange = renderPanel({ standardTargetIntervalSec: 360 }, true);

    fireEvent.change(
      screen.getByLabelText("Fairer minutes vs fewer stoppages"),
      { target: { value: "300" } },
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("These thresholds are controlled by the parent screen and can't be changed here.")).toBeInTheDocument();
  });
});
