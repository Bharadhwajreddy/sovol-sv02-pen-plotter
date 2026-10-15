"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  ImageIcon, Download, Loader2, AlertCircle,
  CheckCircle2, Layers, Pen, LayoutGrid,
  Copy, ChevronDown, ChevronUp, Zap, RotateCw, ScanLine,
  Sparkles, FileCode2, Clock, Ruler, ArrowRight,
} from "lucide-react";
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

const DRAWING_MODES: { id: DrawingMode; label: string; icon: React.ReactNode; desc: string; badge: string; badgeColor: string; accentColor: string }[] = [
  {
    id: "single",
    label: "Single",
    icon: <Pen size={14} />,
    desc: "One centerline per feature. Fastest output.",
    badge: "Fast",
    badgeColor: "text-emerald-400",
    accentColor: "rgba(16,185,129,0.12)",
  },
  {
    id: "multi",
    label: "Multi",
    icon: <Layers size={14} />,
    desc: "Parallel passes for stroke weight.",
    badge: "2× slower",
    badgeColor: "text-blue-400",
    accentColor: "rgba(59,130,246,0.12)",
  },
  {
    id: "shading",
    label: "Shading",
    icon: <LayoutGrid size={14} />,
    desc: "Hatching fills dark areas.",
    badge: "4× slower",
    badgeColor: "text-amber-400",
    accentColor: "rgba(245,158,11,0.12)",
  },
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

function formatTime(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

// ─── Section Label ────────────────────────────────────────────────────────────
function SectionLabel({ num, label, gradient }: { num: number; label: string; gradient: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white flex-shrink-0"
        style={{ background: gradient }}>
        {num}
      </div>
      <span className="text-sm font-bold text-white tracking-tight">{label}</span>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${className}`}
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      {children}
    </div>
  );
}

// ─── Prompt Panel ─────────────────────────────────────────────────────────────
function PromptPanel({ penType }: { penType: PenType }) {
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
    <Card>
      <div className="px-5 py-4 flex items-center justify-between border-b"
        style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: is2mm ? "rgba(59,130,246,0.12)" : "rgba(245,158,11,0.12)" }}>
            <Sparkles size={15} className={is2mm ? "text-blue-400" : "text-amber-400"} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-white">
                {is2mm ? "ChatGPT Prompt — 2mm Caricature" : "ChatGPT Prompt — 0.6mm Portrait"}
              </p>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                style={is2mm
                  ? { color: "#60a5fa", background: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.2)" }
                  : { color: "#fbbf24", background: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.2)" }}>
                Optimized for pen plotting
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {is2mm ? "Bold clean lines for caricature style" : "Exact fine-line replication for portraits"}
            </p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 text-xs px-3.5 py-2 rounded-xl font-semibold transition-all border flex-shrink-0"
          style={copied
            ? { background: "rgba(16,185,129,0.12)", color: "#34d399", borderColor: "rgba(16,185,129,0.25)" }
            : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", borderColor: "var(--border)" }}>
          {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="p-5">
        <div className="rounded-xl p-4 border" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.04)" }}>
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: "rgba(255,255,255,0.45)" }}>
            {expanded ? prompt : lines.slice(0, 4).join("\n") + (lines.length > 4 ? "\n..." : "")}
          </pre>
        </div>
        {lines.length > 4 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold transition-colors"
            style={{ color: "#a78bfa" }}>
            {expanded ? <><ChevronUp size={12} />Hide prompt</> : <><ChevronDown size={12} />Show full prompt</>}
          </button>
        )}
      </div>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function UploadConvert({ settings = DEFAULT_SETTINGS }: { settings?: PlotterSettings }) {
  // ── Upload & mode state ──────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<"raw_photo" | "ai_sketch">("ai_sketch");
  const [classifying, setClassifying] = useState(false);
  const [classifyConfidence, setClassifyConfidence] = useState<number | null>(null);
  const [manualOverride, setManualOverride] = useState(false);

  // ── Processing state ─────────────────────────────────────────────────────
  const [penType, setPenType] = useState<PenType>("2mm");
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("single");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [detailLevel, setDetailLevel] = useState(8);
  const [strokeWeight, setStrokeWeight] = useState(2);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // ── Pipeline stage state ─────────────────────────────────────────────────
  // "upload" → "svg-editor" (raw photo) → "composer" → "download"
  // "upload" → "composer" (ai sketch) → "download"
  const [stage, setStage] = useState<"upload" | "svg-editor" | "composer" | "download">("upload");
  const [autoTraceSvg, setAutoTraceSvg] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [gcodeResult, setGcodeResult] = useState<{ gcode: string; stats: ProcessResult["stats"] } | null>(null);

  // ── Rating state ─────────────────────────────────────────────────────────
  const [showRating, setShowRating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load last upload mode from localStorage ──────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("last_upload_mode") as "raw_photo" | "ai_sketch" | null;
    if (saved) setUploadMode(saved);
  }, []);

  // ── Persist upload mode ──────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("last_upload_mode", uploadMode);
  }, [uploadMode]);

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
    setManualOverride(false);
    setClassifyConfidence(null);
    setStage("upload");

    // SVG files are always AI sketches — skip classification
    if (isSvg) {
      setUploadMode("ai_sketch");
      setClassifyConfidence(1.0);
      return;
    }

    // Auto-classify — try API first, fall back to client-side heuristic
    setClassifying(true);
    try {
      const fd = new FormData();
      fd.append("image", f);
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setUploadMode(data.mode);
        setClassifyConfidence(data.confidence);
      } else {
        // API unavailable (Python not on Vercel) — use client-side heuristic
        await classifyClientSide(f);
      }
    } catch {
      // Network error — use client-side heuristic
      await classifyClientSide(f);
    } finally {
      setClassifying(false);
    }
  }, []);

  // Client-side image classification using Canvas API (no Python needed)
  const classifyClientSide = useCallback(async (f: File) => {
    try {
      const bitmap = await createImageBitmap(f);
      const canvas = document.createElement("canvas");
      const size = 64; // sample at 64x64 for speed
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // Compute per-channel std dev (R, G, B)
      const channels = [0, 1, 2].map((c) => {
        const vals = Array.from({ length: size * size }, (_, i) => data[i * 4 + c]);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
        return Math.sqrt(variance);
      });
      const meanChannelStd = channels.reduce((a, b) => a + b, 0) / 3;

      // Compute grayscale histogram std dev
      const hist = new Array(256).fill(0);
      for (let i = 0; i < size * size; i++) {
        const gray = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
        hist[gray]++;
      }
      const histMean = hist.reduce((a, b) => a + b, 0) / 256;
      const histStd = Math.sqrt(hist.reduce((a, b) => a + (b - histMean) ** 2, 0) / 256);

      const isRawPhoto = meanChannelStd > 15 || histStd > 40;
      const mode = isRawPhoto ? "raw_photo" : "ai_sketch";
      const confidence = Math.min(1.0, Math.max(meanChannelStd, histStd / 40) / 30);

      setUploadMode(mode as "raw_photo" | "ai_sketch");
      setClassifyConfidence(confidence);
    } catch {
      // If canvas fails, default to ai_sketch
      setUploadMode("ai_sketch");
    }
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

  // ── Process: Raw Photo path (auto-trace with client-side fallback) ──────────
  const processRawPhoto = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    setProcessError(null);

    try {
      // Try server-side auto-trace first
      const fd = new FormData();
      fd.append("image", file);
      fd.append("settings", JSON.stringify({
        canvas_x: settings.canvasX, canvas_y: settings.canvasY,
        offset_x: settings.offsetX, offset_y: settings.offsetY,
      }));

      const res = await fetch("/api/autotrace", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setAutoTraceSvg(data.svg);
        setStage("svg-editor");
        return;
      }
    } catch { /* fall through to client-side */ }

    // Client-side fallback: use Canvas API for edge detection
    try {
      const svg = await clientSideAutoTrace(file, settings.canvasX, settings.canvasY);
      setAutoTraceSvg(svg);
      setStage("svg-editor");
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : "Auto-trace failed");
    } finally {
      setProcessing(false);
    }
  }, [file, settings]);

  // ── Route to correct pipeline ────────────────────────────────────────────
  const handleProcess = useCallback(() => {
    if (uploadMode === "raw_photo") {
      processRawPhoto();
    } else {
      processAiSketch();
    }
  }, [uploadMode, processRawPhoto, processAiSketch]);

  // ── SVG Editor → Composer ────────────────────────────────────────────────
  const handleSvgEditorProceed = useCallback((cleanedSvg: string) => {
    setAutoTraceSvg(cleanedSvg);
    setStage("composer");
  }, []);

  // ── G-code ready ─────────────────────────────────────────────────────────
  const handleGcodeReady = useCallback((result: { gcode: string; stats: ProcessResult["stats"] }) => {
    setGcodeResult(result);
    setStage("download");
  }, []);

  // ── Download G-code ──────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!gcodeResult) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `plotter_${uploadMode}_${orientation}_${ts}.gcode`;
    const blob = new Blob([gcodeResult.gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowRating(true);
  }, [gcodeResult, uploadMode, orientation]);

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
    upload_mode: uploadMode,
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
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">

      {/* ── Stage: Upload ── */}
      {stage === "upload" && (
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Canvas-first: upload area takes 65% on desktop */}
          <div className="flex flex-col gap-5 lg:w-[65%]">
            <SectionLabel num={1} label="Upload Image" gradient="linear-gradient(135deg,#7c3aed,#2563eb)" />

            {/* Upload zone */}
            <Card>
              <div
                className="p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all"
                style={{ minHeight: 220 }}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Preview" className="max-h-48 max-w-full rounded-xl object-contain" />
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ background: "rgba(124,58,237,0.12)" }}>
                      <ImageIcon size={24} className="text-purple-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-white">Drop image here or click to browse</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>JPEG, PNG, WEBP, SVG accepted</p>
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/svg+xml,.svg"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>
            </Card>

            {/* Mode indicator */}
            {file && (
              <Card>
                <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    {classifying ? (
                      <Loader2 size={14} className="animate-spin text-purple-400" />
                    ) : (
                      <div className={`w-2 h-2 rounded-full ${uploadMode === "raw_photo" ? "bg-amber-400" : "bg-emerald-400"}`} />
                    )}
                    <span className="text-sm font-semibold text-white">
                      {classifying ? "Detecting…" : uploadMode === "raw_photo" ? "Raw Photo" : "AI Sketch"}
                    </span>
                    {classifyConfidence !== null && !classifying && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {Math.round(classifyConfidence * 100)}% confidence
                      </span>
                    )}
                  </div>

                  {/* Manual override toggle */}
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>Override:</span>
                    <button
                      onClick={() => { setManualOverride(true); setUploadMode("ai_sketch"); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${uploadMode === "ai_sketch" && manualOverride ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-white/[0.04] text-white/40 border-white/[0.08] hover:text-white/70"}`}
                    >
                      AI Sketch
                    </button>
                    <button
                      onClick={() => { setManualOverride(true); setUploadMode("raw_photo"); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${uploadMode === "raw_photo" && manualOverride ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-white/[0.04] text-white/40 border-white/[0.08] hover:text-white/70"}`}
                    >
                      Raw Photo
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {processError && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border"
                style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }}>
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-300">{processError}</p>
              </div>
            )}
          </div>

          {/* Controls panel: 35% on desktop */}
          <div className="flex flex-col gap-5 lg:flex-1">
            <SectionLabel num={2} label="Settings" gradient="linear-gradient(135deg,#2563eb,#7c3aed)" />

            {/* Only show AI sketch settings when in AI sketch mode */}
            {uploadMode === "ai_sketch" && (
              <>
                {/* Pen type */}
                <Card>
                  <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                    <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Pen Type</p>
                  </div>
                  <div className="p-4 flex gap-2">
                    {(["2mm", "0.6mm"] as PenType[]).map((p) => (
                      <button key={p} onClick={() => setPenType(p)}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${penType === p ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-white/[0.04] text-white/50 border-white/[0.08] hover:text-white/80"}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                </Card>

                {/* Drawing mode */}
                <Card>
                  <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                    <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Drawing Mode</p>
                  </div>
                  <div className="p-4 flex flex-col gap-2">
                    {DRAWING_MODES.map((m) => (
                      <button key={m.id} onClick={() => setDrawingMode(m.id)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${drawingMode === m.id ? "border-purple-500/30" : "border-white/[0.06] hover:border-white/[0.12]"}`}
                        style={{ background: drawingMode === m.id ? m.accentColor : "transparent" }}>
                        <span className={drawingMode === m.id ? "text-purple-300" : "text-white/40"}>{m.icon}</span>
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-white">{m.label}</p>
                          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{m.desc}</p>
                        </div>
                        <span className={`text-[10px] font-semibold ${m.badgeColor}`}>{m.badge}</span>
                      </button>
                    ))}
                  </div>
                </Card>

                {/* Detail & stroke */}
                <Card>
                  <div className="p-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-white/40">Detail Level: {detailLevel}</span>
                      <input type="range" min={1} max={10} value={detailLevel}
                        onChange={(e) => setDetailLevel(Number(e.target.value))}
                        className="w-full accent-purple-500" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-white/40">Stroke Weight: {strokeWeight}</span>
                      <input type="range" min={1} max={5} value={strokeWeight}
                        onChange={(e) => setStrokeWeight(Number(e.target.value))}
                        className="w-full accent-purple-500" />
                    </label>
                  </div>
                </Card>
              </>
            )}

            {/* Orientation */}
            <Card>
              <div className="p-4 flex gap-2">
                {(["portrait", "landscape"] as Orientation[]).map((o) => (
                  <button key={o} onClick={() => setOrientation(o)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border capitalize transition-all ${orientation === o ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-white/[0.04] text-white/50 border-white/[0.08] hover:text-white/80"}`}>
                    {o}
                  </button>
                ))}
              </div>
            </Card>

            {/* Process button */}
            {file && (
              <button
                onClick={handleProcess}
                disabled={processing || classifying}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-black text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:scale-[1.02]"
                style={{ background: "linear-gradient(135deg,#7c3aed,#2563eb)" }}>
                {processing ? <><Loader2 size={14} className="animate-spin" />Processing…</> : <><Zap size={14} />{uploadMode === "raw_photo" ? "Auto-Trace Photo" : "Convert to G-code"}</>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Stage: SVG Editor (raw photo path) ── */}
      {stage === "svg-editor" && autoTraceSvg && (
        <div className="flex flex-col gap-5">
          <SectionLabel num={2} label="Edit SVG Paths" gradient="linear-gradient(135deg,#f59e0b,#7c3aed)" />
          {/* Lazy import SvgEditor to avoid SSR issues */}
          <SvgEditorWrapper svg={autoTraceSvg} onProceed={handleSvgEditorProceed} />
        </div>
      )}

      {/* ── Stage: Composer ── */}
      {stage === "composer" && (
        <div className="flex flex-col gap-5">
          <SectionLabel num={3} label="Compose Layout" gradient="linear-gradient(135deg,#2563eb,#7c3aed)" />
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
          />
        </div>
      )}

      {/* ── Stage: Download ── */}
      {stage === "download" && gcodeResult && (
        <div className="flex flex-col gap-5">
          <SectionLabel num={4} label="Download G-code" gradient="linear-gradient(135deg,#10b981,#2563eb)" />
          <Card>
            <div className="p-6 flex flex-col gap-4">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: <ScanLine size={14} />, label: "Strokes", value: gcodeResult.stats.strokeCount.toLocaleString() },
                  { icon: <Clock size={14} />, label: "Est. Time", value: formatTime(gcodeResult.stats.estimatedTimeSeconds) },
                  { icon: <Ruler size={14} />, label: "Path Length", value: `${(gcodeResult.stats.pathLengthMm / 1000).toFixed(1)}m` },
                ].map((s) => (
                  <div key={s.label} className="flex flex-col items-center gap-1 p-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className="text-purple-400">{s.icon}</span>
                    <span className="text-lg font-black text-white">{s.value}</span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{s.label}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleDownload}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-black text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 hover:scale-[1.02] transition-all"
                style={{ background: "linear-gradient(135deg,#10b981,#2563eb)" }}>
                <Download size={14} />
                Download G-code
              </button>

              <button
                onClick={() => { setStage("upload"); setFile(null); setPreviewUrl(null); setGcodeResult(null); setAutoTraceSvg(null); setProcessResult(null); }}
                className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-white/40 hover:text-white/70 border border-white/[0.08] hover:border-white/[0.16] transition-all">
                <RotateCw size={12} />
                Start Over
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Prompt panel (AI sketch mode only) ── */}
      {stage === "upload" && uploadMode === "ai_sketch" && (
        <div>
          <SectionLabel num={3} label="ChatGPT Prompt" gradient="linear-gradient(135deg,#a78bfa,#60a5fa)" />
          <PromptPanel penType={penType} />
        </div>
      )}

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

const SvgEditorWrapper = dynamic(() => import("./SvgEditor"), { ssr: false });
const ComposerWrapper = dynamic(() => import("./Composer"), { ssr: false });
const RatingModalWrapper = dynamic(() => import("./RatingModal"), { ssr: false });
