import { useState, useEffect, useCallback, useRef } from "react";

// Types for Fabric.js classes we use
type FabricCanvas = import("fabric").Canvas;
type FabricPencilBrush = import("fabric").PencilBrush;
type FabricLine = typeof import("fabric").Line;
type FabricTriangle = typeof import("fabric").Triangle;
type FabricGroup = typeof import("fabric").Group;
type FabricPath = typeof import("fabric").Path;

interface FabricModule {
  Canvas: typeof import("fabric").Canvas;
  PencilBrush: typeof import("fabric").PencilBrush;
  Line: FabricLine;
  Triangle: FabricTriangle;
  Group: FabricGroup;
  Path: FabricPath;
}

// Cached promise for the Fabric module
let fabricModulePromise: Promise<FabricModule> | null = null;
let fabricModuleCache: FabricModule | null = null;

// Load Fabric.js module (returns cached if already loaded)
const loadFabricModule = (): Promise<FabricModule> => {
  if (fabricModuleCache) {
    return Promise.resolve(fabricModuleCache);
  }
  
  if (!fabricModulePromise) {
    fabricModulePromise = import("fabric").then((module) => {
      fabricModuleCache = {
        Canvas: module.Canvas,
        PencilBrush: module.PencilBrush,
        Line: module.Line,
        Triangle: module.Triangle,
        Group: module.Group,
        Path: module.Path,
      };
      return fabricModuleCache;
    });
  }
  
  return fabricModulePromise;
};

// Prefetch Fabric.js in the background (call after initial UI render)
export const prefetchFabric = (): void => {
  // Use requestIdleCallback if available for optimal timing
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(() => {
      loadFabricModule();
    });
  } else {
    // Fallback: load after a short delay
    setTimeout(() => {
      loadFabricModule();
    }, 300);
  }
};

interface PitchArrowData {
  kind?: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getArrowHeadLength = (dx: number, dy: number) => {
  const shaftLength = Math.hypot(dx, dy);
  return clamp(shaftLength * 0.18, 10, 24);
};

const buildArrowPathData = (startX: number, startY: number, endX: number, endY: number) => {
  const dx = endX - startX;
  const dy = endY - startY;
  const angle = Math.atan2(dy, dx);
  const headLength = getArrowHeadLength(dx, dy);
  const headSpread = Math.PI / 7;

  const leftHeadX = endX - headLength * Math.cos(angle - headSpread);
  const leftHeadY = endY - headLength * Math.sin(angle - headSpread);
  const rightHeadX = endX - headLength * Math.cos(angle + headSpread);
  const rightHeadY = endY - headLength * Math.sin(angle + headSpread);

  return [
    ["M", startX, startY],
    ["L", endX, endY],
    ["M", endX, endY],
    ["L", leftHeadX, leftHeadY],
    ["M", endX, endY],
    ["L", rightHeadX, rightHeadY],
  ];
};

const isLikelyArrowPath = (path: any): boolean => {
  if (!Array.isArray(path) || path.length !== 6) return false;

  const expectedCommands = ["M", "L", "M", "L", "M", "L"];
  return expectedCommands.every((command, index) => {
    const entry = path[index];
    return Array.isArray(entry) && String(entry[0]).toUpperCase() === command;
  });
};

const extractArrowDataFromPathObject = (obj: any): PitchArrowData | null => {
  const path = obj?.path;
  if (!isLikelyArrowPath(path)) return null;

  const startXRaw = Number(path?.[0]?.[1]);
  const startYRaw = Number(path?.[0]?.[2]);
  const endXRaw = Number(path?.[1]?.[1]);
  const endYRaw = Number(path?.[1]?.[2]);

  if (![startXRaw, startYRaw, endXRaw, endYRaw].every((value) => Number.isFinite(value))) {
    return null;
  }

  const isLegacyRelativePath = Math.abs(startXRaw) < 0.001 && Math.abs(startYRaw) < 0.001;

  if (isLegacyRelativePath) {
    const left = Number(obj?.left ?? 0);
    const top = Number(obj?.top ?? 0);

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return {
      kind: "pitch-arrow",
      startX: left,
      startY: top,
      endX: left + endXRaw,
      endY: top + endYRaw,
    };
  }

  return {
    kind: "pitch-arrow",
    startX: startXRaw,
    startY: startYRaw,
    endX: endXRaw,
    endY: endYRaw,
  };
};

const scaleArrowPathObject = (obj: any, scaleX: number, scaleY: number): boolean => {
  if (obj?.type !== "path") {
    return false;
  }

  let arrowData = obj?.data as PitchArrowData | undefined;

  if (arrowData?.kind !== "pitch-arrow") {
    const migratedArrowData = extractArrowDataFromPathObject(obj);
    if (!migratedArrowData) {
      return false;
    }
    arrowData = migratedArrowData;
  }

  if (
    typeof arrowData.startX !== "number" ||
    typeof arrowData.startY !== "number" ||
    typeof arrowData.endX !== "number" ||
    typeof arrowData.endY !== "number"
  ) {
    return false;
  }

  const nextStartX = arrowData.startX * scaleX;
  const nextStartY = arrowData.startY * scaleY;
  const nextEndX = arrowData.endX * scaleX;
  const nextEndY = arrowData.endY * scaleY;

  const nextPath = buildArrowPathData(nextStartX, nextStartY, nextEndX, nextEndY);

  obj.set({
    scaleX: 1,
    scaleY: 1,
    path: nextPath,
    data: {
      ...arrowData,
      kind: "pitch-arrow",
      startX: nextStartX,
      startY: nextStartY,
      endX: nextEndX,
      endY: nextEndY,
    },
  });

  // Let Fabric recalculate positioning from the new absolute path data
  if (typeof obj.initialize === "function") {
    obj.initialize(nextPath, { stroke: obj.stroke, strokeWidth: obj.strokeWidth, fill: obj.fill });
    obj.set("data", {
      ...arrowData,
      kind: "pitch-arrow",
      startX: nextStartX,
      startY: nextStartY,
      endX: nextEndX,
      endY: nextEndY,
    });
  }

  if (typeof obj.setCoords === "function") {
    obj.setCoords();
  }

  return true;
};

const scaleCanvasObjects = (
  canvas: FabricCanvas,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number
): void => {
  if (fromWidth <= 0 || fromHeight <= 0 || toWidth <= 0 || toHeight <= 0) return;

  const scaleX = toWidth / fromWidth;
  const scaleY = toHeight / fromHeight;
  const noScaleChange = Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001;

  if (noScaleChange) return;

  // All objects get full non-uniform scaling so drawings keep their
  // relative placement on the stretched pitch across orientation changes.
  canvas.getObjects().forEach((obj: any) => {
    if (scaleArrowPathObject(obj, scaleX, scaleY)) {
      return;
    }

    obj.set({
      left: (obj.left ?? 0) * scaleX,
      top: (obj.top ?? 0) * scaleY,
      scaleX: (obj.scaleX ?? 1) * scaleX,
      scaleY: (obj.scaleY ?? 1) * scaleY,
    });

    if (typeof obj.setCoords === "function") {
      obj.setCoords();
    }
  });
};

interface UseLazyFabricOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  enabled: boolean; // Only initialize when true (e.g., drawing mode)
  initialColor?: string;
  onCanvasReady?: (canvas: FabricCanvas) => void;
  dependencies?: any[]; // Additional deps to trigger reinit (e.g., isLandscape)
}

