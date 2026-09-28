import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePitchBoardDrawing } from "./usePitchBoardDrawing";

type Handler = (event: unknown) => void;

function createCanvas() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    isDrawingMode: false,
    freeDrawingBrush: { color: "", width: 0 },
    on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
    off: vi.fn((event: string, handler: Handler) => {
      if (handlers.get(event) === handler) handlers.delete(event);
    }),
    add: vi.fn(),
    remove: vi.fn(),
    renderAll: vi.fn(),
    clear: vi.fn(),
    backgroundColor: "red",
    getScenePoint: vi.fn(),
    getViewportPoint: vi.fn(() => ({ x: 1, y: 2 })),
  };
}

function createProps(overrides: Record<string, unknown> = {}) {
  const canvas = createCanvas();
  const Path = vi.fn(function MockPath(
    this: Record<string, unknown>,
    path: unknown,
    options: Record<string, unknown>,
  ) {
    this.path = path;
    Object.assign(this, options);
  });

  return {
    drawingTool: "none" as const,
    setDrawingTool: vi.fn(),
    drawingColor: "#ffffff",
    setShowFloatingDrawToolbar: vi.fn(),
    settingsMenuOpen: false,
    portraitSheetOpen: false,
    settingsDialogOpen: false,
    autoSubPanelOpen: false,
    toolbarCollapsed: true,
    fabricCanvas: canvas,
    fabricModule: { Path },
    ...overrides,
  };
}

