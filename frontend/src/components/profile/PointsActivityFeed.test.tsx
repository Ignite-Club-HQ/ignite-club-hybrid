import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
import { PointsActivityFeed } from "./PointsActivityFeed";
const props = { open: true, onOpenChange: vi.fn(), loading: false, balance: 10, earned: 10, spent: 0, selectedSeasonId: "all", onSeasonChange: vi.fn(), showSeasonFilter: false };
describe("Progressive points activity", () => {
  it("retains known activity during a secondary refresh", () => {
    render(<PointsActivityFeed {...props} loading items={[{ id: "one", type: "earned", points: 10, name: "Award", context: "Giddy Goat", date: "2026-10-23T00:00:00Z" }]} />);
    expect(screen.getByText("Award")).toBeInTheDocument();
  });
  it("allows retry after history fails", () => {
    const retry = vi.fn();
    render(<PointsActivityFeed {...props} error onRetry={retry} items={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});