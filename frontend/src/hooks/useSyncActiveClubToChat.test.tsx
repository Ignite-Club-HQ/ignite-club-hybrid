import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncActiveClubToChat } from "./useSyncActiveClubToChat";

const setActiveClubTheme = vi.fn();
let activeClubFilter: string | null = "club-a";

vi.mock("./useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter, setActiveClubTheme }),
}));

describe("useSyncActiveClubToChat", () => {
  beforeEach(() => {
    activeClubFilter = "club-a";
    setActiveClubTheme.mockReset();
  });

  it("does not override the user-selected club during ordinary cross-club chat navigation", () => {
    renderHook(() => useSyncActiveClubToChat("club-b"));

    expect(setActiveClubTheme).not.toHaveBeenCalled();
  });

  it("does not write when the routed chat already matches the active club", () => {
    renderHook(() => useSyncActiveClubToChat("club-a"));

    expect(setActiveClubTheme).not.toHaveBeenCalled();
  });

  it("does nothing until the routed chat club is known", () => {
    renderHook(() => useSyncActiveClubToChat(undefined));

    expect(setActiveClubTheme).not.toHaveBeenCalled();
  });
});
