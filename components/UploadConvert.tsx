"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  ImagePlus, Upload, Download, Loader2, AlertCircle, CheckCircle2, Check,
  Layers, Pen, LayoutGrid, Copy, ChevronDown, ChevronUp, RefreshCw, Trash2,
  Sparkles, FileCode2, FileImage, Ruler, Route, Timer, PenTool, Printer,
  ArrowLeft, Wand2, SlidersHorizontal, RectangleVertical, RectangleHorizontal, Play, ZoomIn,
} from "lucide-react";
import GcodePreview, { GcodeInspector, parseGcode, formatDuration, formatDistance } from "@/components/GcodePreview";
import HeroArt from "@/components/HeroArt";
import { PROMPT_2MM, PROMPT_06MM } from "@/lib/prompts";

// ─── Types ────────────────────────────────────────────────────────────────────
type PenType = "2mm" | "0.6mm";
type DrawingMode = "single" | "multi" | "shading";
type Orientation = "portrait" | "landscape";

interface PlotterSettings {
  zDraw: number; zHop: number;
  feedDraw: number; feedTravel: number;
  canvasX: number; canvasY: number;
  offsetX: number; offsetY: number;
}

interface ProcessResult {
  gcode: string;
  sketchDataUrl: string | null;
  darknessMapUrl: string | null;
  strokesSvg?: string;
  stats: { strokeCount: number; estimatedTimeSeconds: number; pathLengthMm: number; };
  warning?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: PlotterSettings = {
  zDraw: 0.0, zHop: 3.0, feedDraw: 1500, feedTravel: 3000,
  canvasX: 200, canvasY: 160, offsetX: 20, offsetY: 40,
};

const PEN_OPTIONS: { id: PenType; label: string; desc: string; badge?: string }[] = [
  { id: "0.6mm", label: "0.6 mm fine liner", desc: "Maximum detail — eyes, eyebrows and dark areas are filled solid.", badge: "Recommended" },
  { id: "2mm", label: "2 mm marker", desc: "Bold, clean outlines. Fewer strokes, faster plots." },
];

const DRAWING_MODES: { id: DrawingMode; label: string; icon: React.ReactNode; desc: string; badge: string; badgeClass: string }[] = [
  { id: "single",  label: "Single",  icon: <Pen size={15} />,        desc: "One crisp line per feature",          badge: "Fastest",   badgeClass: "ui-badge-ok" },
  { id: "multi",   label: "Multi",   icon: <Layers size={15} />,     desc: "Extra passes where lines are thicker", badge: "≈ 2× time", badgeClass: "ui-badge-ink" },
  { id: "shading", label: "Shading", icon: <LayoutGrid size={15} />, desc: "Adds hatching in dark areas",          badge: "≈ 4× time", badgeClass: "ui-badge-terra" },
];

// ─── SVG direct passthrough (module-level) ───────────────────────────────────
// For SVG file uploads: sample all path elements using the browser's SVG engine,
// scale to plotter canvas coordinates, and return a G-code-compatible SVG.
// Uses negative-height viewBox to display right-side up in Composer (matching
// the Y-flip in buildStrokesSvg on the server).
async function processSvgFileDirect(
  f: File,
  canvasX: number, canvasY: number,
  offsetX: number, offsetY: number
): Promise<string> {
  const svgText = await f.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.documentElement;

  // Determine source coordinate space from viewBox or width/height
  let srcW = 0, srcH = 0;
  const vb = svgEl.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4) { srcW = parts[2]; srcH = parts[3]; }
  }
  if (!srcW) srcW = parseFloat(svgEl.getAttribute("width") || "0") || 500;
  if (!srcH) srcH = parseFloat(svgEl.getAttribute("height") || "0") || 500;

  // Scale+center to canvas, preserving aspect ratio
  const fitScale = Math.min(canvasX / srcW, canvasY / srcH);
  const padX = (canvasX - srcW * fitScale) / 2;
  const padY = (canvasY - srcH * fitScale) / 2;

  // Mount hidden live SVG in DOM so we can call getTotalLength / getPointAtLength
  const live = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  live.setAttribute("viewBox", `0 0 ${srcW} ${srcH}`);
  Object.assign(live.style, {
    position: "fixed", top: "-9999px", left: "-9999px",
    width: `${srcW}px`, height: `${srcH}px`, visibility: "hidden",
  });
  document.body.appendChild(live);

  const outPaths: string[] = [];
  try {
    const pathEls = Array.from(doc.querySelectorAll("path"));
    for (const el of pathEls) {
      const d = el.getAttribute("d");
      if (!d) continue;

      const p = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement;
      p.setAttribute("d", d);
      live.appendChild(p);

      const len = p.getTotalLength();
      const nSamples = Math.min(600, Math.max(2, Math.ceil(len)));
      const pts: string[] = [];

      for (let i = 0; i <= nSamples; i++) {
        const pt = p.getPointAtLength((i / nSamples) * len);
        // Flip Y: SVG Y-down → plotter Y-up (same convention as buildStrokesSvg)
        const mx = (pt.x * fitScale + padX + offsetX).toFixed(2);
        const my = ((srcH - pt.y) * fitScale + padY + offsetY).toFixed(2);
        pts.push(i === 0 ? `M${mx},${my}` : `L${mx},${my}`);
      }
      live.removeChild(p);

      if (pts.length >= 2) {
        outPaths.push(`<path d="${pts.join(" ")}" stroke="black" fill="none" stroke-width="0.5"/>`);
      }
    }
  } finally {
    document.body.removeChild(live);
  }

  // Y-flip via <g transform> — same convention as buildStrokesSvg on the server.
  const flipY = `scale(1,-1) translate(0,${-(2 * offsetY + canvasY)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${offsetX} ${offsetY} ${canvasX} ${canvasY}" width="100%" height="100%"><g transform="${flipY}">${outPaths.join("")}</g></svg>`;
}

