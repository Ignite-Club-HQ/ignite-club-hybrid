import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PlayersNeedingAttention,
  SortablePlayerMinutesRow,
  type PlayerTimeForecast,
} from "./PlayerMinutesPresentation";
import type { FairnessReport } from "./planner/analysis";

const forecasts: PlayerTimeForecast[] = [
  {
    player: { id: "low", name: "Low Player", number: 4 },
    predictedMinutes: 12,
    percentageOfGame: 40,
    startsOnPitch: false,
  },
  {
    player: { id: "middle", name: "Middle Player", number: 7 },
    predictedMinutes: 15,
    percentageOfGame: 50,
    startsOnPitch: true,
  },
  {
    player: { id: "high", name: "High Player", number: 10 },
    predictedMinutes: 18,
    percentageOfGame: 60,
    startsOnPitch: true,
  },
];

const fairnessReport: FairnessReport = {
  perPlayer: [
    {
      playerId: "middle",
      playerName: "Middle Player",
      totalSeconds: 900,
      shortShifts: 1,
      bounceBacks: 0,
      startsOnPitch: true,
    },
  ],
  spreadSeconds: 360,
  minSeconds: 720,
  maxSeconds: 1080,
  avgSeconds: 900,
  totalShortShifts: 1,
  totalBounceBacks: 0,
  totalSubs: 3,
  grade: "fair",
};

function renderSortableRow(forecast: PlayerTimeForecast, draggable: boolean) {
  return render(
    <DndContext>
      <SortableContext items={[forecast.player.id]} strategy={verticalListSortingStrategy}>
        <SortablePlayerMinutesRow
          forecast={forecast}
          fairnessReport={fairnessReport}
          draggable={draggable}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("PlayerMinutesPresentation", () => {
  it("renders only players whose minutes or fairness need attention", () => {
    render(
      <PlayersNeedingAttention
        forecasts={forecasts}
        fairnessReport={fairnessReport}
      />,
    );

    expect(screen.getByText("Players needing attention")).toBeInTheDocument();
    expect(screen.getByText("Low Player")).toBeInTheDocument();
    expect(screen.getByText("Lowest minutes")).toBeInTheDocument();
    expect(screen.getByText("High Player")).toBeInTheDocument();
    expect(screen.getByText("Highest minutes")).toBeInTheDocument();
    expect(screen.getByText("Middle Player")).toBeInTheDocument();
    expect(screen.getByText("1 very short turn")).toBeInTheDocument();
  });

  it("preserves the sortable handle and forecast labels for draggable outfielders", () => {
    renderSortableRow(forecasts[0], true);

    expect(screen.getByRole("button", { name: "Drag to reorder priority" })).toBeInTheDocument();
    expect(screen.getByText("Low Player")).toBeInTheDocument();
    expect(screen.getByText("Bench")).toBeInTheDocument();
    expect(screen.getByText("12' (40%)")).toBeInTheDocument();
  });

  it("keeps full-game goalkeepers locked while showing their existing labels", () => {
    renderSortableRow({
      player: { id: "gk", name: "Goal Keeper", number: 1 },
      predictedMinutes: 30,
      percentageOfGame: 100,
      startsOnPitch: true,
      gkRole: "full",
    }, false);

    expect(screen.queryByRole("button", { name: "Drag to reorder priority" })).not.toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("GK")).toBeInTheDocument();
    expect(screen.getByText("30' (100%)")).toBeInTheDocument();
  });
});
