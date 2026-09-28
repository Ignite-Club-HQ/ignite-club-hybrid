import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamAppAdminProToggleCard } from "./TeamAppAdminProToggleCard";

describe("TeamAppAdminProToggleCard", () => {
  it("toggles the Pro override", () => {
    const onProOverrideChange = vi.fn();
    render(
      <TeamAppAdminProToggleCard
        isProOverride={false}
        onProOverrideChange={onProOverrideChange}
        isSoccerClub={false}
        isProFootballOverride={false}
        onProFootballOverrideChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onProOverrideChange).toHaveBeenCalledWith(true);
  });

  it("hides the Pro Football toggle for non-soccer clubs", () => {
    render(
      <TeamAppAdminProToggleCard
        isProOverride={false}
        onProOverrideChange={vi.fn()}
        isSoccerClub={false}
        isProFootballOverride={false}
        onProFootballOverrideChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Free Pro Football Access")).not.toBeInTheDocument();
  });

  it("shows and toggles the Pro Football override for soccer clubs", () => {
    const onProFootballOverrideChange = vi.fn();
    render(
      <TeamAppAdminProToggleCard
        isProOverride
        onProOverrideChange={vi.fn()}
        isSoccerClub
        isProFootballOverride={false}
        onProFootballOverrideChange={onProFootballOverrideChange}
      />,
    );
    expect(screen.getByText("Free Pro Football Access")).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);
    expect(onProFootballOverrideChange).toHaveBeenCalledWith(true);
  });
});
