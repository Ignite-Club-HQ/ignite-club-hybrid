import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));

import {
  beginLaunchIntentResolution,
  getLaunchIntentState,
  getRetainedLaunchDestination,
  isLaunchIntentPending,
  markLaunchNavigationCommitted,
  markLaunchUrlReceived,
  noteLaunchNavigationRequested,
  __resetLaunchIntentForTests,
} from "@/lib/nativeLaunchIntent";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("native launch-intent readiness boundary", () => {
  beforeEach(() => {
    __resetLaunchIntentForTests();
  });

  it("starts pending on native so routing cannot redirect to /auth", () => {
    expect(isLaunchIntentPending()).toBe(true);
  });

  it("queues the invite destination before releasing the boundary", async () => {
    const order: string[] = [];
    beginLaunchIntentResolution(
      async () => ({ url: "https://reference.invalid" }),
      (url) => {
        order.push(`nav:${url}`);
        expect(isLaunchIntentPending()).toBe(true);
      },
    );
    await flush();
    expect(order).toEqual(["nav:https://reference.invalid"]);
    // Requesting navigation is NOT enough: the gate stays closed until the
    // Router commits the destination.
    expect(getLaunchIntentState()).toBe("resolved-url-awaiting-navigation");
    expect(isLaunchIntentPending()).toBe(true);
  });

  it("keeps the auth gate closed until the Router commits the invite route", async () => {
    beginLaunchIntentResolution(
      async () => ({ url: "https://reference.invalid" }),
      () => noteLaunchNavigationRequested("/join/p/tok123"),
    );
    await flush();
    expect(getRetainedLaunchDestination()).toBe("/join/p/tok123");
    expect(isLaunchIntentPending()).toBe(true);

    // A still-mounted protected route rendering "/" must not release the gate.
    markLaunchNavigationCommitted({ pathname: "/" });
    expect(isLaunchIntentPending()).toBe(true);

    markLaunchNavigationCommitted({ pathname: "/join/p/tok123" });
    expect(getLaunchIntentState()).toBe("resolved-url-committed");
    expect(isLaunchIntentPending()).toBe(false);
  });

  it("never releases on a generic /auth commitment while awaiting the invite", async () => {
    markLaunchUrlReceived();
    noteLaunchNavigationRequested("/join/p/tok456");
    markLaunchNavigationCommitted({ pathname: "/auth", search: "?mode=signup" });
    expect(isLaunchIntentPending()).toBe(true);
    expect(getLaunchIntentState()).toBe("resolved-url-awaiting-navigation");
  });

  it("recovers from a transient getLaunchUrl rejection without a second tap", async () => {
    let calls = 0;
    const seen: string[] = [];
    beginLaunchIntentResolution(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { url: "https://reference.invalid" };
      },
      (url) => seen.push(url),
    );
    await flush();
    expect(getLaunchIntentState()).toBe("failed-retrying");
    expect(isLaunchIntentPending()).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(["https://reference.invalid"]);
    expect(getLaunchIntentState()).toBe("resolved-url-awaiting-navigation");
  });

  it("releases for an ordinary launch with no URL", async () => {
    beginLaunchIntentResolution(async () => ({ url: null }), () => {
      throw new Error("should not navigate");
    });
    await flush();
    expect(getLaunchIntentState()).toBe("resolved-none");
    expect(isLaunchIntentPending()).toBe(false);
  });

  it("an appUrlOpen event keeps the gate closed pending commitment", () => {
    expect(isLaunchIntentPending()).toBe(true);
    markLaunchUrlReceived();
    expect(getLaunchIntentState()).toBe("resolved-url-awaiting-navigation");
    expect(isLaunchIntentPending()).toBe(true);
  });

  it("warm deep links after an ordinary launch never re-close the gate", async () => {
    beginLaunchIntentResolution(async () => ({ url: null }), () => {});
    await flush();
    markLaunchUrlReceived();
    expect(getLaunchIntentState()).toBe("resolved-none");
    expect(isLaunchIntentPending()).toBe(false);
  });

  it("re-flushes the retained navigation when acknowledgement is late", async () => {
    const flushes: string[] = [];
    markLaunchUrlReceived();
    noteLaunchNavigationRequested("/join/p/late", () => flushes.push("/join/p/late"));
    await new Promise((r) => setTimeout(r, 800));
    expect(flushes).toEqual(["/join/p/late"]);
    expect(isLaunchIntentPending()).toBe(true);
    markLaunchNavigationCommitted({ pathname: "/join/p/late" });
    expect(getLaunchIntentState()).toBe("resolved-url-committed");
  });

  it("cannot hang: the bounded ceiling releases a never-acknowledged launch", async () => {
    vi.useFakeTimers();
    try {
      markLaunchUrlReceived();
      noteLaunchNavigationRequested("/join/p/stuck");
      vi.advanceTimersByTime(3000);
      expect(isLaunchIntentPending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
