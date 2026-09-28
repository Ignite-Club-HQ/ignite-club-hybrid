import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAutoSubAdvancedSettingsState,
  getAutoSubPlanModeState,
  getAutoSubPlanStatus,
  getAutoSubPlayerMinutesState,
  requestAutoSubPlanMode,
  resetAutoSubAdvancedOverrides,
  updateAutoSubAdvancedOverride,
  type AutoSubAdvancedOverrides,
  type AutoSubGoalkeeperRole,
  type AutoSubPlanMode,
} from "../src/lab/componentCandidatePolicies";

afterEach(cleanup);

function AdvancedSettingsFixture({
  open = true,
  overrides = {},
  readOnly = false,
  onChange = () => undefined,
  onToggle = () => undefined,
}: {
  open?: boolean;
  overrides?: AutoSubAdvancedOverrides;
  readOnly?: boolean;
  onChange?: (next: AutoSubAdvancedOverrides) => void;
  onToggle?: () => void;
}) {
  const state = getAutoSubAdvancedSettingsState({
    open,
    overrides,
    readOnly,
    defaultMaxSpreadMinutes: 5,
  });
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={onToggle}>
        Show expert controls
        {state.customCount > 0 && <span>{state.customCount} custom</span>}
      </button>
      {open && (
        <>
          {state.controlledMessage && <p>{state.controlledMessage}</p>}
          {state.controls.map((control) => (
            <div key={control.key}>
              <label>
                {control.label}
                <input
                  type="range"
                  aria-label={control.label}
                  value={control.value}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  disabled={control.disabled}
                  onChange={(event) => onChange(updateAutoSubAdvancedOverride(
                    overrides,
                    control.key,
                    Number(event.currentTarget.value),
                    readOnly,
                  ))}
                />
              </label>
              {control.canReset && (
                <button
                  type="button"
                  aria-label={`Reset ${control.label}`}
                  onClick={() => onChange(updateAutoSubAdvancedOverride(
                    overrides,
                    control.key,
                    undefined,
                    readOnly,
                  ))}
                >
                  reset
                </button>
              )}
            </div>
          ))}
          {state.canResetAll && (
            <button
              type="button"
              onClick={() => onChange(resetAutoSubAdvancedOverrides(overrides, readOnly))}
            >
              Reset all to defaults
            </button>
          )}
        </>
      )}
    </section>
  );
}