describe("usePitchBoardDrawing Fabric regression boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs a serializable pitch arrow with stable metadata", () => {
    const props = createProps();
    const { result } = renderHook(() => usePitchBoardDrawing(props));

    const arrow = result.current.createArrow(10, 20, 110, 70, "#00ff00") as any;

    expect(props.fabricModule.Path).toHaveBeenCalledOnce();
    expect(arrow.data).toEqual({
      kind: "pitch-arrow",
      startX: 10,
      startY: 20,
      endX: 110,
      endY: 70,
    });
    expect(arrow).toMatchObject({
      stroke: "#00ff00",
      strokeWidth: 3,
      strokeUniform: true,
      selectable: false,
      evented: false,
    });
    expect(arrow.path).toHaveLength(6);
    expect(arrow.path.slice(0, 2)).toEqual([
      ["M", 10, 20],
      ["L", 110, 70],
    ]);
  });

  it("returns null when Fabric has not loaded", () => {
    const props = createProps({ fabricModule: null });
    const { result } = renderHook(() => usePitchBoardDrawing(props));

    expect(result.current.createArrow(0, 0, 100, 100, "#fff")).toBeNull();
  });

  it("uses Fabric scene coordinates and commits one sufficiently long arrow", () => {
    const props = createProps({ drawingTool: "arrow" });
    props.fabricCanvas.getScenePoint
      .mockReturnValueOnce({ x: 10, y: 20 })
      .mockReturnValueOnce({ x: 80, y: 90 });
    renderHook(() => usePitchBoardDrawing(props));

    act(() => {
      props.fabricCanvas.handlers.get("mouse:down")?.({ e: new MouseEvent("mousedown") });
      props.fabricCanvas.handlers.get("mouse:up")?.({ e: new MouseEvent("mouseup") });
    });

    expect(props.fabricCanvas.add).toHaveBeenCalledOnce();
    expect(props.fabricCanvas.renderAll).toHaveBeenCalledOnce();
    expect((props.fabricCanvas.add.mock.calls[0][0] as any).data).toMatchObject({
      startX: 10,
      startY: 20,
      endX: 80,
      endY: 90,
    });
  });

  it("does not persist accidental short arrow gestures", () => {
    const props = createProps({ drawingTool: "arrow" });
    props.fabricCanvas.getScenePoint
      .mockReturnValueOnce({ x: 10, y: 10 })
      .mockReturnValueOnce({ x: 20, y: 20 });
    renderHook(() => usePitchBoardDrawing(props));

    act(() => {
      props.fabricCanvas.handlers.get("mouse:down")?.({ e: {} });
      props.fabricCanvas.handlers.get("mouse:up")?.({ e: {} });
    });

    expect(props.fabricCanvas.add).not.toHaveBeenCalled();
  });

  it("replaces the temporary arrow while dragging and commits only the final arrow", () => {
    const props = createProps({ drawingTool: "arrow" });
    props.fabricCanvas.getScenePoint
      .mockReturnValueOnce({ x: 0, y: 0 })
      .mockReturnValueOnce({ x: 30, y: 30 })
      .mockReturnValueOnce({ x: 50, y: 50 })
      .mockReturnValueOnce({ x: 70, y: 70 });
    renderHook(() => usePitchBoardDrawing(props));

    act(() => {
      props.fabricCanvas.handlers.get("mouse:down")?.({ e: {} });
      props.fabricCanvas.handlers.get("mouse:move")?.({ e: {} });
      props.fabricCanvas.handlers.get("mouse:move")?.({ e: {} });
      props.fabricCanvas.handlers.get("mouse:up")?.({ e: {} });
    });

    expect(props.fabricCanvas.add).toHaveBeenCalledTimes(3);
    expect(props.fabricCanvas.remove).toHaveBeenCalledTimes(2);
    expect(props.fabricCanvas.remove.mock.calls[0][0]).toBe(
      props.fabricCanvas.add.mock.calls[0][0],
    );
    expect(props.fabricCanvas.remove.mock.calls[1][0]).toBe(
      props.fabricCanvas.add.mock.calls[1][0],
    );
  });

  it("falls back to viewport coordinates when scene coordinates are unavailable", () => {
    const props = createProps({ drawingTool: "arrow" });
    props.fabricCanvas.getScenePoint.mockReturnValue(undefined);
    props.fabricCanvas.getViewportPoint
      .mockReturnValueOnce({ x: 5, y: 5 })
      .mockReturnValueOnce({ x: 50, y: 50 });
    renderHook(() => usePitchBoardDrawing(props));

    act(() => {
      props.fabricCanvas.handlers.get("mouse:down")?.({ e: {} });
      props.fabricCanvas.handlers.get("mouse:up")?.({ e: {} });
    });

    expect(props.fabricCanvas.getViewportPoint).toHaveBeenCalledTimes(2);
    expect(props.fabricCanvas.add).toHaveBeenCalledOnce();
  });

  it("uses payload scenePoint without consulting canvas coordinate helpers", () => {
    const props = createProps({ drawingTool: "arrow" });
    renderHook(() => usePitchBoardDrawing(props));

    act(() => {
      props.fabricCanvas.handlers.get("mouse:down")?.({ scenePoint: { x: 0, y: 0 } });
      props.fabricCanvas.handlers.get("mouse:up")?.({ scenePoint: { x: 40, y: 40 } });
    });

    expect(props.fabricCanvas.getScenePoint).not.toHaveBeenCalled();
    expect(props.fabricCanvas.getViewportPoint).not.toHaveBeenCalled();
    expect(props.fabricCanvas.add).toHaveBeenCalledOnce();
  });

  it("enables the pencil brush with the selected colour and fixed width", () => {
    const props = createProps({ drawingTool: "pen", drawingColor: "#123456" });
    renderHook(() => usePitchBoardDrawing(props));

    expect(props.fabricCanvas.isDrawingMode).toBe(true);
    expect(props.fabricCanvas.freeDrawingBrush).toEqual({
      color: "#123456",
      width: 3,
    });
  });

  it("turns Fabric drawing mode off for non-pen tools", () => {
    const props = createProps({ drawingTool: "arrow" });
    props.fabricCanvas.isDrawingMode = true;
    renderHook(() => usePitchBoardDrawing(props));

    expect(props.fabricCanvas.isDrawingMode).toBe(false);
  });

  it.each([
    ["settings menu", { settingsMenuOpen: true }],
    ["portrait sheet", { portraitSheetOpen: true }],
    ["settings dialog", { settingsDialogOpen: true }],
    ["auto-sub panel", { autoSubPanelOpen: true }],
    ["expanded toolbar", { toolbarCollapsed: false }],
  ])("closes drawing safely when the %s opens", (_name, overlay) => {
    const props = createProps({ drawingTool: "pen", ...overlay });
    renderHook(() => usePitchBoardDrawing(props));

    expect(props.setDrawingTool).toHaveBeenCalledWith("none");
    expect(props.setShowFloatingDrawToolbar).toHaveBeenCalledWith(false);
  });

  it("clears drawings and restores a transparent canvas", () => {
    const props = createProps();
    const { result } = renderHook(() => usePitchBoardDrawing(props));

    act(() => result.current.clearDrawings());

    expect(props.fabricCanvas.clear).toHaveBeenCalledOnce();
    expect(props.fabricCanvas.backgroundColor).toBe("transparent");
    expect(props.fabricCanvas.renderAll).toHaveBeenCalledOnce();
  });

  it("unregisters the exact Fabric event handlers on unmount", () => {
    const props = createProps({ drawingTool: "arrow" });
    const { unmount } = renderHook(() => usePitchBoardDrawing(props));
    const registered = new Map(props.fabricCanvas.handlers);

    unmount();

    expect(props.fabricCanvas.off).toHaveBeenCalledTimes(3);
    for (const [event, handler] of registered) {
      expect(props.fabricCanvas.off).toHaveBeenCalledWith(event, handler);
    }
    expect(props.fabricCanvas.handlers.size).toBe(0);
  });
});
