"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { renderBorder, BorderConfig, BorderStyle, DrawingArea } from "@/lib/border-renderer";
import { renderText, HersheyFontName } from "@/lib/hershey-fonts";
import { STICKERS, StickerMeta, StickerCategory, getStickerCategories, getStickersByCategory } from "@/lib/sticker-data";
import { Download, Plus, Type, Maximize2, ArrowLeft, Loader2, AlertCircle, AlertTriangle, Move, Smile, Frame, Trash2, RectangleVertical, RectangleHorizontal } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlotterSettings {
  z_draw: number;
  z_hop: number;
  feed_draw: number;
  feed_travel: number;
  canvas_x: number;
  canvas_y: number;
  offset_x: number;
  offset_y: number;
  detail_level: number;
}

export type ComposerBaseLayer =
  | { type: "svg"; svg: string }
  | { type: "sketch"; dataUrl: string };

export interface GcodeResult {
  gcode: string;
  stats: {
    strokeCount: number;
    estimatedTimeSeconds: number;
    pathLengthMm: number;
  };
}

interface TextElement {
  id: string;
  text: string;
  font: HersheyFontName;
  sizeMm: number;
  passes: number;
  x: number; // mm from drawing area origin
  y: number;
}

interface StickerElement {
  id: string;
  stickerId: string;
  svgPath: string;
  x: number; // mm
  y: number;
  width: number;
  height: number;
  passes: number;
}

export interface ProcessParams {
  penType: string;
  drawingMode: string;
  orientation: string;
  detailLevel: number;
  strokeWeight: number;
}

export interface ComposerProps {
  baseLayer: ComposerBaseLayer;
  settings: PlotterSettings;
  imageFile?: File;
  processParams?: ProcessParams;
  onGcodeReady: (result: GcodeResult) => void;
  onBack?: () => void; // UI: return to the drawing settings step
}

// ─── Constants ────────────────────────────────────────────────────────────────

const A4_PORTRAIT = { width: 210, height: 297 };   // mm
const A4_LANDSCAPE = { width: 297, height: 210 };  // mm

const CLAMP = {
  portrait:  { minW: 10, maxW: 250, minH: 10, maxH: 250, minX: 0, maxX: 150, minY: 0, maxY: 150 },
  landscape: { minW: 10, maxW: 280, minH: 10, maxH: 200, minX: 0, maxX: 150, minY: 0, maxY: 150 },
};

const HERSHEY_FONTS: HersheyFontName[] = ["sans", "script", "gothic", "block", "simplex"];

// ─── Clamping helper (exported for property tests) ────────────────────────────

export function clampDrawingArea(
  width: number,
  height: number,
  orientation: "portrait" | "landscape",
  x?: number,
  y?: number,
): { width: number; height: number; x: number; y: number } {
  const c = CLAMP[orientation];
  const w = Number.isFinite(width) ? Math.max(c.minW, Math.min(c.maxW, width)) : c.minW;
  const h = Number.isFinite(height) ? Math.max(c.minH, Math.min(c.maxH, height)) : c.minH;
  const cx = x !== undefined && Number.isFinite(x) ? Math.max(c.minX, Math.min(c.maxX, x)) : c.minX;
  const cy = y !== undefined && Number.isFinite(y) ? Math.max(c.minY, Math.min(c.maxY, y)) : c.minY;
  return { width: w, height: h, x: cx, y: cy };
}

