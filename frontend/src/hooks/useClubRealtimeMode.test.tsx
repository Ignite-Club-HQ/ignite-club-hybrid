import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useClubProAccess, useFreeClubPollingEnabled } = vi.hoisted(() => ({
  useClubProAccess: vi.fn(),
  useFreeClubPollingEnabled: vi.fn(),
}));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess }));
vi.mock("@/hooks/useFreeClubPollingEnabled", () => ({ useFreeClubPollingEnabled }));

import { FREE_CLUB_POLL_INTERVAL_MS, useClubRealtimeMode } from "./useClubRealtimeMode";

describe("useClubRealtimeMode entitlement boundary", () => {
  beforeEach(() => {
    useFreeClubPollingEnabled.mockReturnValue(true);
    useClubProAccess.mockReturnValue({ hasPro: false, isLoading: false });
  });

  it("polls a resolved Free club when the operational flag is enabled", () => {
    const { result } = renderHook(() => useClubRealtimeMode("club-free"));
    expect(result.current).toEqual({ mode: "polling", intervalMs: FREE_CLUB_POLL_INTERVAL_MS });
  });

  it.each([
    ["a Pro club", "club-pro", true, false, true],
    ["a club whose entitlement is loading", "club-loading", false, true, true],
    ["an unresolved club", null, false, false, true],
    ["a Free club while the flag is disabled", "club-free", false, false, false],
  ])("keeps %s on realtime", (_label, clubId, hasPro, isLoading, flag) => {
    useClubProAccess.mockReturnValue({ hasPro, isLoading });
    useFreeClubPollingEnabled.mockReturnValue(flag);
    const { result } = renderHook(() => useClubRealtimeMode(clubId));
    expect(result.current.mode).toBe("realtime");
  });
});