interface UseLazyFabricReturn {
  canvas: FabricCanvas | null;
  isLoading: boolean;
  isReady: boolean;
  fabricModule: FabricModule | null;
  clearCanvas: () => void;
  disposeCanvas: () => void;
}

interface PendingRestoreState {
  json: any;
  width: number;
  height: number;
}

export function useLazyFabric({
  canvasRef,
  containerRef,
  enabled,
  initialColor = "#ffffff",
  onCanvasReady,
  dependencies = [],
}: UseLazyFabricOptions): UseLazyFabricReturn {
  const [canvas, setCanvas] = useState<FabricCanvas | null>(null);
  const [fabricModule, setFabricModule] = useState<FabricModule | null>(fabricModuleCache);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const initializingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pendingRestoreJsonRef = useRef<PendingRestoreState | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  // Load Fabric module when enabled
  useEffect(() => {
    if (!enabled || fabricModule) return;
    
    setIsLoading(true);
    loadFabricModule()
      .then((module) => {
        setFabricModule(module);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load Fabric.js:", err);
        setIsLoading(false);
      });
  }, [enabled, fabricModule]);

  // Track a retry counter to re-trigger effect when refs aren't ready
  const [retryCount, setRetryCount] = useState(0);

  const resizeCanvasToContainer = useCallback((targetCanvas: FabricCanvas, targetContainer: HTMLDivElement) => {
    const rect = targetContainer.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    targetCanvas.setDimensions({ width: rect.width, height: rect.height });
    targetCanvas.renderAll();
  }, []);

  // Initialize canvas when module is loaded and enabled
  useEffect(() => {
    if (!enabled || !fabricModule) {
      return;
    }

    // Prevent double initialization
    if (initializingRef.current) return;

    const canvasEl = canvasRef.current;
    const containerEl = containerRef.current;

    // If refs aren't ready yet, retry after a short delay
    if (!canvasEl || !containerEl) {
      const retryId = setTimeout(() => {
        setRetryCount((c) => c + 1);
      }, 150);
      return () => clearTimeout(retryId);
    }

    // If we already have a canvas bound to this DOM element, just keep it sized correctly
    if (canvas) {
      const boundCanvasEl = (canvas as any).lowerCanvasEl as HTMLCanvasElement | undefined;
      const isBoundToCurrentElement = boundCanvasEl === canvasEl;

      if (isBoundToCurrentElement) {
        resizeCanvasToContainer(canvas, containerEl);
        return;
      }

      // Canvas is attached to a stale element (orientation/layout swap). Clear drawings and recreate.
      pendingRestoreJsonRef.current = null;

      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      setCanvas(null);
      setIsReady(false);
    }

    initializingRef.current = true;

    // Small delay to let container settle (especially after orientation change)
    const timeoutId = setTimeout(() => {
      if (!canvasRef.current || !containerRef.current) {
        initializingRef.current = false;
        return;
      }

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();

      // Retry if dimensions are not ready yet
      if (rect.width < 10 || rect.height < 10) {
        initializingRef.current = false;
        setTimeout(() => setRetryCount((c) => c + 1), 150);
        return;
      }

      console.log("[LazyFabric] Initializing canvas:", rect.width, "x", rect.height);

      const { Canvas, PencilBrush } = fabricModule;

      const newCanvas = new Canvas(canvasRef.current, {
        width: rect.width,
        height: rect.height,
        backgroundColor: "transparent",
        selection: false,
        allowTouchScrolling: false,
      });

      newCanvas.freeDrawingBrush = new PencilBrush(newCanvas);
      newCanvas.freeDrawingBrush.color = initialColor;
      newCanvas.freeDrawingBrush.width = 3;

      // Style wrapper and canvas elements for touch
      const wrapperEl = newCanvas.wrapperEl;
      const upperCanvas = newCanvas.upperCanvasEl;
      const lowerCanvas = newCanvas.lowerCanvasEl;

      [wrapperEl, upperCanvas, lowerCanvas].forEach((el) => {
        if (el) {
          el.style.touchAction = "none";
        }
      });

      if (wrapperEl) {
        wrapperEl.style.position = "absolute";
        wrapperEl.style.inset = "0";
        wrapperEl.style.width = "100%";
        wrapperEl.style.height = "100%";
      }

      // Prevent scroll during drawing
      const preventScroll = (e: TouchEvent) => {
        e.preventDefault();
      };

      upperCanvas.addEventListener("touchstart", preventScroll, { passive: false });
      upperCanvas.addEventListener("touchmove", preventScroll, { passive: false });

      // Store cleanup function
      cleanupRef.current = () => {
        upperCanvas.removeEventListener("touchstart", preventScroll);
        upperCanvas.removeEventListener("touchmove", preventScroll);
        newCanvas.dispose();
      };

      const lockObject = (obj: any) => {
        if (!obj) return;
        obj.set({
          selectable: false,
          evented: false,
          hasControls: false,
          hasBorders: false,
          lockMovementX: true,
          lockMovementY: true,
        });
      };

      // Make all drawn objects non-selectable
      newCanvas.on("path:created", (e: any) => lockObject(e.path));

      // Also lock any objects added via other means (arrows, etc.)
      newCanvas.on("object:added", (e: any) => lockObject(e.target));

      setCanvas(newCanvas);
      setIsReady(true);
      initializingRef.current = false;

      if (onCanvasReady) {
        onCanvasReady(newCanvas);
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      initializingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fabricModule, retryCount, canvas, resizeCanvasToContainer, ...dependencies]);

  useEffect(() => {
    if (!canvas) return;

    const scheduleResizeSync = () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }

      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        const currentContainer = containerRef.current;
        if (!currentContainer) return;
        resizeCanvasToContainer(canvas, currentContainer);
      });
    };

    const container = containerRef.current;
    const resizeObserver = typeof ResizeObserver !== "undefined" && container
      ? new ResizeObserver(() => scheduleResizeSync())
      : null;

    if (container && resizeObserver) {
      resizeObserver.observe(container);
    }

    window.addEventListener("resize", scheduleResizeSync);
    window.addEventListener("orientationchange", scheduleResizeSync);

    return () => {
      window.removeEventListener("resize", scheduleResizeSync);
      window.removeEventListener("orientationchange", scheduleResizeSync);
      resizeObserver?.disconnect();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [canvas, containerRef, resizeCanvasToContainer]);

  // When disabled, just turn off drawing mode but keep canvas alive to preserve drawings
  useEffect(() => {
    if (!enabled && canvas) {
      canvas.isDrawingMode = false;
    }
  }, [enabled, canvas]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const clearCanvas = useCallback(() => {
    if (canvas) {
      canvas.clear();
      canvas.backgroundColor = "transparent";
      canvas.renderAll();
    }
  }, [canvas]);

  const disposeCanvas = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setCanvas(null);
    setIsReady(false);
  }, []);

  return {
    canvas,
    isLoading,
    isReady,
    fabricModule,
    clearCanvas,
    disposeCanvas,
  };
}

export default useLazyFabric;
