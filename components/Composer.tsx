"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { renderBorder, BorderConfig, BorderStyle, DrawingArea } from "@/lib/border-renderer";
import { renderText, HersheyFontName } from "@/lib/hershey-fonts";
import { STICKERS, StickerMeta, StickerCategory, getStickerCategories, getStickersByCategory } from "@/lib/sticker-data";
import {
  Artwork, Placement, Point, Polyline, artworkFromSvg, artworkSize, boxArtwork, constrainPlacement,
  fitPlacement, normalizeAngle, pageToMachine, parsePathD, rotatedExtents, svgTransform, toLocal, toMachine,
} from "@/lib/artwork-placement";
import { Download, Plus, ChevronRight, ChevronLeft, RotateCcw, RotateCw, Maximize2, Crosshair } from "lucide-react";

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

export interface ComposerProps {
  baseLayer: ComposerBaseLayer;
  settings: PlotterSettings;
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

// ─── Number input that commits on blur / Enter ───────────────────────────────

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const show = (n: number) => String(Math.round(n * 10) / 10);
  const [text, setText] = useState(show(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(show(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = parseFloat(text);
    if (Number.isFinite(n)) onCommit(n);
  };

  return (
    <label className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="text-[10px] text-white/40 truncate">{label}</span>
      <input
        type="number"
        step={0.5}
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full px-2 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white text-xs focus:outline-none focus:border-purple-500/50"
      />
    </label>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Composer({ baseLayer, settings, onGcodeReady }: ComposerProps) {
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

  // ── Visible region: the A4 sheet plus any part of the drawing area beyond it ──
  // (anything inside the drawing area gets plotted, so it must never be hidden)
  const view = useMemo(() => {
    const x0 = Math.min(0, drawingArea.x);
    const y0 = Math.min(0, drawingArea.y);
    const x1 = Math.max(a4.width, drawingArea.x + drawingArea.width);
    const y1 = Math.max(a4.height, drawingArea.y + drawingArea.height);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [a4.width, a4.height, drawingArea]);
  const areaOffSheet = view.width > a4.width || view.height > a4.height;

  // ── Scale factor: fit the visible region into the canvas panel ──
  const [pxPerMm, setPxPerMm] = useState(2.0);
  useEffect(() => {
    const updateScale = () => {
      const vw = window.innerWidth;
      const panelWidth = panelCollapsed ? vw * 0.95 : vw * 0.65;
      const maxH = window.innerHeight * 0.75;
      const scaleW = (panelWidth - 40) / view.width;
      const scaleH = maxH / view.height;
      setPxPerMm(Math.min(scaleW, scaleH));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [view.width, view.height, panelCollapsed]);

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

  // ── Base image artwork (parsed once per base layer) ────────────────────────
  const baseSvg = baseLayer.type === "svg" ? baseLayer.svg : "";
  const sketchUrl = baseLayer.type === "sketch" ? baseLayer.dataUrl : "";
  const [sketchSize, setSketchSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setSketchSize(null);
    if (!sketchUrl) return;
    const img = new Image();
    img.onload = () => setSketchSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.src = sketchUrl;
  }, [sketchUrl]);

  const artwork = useMemo<Artwork | null>(() => {
    if (baseSvg) return artworkFromSvg(baseSvg);
    if (sketchUrl && sketchSize) return boxArtwork(sketchSize.w, sketchSize.h);
    return null;
  }, [baseSvg, sketchUrl, sketchSize]);

  // All artwork strokes as one path — the preview only updates its transform while dragging
  const artworkPathD = useMemo(() => {
    if (!artwork) return "";
    return artwork.polylines
      .map((line) => "M" + line.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join("L"))
      .join("");
  }, [artwork]);

  // ── Image placement: position / size / rotation inside the drawing area ────
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [imageSelected, setImageSelected] = useState(false);
  const extents = useMemo(
    () => (artwork && placement ? rotatedExtents(artwork, placement.rotation) : null),
    [artwork, placement?.rotation], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Fit the image to the drawing area whenever a new image arrives
  useEffect(() => {
    setPlacement(artwork ? fitPlacement(artwork, drawingArea) : null);
  }, [artwork]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the image inside the drawing area when the area is resized
  useEffect(() => {
    if (!artwork) return;
    setPlacement((p) => (p ? constrainPlacement(p, drawingArea, rotatedExtents(artwork, p.rotation)) : p));
  }, [artwork, drawingArea.width, drawingArea.height]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply a placement change, clamped so the image never leaves the drawing area. */
  const applyPlacement = useCallback((next: Placement) => {
    if (!artwork) return;
    setPlacement(constrainPlacement(next, drawingArea, rotatedExtents(artwork, next.rotation)));
  }, [artwork, drawingArea]);

  const fitImage = useCallback(() => {
    if (artwork && placement) setPlacement(fitPlacement(artwork, drawingArea, placement.rotation));
  }, [artwork, placement, drawingArea]);

  const centerImage = useCallback(() => {
    if (!placement || !extents) return;
    applyPlacement({
      ...placement,
      cx: drawingArea.width / 2 - placement.scale * (extents.minX + extents.maxX) / 2,
      cy: drawingArea.height / 2 - placement.scale * (extents.minY + extents.maxY) / 2,
    });
  }, [placement, extents, drawingArea, applyPlacement]);

  const rotateImageBy = useCallback((deg: number) => {
    if (placement) applyPlacement({ ...placement, rotation: normalizeAngle(placement.rotation + deg) });
  }, [placement, applyPlacement]);

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
      let strokeCount = 0;
      let drawLen = 0;
      let travelLen = 0;
      let pen: Point = [drawingArea.x, drawingArea.y];

      // One pen-down stroke through machine-coordinate points
      const emitStroke = (pts: Point[]) => {
        if (pts.length < 2) return;
        travelLen += Math.hypot(pts[0][0] - pen[0], pts[0][1] - pen[1]);
        lines.push(`G0 X${fmt(pts[0][0])} Y${fmt(pts[0][1])} F${feedTravel}`);
        lines.push(`G0 Z${fmt(zDraw)} F${feedTravel}`);
        for (let i = 1; i < pts.length; i++) {
          drawLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          lines.push(`G1 X${fmt(pts[i][0])} Y${fmt(pts[i][1])} F${feedDraw}`);
        }
        lines.push(`G0 Z${fmt(zHop)} F${feedTravel}`);
        pen = pts[pts.length - 1];
        strokeCount++;
      };

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

      // Base image strokes — exactly what the preview shows (same placement transform)
      lines.push("; === IMAGE ===");
      if (artwork && placement) {
        lines.push(`; Image: ${(artworkSize(artwork).width * placement.scale).toFixed(1)}x${(artworkSize(artwork).height * placement.scale).toFixed(1)}mm, rotation ${placement.rotation.toFixed(1)}deg`);
        for (const line of artwork.polylines) {
          emitStroke(line.map((p) => toMachine(p, artwork, placement, drawingArea)));
        }
      }
      lines.push("");

      // Text elements
      lines.push("; === TEXT ===");
      textElements.forEach((el) => {
        const rendered = renderText(el.text, el.font as HersheyFontName, el.sizeMm, el.passes);
        rendered.svgPaths.forEach((pathStr) => {
          const dMatch = pathStr.match(/d="([^"]+)"/);
          if (!dMatch) return;
          parsePathD(dMatch[1]).forEach((line: Polyline) =>
            emitStroke(line.map(([gx, gy]) => pageToMachine([gx + el.x, gy + el.y], drawingArea))),
          );
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
          parsePathD(path.getAttribute("d") || "").forEach((line) =>
            emitStroke(line.map(([px, py]) => pageToMachine([el.x + px * scaleX, el.y + py * scaleY], drawingArea))),
          );
        });
      });

      // Footer
      lines.push("");
      lines.push("; === FOOTER ===");
      lines.push(`G0 Z${fmt(zHop + 5)} F${feedTravel} ; raise pen safely`);
      lines.push(`G0 X${fmt(drawingArea.x)} Y${fmt(drawingArea.y)} F${feedTravel} ; return to area origin`);
      lines.push("M84 ; disable motors");

      const gcode = lines.join("\n");
      const pathLengthMm = Math.round(drawLen);
      // Drawing + travel time, plus ~1s per pen lift/drop
      const estimatedTimeSeconds = Math.round((drawLen / feedDraw + travelLen / feedTravel) * 60 + strokeCount);

      onGcodeReady({ gcode, stats: { strokeCount, estimatedTimeSeconds, pathLengthMm } });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [textElements, stickerElements, settings, drawingArea, borderResult, artwork, placement, onGcodeReady]);

  // ── Image drag / resize / rotate on the canvas ─────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const imageDragRef = useRef<{ mode: "move" | "scale" | "rotate"; start: Point; orig: Placement; pointerId: number } | null>(null);

  useEffect(() => { setImageSelected(!!artwork); }, [artwork]);

  /** Screen position → page mm (the SVG viewBox is in page mm). */
  const toPagePoint = (clientX: number, clientY: number): Point | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [pt.x, pt.y];
  };

  const startImageDrag = (mode: "move" | "scale" | "rotate") => (e: React.PointerEvent) => {
    if (!placement || e.button !== 0) return;
    const start = toPagePoint(e.clientX, e.clientY);
    if (!start) return;
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    imageDragRef.current = { mode, start, orig: placement, pointerId: e.pointerId };
    setImageSelected(true);
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pt = toPagePoint(e.clientX, e.clientY);
    if (!pt) return;
    const { orig, start } = drag;
    const center: Point = [drawingArea.x + orig.cx, drawingArea.y + orig.cy];
    if (drag.mode === "move") {
      applyPlacement({ ...orig, cx: orig.cx + pt[0] - start[0], cy: orig.cy + pt[1] - start[1] });
    } else if (drag.mode === "scale") {
      const d0 = Math.hypot(start[0] - center[0], start[1] - center[1]);
      const d1 = Math.hypot(pt[0] - center[0], pt[1] - center[1]);
      if (d0 > 1e-6) applyPlacement({ ...orig, scale: (orig.scale * d1) / d0 });
    } else {
      const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
      const a1 = Math.atan2(pt[1] - center[1], pt[0] - center[0]);
      let rotation = orig.rotation + ((a1 - a0) * 180) / Math.PI;
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15; // Shift snaps to 15°
      applyPlacement({ ...orig, rotation: normalizeAngle(rotation) });
    }
  };

  const endImageDrag = (e: React.PointerEvent) => {
    if (imageDragRef.current?.pointerId !== e.pointerId) return;
    imageDragRef.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  // Selection frame + handles, in page mm
  const frame = useMemo(() => {
    if (!artwork || !placement) return null;
    const b = artwork.bounds;
    const corners = ([[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] as Point[])
      .map((p) => {
        const [lx, ly] = toLocal(p, artwork, placement);
        return [drawingArea.x + lx, drawingArea.y + ly] as Point;
      });
    const center: Point = [drawingArea.x + placement.cx, drawingArea.y + placement.cy];
    const topMid: Point = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    const len = Math.hypot(topMid[0] - center[0], topMid[1] - center[1]);
    const dir: Point = len > 1e-6 ? [(topMid[0] - center[0]) / len, (topMid[1] - center[1]) / len] : [0, -1];
    const reach = 22 / pxPerMm;
    const rotHandle: Point = [topMid[0] + dir[0] * reach, topMid[1] + dir[1] * reach];
    return { corners, topMid, rotHandle };
  }, [artwork, placement, drawingArea, pxPerMm]);

  // ── Canvas pixel dimensions ────────────────────────────────────────────────
  const canvasPx = { width: view.width * pxPerMm, height: view.height * pxPerMm };
  const px = (mmX: number, mmY: number) => ({ left: (mmX - view.x) * pxPerMm, top: (mmY - view.y) * pxPerMm });
  const handleR = 6 / pxPerMm;
  const imgW = artwork && placement ? artworkSize(artwork).width * placement.scale : 0;
  const imgH = artwork && placement ? artworkSize(artwork).height * placement.scale : 0;

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
            {generating ? "Generating…" : "Generate G-code"}
          </button>
        </div>

        {genError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300">
            {genError}
          </div>
        )}

        {/* A4 Canvas — everything is drawn in page mm, so the preview matches the G-code */}
        <div
          ref={canvasRef}
          className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/40 mx-auto bg-zinc-300"
          style={{ width: canvasPx.width, height: canvasPx.height }}
          aria-label={`A4 canvas ${orientation}`}
        >
          <svg
            ref={svgRef}
            className="absolute inset-0"
            style={{ width: canvasPx.width, height: canvasPx.height, touchAction: "none" }}
            viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
            onPointerDown={() => setImageSelected(false)}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endImageDrag}
            onPointerCancel={endImageDrag}
          >
            {/* A4 sheet */}
            <rect x={0} y={0} width={a4.width} height={a4.height} fill="white" />

            {/* Drawing area indicator */}
            <rect
              x={drawingArea.x} y={drawingArea.y} width={drawingArea.width} height={drawingArea.height}
              fill="none" stroke="rgba(96,165,250,0.6)" strokeWidth={1.5} strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke" pointerEvents="none"
            />

            {/* Base image layer */}
            {artwork && placement && (
              <g transform={svgTransform(artwork, placement, drawingArea)} pointerEvents="none">
                {artworkPathD && (
                  <path d={artworkPathD} fill="none" stroke="#111" strokeWidth={1}
                    strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                )}
                {!artworkPathD && sketchUrl && sketchSize && (
                  <image href={sketchUrl} x={0} y={0} width={sketchSize.w} height={sketchSize.h} preserveAspectRatio="none" />
                )}
              </g>
            )}

            {/* Border overlay */}
            {borderResult.svgPaths.map((p, i) => (
              <g key={i} pointerEvents="none" dangerouslySetInnerHTML={{ __html: p }} />
            ))}

            {/* Image hit area, selection frame and handles */}
            {frame && (
              <g>
                <polygon
                  points={frame.corners.map((c) => c.join(",")).join(" ")}
                  fill="transparent"
                  stroke={imageSelected ? "#a855f7" : "none"} strokeWidth={1.5}
                  strokeDasharray={imageSelected ? "4 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "move" }}
                  onPointerDown={startImageDrag("move")}
                />
                {imageSelected && (
                  <>
                    <line
                      x1={frame.topMid[0]} y1={frame.topMid[1]} x2={frame.rotHandle[0]} y2={frame.rotHandle[1]}
                      stroke="#a855f7" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none"
                    />
                    <circle
                      cx={frame.rotHandle[0]} cy={frame.rotHandle[1]} r={handleR}
                      fill="#a855f7" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                      style={{ cursor: "grab" }}
                      onPointerDown={startImageDrag("rotate")}
                    >
                      <title>Drag to rotate (hold Shift to snap to 15°)</title>
                    </circle>
                    {frame.corners.map((c, i) => (
                      <rect
                        key={i}
                        x={c[0] - handleR * 0.8} y={c[1] - handleR * 0.8} width={handleR * 1.6} height={handleR * 1.6}
                        fill="white" stroke="#a855f7" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                        style={{ cursor: i % 2 === 0 ? "nwse-resize" : "nesw-resize" }}
                        onPointerDown={startImageDrag("scale")}
                      >
                        <title>Drag to resize</title>
                      </rect>
                    ))}
                  </>
                )}
              </g>
            )}
          </svg>

          {/* Text elements */}
          {textElements.map((el) => {
            const rendered = renderText(el.text, el.font, el.sizeMm, 1);
            return (
              <div
                key={el.id}
                className={`absolute cursor-move select-none ${selectedTextId === el.id ? "ring-2 ring-blue-400" : ""}`}
                style={px(el.x, el.y)}
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
                ...px(el.x, el.y),
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

        {areaOffSheet && (
          <p className="text-[11px] text-amber-300/80 text-center">
            The drawing area extends past the A4 sheet (grey zone) — make sure your paper covers it, or shrink the area.
          </p>
        )}
        {!artwork && (
          <p className="text-[11px] text-white/40 text-center">No image strokes to place.</p>
        )}
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

            {/* Image placement controls */}
            {artwork && placement && extents && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#161616] p-4">
                <p className="text-xs font-bold text-white/60 mb-3 uppercase tracking-wider">Image</p>
                <div className="flex gap-2 mb-2">
                  <NumberField label="Width (mm)" value={imgW}
                    onCommit={(w) => applyPlacement({ ...placement, scale: w / artworkSize(artwork).width })} />
                  <NumberField label="Height (mm)" value={imgH}
                    onCommit={(h) => applyPlacement({ ...placement, scale: h / artworkSize(artwork).height })} />
                </div>
                <div className="flex gap-2 mb-2">
                  <NumberField label="X from area left (mm)" value={placement.cx + placement.scale * extents.minX}
                    onCommit={(v) => applyPlacement({ ...placement, cx: v - placement.scale * extents.minX })} />
                  <NumberField label="Y from area top (mm)" value={placement.cy + placement.scale * extents.minY}
                    onCommit={(v) => applyPlacement({ ...placement, cy: v - placement.scale * extents.minY })} />
                </div>
                <label className="flex flex-col gap-1 mb-2">
                  <span className="text-[10px] text-white/40">Rotation: {Math.round(placement.rotation)}°</span>
                  <input type="range" min={-180} max={180} step={1} value={Math.round(placement.rotation)}
                    onChange={(e) => applyPlacement({ ...placement, rotation: Number(e.target.value) })}
                    className="w-full accent-purple-500" />
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  <button onClick={() => rotateImageBy(-90)} title="Rotate 90° left"
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white">
                    <RotateCcw size={11} /> 90°
                  </button>
                  <button onClick={() => rotateImageBy(90)} title="Rotate 90° right"
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white">
                    <RotateCw size={11} /> 90°
                  </button>
                  <button onClick={fitImage} title="Make the image as large as the drawing area allows"
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white">
                    <Maximize2 size={11} /> Fit
                  </button>
                  <button onClick={centerImage} title="Center the image in the drawing area"
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white">
                    <Crosshair size={11} /> Center
                  </button>
                </div>
                <p className="text-[9px] text-white/25 mt-2">
                  Drag the image to move it, a corner to resize, the round handle to rotate. It always stays inside the drawing area, so nothing gets cut off.
                </p>
              </div>
            )}

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
