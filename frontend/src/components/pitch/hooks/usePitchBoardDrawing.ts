import { useCallback, useEffect, useRef } from "react";
import type { DrawingTool } from "../types";

interface UsePitchBoardDrawingArgs {
  drawingTool: DrawingTool;
  setDrawingTool: (tool: DrawingTool) => void;
  drawingColor: string;
  setShowFloatingDrawToolbar: (visible: boolean) => void;
  settingsMenuOpen: boolean;
  portraitSheetOpen: boolean;
  settingsDialogOpen: boolean;
  autoSubPanelOpen: boolean;
  toolbarCollapsed: boolean;
  fabricCanvas: any;
  fabricModule: any;
}

/**
 * Step 9f — Drawing/arrow lifecycle for PitchBoard.
 *
 * Owns:
 *  - drawingToolRef mirror (latest drawing tool, for closures).
 *  - In-flight arrow refs (start point + temp arrow object + flag).
 *  - Auto-disable drawing tool when any overlay/panel opens.
 *  - `createArrow` factory built against the lazy-loaded fabric module.
 *  - Fabric mouse handlers for arrow creation.
 *  - Pen/free-draw mode toggle on the canvas.
 *  - `clearDrawings` helper.
 */
export function usePitchBoardDrawing({
  drawingTool,
  setDrawingTool,
  drawingColor,
  setShowFloatingDrawToolbar,
  settingsMenuOpen,
  portraitSheetOpen,
  settingsDialogOpen,
  autoSubPanelOpen,
  toolbarCollapsed,
  fabricCanvas,
  fabricModule,
}: UsePitchBoardDrawingArgs) {
  const drawingToolRef = useRef(drawingTool);
  const isDrawingArrowRef = useRef(false);
  const arrowStartRef = useRef<{ x: number; y: number } | null>(null);
  const tempArrowRef = useRef<any>(null);

  // Keep ref updated
  useEffect(() => {
    drawingToolRef.current = drawingTool;
  }, [drawingTool]);

  // Disable drawing mode when any overlay/panel opens
  useEffect(() => {
    if (settingsMenuOpen || portraitSheetOpen || settingsDialogOpen || autoSubPanelOpen || !toolbarCollapsed) {
      if (drawingTool !== "none") {
        setDrawingTool("none");
        setShowFloatingDrawToolbar(false);
      }
    }
  }, [settingsMenuOpen, portraitSheetOpen, settingsDialogOpen, autoSubPanelOpen, toolbarCollapsed, drawingTool, setDrawingTool, setShowFloatingDrawToolbar]);

  // Create arrow helper — uses lazy-loaded fabric module
  const createArrow = useCallback((startX: number, startY: number, endX: number, endY: number, color: string) => {
    if (!fabricModule) return null;

    const { Path } = fabricModule;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx);
    const shaftLength = Math.hypot(dx, dy);
    const headLength = Math.max(10, Math.min(24, shaftLength * 0.18));
    const headSpread = Math.PI / 7;

    const leftHeadX = endX - headLength * Math.cos(angle - headSpread);
    const leftHeadY = endY - headLength * Math.sin(angle - headSpread);
    const rightHeadX = endX - headLength * Math.cos(angle + headSpread);
    const rightHeadY = endY - headLength * Math.sin(angle + headSpread);

    const arrowPathData = [
      ["M", startX, startY],
      ["L", endX, endY],
      ["M", endX, endY],
      ["L", leftHeadX, leftHeadY],
      ["M", endX, endY],
      ["L", rightHeadX, rightHeadY],
    ];

    const arrow = new Path(arrowPathData as any, {
      stroke: color,
      strokeWidth: 3,
      strokeUniform: true,
      fill: "",
      strokeLineCap: "butt",
      strokeLineJoin: "round",
      selectable: false,
      evented: false,
      data: {
        kind: "pitch-arrow",
        startX,
        startY,
        endX,
        endY,
      },
    });

    return arrow;
  }, [fabricModule]);

  // Handle arrow drawing
  useEffect(() => {
    if (!fabricCanvas) return;

    const getArrowPointer = (eventPayload: any) => {
      if (eventPayload?.scenePoint) return eventPayload.scenePoint;

      const nativeEvent = eventPayload?.e ?? eventPayload;
      const canvasWithScenePoint = fabricCanvas as any;
      if (typeof canvasWithScenePoint.getScenePoint === "function") {
        const scenePoint = canvasWithScenePoint.getScenePoint(nativeEvent);
        if (scenePoint?.x !== undefined && scenePoint?.y !== undefined) {
          return scenePoint;
        }
      }

      return eventPayload?.viewportPoint ?? eventPayload?.pointer ?? fabricCanvas.getViewportPoint(nativeEvent);
    };

    const handleMouseDown = (e: any) => {
      if (drawingTool !== "arrow") return;
      const pointer = getArrowPointer(e);
      if (!pointer) return;
      isDrawingArrowRef.current = true;
      arrowStartRef.current = { x: pointer.x, y: pointer.y };
    };

    const handleMouseMove = (e: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current || drawingTool !== "arrow") return;
      const pointer = getArrowPointer(e);
      if (!pointer) return;

      if (tempArrowRef.current) {
        fabricCanvas.remove(tempArrowRef.current);
      }

      const arrow = createArrow(
        arrowStartRef.current.x,
        arrowStartRef.current.y,
        pointer.x,
        pointer.y,
        drawingColor
      );

      if (arrow) {
        tempArrowRef.current = arrow;
        fabricCanvas.add(arrow);
        fabricCanvas.renderAll();
      }
    };

    const handleMouseUp = (e: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current || drawingTool !== "arrow") return;
      const pointer = getArrowPointer(e);
      if (!pointer) return;

      if (tempArrowRef.current) {
        fabricCanvas.remove(tempArrowRef.current);
        tempArrowRef.current = null;
      }

      const distance = Math.sqrt(
        Math.pow(pointer.x - arrowStartRef.current.x, 2) +
        Math.pow(pointer.y - arrowStartRef.current.y, 2)
      );

      if (distance > 20) {
        const arrow = createArrow(
          arrowStartRef.current.x,
          arrowStartRef.current.y,
          pointer.x,
          pointer.y,
          drawingColor
        );
        if (arrow) {
          fabricCanvas.add(arrow);
          fabricCanvas.renderAll();
        }
      }

      isDrawingArrowRef.current = false;
      arrowStartRef.current = null;
    };

    fabricCanvas.on("mouse:down", handleMouseDown);
    fabricCanvas.on("mouse:move", handleMouseMove);
    fabricCanvas.on("mouse:up", handleMouseUp);

    return () => {
      fabricCanvas.off("mouse:down", handleMouseDown);
      fabricCanvas.off("mouse:move", handleMouseMove);
      fabricCanvas.off("mouse:up", handleMouseUp);
    };
  }, [fabricCanvas, drawingTool, drawingColor, createArrow]);

  // Update pen drawing mode
  useEffect(() => {
    if (!fabricCanvas) return;

    if (drawingTool === "pen") {
      fabricCanvas.isDrawingMode = true;
      if (fabricCanvas.freeDrawingBrush) {
        fabricCanvas.freeDrawingBrush.color = drawingColor;
        fabricCanvas.freeDrawingBrush.width = 3;
      }
    } else {
      fabricCanvas.isDrawingMode = false;
    }
  }, [drawingTool, drawingColor, fabricCanvas]);

  const clearDrawings = useCallback(() => {
    if (!fabricCanvas) return;
    fabricCanvas.clear();
    fabricCanvas.backgroundColor = "transparent";
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  return {
    drawingToolRef,
    isDrawingArrowRef,
    arrowStartRef,
    tempArrowRef,
    createArrow,
    clearDrawings,
  };
}
