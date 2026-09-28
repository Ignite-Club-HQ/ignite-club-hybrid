import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fabricMocks = vi.hoisted(() => {
  const instances: MockCanvas[] = [];

  class MockCanvas {
    lowerCanvasEl: HTMLCanvasElement;
    upperCanvasEl = document.createElement("canvas");
    wrapperEl = document.createElement("div");
    freeDrawingBrush: MockPencilBrush | null = null;
    backgroundColor: string | undefined;
    isDrawingMode = false;
    handlers = new Map<string, (event: any) => void>();
    setDimensions = vi.fn();
    renderAll = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
    getObjects = vi.fn(() => []);
    on = vi.fn((event: string, handler: (payload: any) => void) => {
      this.handlers.set(event, handler);
    });

    constructor(element: HTMLCanvasElement, public options: Record<string, unknown>) {
      this.lowerCanvasEl = element;
      this.backgroundColor = options.backgroundColor as string;
      instances.push(this);
    }
  }

  class MockPencilBrush {
    color = "";
    width = 0;
    constructor(public canvas: MockCanvas) {}
  }

  return { MockCanvas, MockPencilBrush, instances };
});

vi.mock("fabric", () => ({
  Canvas: fabricMocks.MockCanvas,
  PencilBrush: fabricMocks.MockPencilBrush,
  Line: class {},
  Triangle: class {},
  Group: class {},
  Path: class {},
}));

import { useLazyFabric } from "./useLazyFabric";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
}

function refs(width = 640, height = 360) {
  const canvas = document.createElement("canvas");
  const container = document.createElement("div");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });

  return {
    canvas,
    container,
    canvasRef: { current: canvas } as RefObject<HTMLCanvasElement>,
    containerRef: { current: container } as RefObject<HTMLDivElement>,
  };
}

async function settleInitialization() {
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useLazyFabric canvas lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fabricMocks.instances.length = 0;
    MockResizeObserver.instances.length = 0;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not construct a canvas while drawing support is disabled", async () => {
    const testRefs = refs();
    const { result } = renderHook(() =>
      useLazyFabric({ ...testRefs, enabled: false }),
    );

    await settleInitialization();

    expect(fabricMocks.instances).toHaveLength(0);
    expect(result.current.isReady).toBe(false);
  });

  it("initializes Fabric with stable dimensions, options and pencil defaults", async () => {
    const testRefs = refs();
    const onCanvasReady = vi.fn();
    const { result } = renderHook(() =>
      useLazyFabric({
        ...testRefs,
        enabled: true,
        initialColor: "#123456",
        onCanvasReady,
      }),
    );

    await settleInitialization();

    const instance = fabricMocks.instances[0];
    expect(instance).toBeDefined();
    expect(instance.options).toMatchObject({
      width: 640,
      height: 360,
      backgroundColor: "transparent",
      selection: false,
      allowTouchScrolling: false,
    });
    expect(instance.freeDrawingBrush).toMatchObject({
      color: "#123456",
      width: 3,
    });
    expect(result.current.canvas).toBe(instance);
    expect(result.current.isReady).toBe(true);
    expect(onCanvasReady).toHaveBeenCalledWith(instance);
  });

  it("configures all Fabric layers to prevent touch-driven page movement", async () => {
    const testRefs = refs();
    renderHook(() => useLazyFabric({ ...testRefs, enabled: true }));

    await settleInitialization();

    const instance = fabricMocks.instances[0];
    expect(instance.wrapperEl.style.touchAction).toBe("none");
    expect(instance.upperCanvasEl.style.touchAction).toBe("none");
    expect(instance.lowerCanvasEl.style.touchAction).toBe("none");
    expect(instance.wrapperEl.style.position).toBe("absolute");

    const event = new TouchEvent("touchmove", { cancelable: true });
    instance.upperCanvasEl.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(["path:created", "object:added"])(
    "locks objects received through %s against accidental manipulation",
    async (eventName) => {
      const testRefs = refs();
      renderHook(() => useLazyFabric({ ...testRefs, enabled: true }));
      await settleInitialization();

      const object = { set: vi.fn() };
      const instance = fabricMocks.instances[0];
      instance.handlers.get(eventName)?.(
        eventName === "path:created" ? { path: object } : { target: object },
      );

      expect(object.set).toHaveBeenCalledWith({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
      });
    },
  );

  it("keeps drawings alive but exits drawing mode when disabled", async () => {
    const testRefs = refs();
    const { rerender } = renderHook(
      ({ enabled }) => useLazyFabric({ ...testRefs, enabled }),
      { initialProps: { enabled: true } },
    );
    await settleInitialization();
    const instance = fabricMocks.instances[0];
    instance.isDrawingMode = true;

    rerender({ enabled: false });

    expect(instance.isDrawingMode).toBe(false);
    expect(instance.dispose).not.toHaveBeenCalled();
    expect(fabricMocks.instances).toHaveLength(1);
  });

  it("resizes the existing canvas rather than recreating it", async () => {
    const testRefs = refs();
    renderHook(() => useLazyFabric({ ...testRefs, enabled: true }));
    await settleInitialization();
    const instance = fabricMocks.instances[0];
    vi.mocked(testRefs.container.getBoundingClientRect).mockReturnValue({
      width: 800,
      height: 450,
    } as DOMRect);

    act(() => window.dispatchEvent(new Event("resize")));

    expect(instance.setDimensions).toHaveBeenCalledWith({ width: 800, height: 450 });
    expect(instance.renderAll).toHaveBeenCalled();
    expect(fabricMocks.instances).toHaveLength(1);
  });

  it("clears to transparency and disposes exactly once through the public API", async () => {
    const testRefs = refs();
    const { result, unmount } = renderHook(() =>
      useLazyFabric({ ...testRefs, enabled: true }),
    );
    await settleInitialization();
    const instance = fabricMocks.instances[0];

    act(() => result.current.clearCanvas());
    expect(instance.clear).toHaveBeenCalledOnce();
    expect(instance.backgroundColor).toBe("transparent");
    expect(instance.renderAll).toHaveBeenCalled();

    act(() => result.current.disposeCanvas());
    expect(instance.dispose).toHaveBeenCalledOnce();
    expect(result.current.canvas).toBeNull();
    expect(result.current.isReady).toBe(false);

    unmount();
    expect(instance.dispose).toHaveBeenCalledOnce();
  });

  it("waits for usable dimensions before constructing Fabric", async () => {
    const testRefs = refs(0, 0);
    renderHook(() => useLazyFabric({ ...testRefs, enabled: true }));
    await settleInitialization();
    expect(fabricMocks.instances).toHaveLength(0);

    vi.mocked(testRefs.container.getBoundingClientRect).mockReturnValue({
      width: 640,
      height: 360,
    } as DOMRect);
    act(() => vi.advanceTimersByTime(150));
    await settleInitialization();

    expect(fabricMocks.instances).toHaveLength(1);
  });
});
