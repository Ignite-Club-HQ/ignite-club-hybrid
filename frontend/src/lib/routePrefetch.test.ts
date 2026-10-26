import { afterEach, describe, expect, it, vi } from "vitest";

const imports = vi.hoisted(() => ({ messages: vi.fn(), events: vi.fn(), home: vi.fn(), media: vi.fn(), upgrade: vi.fn() }));
vi.mock("@/pages/ClubUpgradePage", () => { imports.upgrade(); return { default: () => null }; });
vi.mock("@/pages/MessagesPage", () => { imports.messages(); return { default: () => null }; });
vi.mock("@/pages/EventsPage", () => { imports.events(); return { default: () => null }; });
vi.mock("@/pages/HomePage", () => { imports.home(); return { default: () => null }; });
vi.mock("@/pages/MediaPage", () => { imports.media(); return { default: () => null }; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("main route code warmup", () => {
  it("shares upgrade code warmup across club IDs without loading club data", async () => {
    vi.resetModules();
    const { prefetchRoute } = await import("./routePrefetch");
    await Promise.all([prefetchRoute("/clubs/upgrade"), prefetchRoute("/clubs/g2/upgrade"), prefetchRoute("/clubs/g1/upgrade")]);
    expect(imports.upgrade).toHaveBeenCalledTimes(1);
  });
  it("warms all tabs without a load event and shares imports with tap intent", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const { warmMainRoutes, prefetchRoute } = await import("./routePrefetch");
    warmMainRoutes(); warmMainRoutes();
    await vi.advanceTimersByTimeAsync(500);
    await prefetchRoute("/messages");
    expect(imports.messages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(imports.events).toHaveBeenCalledTimes(1);
    expect(imports.home).toHaveBeenCalledTimes(1);
    expect(imports.media).toHaveBeenCalledTimes(1);
  });
});