// ─── SVG path D parser (M/L/Z only) ──────────────────────────────────────────
function parseSvgPathD(d: string): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const tokens = d.match(/[MLZmlz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "M" || tok === "L") {
      i++;
      if (i + 1 < tokens.length) {
        pts.push([parseFloat(tokens[i]), parseFloat(tokens[i + 1])]);
        i += 2;
      }
    } else if (tok === "Z" || tok === "z") {
      if (pts.length > 0) pts.push(pts[0]);
      i++;
    } else { i++; }
  }
  return pts;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Composer({ baseLayer, settings, imageFile, processParams, onGcodeReady, onBack }: ComposerProps) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  // Initialize drawing area from plotter settings so it matches the actual canvas
  const [drawingArea, setDrawingArea] = useState<DrawingArea>(() => ({
    x: settings.offset_x,
    y: settings.offset_y,
    width: settings.canvas_x,
    height: settings.canvas_y,
  }));
  const [border, setBorder] = useState<BorderConfig>({ style: "rounded-rect", margin: 5, thickness: 1 });
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  const [stickerElements, setStickerElements] = useState<StickerElement[]>([]);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"border" | "text" | "stickers">("border");
  // Local string state for number inputs so user can clear and retype freely
  const [widthInput, setWidthInput] = useState(String(settings.canvas_x));
  const [heightInput, setHeightInput] = useState(String(settings.canvas_y));
  const [xInput, setXInput] = useState(String(settings.offset_x));
  const [yInput, setYInput] = useState(String(settings.offset_y));
  const [imageScale, setImageScale] = useState(100);

  // Drag state for stickers
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  // Drag state for drawing area box
  const daDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasColRef = useRef<HTMLDivElement>(null);

  // ── A4 dimensions ──────────────────────────────────────────────────────────
  const a4 = orientation === "portrait" ? A4_PORTRAIT : A4_LANDSCAPE;

  // ── Scale factor: fit A4 into canvas panel — recalculates on orientation change ──
  const [pxPerMm, setPxPerMm] = useState(2.0);
  useEffect(() => {
    const updateScale = () => {
      const containerW = canvasColRef.current
        ? canvasColRef.current.offsetWidth
        : window.innerWidth * (panelCollapsed ? 0.95 : 0.65);
      const maxH = window.innerHeight * 0.75;
      const scaleW = (containerW - 40) / a4.width;
      const scaleH = maxH / a4.height;
      setPxPerMm(Math.min(scaleW, scaleH));
    };
    updateScale();
    let ro: ResizeObserver | null = null;
    if (canvasColRef.current) {
      ro = new ResizeObserver(updateScale);
      ro.observe(canvasColRef.current);
    }
    window.addEventListener("resize", updateScale);
    return () => {
      window.removeEventListener("resize", updateScale);
      ro?.disconnect();
    };
  }, [a4.width, a4.height, panelCollapsed, orientation]);

  // ── Load last border style from localStorage ───────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("last_border_style") as BorderStyle | null;
    if (saved) setBorder((b) => ({ ...b, style: saved }));
  }, []);

  // ── Persist border style ───────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("last_border_style", border.style);
  }, [border.style]);

  // ── Orientation toggle ─────────────────────────────────────────────────────
  const toggleOrientation = useCallback(() => {
    setOrientation((o) => {
      // Swap canvas_x / canvas_y for the new orientation
      const next = o === "portrait" ? "landscape" : "portrait";
      const newW = settings.canvas_y; // swap axes
      const newH = settings.canvas_x;
      setDrawingArea({ x: settings.offset_x, y: settings.offset_y, width: newW, height: newH });
      setWidthInput(String(newW));
      setHeightInput(String(newH));
      setXInput(String(settings.offset_x));
      setYInput(String(settings.offset_y));
      return next;
    });
  }, [settings]);

  // ── Drawing area resize ────────────────────────────────────────────────────
  const commitWidth = useCallback((raw: string) => {
    const n = parseFloat(raw);
    const clamped = clampDrawingArea(isNaN(n) ? drawingArea.width : n, drawingArea.height, orientation, drawingArea.x, drawingArea.y);
    setDrawingArea((prev) => ({ ...prev, width: clamped.width }));
    setWidthInput(String(Math.round(clamped.width)));
  }, [drawingArea, orientation]);

  const commitHeight = useCallback((raw: string) => {
    const n = parseFloat(raw);
    const clamped = clampDrawingArea(drawingArea.width, isNaN(n) ? drawingArea.height : n, orientation, drawingArea.x, drawingArea.y);
    setDrawingArea((prev) => ({ ...prev, height: clamped.height }));
    setHeightInput(String(Math.round(clamped.height)));
  }, [drawingArea, orientation]);

  const commitX = useCallback((raw: string) => {
    const n = parseFloat(raw);
    const clamped = clampDrawingArea(drawingArea.width, drawingArea.height, orientation, isNaN(n) ? drawingArea.x : n, drawingArea.y);
    setDrawingArea((prev) => ({ ...prev, x: clamped.x }));
    setXInput(String(Math.round(clamped.x)));
  }, [drawingArea, orientation]);

  const commitY = useCallback((raw: string) => {
    const n = parseFloat(raw);
    const clamped = clampDrawingArea(drawingArea.width, drawingArea.height, orientation, drawingArea.x, isNaN(n) ? drawingArea.y : n);
    setDrawingArea((prev) => ({ ...prev, y: clamped.y }));
    setYInput(String(Math.round(clamped.y)));
  }, [drawingArea, orientation]);

  const updateDrawingArea = useCallback((updates: Partial<DrawingArea>) => {
    setDrawingArea((prev) => {
      const next = { ...prev, ...updates };
      const clamped = clampDrawingArea(next.width, next.height, orientation, next.x, next.y);
      return { ...next, ...clamped };
    });
  }, [orientation]);

  // ── Border render (memoised) ───────────────────────────────────────────────
  const borderResult = useMemo(() => {
    if (border.style === "none") return { svgPaths: [], gcodeLines: [] };
    return renderBorder(border, drawingArea, settings);
  }, [border, drawingArea, settings]);

  // ── Add text element ───────────────────────────────────────────────────────
  const addText = useCallback(() => {
    const id = `text-${Date.now()}`;
    const newEl: TextElement = {
      id,
      text: "Your text",
      font: "sans",
      sizeMm: 10,
      passes: 1,
      x: drawingArea.x + drawingArea.width / 2,
      y: drawingArea.y + drawingArea.height / 2,
    };
    setTextElements((prev) => [...prev, newEl]);
    setSelectedTextId(id);
    setActiveTab("text");
  }, [drawingArea]);

  // ── Add sticker ────────────────────────────────────────────────────────────
  const addSticker = useCallback((sticker: StickerMeta) => {
    const id = `sticker-${Date.now()}`;
    const newEl: StickerElement = {
      id,
      stickerId: sticker.id,
      svgPath: sticker.path,
      x: drawingArea.x + drawingArea.width / 2 - 10,
      y: drawingArea.y + drawingArea.height / 2 - 10,
      width: 20,
      height: 20,
      passes: 1,
    };
    setStickerElements((prev) => [...prev, newEl]);
    setSelectedStickerId(id);
  }, [drawingArea]);

  // ── Parse SVG paths into G-code lines ─────────────────────────────────────
  const svgToGcodeLines = useCallback((svgString: string, fmt: (n: number) => string, zDraw: number, zHop: number, feedDraw: number, feedTravel: number): string[] => {
    const lines: string[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const strokes: Array<Array<[number, number]>> = [];
    doc.querySelectorAll("path").forEach((path) => {
      const pts = parseSvgPathD(path.getAttribute("d") || "");
      if (pts.length >= 2) strokes.push(pts);
    });
    // Short pen lift (0.5mm) when the next stroke starts within 5mm, full Z-hop otherwise
    const zShort = Math.min(zDraw + 0.5, zHop);
    strokes.forEach((pts, k) => {
      lines.push(`G0 X${fmt(pts[0][0])} Y${fmt(pts[0][1])} F${feedTravel}`);
      lines.push(`G0 Z${fmt(zDraw)} F${feedTravel}`);
      for (let i = 1; i < pts.length; i++) {
        lines.push(`G1 X${fmt(pts[i][0])} Y${fmt(pts[i][1])} F${feedDraw}`);
      }
      const end = pts[pts.length - 1];
      const next = strokes[k + 1]?.[0];
      const near = next && Math.hypot(next[0] - end[0], next[1] - end[1]) <= 5;
      lines.push(`G0 Z${fmt(near ? zShort : zHop)} F${feedTravel}`);
    });
    return lines;
  }, []);

  // ── Scale SVG path coordinates from drawing-area centre (for Image Scale slider) ──
  const applyScaleToSvg = useCallback((svgString: string): string => {
    if (imageScale === 100) return svgString;
    const s = imageScale / 100;
    const cx = drawingArea.x + drawingArea.width / 2;
    const cy = drawingArea.y + drawingArea.height / 2;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    doc.querySelectorAll("path").forEach((path) => {
      const d = path.getAttribute("d") || "";
      const pts = parseSvgPathD(d);
      if (pts.length < 2) return;
      let newD = "";
      pts.forEach(([x, y], i) => {
        const nx = (cx + (x - cx) * s).toFixed(3);
        const ny = (cy + (y - cy) * s).toFixed(3);
        newD += i === 0 ? `M${nx},${ny}` : `L${nx},${ny}`;
      });
      path.setAttribute("d", newD);
    });
    return new XMLSerializer().serializeToString(doc.documentElement);
  }, [drawingArea, imageScale]);

  // ── Generate G-code ────────────────────────────────────────────────────────
  const generateGcode = useCallback(async () => {
    setGenerating(true);
    setGenError(null);

    try {
      const fmt = (n: number) => n.toFixed(3);
      const zDraw = settings.z_draw;
      const zHop = settings.z_hop;
      const feedDraw = settings.feed_draw;
      const feedTravel = settings.feed_travel;

      const lines: string[] = [];

      // Header
      lines.push("; Sovol SV02 Pen Plotter G-code");
      lines.push("; Generated by PlotterAI Composer");
      lines.push(`; Drawing area: ${drawingArea.x},${drawingArea.y} + ${drawingArea.width}x${drawingArea.height}mm`);
      lines.push("G21 ; mm units");
      lines.push("G90 ; absolute positioning");
      lines.push("G28 X Y ; home X and Y");
      lines.push(`G0 Z${fmt(zHop)} F${feedTravel} ; pen up`);
      lines.push("");

      // Border (uses current border selection and drawing area)
      if (borderResult.gcodeLines.length > 0) {
        lines.push("; === BORDER ===");
        lines.push(...borderResult.gcodeLines);
        lines.push("");
      }

      // Base image strokes
      lines.push("; === IMAGE ===");

      if (imageFile && processParams) {
        // Re-call the API with the current drawing area as the canvas dimensions.
        // This ensures the image is correctly scaled and positioned within the selected area.
        try {
          const fd = new FormData();
          fd.append("image", imageFile);
          fd.append("penType", processParams.penType);
          fd.append("drawingMode", processParams.drawingMode);
          fd.append("orientation", processParams.orientation);
          fd.append("detail", String(processParams.detailLevel));
          fd.append("strokeWeight", String(processParams.strokeWeight));
          fd.append("settings", JSON.stringify({
            zDraw: settings.z_draw,
            zHop: settings.z_hop,
            feedDraw: settings.feed_draw,
            feedTravel: settings.feed_travel,
            canvasX: drawingArea.width,   // scale image to drawing area width
            canvasY: drawingArea.height,  // scale image to drawing area height
            offsetX: drawingArea.x,       // position image at drawing area X
            offsetY: drawingArea.y,       // position image at drawing area Y
          }));

          const res = await fetch("/api/process", { method: "POST", body: fd });
          if (res.ok) {
            const result = await res.json();
            if (result.strokesSvg) {
              lines.push(...svgToGcodeLines(applyScaleToSvg(result.strokesSvg), fmt, zDraw, zHop, feedDraw, feedTravel));
            }
          } else {
            // API failed — fall back to existing base layer
            if (baseLayer.type === "svg" && baseLayer.svg) {
              lines.push(...svgToGcodeLines(applyScaleToSvg(baseLayer.svg), fmt, zDraw, zHop, feedDraw, feedTravel));
            }
          }
        } catch {
          // Network error — fall back to existing base layer
          if (baseLayer.type === "svg" && baseLayer.svg) {
            lines.push(...svgToGcodeLines(applyScaleToSvg(baseLayer.svg), fmt, zDraw, zHop, feedDraw, feedTravel));
          }
        }
      } else if (baseLayer.type === "svg" && baseLayer.svg) {
        // No imageFile prop — use the base layer SVG paths directly
        lines.push(...svgToGcodeLines(applyScaleToSvg(baseLayer.svg), fmt, zDraw, zHop, feedDraw, feedTravel));
      }

      lines.push("");

      // Text elements
      lines.push("; === TEXT ===");
      textElements.forEach((el) => {
        const rendered = renderText(el.text, el.font as HersheyFontName, el.sizeMm, el.passes);
        rendered.svgPaths.forEach((pathStr) => {
          const dMatch = pathStr.match(/d="([^"]+)"/);
          if (!dMatch) return;
          const pts = parseSvgPathD(dMatch[1]);
          if (pts.length < 2) return;
          lines.push(`G0 X${fmt(pts[0][0] + el.x)} Y${fmt(pts[0][1] + el.y)} F${feedTravel}`);
          lines.push(`G0 Z${fmt(zDraw)} F${feedTravel}`);
          for (let i = 1; i < pts.length; i++) {
            lines.push(`G1 X${fmt(pts[i][0] + el.x)} Y${fmt(pts[i][1] + el.y)} F${feedDraw}`);
          }
          lines.push(`G0 Z${fmt(zHop)} F${feedTravel}`);
        });
      });

      // Stickers
      lines.push("; === STICKERS ===");
      const stickerPayload = await Promise.all(
        stickerElements.map(async (el) => {
          let svgContent = "";
          try {
            const res = await fetch(el.svgPath);
            svgContent = await res.text();
          } catch { svgContent = ""; }
          return { ...el, svgContent };
        })
      );
      stickerPayload.forEach((el) => {
        if (!el.svgContent) return;
        const parser = new DOMParser();
        const doc = parser.parseFromString(el.svgContent, "image/svg+xml");
        const scaleX = el.width / 100;
        const scaleY = el.height / 100;
        doc.querySelectorAll("path").forEach((path) => {
          const d = path.getAttribute("d") || "";
          const pts = parseSvgPathD(d);
          if (pts.length < 2) return;
          lines.push(`G0 X${fmt(el.x + pts[0][0] * scaleX)} Y${fmt(el.y + pts[0][1] * scaleY)} F${feedTravel}`);
          lines.push(`G0 Z${fmt(zDraw)} F${feedTravel}`);
          for (let i = 1; i < pts.length; i++) {
            lines.push(`G1 X${fmt(el.x + pts[i][0] * scaleX)} Y${fmt(el.y + pts[i][1] * scaleY)} F${feedDraw}`);
          }
          lines.push(`G0 Z${fmt(zHop)} F${feedTravel}`);
        });
      });

      // Footer
      lines.push("");
      lines.push("; === FOOTER ===");
      lines.push(`G0 Z${fmt(zHop + 5)} F${feedTravel} ; raise pen safely`);
      lines.push(`G0 X${fmt(drawingArea.x)} Y${fmt(drawingArea.y)} F${feedTravel} ; return to area origin`);
      lines.push("M84 ; disable motors");

      const gcode = lines.join("\n");
      const strokeCount = lines.filter((l) => l.startsWith(`G0 Z${fmt(zDraw)}`)).length;
      const pathLengthMm = 0;
      const estimatedTimeSeconds = Math.round((strokeCount * 2 * feedDraw) / 60);

      onGcodeReady({ gcode, stats: { strokeCount, estimatedTimeSeconds, pathLengthMm } });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [textElements, stickerElements, settings, drawingArea, baseLayer, borderResult, imageFile, processParams, svgToGcodeLines, applyScaleToSvg, onGcodeReady]);

  // ── Canvas pixel dimensions ────────────────────────────────────────────────
  const canvasPx = { width: a4.width * pxPerMm, height: a4.height * pxPerMm };
  const daPx = {
    x: drawingArea.x * pxPerMm,
    y: drawingArea.y * pxPerMm,
    width: drawingArea.width * pxPerMm,
    height: drawingArea.height * pxPerMm,
  };

  // ── UI-only derived values ───────────────────────────────────────────────
  const overX = Math.max(0, Math.round(drawingArea.x + drawingArea.width - a4.width));
  const overY = Math.max(0, Math.round(drawingArea.y + drawingArea.height - a4.height));
  const resetArea = () => {
    const newW = settings.canvas_x;
    const newH = settings.canvas_y;
    setDrawingArea({ x: settings.offset_x, y: settings.offset_y, width: newW, height: newH });
    setWidthInput(String(newW));
    setHeightInput(String(newH));
    setXInput(String(settings.offset_x));
    setYInput(String(settings.offset_y));
  };
  const scaleFill = ((imageScale - 50) / 150) * 100;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start w-full min-w-0">
      {/* ── Canvas area ── */}
      <section ref={canvasColRef} className="ui-panel overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="ui-panel-head flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="ui-seg">
              {(["portrait", "landscape"] as const).map((o) => (
                <button key={o} type="button" aria-pressed={orientation === o}
                  onClick={() => { if (orientation !== o) toggleOrientation(); }}
                  className="ui-seg-btn capitalize">
                  {o === "portrait" ? <RectangleVertical size={14} /> : <RectangleHorizontal size={14} />}{o}
                </button>
              ))}
            </div>
            <button type="button" onClick={resetArea} title="Reset the drawing area to the plotter canvas" className="ui-btn ui-btn-sm">
              <Maximize2 size={13} />Reset area
            </button>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="ui-badge">A4 · {a4.width} × {a4.height} mm</span>
          </div>
        </div>

        {(overX > 0 || overY > 0) && (
          <div className="flex items-start gap-2.5 px-5 py-2.5 border-b text-[12.5px]" role="status"
            style={{ borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.07)", color: "#fcd34d" }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              The drawing area runs {[overX > 0 ? `${overX} mm past the right edge` : null, overY > 0 ? `${overY} mm past the bottom edge` : null].filter(Boolean).join(" and ")} of
              the A4 sheet. Make sure your paper covers it, or reduce the size/offset.
            </span>
          </div>
        )}

        {/* Stage */}
        <div className="relative ui-stage !rounded-none !border-0 p-4 sm:p-6 overflow-auto">
          <div
            ref={canvasRef}
            className="relative ui-paper overflow-hidden mx-auto"
            style={{ width: canvasPx.width, height: canvasPx.height }}
            aria-label={`A4 canvas ${orientation}`}
          >
            {/* Base image layer */}
            {baseLayer.type === "svg" && baseLayer.svg && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: daPx.x, top: daPx.y,
                  width: daPx.width, height: daPx.height,
                  overflow: "hidden",
                  transform: imageScale !== 100 ? `scale(${(imageScale / 100).toFixed(2)})` : undefined,
                  transformOrigin: "center",
                }}
                dangerouslySetInnerHTML={{ __html: baseLayer.svg }}
              />
            )}
            {baseLayer.type === "sketch" && baseLayer.dataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={baseLayer.dataUrl}
                alt="Base sketch"
                className="absolute object-contain pointer-events-none"
                style={{
                  left: daPx.x, top: daPx.y,
                  width: daPx.width, height: daPx.height,
                  transform: imageScale !== 100 ? `scale(${(imageScale / 100).toFixed(2)})` : undefined,
                  transformOrigin: "center",
                }}
              />
            )}

            {/* Drawing area indicator — draggable to reposition */}
            <div
              className="absolute cursor-move group"
              style={{ left: daPx.x, top: daPx.y, width: daPx.width, height: daPx.height, zIndex: 10, outline: "1.5px dashed rgba(99,102,241,0.75)", outlineOffset: -1 }}
              title="Drag to move the drawing"
              onMouseDown={(e) => {
                e.preventDefault();
                daDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: drawingArea.x,
                  origY: drawingArea.y,
                };
                const origW = drawingArea.width;
                const origH = drawingArea.height;
                const origOri = orientation;
                const onMove = (me: MouseEvent) => {
                  if (!daDragRef.current) return;
                  const dx = (me.clientX - daDragRef.current.startX) / pxPerMm;
                  const dy = (me.clientY - daDragRef.current.startY) / pxPerMm;
                  const clamped = clampDrawingArea(origW, origH, origOri, daDragRef.current.origX + dx, daDragRef.current.origY + dy);
                  setDrawingArea((prev) => ({ ...prev, x: clamped.x, y: clamped.y }));
                  setXInput(String(Math.round(clamped.x)));
                  setYInput(String(Math.round(clamped.y)));
                };
                const onUp = () => {
                  daDragRef.current = null;
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            >
              <span className="absolute -top-px left-2 -translate-y-full px-1.5 py-0.5 rounded-t-md text-[10px] font-semibold text-white opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(79,70,229,0.9)" }}>
                <Move size={10} className="inline -mt-0.5 mr-1" />drag to move
              </span>
            </div>

            {/* Border overlay */}
            {borderResult.svgPaths.length > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: canvasPx.width, height: canvasPx.height }}
                viewBox={`0 0 ${a4.width} ${a4.height}`}
              >
                {borderResult.svgPaths.map((p, i) => (
                  <g key={i} dangerouslySetInnerHTML={{ __html: p }} />
                ))}
              </svg>
            )}

            {/* Text elements */}
            {textElements.map((el) => {
              const rendered = renderText(el.text, el.font, el.sizeMm, 1);
              return (
                <div
                  key={el.id}
                  className={`absolute cursor-pointer select-none rounded-sm ${selectedTextId === el.id ? "ring-2 ring-indigo-400" : ""}`}
                  style={{ left: el.x * pxPerMm, top: el.y * pxPerMm }}
                  onClick={() => { setSelectedTextId(el.id); setActiveTab("text"); }}
                >
                  <svg
                    viewBox={`0 0 ${rendered.boundingBox.width} ${rendered.boundingBox.height}`}
                    style={{ width: rendered.boundingBox.width * pxPerMm, height: rendered.boundingBox.height * pxPerMm }}
                  >
                    {rendered.svgPaths.map((p, i) => (
                      <g key={i} dangerouslySetInnerHTML={{ __html: p }} />
                    ))}
                  </svg>
                </div>
              );
            })}

            {/* Sticker elements — draggable */}
            {stickerElements.map((el) => (
              <div
                key={el.id}
                className={`absolute cursor-move select-none rounded ${selectedStickerId === el.id ? "ring-2 ring-violet-400" : ""}`}
                style={{
                  left: el.x * pxPerMm,
                  top: el.y * pxPerMm,
                  width: el.width * pxPerMm,
                  height: el.height * pxPerMm,
                  touchAction: "none",
                  zIndex: 11,
                }}
                onClick={() => setSelectedStickerId(el.id)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragRef.current = {
                    id: el.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: el.x,
                    origY: el.y,
                  };
                  const onMove = (me: MouseEvent) => {
                    if (!dragRef.current || dragRef.current.id !== el.id) return;
                    const dx = (me.clientX - dragRef.current.startX) / pxPerMm;
                    const dy = (me.clientY - dragRef.current.startY) / pxPerMm;
                    setStickerElements((prev) =>
                      prev.map((s) =>
                        s.id === el.id
                          ? { ...s, x: dragRef.current!.origX + dx, y: dragRef.current!.origY + dy }
                          : s
                      )
                    );
                  };
                  const onUp = () => {
                    dragRef.current = null;
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={el.svgPath} alt={el.stickerId} className="w-full h-full object-contain pointer-events-none" />
              </div>
            ))}
          </div>

          {generating && (
            <div className="absolute inset-0 grid place-items-center" style={{ background: "rgba(7,7,11,0.55)", backdropFilter: "blur(2px)" }} aria-live="polite">
              <div className="ui-panel px-5 py-4 flex items-center gap-3 ui-pop">
                <Loader2 size={18} className="animate-spin text-violet-300" />
                <div>
                  <p className="text-sm font-semibold text-white">{imageFile ? "Processing image at full detail…" : "Generating G-code…"}</p>
                  <p className="ui-hint">Usually 5–15 seconds</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t text-[12px] flex flex-wrap gap-x-5 gap-y-1" style={{ borderColor: "var(--ui-line)", color: "var(--ui-text-3)" }}>
          <span className="inline-flex items-center gap-1.5"><Move size={12} />Drag the dashed box to move the drawing</span>
          <span className="inline-flex items-center gap-1.5"><Smile size={12} />Drag stickers to place them</span>
        </div>
      </section>

      {/* ── Controls panel ── */}
      <aside className="ui-panel overflow-hidden lg:sticky lg:top-24 min-w-0">
        {/* Primary action */}
        <div className="ui-section flex flex-col gap-2.5" style={{ background: "rgba(0,0,0,0.2)" }}>
          <button
            onClick={generateGcode}
            disabled={generating}
            className="ui-btn ui-btn-primary ui-btn-lg w-full"
          >
            {generating ? <><Loader2 size={17} className="animate-spin" />{imageFile ? "Processing image…" : "Generating…"}</> : <><Download size={17} />Generate G-code</>}
          </button>
          {onBack && (
            <button type="button" onClick={onBack} disabled={generating} className="ui-btn ui-btn-ghost ui-btn-sm w-full">
              <ArrowLeft size={13} />Back to drawing settings
            </button>
          )}
          {genError && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] text-red-200"
              style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }}>
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-red-400" />{genError}
            </div>
          )}
        </div>

        {/* Placement */}
        <div className="ui-section">
          <div className="flex items-center justify-between mb-3">
            <p className="ui-eyebrow">Drawing area</p>
            <span className="text-[11px] font-mono" style={{ color: "var(--ui-text-3)" }}>
              {Math.round(drawingArea.x)},{Math.round(drawingArea.y)} → {Math.round(drawingArea.x + drawingArea.width)},{Math.round(drawingArea.y + drawingArea.height)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "X offset", value: xInput, set: setXInput, commit: commitX, min: CLAMP[orientation].minX, max: CLAMP[orientation].maxX },
              { label: "Y offset", value: yInput, set: setYInput, commit: commitY, min: CLAMP[orientation].minY, max: CLAMP[orientation].maxY },
              { label: "Width", value: widthInput, set: setWidthInput, commit: commitWidth, min: CLAMP[orientation].minW, max: CLAMP[orientation].maxW },
              { label: "Height", value: heightInput, set: setHeightInput, commit: commitHeight, min: CLAMP[orientation].minH, max: CLAMP[orientation].maxH },
            ].map((f) => (
              <label key={f.label} className="ui-field">
                <span>{f.label}</span>
                <input
                  type="number"
                  value={f.value}
                  min={f.min}
                  max={f.max}
                  onChange={(e) => f.set(e.target.value)}
                  onBlur={() => f.commit(f.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") f.commit(f.value); }}
                  className="ui-input"
                />
                <span className="ui-unit">mm</span>
              </label>
            ))}
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-semibold text-white/85">Image size</span>
              <div className="flex items-center gap-2">
                {imageScale !== 100 && (
                  <button onClick={() => setImageScale(100)} className="text-[11px] font-semibold text-violet-300 hover:text-violet-200">Reset</button>
                )}
                <span className="ui-value">{imageScale}%</span>
              </div>
            </div>
            <input
              type="range" min={50} max={200} step={5} value={imageScale}
              onChange={(e) => setImageScale(Number(e.target.value))}
              className="ui-range" style={{ ["--fill" as string]: `${scaleFill}%` }} aria-label="Image size"
            />
            <p className="ui-hint mt-1.5">Above 100% the image grows past the drawing area and its edges are cut.</p>
          </div>
        </div>

        {/* Extras */}
        <div className="ui-section">
          <div className="ui-seg mb-4" role="tablist" aria-label="Decorations">
            {([
              { id: "border", label: "Border", icon: <Frame size={13} /> },
              { id: "text", label: "Text", icon: <Type size={13} /> },
              { id: "stickers", label: "Stickers", icon: <Smile size={13} /> },
            ] as const).map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)} className="ui-seg-btn">
                {tab.icon}{tab.label}
                {tab.id === "text" && textElements.length > 0 && <span className="ui-value !h-[18px] !min-w-[18px] !px-1 !text-[10px]">{textElements.length}</span>}
                {tab.id === "stickers" && stickerElements.length > 0 && <span className="ui-value !h-[18px] !min-w-[18px] !px-1 !text-[10px]">{stickerElements.length}</span>}
              </button>
            ))}
          </div>

          {/* Border tab */}
          {activeTab === "border" && (
            <div className="flex flex-col gap-4 ui-pop">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Border style">
                {(["none", "simple-rect", "rounded-rect", "double-line", "corner-marks", "dashed", "ornamental-corners"] as BorderStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={border.style === s}
                    onClick={() => setBorder((b) => ({ ...b, style: s }))}
                    className="ui-option !p-2.5 !gap-2.5 !items-center"
                  >
                    <BorderGlyph style={s} active={border.style === s} />
                    <span className="text-[12px] font-semibold capitalize text-white/85 leading-tight">{s.replace(/-/g, " ")}</span>
                  </button>
                ))}
              </div>
              {border.style !== "none" && (
                <>
                  <MiniSlider label="Margin" unit="mm" value={border.margin} min={0} max={20}
                    onChange={(v) => setBorder((b) => ({ ...b, margin: v }))} />
                  <MiniSlider label="Thickness" unit={border.thickness === 1 ? "pass" : "passes"} value={border.thickness} min={1} max={5}
                    onChange={(v) => setBorder((b) => ({ ...b, thickness: v }))} />
                </>
              )}
            </div>
          )}

          {/* Text tab */}
          {activeTab === "text" && (
            <div className="flex flex-col gap-3 ui-pop">
              <button onClick={addText} className="ui-btn w-full !border-dashed">
                <Plus size={14} />Add text
              </button>
              {textElements.map((el) => (
                <div key={el.id}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedTextId === el.id ? "border-indigo-400/50 bg-indigo-500/[0.07]" : "border-white/[0.07] bg-white/[0.02]"}`}
                  onClick={() => setSelectedTextId(el.id)}>
                  <input
                    value={el.text}
                    onChange={(e) => setTextElements((prev) => prev.map((t) => t.id === el.id ? { ...t, text: e.target.value } : t))}
                    className="ui-input !pr-3 mb-2"
                    aria-label="Text"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex gap-2">
                    <select value={el.font}
                      onChange={(e) => setTextElements((prev) => prev.map((t) => t.id === el.id ? { ...t, font: e.target.value as HersheyFontName } : t))}
                      className="ui-input flex-1 capitalize" aria-label="Font">
                      {HERSHEY_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <label className="ui-field w-24">
                      <input
                        type="number" min={4} max={50}
                        defaultValue={el.sizeMm}
                        key={`size-${el.id}`}
                        aria-label="Text size in mm"
                        onBlur={(e) => {
                          const v = Math.max(4, Math.min(50, Number(e.target.value) || 10));
                          setTextElements((prev) => prev.map((t) => t.id === el.id ? { ...t, sizeMm: v } : t));
                          e.target.value = String(v);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        className="ui-input" />
                      <span className="ui-unit">mm</span>
                    </label>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setTextElements((prev) => prev.filter((t) => t.id !== el.id)); }}
                    className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-red-300/70 hover:text-red-300 transition-colors">
                    <Trash2 size={12} />Remove
                  </button>
                </div>
              ))}
              {textElements.length === 0 && (
                <p className="ui-hint text-center py-3">Add a name, date or message — it's drawn with a single-stroke pen font.</p>
              )}
            </div>
          )}

          {/* Stickers tab */}
          {activeTab === "stickers" && (
            <div className="flex flex-col gap-4 ui-pop">
              {getStickerCategories().map((cat) => (
                <div key={cat}>
                  <p className="text-[11.5px] font-semibold capitalize mb-2" style={{ color: "var(--ui-text-3)" }}>{cat.replace(/-/g, " ")}</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {getStickersByCategory(cat as StickerCategory).map((sticker) => (
                      <button key={sticker.id} onClick={() => addSticker(sticker)}
                        title={`Add ${sticker.name}`} aria-label={`Add ${sticker.name}`}
                        className="aspect-square rounded-lg bg-white border border-transparent hover:border-violet-400 hover:scale-105 transition-all p-1.5 grid place-items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sticker.path} alt="" className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {stickerElements.length > 0 && (
                <button onClick={() => { setStickerElements([]); setSelectedStickerId(null); }}
                  className="ui-btn ui-btn-sm ui-btn-ghost self-start !text-red-300/80">
                  <Trash2 size={12} />Remove all stickers ({stickerElements.length})
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function MiniSlider({ label, unit, value, min, max, onChange }: { label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12.5px] font-semibold text-white/80">{label}</span>
        <span className="text-[12px] font-semibold text-violet-200 tabular-nums">{value} {unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="ui-range" style={{ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` }} aria-label={label} />
    </label>
  );
}

