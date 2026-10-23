// @vitest-environment-options {"url":"https://ignite-canister-connect.lovable.app/"}
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleMapEmbed } from "./GoogleMapEmbed";

const native = vi.hoisted(() => ({ enabled: false, listeners: new Map<string, (state?: any) => void>(), remove: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.enabled } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async (name, callback) => {
  native.listeners.set(name, callback);
  return { remove: native.remove };
}) } }));

describe("GoogleMapEmbed", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
    native.enabled = false;
    native.listeners.clear();
    native.remove.mockClear();
  });

  it.each(["public-test-key", ""])("recreates an interrupted map on return with key %s", (key) => {
    vi.useFakeTimers();
    vi.stubEnv("IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY", key);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    render(<GoogleMapEmbed address="Norwood Oval" />);
    const original = screen.getByTitle("Event location map");
    const source = original.getAttribute("src");
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTitle("Event location map")).toBe(original);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTitle("Event location map")).not.toBe(original);
    expect(screen.getByTitle("Event location map").getAttribute("src")).toBe(source);
    const recovered = screen.getByTitle("Event location map");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTitle("Event location map")).toBe(recovered);
  });

  it("waits for connectivity and cancels pending recovery when removed", () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { unmount } = render(<GoogleMapEmbed address="Norwood Oval" />);
    const original = screen.getByTitle("Event location map");
    act(() => { window.dispatchEvent(new Event("online")); vi.advanceTimersByTime(250); });
    expect(screen.getByTitle("Event location map")).toBe(original);
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces native resume signals and removes native listeners", async () => {
    vi.useFakeTimers();
    native.enabled = true;
    const { unmount } = render(<GoogleMapEmbed address="Norwood Oval" />);
    const original = screen.getByTitle("Event location map");
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(native.listeners.size).toBe(2);
    act(() => {
      native.listeners.get("resume")?.();
      native.listeners.get("appStateChange")?.({ isActive: true });
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTitle("Event location map")).not.toBe(original);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(native.remove).toHaveBeenCalledTimes(2);
  });

  it("embeds the event address using the public browser key", () => {
    vi.stubEnv("IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY", "public-test-key");
    render(<GoogleMapEmbed address="35 Driffield, Adelaide SA" />);
    const frame = screen.getByTitle("Event location map");
    expect(frame).toHaveAttribute(
      "src",
      "https://www.google.com/maps/embed/v1/place?key=public-test-key&q=35%20Driffield%2C%20Adelaide%20SA",
    );
  });

  it("shows a keyless map plus a link when no key is configured", () => {
    vi.stubEnv("IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<GoogleMapEmbed address="35 Driffield" />);
    expect(screen.getByTitle("Event location map")).toHaveAttribute(
      "src",
      "https://www.google.com/maps?q=35%20Driffield&output=embed",
    );
    expect(screen.getByRole("link", { name: /View location on Google Maps/i })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=35%20Driffield",
    );
  });
});