describe("AutoSubAdvancedSettingsPanel authoritative behaviors", () => {
  it("keeps expert controls collapsed until requested", () => {
    const onToggle = vi.fn();
    render(<AdvancedSettingsFixture open={false} onToggle={onToggle} />);
    expect(screen.queryByRole("slider")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Show expert controls/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows all six live planner thresholds with established defaults", () => {
    render(<AdvancedSettingsFixture />);
    expect(screen.getAllByRole("slider")).toHaveLength(6);
    expect((screen.getByRole("slider", {
      name: "Fairer minutes vs fewer stoppages",
    }) as HTMLInputElement).value).toBe("420");
    expect((screen.getByRole("slider", {
      name: "Max playing-time spread",
    }) as HTMLInputElement).value).toBe("300");
    expect((screen.getByRole("slider", {
      name: "Space out substitution moments",
    }) as HTMLInputElement).value).toBe("240");
    expect((screen.getByRole("slider", {
      name: "Space out substitution moments (Frequent mode)",
    }) as HTMLInputElement).value).toBe("180");
  });

  it("merges a changed threshold without discarding unrelated overrides", () => {
    const onChange = vi.fn();
    render(<AdvancedSettingsFixture overrides={{ minShiftSeconds: 240 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", {
      name: "Fairer minutes vs fewer stoppages",
    }), { target: { value: "360" } });
    expect(onChange).toHaveBeenCalledWith({
      minShiftSeconds: 240,
      standardTargetIntervalSec: 360,
    });
  });

  it("resets one changed threshold without clearing other custom settings", () => {
    const onChange = vi.fn();
    render(<AdvancedSettingsFixture
      overrides={{ minShiftSeconds: 240, halftimeGuardSeconds: 240 }}
      onChange={onChange}
    />);
    fireEvent.click(screen.getByRole("button", {
      name: "Reset Allow short cameos vs protect player shifts",
    }));
    expect(onChange).toHaveBeenCalledWith({ halftimeGuardSeconds: 240 });
  });

  it("reports the custom-setting count and resets all settings in one action", () => {
    const onChange = vi.fn();
    render(<AdvancedSettingsFixture
      overrides={{ minShiftSeconds: 240, maxSpreadOverrideSec: 240 }}
      onChange={onChange}
    />);
    expect(screen.getByText("2 custom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("shows externally managed values without allowing local mutation", () => {
    const onChange = vi.fn();
    render(<AdvancedSettingsFixture
      overrides={{ minShiftSeconds: 240 }}
      readOnly
      onChange={onChange}
    />);
    expect(screen.getByText(/controlled by the parent screen/)).toBeTruthy();
    expect(screen.getAllByRole("slider").every((slider) => (
      (slider as HTMLInputElement).disabled
    ))).toBe(true);
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

function PlanModeFixture({
  activeMode,
  onChange,
  readOnly,
  disabledModes = [],
}: {
  activeMode: AutoSubPlanMode;
  onChange: (mode: AutoSubPlanMode) => void;
  readOnly: boolean;
  disabledModes?: AutoSubPlanMode[];
}) {
  const modes = getAutoSubPlanModeState({ activeMode, readOnly, disabledModes });
  return (
    <div>
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          disabled={mode.disabled}
          aria-pressed={mode.active}
          title={mode.unavailableReason ?? undefined}
          onClick={() => {
            const requested = requestAutoSubPlanMode({
              requestedMode: mode.id,
              readOnly,
              disabledModes,
            });
            if (requested !== null) onChange(requested);
          }}
        >
          {mode.title}
          <span>{mode.tradeoff}</span>
          {mode.badge && <span>{mode.badge}</span>}
        </button>
      ))}
    </div>
  );
}

describe("AutoSubPlanModeToggle authoritative behaviors", () => {
  it("shows both public modes and their coach-facing tradeoffs", () => {
    render(<PlanModeFixture activeMode={1} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByRole("button", { name: /Standard/ }).textContent)
      .toContain("Fewer substitutions");
    expect(screen.getByRole("button", { name: /Frequent/ }).textContent)
      .toContain("tighter rotation");
  });

  it("marks only the selected mode as active", () => {
    render(<PlanModeFixture activeMode={2} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByRole("button", { name: /Standard/ }).getAttribute("aria-pressed"))
      .toBe("false");
    expect(screen.getByRole("button", { name: /Frequent/ }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("requests the selected mode once", () => {
    const onChange = vi.fn();
    render(<PlanModeFixture activeMode={1} onChange={onChange} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Frequent/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("blocks an unavailable mode and explains why", () => {
    const onChange = vi.fn();
    render(<PlanModeFixture
      activeMode={1}
      onChange={onChange}
      readOnly={false}
      disabledModes={[2]}
    />);
    const frequent = screen.getByRole("button", { name: /Frequent/ }) as HTMLButtonElement;
    expect(frequent.disabled).toBe(true);
    expect(frequent.textContent).toContain("Unavailable");
    expect(frequent.title).toBe("Not available for this squad size and match length");
    fireEvent.click(frequent);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the control when planner settings are externally managed", () => {
    const { container } = render(
      <PlanModeFixture activeMode={1} onChange={vi.fn()} readOnly />,
    );
    expect(container.firstChild?.textContent).toBe("");
  });
});

function PlanStatusFixture(input: {
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const status = getAutoSubPlanStatus(input);
  return (
    <div
      data-testid="autosub-plan-status"
      data-needs-adjustment={String(status.needsAdjustment)}
    >
      <div><span>Subs</span><span>{status.totalSubsLabel}</span></div>
      <div>
        <span>Minutes diff</span>
        <span className={status.spreadTone === "normal" ? "text-foreground" : "text-attention"}>
          {status.spreadLabel}
        </span>
      </div>
      <div><span>Very short turns</span><span>{status.shortShiftsLabel}</span></div>
    </div>
  );
}

const renderStatus = (
  overrides: Partial<React.ComponentProps<typeof PlanStatusFixture>> = {},
) => render(<PlanStatusFixture
  totalSubs={6}
  spreadMin={3}
  shortShifts={0}
  hasHalftimeClash={false}
  {...overrides}
/>);

describe("AutoSubPlanStatusCard authoritative behaviors", () => {
  it("shows the exact substitution, minute-spread and short-turn summary", () => {
    renderStatus({ totalSubs: 8, spreadMin: 2.75, shortShifts: 1 });
    expect(screen.getByText("Subs").nextElementSibling?.textContent).toBe("8");
    expect(screen.getByText("Minutes diff").nextElementSibling?.textContent).toBe("2.8m");
    expect(screen.getByText("Very short turns").nextElementSibling?.textContent).toBe("1");
  });

  it("marks a calm plan as not needing adjustment", () => {
    renderStatus({ spreadMin: 6, shortShifts: 0, hasHalftimeClash: false });
    expect(screen.getByTestId("autosub-plan-status").dataset.needsAdjustment).toBe("false");
  });

  it.each([
    ["spread above six minutes", { spreadMin: 6.1 }],
    ["a very short turn", { shortShifts: 1 }],
    ["a substitution near halftime", { hasHalftimeClash: true }],
  ])("marks the plan for attention when there is %s", (_label, props) => {
    renderStatus(props);
    expect(screen.getByTestId("autosub-plan-status").dataset.needsAdjustment).toBe("true");
  });

  it("does not visually flag a six-minute spread until it exceeds the threshold", () => {
    renderStatus({ spreadMin: 6 });
    expect(screen.getByText("6.0m").classList.contains("text-foreground")).toBe(true);
  });
});

type PlayerForecast = {
  player: { name: string; number?: number };
  predictedMinutes: number;
  percentageOfGame: number;
  startsOnPitch: boolean;
  gkRole?: AutoSubGoalkeeperRole;
};

function PlayerMinutesFixture({
  forecast,
  shortShifts = 0,
  bounceBacks = 0,
  draggable = true,
}: {
  forecast: PlayerForecast;
  shortShifts?: number;
  bounceBacks?: number;
  draggable?: boolean;
}) {
  const state = getAutoSubPlayerMinutesState({
    ...forecast,
    shortShifts,
    bounceBacks,
    draggable,
  });
  return (
    <div>
      {state.dragLabel && <button type="button" aria-label={state.dragLabel}>drag</button>}
      <span>{state.playerName}</span>
      <span>{state.numberLabel}</span>
      <span>{state.lineupLabel}</span>
      {state.goalkeeperLabel && <span>{state.goalkeeperLabel}</span>}
      {state.warningLabels.map((warning) => <span key={warning}>{warning}</span>)}
      <span>{state.forecastLabel}</span>
    </div>
  );
}

const defaultForecast: PlayerForecast = {
  player: { name: "Alex", number: 12 },
  predictedMinutes: 28,
  percentageOfGame: 70,
  startsOnPitch: true,
};

describe("AutoSubPlayerMinutesRow authoritative behaviors", () => {
  it("shows identity, starter state and exact forecast", () => {
    render(<PlayerMinutesFixture forecast={defaultForecast} />);
    expect(screen.getByText("Alex")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Start")).toBeTruthy();
    expect(screen.getByText("28' (70%)")).toBeTruthy();
  });

  it("shows bench state and a safe number fallback", () => {
    render(<PlayerMinutesFixture forecast={{
      ...defaultForecast,
      player: { name: "Alex" },
      startsOnPitch: false,
    }} />);
    expect(screen.getByText("Bench")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
  });

  it.each([
    ["full", "GK"],
    ["1h", "GK 1H"],
    ["2h", "GK 2H"],
  ] as const)("labels %s-match goalkeeper duty", (gkRole, label) => {
    render(<PlayerMinutesFixture forecast={{ ...defaultForecast, gkRole }} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows both short-shift and bounce-back warnings from the fairness report", () => {
    render(<PlayerMinutesFixture forecast={defaultForecast} shortShifts={2} bounceBacks={1} />);
    expect(screen.getByText("2 very short")).toBeTruthy();
    expect(screen.getByText("1 bounce")).toBeTruthy();
  });

  it("offers an accessible drag handle only for reorderable outfielders", () => {
    const { rerender } = render(<PlayerMinutesFixture forecast={defaultForecast} />);
    expect(screen.getByRole("button", {
      name: "Reorder Alex playing-time priority",
    })).toBeTruthy();
    rerender(<PlayerMinutesFixture forecast={defaultForecast} draggable={false} />);
    expect(screen.queryByRole("button", { name: /Reorder Alex/ })).toBeNull();
  });
});