function BorderGlyph({ style, active }: { style: BorderStyle; active: boolean }) {
  const c = active ? "#c4b5fd" : "rgba(255,255,255,0.55)";
  const common = { fill: "none", stroke: c, strokeWidth: 1.6, strokeLinecap: "round" as const };
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" className="flex-shrink-0 rounded-md" style={{ background: "rgba(0,0,0,0.3)" }} aria-hidden="true">
      {style === "none" && <path d="M10 18 L24 8" {...common} strokeDasharray="2 3" />}
      {style === "simple-rect" && <rect x="5" y="4" width="24" height="18" {...common} />}
      {style === "rounded-rect" && <rect x="5" y="4" width="24" height="18" rx="4" {...common} />}
      {style === "double-line" && <><rect x="4" y="3" width="26" height="20" {...common} strokeWidth={1.2} /><rect x="7" y="6" width="20" height="14" {...common} strokeWidth={1.2} /></>}
      {style === "corner-marks" && <path d="M5 10V4h6M23 4h6v6M29 16v6h-6M11 22H5v-6" {...common} />}
      {style === "dashed" && <rect x="5" y="4" width="24" height="18" {...common} strokeDasharray="3 2.5" />}
      {style === "ornamental-corners" && <path d="M5 11c0-4 2-7 6-7M29 11c0-4-2-7-6-7M5 15c0 4 2 7 6 7M29 15c0 4-2 7-6 7M8 7.5a1.5 1.5 0 1 0 0.01 0M26 7.5a1.5 1.5 0 1 0 0.01 0M8 18.5a1.5 1.5 0 1 0 0.01 0M26 18.5a1.5 1.5 0 1 0 0.01 0" {...common} strokeWidth={1.4} />}
    </svg>
  );
}