// ─── Client-side auto-trace (module-level — no React state used) ─────────────
// Full Canny + contour tracing pipeline. Produces SVG paths in plotter mm coords.
async function clientSideAutoTrace(f: File, canvasX: number, canvasY: number): Promise<string> {
  const bitmap = await createImageBitmap(f);
  const maxDim = 800;
  const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * pixels[i*4] + 0.587 * pixels[i*4+1] + 0.114 * pixels[i*4+2];
  }

  const kernel5 = [1,4,7,4,1, 4,16,26,16,4, 7,26,41,26,7, 4,16,26,16,4, 1,4,7,4,1];
  const k5sum = 273;
  const blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          const nx = Math.max(0, Math.min(w-1, x+kx));
          const ny = Math.max(0, Math.min(h-1, y+ky));
          sum += gray[ny*w+nx] * kernel5[(ky+2)*5+(kx+2)];
        }
      }
      blurred[y*w+x] = sum / k5sum;
    }
  }

  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const gxv = -blurred[(y-1)*w+(x-1)] - 2*blurred[y*w+(x-1)] - blurred[(y+1)*w+(x-1)]
                 + blurred[(y-1)*w+(x+1)] + 2*blurred[y*w+(x+1)] + blurred[(y+1)*w+(x+1)];
      const gyv = -blurred[(y-1)*w+(x-1)] - 2*blurred[(y-1)*w+x] - blurred[(y-1)*w+(x+1)]
                 + blurred[(y+1)*w+(x-1)] + 2*blurred[(y+1)*w+x] + blurred[(y+1)*w+(x+1)];
      gx[y*w+x] = gxv; gy[y*w+x] = gyv;
      mag[y*w+x] = Math.sqrt(gxv*gxv + gyv*gyv);
    }
  }

  const nms = new Float32Array(w * h);
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const m = mag[y*w+x];
      if (m === 0) continue;
      const angle = Math.atan2(gy[y*w+x], gx[y*w+x]) * 180 / Math.PI;
      const a = ((angle % 180) + 180) % 180;
      let m1: number, m2: number;
      if (a < 22.5 || a >= 157.5)      { m1 = mag[y*w+(x-1)]; m2 = mag[y*w+(x+1)]; }
      else if (a < 67.5)               { m1 = mag[(y-1)*w+(x+1)]; m2 = mag[(y+1)*w+(x-1)]; }
      else if (a < 112.5)              { m1 = mag[(y-1)*w+x]; m2 = mag[(y+1)*w+x]; }
      else                             { m1 = mag[(y-1)*w+(x-1)]; m2 = mag[(y+1)*w+(x+1)]; }
      if (m >= m1 && m >= m2) nms[y*w+x] = m;
    }
  }

  let maxMag = 0;
  for (let i = 0; i < nms.length; i++) if (nms[i] > maxMag) maxMag = nms[i];
  const highT = maxMag * 0.12;
  const lowT  = highT * 0.4;

  const STRONG = 2, WEAK = 1;
  const edgeMap = new Uint8Array(w * h);
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= highT) edgeMap[i] = STRONG;
    else if (nms[i] >= lowT) edgeMap[i] = WEAK;
  }
  const queue: number[] = [];
  for (let i = 0; i < edgeMap.length; i++) if (edgeMap[i] === STRONG) queue.push(i);
  const dirs8 = [-w-1,-w,-w+1,-1,1,w-1,w,w+1];
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    for (const d of dirs8) {
      const ni = idx + d;
      if (ni >= 0 && ni < edgeMap.length && edgeMap[ni] === WEAK) {
        edgeMap[ni] = STRONG;
        queue.push(ni);
      }
    }
  }
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < edgeMap.length; i++) if (edgeMap[i] === STRONG) edges[i] = 1;

  const visited = new Uint8Array(w * h);
  const strokes: Array<Array<[number, number]>> = [];
  const get = (x: number, y: number) => x>=0&&x<w&&y>=0&&y<h ? edges[y*w+x] : 0;
  const dirs8xy: Array<[number,number]> = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

  const starts: Array<[number,number]> = [];
  const fallbacks: Array<[number,number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y*w+x]) continue;
      let n = 0;
      for (const [dx,dy] of dirs8xy) if (get(x+dx,y+dy)) n++;
      if (n <= 1) starts.push([x,y]);
      else fallbacks.push([x,y]);
    }
  }

  const traceFrom = (sx: number, sy: number) => {
    if (visited[sy*w+sx]) return;
    const stroke: Array<[number,number]> = [];
    let cx = sx, cy = sy, pdx = 0, pdy = 0;
    for (;;) {
      if (visited[cy*w+cx]) break;
      visited[cy*w+cx] = 1;
      stroke.push([cx, cy]);
      let bx = -1, by = -1, bScore = -Infinity;
      for (const [dx,dy] of dirs8xy) {
        const nx = cx+dx, ny = cy+dy;
        if (!get(nx,ny) || visited[ny*w+nx]) continue;
        const score = (pdx===0&&pdy===0) ? 0 : pdx*dx+pdy*dy;
        if (score > bScore) { bScore = score; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      pdx = bx-cx; pdy = by-cy; cx = bx; cy = by;
    }
    if (stroke.length >= 8) strokes.push(stroke);
  };

  for (const [sx,sy] of starts) traceFrom(sx, sy);
  for (const [sx,sy] of fallbacks) traceFrom(sx, sy);

  const simplify = (pts: Array<[number,number]>, eps: number): Array<[number,number]> => {
    if (pts.length <= 2) return pts;
    const [x1,y1] = pts[0], [x2,y2] = pts[pts.length-1];
    const len = Math.sqrt((x2-x1)**2+(y2-y1)**2);
    let maxD = 0, maxI = 0;
    for (let i = 1; i < pts.length-1; i++) {
      const [px,py] = pts[i];
      const d = len < 0.001
        ? Math.sqrt((px-x1)**2+(py-y1)**2)
        : Math.abs((y2-y1)*px-(x2-x1)*py+x2*y1-y2*x1)/len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) {
      const L = simplify(pts.slice(0, maxI+1), eps);
      const R = simplify(pts.slice(maxI), eps);
      return [...L.slice(0,-1), ...R];
    }
    return [pts[0], pts[pts.length-1]];
  };

  const scaleX = canvasX / w;
  const scaleY = canvasY / h;
  const paths: string[] = [];

  for (const stroke of strokes) {
    const simplified = simplify(stroke, 1.5);
    if (simplified.length < 2) continue;
    const parts: string[] = [];
    simplified.forEach(([px, py], i) => {
      const mx = (px * scaleX).toFixed(3);
      const my = (py * scaleY).toFixed(3);
      parts.push(i === 0 ? `M ${mx},${my}` : `L ${mx},${my}`);
    });
    paths.push(`<path d="${parts.join(" ")}" stroke="black" fill="none" stroke-width="0.3"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasX} ${canvasY}" width="100%" height="100%">${paths.join("")}</svg>`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const PROCESS_STEPS = [
  "Reading your image…",
  "Finding every line…",
  "Tracing centre-lines…",
  "Filling solid areas…",
  "Planning the pen path…",
];

// Browser history: one URL per step so the back button walks back through the app
const STEP_HASH = ["#/", "#/drawing", "#/layout", "#/export"];
function stepFromHash(hash: string): number | null {
  if (hash === "" || hash === "#" || hash === "#/") return 0;
  if (hash === "#/drawing") return 1;
  if (hash === "#/layout") return 2;
  if (hash === "#/export") return 3;
  return null; // another tab, or "#/convert" (= wherever you were)
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
const STEPS = ["Image", "Settings", "Layout", "Export"];

function Stepper({ current, onStep }: { current: number; onStep: (i: number) => void }) {
  return (
    <ol className="ui-steps ui-scroll-x" aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const clickable = i < current;
        return (
          <li key={label} className="flex items-center gap-1.5 flex-1 last:flex-none min-w-0">
            <button type="button" className="ui-step border border-transparent" data-state={state} disabled={!clickable}
              onClick={() => clickable && onStep(i)} aria-current={state === "current" ? "step" : undefined}
              title={clickable ? `Back to ${label}` : undefined}>
              <span className="ui-step-dot">{state === "done" ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="ui-step-line" data-done={i < current} />}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Slider with value pill ───────────────────────────────────────────────────
function Slider({ label, value, min, max, onChange, left, right, hint }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
  left?: string; right?: string; hint?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13.5px] font-semibold text-tx">{label}</span>
        <span className="ui-value">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="ui-range" style={{ ["--fill" as string]: `${fill}%` }} aria-label={label} />
      {(left || right) && (
        <div className="flex justify-between mt-1 text-[11.5px] text-tx3">
          <span>{left}</span><span>{right}</span>
        </div>
      )}
      {hint && <p className="ui-hint mt-1.5">{hint}</p>}
    </label>
  );
}

// ─── Prompt Panel ─────────────────────────────────────────────────────────────
function PromptPanel({ penType }: { penType: PenType }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const prompt = penType === "2mm" ? PROMPT_2MM : PROMPT_06MM;
  const lines = prompt.split("\n");
  const is2mm = penType === "2mm";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <section className="ui-panel overflow-hidden ui-rise ui-d4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center gap-4 px-5 sm:px-6 py-5 text-left hover:bg-[var(--ui-panel-2)] transition-colors">
        <div className="w-11 h-11 rounded-2xl grid place-items-center flex-shrink-0" style={{ background: "var(--ui-gold-soft)", border: "1px solid rgba(167,125,60,0.25)" }}>
          <Sparkles size={18} className="text-gold" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-serif-display text-[17px] font-semibold text-tx">Starting from a photo? Make it a clean sketch first.</p>
          <p className="ui-hint mt-0.5">
            Copy this ChatGPT prompt, attach your photo, then upload the sketch it returns —
            {" "}tuned for the {is2mm ? "2 mm marker (bold caricature)" : "0.6 mm fine liner (detailed portrait)"}.
          </p>
        </div>
        <ChevronDown size={18} className={`flex-shrink-0 text-tx3 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-5 sm:px-6 pb-6 ui-pop">
          <div className="relative rounded-2xl border" style={{ background: "var(--ui-panel-2)", borderColor: "var(--ui-line)" }}>
            <button onClick={handleCopy}
              className={`ui-btn ui-btn-sm absolute top-3 right-3 ${copied ? "!text-okc !border-[rgba(47,122,87,0.35)]" : ""}`}>
              {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy prompt"}
            </button>
            <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words p-5 pr-36 text-tx2">
              {expanded ? prompt : lines.slice(0, 6).join("\n") + (lines.length > 6 ? "\n…" : "")}
            </pre>
          </div>
          {lines.length > 6 && (
            <button onClick={() => setExpanded((v) => !v)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink hover:underline underline-offset-4">
              {expanded ? <><ChevronUp size={14} />Show less</> : <><ChevronDown size={14} />Show the full prompt</>}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Orientation glyphs ───────────────────────────────────────────────────────
function OrientationIcon({ o }: { o: Orientation }) {
  return o === "portrait" ? <RectangleVertical size={15} /> : <RectangleHorizontal size={15} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function UploadConvert({ settings = DEFAULT_SETTINGS, active = true }: { settings?: PlotterSettings; active?: boolean }) {
  // ── Upload & mode state ──────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ── Processing state ─────────────────────────────────────────────────────
  const [penType, setPenType] = useState<PenType>("0.6mm");
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("single");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [detailLevel, setDetailLevel] = useState(8);
  const [strokeWeight, setStrokeWeight] = useState(2);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // ── Pipeline stage state ─────────────────────────────────────────────────
  // "upload" → "composer" → "download"
  const [stage, setStage] = useState<"upload" | "composer" | "download">("upload");
  const [autoTraceSvg, setAutoTraceSvg] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [gcodeResult, setGcodeResult] = useState<{ gcode: string; stats: ProcessResult["stats"] } | null>(null);

  // ── Rating state ─────────────────────────────────────────────────────────
  const [showRating, setShowRating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Handle file selection ────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    // Validate file type
    const accepted = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/svg+xml"];
    const isSvg = f.type === "image/svg+xml" || f.name.toLowerCase().endsWith(".svg");
    if (!accepted.includes(f.type.toLowerCase()) && !isSvg) {
      setProcessError("Accepted file types: JPEG, PNG, WEBP, SVG");
      return;
    }

    setFile(f);
    setProcessError(null);
    setPreviewUrl(URL.createObjectURL(f));
    setStage("upload");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Process: AI Sketch path (existing pipeline with client-side fallback) ──
  const processAiSketch = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    setProcessError(null);

    // SVG files: extract paths directly — no rasterization or edge detection needed
    if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
      try {
        const svg = await processSvgFileDirect(
          file, settings.canvasX, settings.canvasY, settings.offsetX, settings.offsetY
        );
        setAutoTraceSvg(svg);
        setStage("composer");
      } catch (err) {
        setProcessError(err instanceof Error ? err.message : "SVG processing failed");
      } finally {
        setProcessing(false);
      }
      return;
    }

    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("penType", penType);
      fd.append("drawingMode", drawingMode);
      fd.append("orientation", orientation);
      fd.append("detail", String(detailLevel));
      fd.append("strokeWeight", String(strokeWeight));
      fd.append("settings", JSON.stringify({
        zDraw: settings.zDraw, zHop: settings.zHop,
        feedDraw: settings.feedDraw, feedTravel: settings.feedTravel,
        canvasX: settings.canvasX, canvasY: settings.canvasY,
        offsetX: settings.offsetX, offsetY: settings.offsetY,
      }));

      const res = await fetch("/api/process", { method: "POST", body: fd });
      if (res.ok) {
        const result: ProcessResult = await res.json();
        setProcessResult(result);
        setStage("composer");
        setProcessing(false);
        return;
      }
    } catch { /* fall through to client-side */ }

    // Client-side fallback: use Canny edge detection to produce sketch SVG
    // then pass it as the base layer to Composer
    try {
      const svg = await clientSideAutoTrace(file, settings.canvasX, settings.canvasY);
      setAutoTraceSvg(svg);
      setStage("composer");
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }, [file, penType, drawingMode, orientation, detailLevel, strokeWeight, settings]);

  // ── G-code ready ─────────────────────────────────────────────────────────
  const handleGcodeReady = useCallback((result: { gcode: string; stats: ProcessResult["stats"] }) => {
    setGcodeResult(result);
    setStage("download");
  }, []);

  // ── Download G-code ──────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!gcodeResult) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `plotter_${orientation}_${ts}.gcode`;
    const blob = new Blob([gcodeResult.gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowRating(true);
  }, [gcodeResult, orientation]);

  // ── Plotter settings adapter ─────────────────────────────────────────────
  const plotterSettings = {
    z_draw: settings.zDraw, z_hop: settings.zHop,
    feed_draw: settings.feedDraw, feed_travel: settings.feedTravel,
    canvas_x: settings.canvasX, canvas_y: settings.canvasY,
    offset_x: settings.offsetX, offset_y: settings.offsetY,
    detail_level: detailLevel,
  };

  // ── Base layer for Composer ──────────────────────────────────────────────
  // Prefer strokesSvg (mm-coordinate SVG from API) so Composer can include image strokes in G-code.
  // Fall back to client-side auto-trace SVG, then PNG preview.
  const composerBaseLayer = autoTraceSvg
    ? { type: "svg" as const, svg: autoTraceSvg }
    : processResult?.strokesSvg
      ? { type: "svg" as const, svg: processResult.strokesSvg }
      : processResult?.sketchDataUrl
        ? { type: "sketch" as const, dataUrl: processResult.sketchDataUrl }
        : { type: "sketch" as const, dataUrl: "" };

  // ── Processing params for Composer (to re-call API with updated drawing area) ──
  const composerProcessParams = {
    penType,
    drawingMode,
    orientation,
    detailLevel,
    strokeWeight,
  };

  // ── Session meta for rating ──────────────────────────────────────────────
  const sessionMeta = {
    upload_mode: "ai_sketch" as const,
    orientation,
    drawing_mode: drawingMode,
    detail_level: detailLevel,
    stroke_weight: strokeWeight,
    border_style: "rounded-rect",
    stroke_count: gcodeResult?.stats.strokeCount ?? 0,
    path_length_mm: gcodeResult?.stats.pathLengthMm ?? 0,
    estimated_time_s: gcodeResult?.stats.estimatedTimeSeconds ?? 0,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // UI-only state & helpers (no effect on processing or G-code)
  // ─────────────────────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const [imgMeta, setImgMeta] = useState<{ w: number; h: number } | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inspecting, setInspecting] = useState(false);

  useEffect(() => {
    if (!processing) { setStepIdx(0); return; }
    const t = setInterval(() => setStepIdx((i) => Math.min(i + 1, PROCESS_STEPS.length - 1)), 1800);
    return () => clearInterval(t);
  }, [processing]);

  useEffect(() => { if (stage !== "download") { setDownloaded(false); setPlaying(false); } }, [stage, gcodeResult]);

  const parsedGcode = useMemo(() => (gcodeResult ? parseGcode(gcodeResult.gcode) : null), [gcodeResult]);
  const onPlayEnd = useCallback(() => setPlaying(false), []);

  const currentStep = stage === "download" ? 3 : stage === "composer" ? 2 : file ? 1 : 0;

  const resetAll = () => {
    setStage("upload"); setFile(null); setPreviewUrl(null); setGcodeResult(null);
    setAutoTraceSvg(null); setProcessResult(null); setImgMeta(null); setProcessError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const goToStep = (i: number) => {
    if (i === 0) resetAll();
    else if (i === 1) setStage("upload");
    else if (i === 2) setStage("composer");
  };

  // ── Browser history: each step is its own entry, so Back walks back through the app ──
  const firstSync = useRef(true);
  useEffect(() => {
    if (!active) return;
    const desired = STEP_HASH[currentStep];
    const cur = window.location.hash;
    const curStep = stepFromHash(cur);
    if (firstSync.current || cur === "#/convert") {
      firstSync.current = false;
      if (curStep !== currentStep) window.history.replaceState(null, "", desired);
      return;
    }
    if (curStep !== currentStep) window.history.pushState(null, "", desired);
  }, [currentStep, active]);

  useEffect(() => {
    const onPop = () => {
      const t = stepFromHash(window.location.hash);
      if (t === null || t === currentStep) return;
      if (t < currentStep) {
        if (t === 0) resetAll();
        else if (t === 1) setStage("upload");
        else setStage("composer");
        window.scrollTo({ top: 0 });
      } else {
        const can = (t === 1 && !!file) || (t === 2 && !!(processResult || autoTraceSvg)) || (t === 3 && !!gcodeResult);
        if (can) setStage(t === 3 ? "download" : t === 2 ? "composer" : "upload");
        else window.history.replaceState(null, "", STEP_HASH[currentStep]);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }); // re-bind every render so the handler always sees the latest state

  const HEADINGS = [
    { title: <>Turn any sketch into a <em className="text-ink">hand‑plotted</em> drawing</>, sub: "Upload a line drawing or sketch. Every line is traced, solid areas are filled, and the pen path is planned for your Sovol SV02." },
    { title: <>Fine‑tune the <em className="text-ink">drawing</em></>, sub: "Choose your pen, style and level of detail, then convert." },
    { title: <>Lay out the <em className="text-ink">page</em></>, sub: "Position the drawing on the paper and add a border, text or stickers." },
    { title: <>Ready to <em className="text-terra">plot</em></>, sub: "This preview is exactly what the pen will draw. Watch it plot, inspect the detail, then download." },
  ];

  const isSvgFile = !!file && (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg"));

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-7 sm:gap-9 w-full">

      {/* ── Heading (+ hero art on the start page) ── */}
      {currentStep === 0 ? (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-8 lg:gap-14 items-center pt-2 sm:pt-4">
          <div className="min-w-0">
            <span className="ui-badge ui-badge-gold ui-rise">
              <Sparkles size={12} /> Pen plotting, made beautiful
            </span>
            <h2 className="ui-rise ui-d1 mt-5 font-serif-display text-[38px] sm:text-[54px] lg:text-[62px] leading-[1.02] font-semibold text-tx max-w-3xl">
              {HEADINGS[0].title}
            </h2>
            <p className="ui-rise ui-d2 mt-5 text-[15.5px] sm:text-[17px] leading-relaxed text-tx2 max-w-xl">
              {HEADINGS[0].sub}
            </p>
            <div className="ui-rise ui-d3 mt-7 flex flex-wrap gap-x-6 gap-y-3">
              {[
                { icon: <PenTool size={15} />, t: "Solid fills for eyes & fine detail" },
                { icon: <Route size={15} />, t: "Exact toolpath preview" },
                { icon: <Timer size={15} />, t: "Time & ink estimates" },
              ].map((f) => (
                <span key={f.t} className="inline-flex items-center gap-2 text-[13.5px] font-medium text-tx2">
                  <span className="w-7 h-7 rounded-full grid place-items-center text-ink" style={{ background: "var(--ui-ink-soft)" }}>{f.icon}</span>
                  {f.t}
                </span>
              ))}
            </div>
          </div>
          <div className="hidden sm:flex justify-center lg:justify-end ui-rise ui-d2 pr-2">
            <HeroArt />
          </div>
        </div>
      ) : (
        <div className="flex flex-col xl:flex-row xl:items-end gap-5 justify-between">
          <div className="min-w-0" key={currentStep}>
            <h2 className="ui-pop font-serif-display text-[32px] sm:text-[42px] leading-[1.05] font-semibold text-tx">
              {HEADINGS[currentStep].title}
            </h2>
            <p className="ui-pop mt-2 text-[15px] max-w-2xl text-tx2">{HEADINGS[currentStep].sub}</p>
          </div>
          <div className="xl:w-[560px] flex-shrink-0">
            <Stepper current={currentStep} onStep={goToStep} />
          </div>
        </div>
      )}

      {/* ── Stage: Upload & settings ── */}
      {stage === "upload" && (
        <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)] gap-6 items-start">

          {/* Left: image */}
          <div className="flex flex-col gap-4 min-w-0 ui-rise ui-d2">
            <div
              className={`ui-drop overflow-hidden ${previewUrl ? "" : "cursor-pointer"}`}
              data-drag={dragging}
              onDrop={(e) => { setDragging(false); handleDrop(e); }}
              onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
              onClick={() => { if (!previewUrl) fileInputRef.current?.click(); }}
              role={previewUrl ? undefined : "button"}
              tabIndex={previewUrl ? undefined : 0}
              onKeyDown={(e) => { if (!previewUrl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileInputRef.current?.click(); } }}
              aria-label={previewUrl ? undefined : "Upload an image"}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/svg+xml,.svg"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImgMeta(null); handleFile(f); } }}
              />

              {!previewUrl ? (
                <div className="flex flex-col items-center justify-center text-center px-6 py-14 sm:py-16 min-h-[340px] sm:min-h-[440px]">
                  <div className={`relative mb-6 transition-transform duration-300 ${dragging ? "scale-110 -rotate-3" : ""}`}>
                    <div className="absolute -inset-3 rounded-[28px] opacity-70 blur-xl" style={{ background: "radial-gradient(closest-side, rgba(47,58,140,0.25), transparent)" }} />
                    <div className="relative w-20 h-20 rounded-[24px] grid place-items-center"
                      style={{ background: "linear-gradient(160deg, #3a46a3, #27307a)", boxShadow: "0 1px 0 rgba(255,255,255,0.25) inset, 0 18px 34px -14px rgba(47,58,140,0.7)" }}>
                      <ImagePlus size={32} className="text-[#fdfaf3]" />
                    </div>
                  </div>
                  <p className="font-serif-display text-[26px] font-semibold text-tx">{dragging ? "Drop it right here" : "Drop your sketch here"}</p>
                  <p className="mt-1 text-[14px] text-tx3">or</p>
                  <span className="ui-btn ui-btn-primary ui-btn-lg mt-3 pointer-events-none !h-12">
                    <Upload size={16} /> Choose an image
                  </span>
                  <p className="mt-4 text-[12.5px] text-tx3 tracking-wide">JPEG · PNG · WEBP · SVG</p>

                  <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full max-w-xl text-left">
                    {[
                      { t: "Black lines on white", d: "Line art & sketches trace best" },
                      { t: "1000 px or larger", d: "More pixels, finer detail" },
                      { t: "Plain background", d: "No shadows or paper texture" },
                    ].map((tip) => (
                      <div key={tip.t} className="rounded-2xl px-4 py-3 border bg-[var(--ui-panel)]" style={{ borderColor: "var(--ui-line)" }}>
                        <p className="text-[13px] font-semibold text-tx flex items-center gap-1.5"><Check size={14} className="text-okc" />{tip.t}</p>
                        <p className="text-[12px] mt-0.5 text-tx3">{tip.d}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  {/* File bar */}
                  <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b bg-[var(--ui-panel)]" style={{ borderColor: "var(--ui-line)" }}>
                    <div className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: "var(--ui-ink-soft)" }}>
                      <FileImage size={17} className="text-ink" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-tx truncate">{file?.name ?? "Image"}</p>
                      <p className="text-[12px] text-tx3">
                        {[imgMeta ? `${imgMeta.w} × ${imgMeta.h} px` : null, file ? formatBytes(file.size) : null, isSvgFile ? "Vector — traced exactly" : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <button type="button" className="ui-btn ui-btn-sm" disabled={processing}
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                      <RefreshCw size={13} /><span className="hidden sm:inline">Replace</span>
                    </button>
                    <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" disabled={processing} aria-label="Remove image"
                      onClick={(e) => { e.stopPropagation(); goToStep(0); }}>
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* Preview */}
                  <div className="ui-stage !rounded-none !border-0 p-5 sm:p-9 flex items-center justify-center min-h-[320px] sm:min-h-[480px]">
                    <div className="ui-paper relative overflow-hidden p-2.5 sm:p-3.5 max-w-full ui-pop">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="Uploaded image preview"
                        onLoad={(e) => setImgMeta({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                        className={`block max-h-[300px] sm:max-h-[520px] w-auto max-w-full object-contain transition-[filter,opacity] duration-500 ${processing ? "sepia-[.35] opacity-80" : ""}`} />
                      {processing && <div className="ui-scanline" />}
                    </div>
                  </div>

                  {processing && (
                    <div className="flex items-center gap-3 px-5 py-3.5 border-t" style={{ borderColor: "var(--ui-line)", background: "var(--ui-ink-soft)" }} aria-live="polite">
                      <Loader2 size={16} className="animate-spin text-ink flex-shrink-0" />
                      <p key={stepIdx} className="text-[14px] font-semibold text-tx ui-fade">{PROCESS_STEPS[stepIdx]}</p>
                      <span className="ml-auto text-[12px] text-tx3">usually 5–15 s</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {processError && (
              <div role="alert" className="flex items-start gap-3 px-4 py-3.5 rounded-2xl border ui-pop"
                style={{ background: "var(--ui-err-soft)", borderColor: "rgba(176,58,46,0.25)" }}>
                <AlertCircle size={16} className="text-errc flex-shrink-0 mt-0.5" />
                <p className="text-[14px] text-errc">{processError}</p>
              </div>
            )}
          </div>

          {/* Right: settings */}
          <aside className="ui-panel lg:sticky lg:top-24 overflow-hidden min-w-0 ui-rise ui-d3">
            <div className="ui-panel-head">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal size={16} className="text-ink" />
                <span className="font-serif-display text-[18px] font-semibold text-tx">Drawing settings</span>
              </div>
              {isSvgFile && <span className="ui-badge ui-badge-ink">SVG — used as-is</span>}
            </div>

            <fieldset disabled={processing} className="contents">
              {/* Pen */}
              <div className="ui-section">
                <p className="ui-eyebrow mb-3">Pen</p>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Pen">
                  {PEN_OPTIONS.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={penType === p.id}
                      onClick={() => setPenType(p.id)} className="ui-option">
                      <span className="ui-radio" />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-[14px] font-semibold text-tx">{p.label}</span>
                          {p.badge && <span className="ui-badge ui-badge-gold">{p.badge}</span>}
                        </span>
                        <span className="block text-[12.5px] mt-0.5 text-tx3">{p.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Style */}
              <div className="ui-section">
                <p className="ui-eyebrow mb-3">Drawing style</p>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Drawing style">
                  {DRAWING_MODES.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={drawingMode === m.id}
                      onClick={() => setDrawingMode(m.id)} className="ui-option !items-center">
                      <span className={`w-9 h-9 rounded-xl grid place-items-center flex-shrink-0 transition-colors ${drawingMode === m.id ? "text-[#fdfaf3]" : "text-tx3"}`}
                        style={{ background: drawingMode === m.id ? "var(--ui-ink)" : "var(--ui-panel-2)" }}>
                        {m.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold text-tx">{m.label}</span>
                        <span className="block text-[12.5px] text-tx3">{m.desc}</span>
                      </span>
                      <span className={`ui-badge ${m.badgeClass}`}>{m.badge}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail */}
              <div className="ui-section flex flex-col gap-5">
                <Slider label="Detail level" value={detailLevel} min={1} max={10} onChange={setDetailLevel}
                  left="Cleaner" right="Finer detail" />
                <Slider label="Stroke weight" value={strokeWeight} min={1} max={5} onChange={setStrokeWeight}
                  left="Light" right="Heavy" hint="Used by the Multi and Shading styles." />
              </div>

              {/* Orientation */}
              <div className="ui-section">
                <p className="ui-eyebrow mb-3">Paper orientation</p>
                <div className="ui-seg">
                  {(["portrait", "landscape"] as Orientation[]).map((o) => (
                    <button key={o} type="button" aria-pressed={orientation === o} onClick={() => setOrientation(o)}
                      className="ui-seg-btn capitalize">
                      <OrientationIcon o={o} />{o}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>

            {/* Action */}
            <div className="ui-section ui-muted">
              <button onClick={processAiSketch} disabled={!file || processing} className="ui-btn ui-btn-primary ui-btn-lg ui-shine w-full">
                {processing ? <><Loader2 size={17} className="animate-spin" />Converting…</> : <><Wand2 size={17} />Convert to G-code</>}
              </button>
              <p className="ui-hint text-center mt-2.5">
                {!file ? "Upload an image to get started" : processing ? PROCESS_STEPS[stepIdx] : "Next you'll position it on the paper"}
              </p>
            </div>
          </aside>
        </div>
      )}

      {stage === "upload" && <PromptPanel penType={penType} />}

      {/* ── Stage: Composer (kept mounted on the export step so "Edit layout" keeps your layout) ── */}
      {(stage === "composer" || stage === "download") && (
        <div className={stage === "download" ? "hidden" : "ui-rise"}>
          <ComposerWrapper
            baseLayer={composerBaseLayer}
            settings={plotterSettings}
            imageFile={
              file && file.type !== "image/svg+xml" && !file.name.toLowerCase().endsWith(".svg")
                ? file
                : undefined
            }
            processParams={composerProcessParams}
            onGcodeReady={handleGcodeReady}
            onBack={() => setStage("upload")}
          />
        </div>
      )}

      {/* ── Stage: Download ── */}
      {stage === "download" && gcodeResult && parsedGcode && (
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,1fr)] gap-6 items-start">

          {/* Toolpath preview */}
          <section className="ui-panel overflow-hidden min-w-0 ui-rise ui-d1">
            <div className="ui-panel-head flex-wrap">
              <div className="flex items-center gap-2.5">
                <Route size={16} className="text-ink" />
                <span className="font-serif-display text-[18px] font-semibold text-tx">Toolpath preview</span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="ui-btn ui-btn-sm" disabled={playing}
                  onClick={() => { setPlaying(true); setPlayKey((k) => k + 1); }}>
                  {playing ? <><Loader2 size={13} className="animate-spin" />Plotting…</> : <><Play size={13} />Watch it plot</>}
                </button>
                <button type="button" className="ui-btn ui-btn-sm" onClick={() => setInspecting(true)}>
                  <ZoomIn size={13} />Inspect
                </button>
              </div>
            </div>
            <div className="ui-stage !rounded-none !border-0 p-5 sm:p-9">
              <button type="button" onClick={() => setInspecting(true)} className="block ui-paper p-2.5 sm:p-3.5 max-w-[720px] mx-auto w-full group" aria-label="Open the toolpath inspector">
                <GcodePreview parsed={parsedGcode} playKey={playKey} onPlayEnd={onPlayEnd} />
              </button>
              <p className="text-center mt-3 text-[12px] text-tx3">Click the drawing to zoom into every stroke</p>
            </div>
          </section>

          {/* Summary & actions */}
          <aside className="ui-panel overflow-hidden lg:sticky lg:top-24 min-w-0 ui-rise ui-d2">
            <div className="ui-section flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl grid place-items-center flex-shrink-0"
                style={{ background: "var(--ui-ok-soft)", border: "1px solid rgba(47,122,87,0.3)" }}>
                <svg className="ui-check" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.2 4.2L19 7" stroke="var(--ui-ok)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="font-serif-display text-[21px] font-semibold text-tx">Your G-code is ready</p>
                <p className="ui-hint">Generated for the Sovol SV02 · {orientation} paper</p>
              </div>
            </div>

            <div className="ui-section grid grid-cols-2 gap-2.5">
              {[
                { icon: <PenTool size={14} />, label: "Strokes", value: parsedGcode.stats.strokes.toLocaleString() },
                { icon: <Timer size={14} />, label: "Est. plot time", value: `≈ ${formatDuration(parsedGcode.stats.seconds)}` },
                { icon: <Ruler size={14} />, label: "Ink distance", value: formatDistance(parsedGcode.stats.drawMm) },
                { icon: <FileCode2 size={14} />, label: "File size", value: formatBytes(parsedGcode.stats.bytes) },
              ].map((s, i) => (
                <div key={s.label} className={`ui-stat ui-rise ui-d${i + 2}`}>
                  <div className="flex items-center gap-1.5 text-ink">{s.icon}<span className="ui-stat-label">{s.label}</span></div>
                  <p className="ui-stat-value mt-1.5">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="ui-section flex flex-col gap-2.5">
              <button onClick={() => { handleDownload(); setDownloaded(true); }} className="ui-btn ui-btn-terra ui-btn-lg ui-shine w-full">
                {downloaded ? <><CheckCircle2 size={18} />Download again</> : <><Download size={18} />Download G-code</>}
              </button>
              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={() => setStage("composer")} className="ui-btn">
                  <ArrowLeft size={15} />Edit layout
                </button>
                <button onClick={() => goToStep(0)} className="ui-btn">
                  <RefreshCw size={14} />New drawing
                </button>
              </div>
            </div>

            <div className="ui-section ui-muted">
              <p className="ui-eyebrow mb-3 flex items-center gap-1.5"><Printer size={13} />Before you plot</p>
              <ol className="flex flex-col gap-2.5">
                {[
                  "Copy the .gcode file to the printer's SD card.",
                  "Home X and Y only — never home Z with the pen mounted.",
                  "Lower the pen until it just touches the paper.",
                  "Start the print and watch the first few strokes.",
                ].map((t, i) => (
                  <li key={i} className="flex gap-3 text-[13.5px] text-tx2">
                    <span className="w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold flex-shrink-0 text-ink" style={{ background: "var(--ui-ink-soft)" }}>{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      )}

      {inspecting && parsedGcode && <GcodeInspector parsed={parsedGcode} onClose={() => setInspecting(false)} />}

      {/* ── Rating modal ── */}
      {showRating && gcodeResult && (
        <RatingModalWrapper
          sessionMeta={sessionMeta}
          onSubmit={() => setShowRating(false)}
          onSkip={() => setShowRating(false)}
        />
      )}
    </div>
  );
}

// ─── Lazy wrappers (avoid SSR issues with dynamic imports) ────────────────────

import dynamic from "next/dynamic";

const ComposerWrapper = dynamic(() => import("./Composer"), { ssr: false });
const RatingModalWrapper = dynamic(() => import("./RatingModal"), { ssr: false });
