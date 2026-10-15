"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { renderBorder, BorderConfig, BorderStyle, DrawingArea } from "@/lib/border-renderer";
import { renderText, HersheyFontName } from "@/lib/hershey-fonts";
import { STICKERS, StickerMeta, StickerCategory, getStickerCategories, getStickersByCategory } from "@/lib/sticker-data";
import { Download, Plus, Type, Layers, ChevronRight, ChevronLeft, RotateCcw } from "lucide-react";

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

export default function Composer({ baseLayer, settings, imageFile, processParams, onGcodeReady }: ComposerProps) {
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
  // Drag state for stickers
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // ── A4 dimensions ──────────────────────────────────────────────────────────
  const a4 = orientation === "portrait" ? A4_PORTRAIT : A4_LANDSCAPE;

  // ── Scale factor: fit A4 into canvas panel — recalculates on orientation change ──
  const [pxPerMm, setPxPerMm] = useState(2.0);
  useEffect(() => {
    const updateScale = () => {
      const vw = window.innerWidth;
      const panelWidth = panelCollapsed ? vw * 0.95 : vw * 0.65;
      const maxH = window.innerHeight * 0.75;
      const scaleW = (panelWidth - 40) / a4.width;
      const scaleH = maxH / a4.height;
      setPxPerMm(Math.min(scaleW, scaleH));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [a4.width, a4.height, panelCollapsed, orientation]); // orientation triggers recalc

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
    doc.querySelectorAll("path").forEach((path) => {
      const d = path.getAttribute("d") || "";
      const pts = parseSvgPathD(d);
      if (pts.length < 2) return;
      lines.push(`G0 X${fmt(pts[0][0])} Y${fmt(pts[0][1])} F${feedTravel}`);
      lines.push(`G0 Z${fmt(zDraw)} F${feedTravel}`);
      for (let i = 1; i < pts.length; i++) {
        lines.push(`G1 X${fmt(pts[i][0])} Y${fmt(pts[i][1])} F${feedDraw}`);
      }
      lines.push(`G0 Z${fmt(zHop)} F${feedTravel}`);
    });
    return lines;
  }, []);

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
              lines.push(...svgToGcodeLines(result.strokesSvg, fmt, zDraw, zHop, feedDraw, feedTravel));
            }
          } else {
            // API failed — fall back to existing base layer
            if (baseLayer.type === "svg" && baseLayer.svg) {
              lines.push(...svgToGcodeLines(baseLayer.svg, fmt, zDraw, zHop, feedDraw, feedTravel));
            }
          }
        } catch {
          // Network error — fall back to existing base layer
          if (baseLayer.type === "svg" && baseLayer.svg) {
            lines.push(...svgToGcodeLines(baseLayer.svg, fmt, zDraw, zHop, feedDraw, feedTravel));
          }
        }
      } else if (baseLayer.type === "svg" && baseLayer.svg) {
        // No imageFile prop — use the base layer SVG paths directly
        lines.push(...svgToGcodeLines(baseLayer.svg, fmt, zDraw, zHop, feedDraw, feedTravel));
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
  }, [textElements, stickerElements, settings, drawingArea, baseLayer, borderResult, imageFile, processParams, svgToGcodeLines, onGcodeReady]);

  // ── Canvas pixel dimensions ────────────────────────────────────────────────
  const canvasPx = { width: a4.width * pxPerMm, height: a4.height * pxPerMm };
  const daPx = {
    x: drawingArea.x * pxPerMm,
    y: drawingArea.y * pxPerMm,
    width: drawingArea.width * pxPerMm,
    height: drawingArea.height * pxPerMm,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-4 w-full">
      {/* ── Canvas area ── */}
      <div className={`flex flex-col gap-3 ${panelCollapsed ? "flex-1" : "w-[65%]"} transition-all duration-200`}>
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={toggleOrientation}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white/[0.06] border border-white/[0.10] text-white/70 hover:bg-white/[0.10] hover:text-white transition-all"
          >
            <RotateCcw size={12} />
            {orientation === "portrait" ? "Portrait" : "Landscape"}
          </button>
          <span className="text-xs text-white/30">1 mm = {pxPerMm.toFixed(1)} px</span>
          <div className="flex-1" />
          <button
            onClick={generateGcode}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/20"
          >
            <Download size={12} />
            {generating ? (imageFile ? "Processing image…" : "Generating…") : "Generate G-code"}
          </button>
        </div>

        {genError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300">
            {genError}
          </div>
        )}

        {/* A4 Canvas */}
        <div
          ref={canvasRef}
          className="relative bg-white rounded-xl overflow-hidden shadow-2xl shadow-black/40 mx-auto"
          style={{ width: canvasPx.width, height: canvasPx.height }}
          aria-label={`A4 canvas ${orientation}`}
        >
          {/* Drawing area indicator */}
          <div
            className="absolute border-2 border-dashed border-blue-400/50 pointer-events-none"
            style={{
              left: daPx.x,
              top: daPx.y,
              width: daPx.width,
              height: daPx.height,
            }}
          />

          {/* Base image layer */}
          {baseLayer.type === "svg" && baseLayer.svg && (
            <div
              className="absolute pointer-events-none"
              style={{ left: daPx.x, top: daPx.y, width: daPx.width, height: daPx.height }}
              dangerouslySetInnerHTML={{ __html: baseLayer.svg }}
            />
          )}
          {baseLayer.type === "sketch" && baseLayer.dataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={baseLayer.dataUrl}
              alt="Base sketch"
              className="absolute object-contain pointer-events-none"
              style={{ left: daPx.x, top: daPx.y, width: daPx.width, height: daPx.height }}
            />
          )}

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
                className={`absolute cursor-move select-none ${selectedTextId === el.id ? "ring-2 ring-blue-400" : ""}`}
                style={{ left: el.x * pxPerMm, top: el.y * pxPerMm }}
                onClick={() => setSelectedTextId(el.id)}
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
              className={`absolute cursor-move select-none ${selectedStickerId === el.id ? "ring-2 ring-purple-400 rounded" : ""}`}
              style={{
                left: el.x * pxPerMm,
                top: el.y * pxPerMm,
                width: el.width * pxPerMm,
                height: el.height * pxPerMm,
                touchAction: "none",
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
      </div>

      {/* ── Controls panel ── */}
      <div className={`flex flex-col gap-3 transition-all duration-200 ${panelCollapsed ? "w-10" : "flex-1 min-w-[280px]"}`}>
        {/* Collapse toggle */}
        <button
          onClick={() => setPanelCollapsed((v) => !v)}
          className="self-start p-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.10] transition-all"
          aria-label={panelCollapsed ? "Expand controls" : "Collapse controls"}
        >
          {panelCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {!panelCollapsed && (
          <>
            {/* Drawing area controls */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#161616] p-4">
              <p className="text-xs font-bold text-white/60 mb-3 uppercase tracking-wider">Drawing Area</p>
              <div className="flex gap-2 mb-2">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] text-white/40">X Offset (mm)</span>
                  <input
                    type="number"
                    value={xInput}
                    min={CLAMP[orientation].minX}
                    max={CLAMP[orientation].maxX}
                    onChange={(e) => setXInput(e.target.value)}
                    onBlur={() => commitX(xInput)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitX(xInput); }}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white text-xs focus:outline-none focus:border-purple-500/50"
                  />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] text-white/40">Y Offset (mm)</span>
                  <input
                    type="number"
                    value={yInput}
                    min={CLAMP[orientation].minY}
                    max={CLAMP[orientation].maxY}
                    onChange={(e) => setYInput(e.target.value)}
                    onBlur={() => commitY(yInput)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitY(yInput); }}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white text-xs focus:outline-none focus:border-purple-500/50"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] text-white/40">Width (mm)</span>
                  <input
                    type="number"
                    value={widthInput}
                    min={CLAMP[orientation].minW}
                    max={CLAMP[orientation].maxW}
                    onChange={(e) => setWidthInput(e.target.value)}
                    onBlur={() => commitWidth(widthInput)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitWidth(widthInput); }}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white text-xs focus:outline-none focus:border-purple-500/50"
                  />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] text-white/40">Height (mm)</span>
                  <input
                    type="number"
                    value={heightInput}
                    min={CLAMP[orientation].minH}
                    max={CLAMP[orientation].maxH}
                    onChange={(e) => setHeightInput(e.target.value)}
                    onBlur={() => commitHeight(heightInput)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitHeight(heightInput); }}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white text-xs focus:outline-none focus:border-purple-500/50"
                  />
                </label>
              </div>
              <p className="text-[9px] text-white/25 mt-2">
                {drawingArea.x},{drawingArea.y} → {drawingArea.x + drawingArea.width},{drawingArea.y + drawingArea.height} mm
              </p>
            </div>

            {/* Tab bar */}
            <div className="flex rounded-xl bg-white/[0.04] border border-white/[0.06] p-1 gap-1">
              {(["border", "text", "stickers"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                    activeTab === tab
                      ? "bg-white/[0.10] text-white"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Border tab */}
            {activeTab === "border" && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#161616] p-4 flex flex-col gap-3">
                <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Border Style</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["none", "simple-rect", "rounded-rect", "double-line", "corner-marks", "dashed", "ornamental-corners"] as BorderStyle[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setBorder((b) => ({ ...b, style: s }))}
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold capitalize transition-all border ${
                        border.style === s
                          ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                          : "bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80"
                      }`}
                    >
                      {s.replace(/-/g, " ")}
                    </button>
                  ))}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-white/40">Margin (mm): {border.margin}</span>
                  <input type="range" min={0} max={20} value={border.margin}
                    onChange={(e) => setBorder((b) => ({ ...b, margin: Number(e.target.value) }))}
                    className="w-full accent-purple-500" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-white/40">Thickness (passes): {border.thickness}</span>
                  <input type="range" min={1} max={5} value={border.thickness}
                    onChange={(e) => setBorder((b) => ({ ...b, thickness: Number(e.target.value) }))}
                    className="w-full accent-purple-500" />
                </label>
              </div>
            )}

            {/* Text tab */}
            {activeTab === "text" && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#161616] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Text Elements</p>
                  <button onClick={addText}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-all">
                    <Plus size={10} /> Add Text
                  </button>
                </div>
                {textElements.map((el) => (
                  <div key={el.id}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedTextId === el.id ? "border-blue-500/40 bg-blue-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}
                    onClick={() => setSelectedTextId(el.id)}>
                    <input
                      value={el.text}
                      onChange={(e) => setTextElements((prev) => prev.map((t) => t.id === el.id ? { ...t, text: e.target.value } : t))}
                      className="w-full bg-transparent text-white text-xs font-semibold focus:outline-none mb-2"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex gap-2">
                      <select value={el.font}
                        onChange={(e) => setTextElements((prev) => prev.map((t) => t.id === el.id ? { ...t, font: e.target.value as HersheyFontName } : t))}
                        className="flex-1 bg-white/[0.06] border border-white/[0.10] text-white text-[10px] rounded-lg px-2 py-1 focus:outline-none">
                        {HERSHEY_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <input
                        type="number" min={4} max={50}
                        defaultValue={el.sizeMm}
                        key={`size-${el.id}`}
                        onBlur={(e) => {
                          const v = Math.max(4, Math.min(50, Number(e.target.value) || 10));
                          setTextElements((prev) => prev.map((t) => t.id === el.id ? { ...t, sizeMm: v } : t));
                          e.target.value = String(v);
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        className="w-14 bg-white/[0.06] border border-white/[0.10] text-white text-[10px] rounded-lg px-2 py-1 focus:outline-none" />
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setTextElements((prev) => prev.filter((t) => t.id !== el.id)); }}
                      className="mt-2 text-[10px] text-red-400/60 hover:text-red-400 transition-colors">Remove</button>
                  </div>
                ))}
                {textElements.length === 0 && (
                  <p className="text-xs text-white/30 text-center py-4">No text elements yet</p>
                )}
              </div>
            )}

            {/* Stickers tab */}
            {activeTab === "stickers" && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#161616] p-4 flex flex-col gap-3">
                <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Sticker Library</p>
                {getStickerCategories().map((cat) => (
                  <div key={cat}>
                    <p className="text-[10px] text-white/40 capitalize mb-1.5">{cat.replace(/-/g, " ")}</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {getStickersByCategory(cat as StickerCategory).map((sticker) => (
                        <button key={sticker.id} onClick={() => addSticker(sticker)}
                          title={sticker.name}
                          className="aspect-square rounded-lg bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] hover:border-purple-500/30 transition-all p-1.5 flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={sticker.path} alt={sticker.name} className="w-full h-full object-contain" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
