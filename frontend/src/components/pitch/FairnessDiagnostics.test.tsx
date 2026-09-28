import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { FairnessDiagnostics } from "./FairnessDiagnostics";
import type { PlayerTimeForecast } from "./PlayerMinutesPresentation";

const forecasts = (...minutes: number[]): PlayerTimeForecast[] =>
  minutes.map((predictedMinutes, index) => ({
    player: { id: `player-${index + 1}`, name: `Player ${index + 1}` },
    predictedMinutes,
    percentageOfGame: predictedMinutes * 2,
    startsOnPitch: index < 7,
  }));

const renderDiagnostics = (
  values: PlayerTimeForecast[],
  overrides: Partial<ComponentProps<typeof FairnessDiagnostics>> = {},
) => render(
  <FairnessDiagnostics
    forecasts={values}
    teamSize={7}
    squadSize={10}
    matchMinutes={40}
    minShiftSeconds={180}
    rotateGkAtHalftime={false}
    mode="Standard"
    {...overrides}
  />,
);

describe("FairnessDiagnostics", () => {
  it("does not render without forecasts or bench players", () => {
    const empty = renderDiagnostics([]);
    expect(empty.container).toBeEmptyDOMElement();

    const noBench = renderDiagnostics(forecasts(40, 40, 40, 40, 40, 40, 40), {
      squadSize: 7,
    });
    expect(noBench.container).toBeEmptyDOMElement();
  });

  it("renders the fair-plan calculation, labels, text, and success tone", () => {
    const { container } = renderDiagnostics(forecasts(28, 28, 28, 28, 27, 27, 28, 28, 28, 28));

    expect(screen.getByText("Game time fairness")).toBeInTheDocument();
    expect(screen.getByText("Standard mode")).toBeInTheDocument();
    expect(screen.getByText("Target per player")).toBeInTheDocument();
    expect(screen.getAllByText("28.0 min")).toHaveLength(2);
    expect(screen.getByText("Fair plan: all outfielders are within 1 min of target game time.")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("border-emerald-500/40", "bg-emerald-500/5");
  });

  it("preserves warning copy for a highly uneven large-bench plan", () => {
    renderDiagnostics(forecasts(35, 34, 32, 29, 25, 24, 22, 21, 20, 18, 17, 15), {
      squadSize: 12,
    });

    expect(screen.getByText("23.3 min")).toBeInTheDocument();
    expect(screen.getByText("20.0 min")).toHaveClass("text-amber-600");
    expect(screen.getByText(
      "Uneven plan: 20.0 min between most- and least-played outfielder. Large bench — try Frequent mode or lower “How often to suggest subs”.",
    )).toBeInTheDocument();
  });

  it("excludes a full-game goalkeeper and reports halftime goalkeeper rotation copy", () => {
    renderDiagnostics([
      {
        player: { id: "keeper-1", name: "Keeper 1" },
        predictedMinutes: 20,
        percentageOfGame: 50,
        startsOnPitch: true,
        gkRole: "1h",
      },
      {
        player: { id: "keeper-2", name: "Keeper 2" },
        predictedMinutes: 20,
        percentageOfGame: 50,
        startsOnPitch: false,
        gkRole: "2h",
      },
      ...forecasts(28, 28, 28, 28, 27, 27, 27, 27),
    ], {
      rotateGkAtHalftime: true,
    });

    expect(screen.getByText("Goalkeeper is being swapped at halftime — outfield minutes shown exclude GK time.")).toBeInTheDocument();
  });
});
