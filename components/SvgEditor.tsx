"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Trash2, Undo2, ArrowRight, Layers } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SvgPath {
  id: string;
  d: string;
}

interface SvgEditorProps {
  svg: string;
  onProceed: (cleanedSvg: string) => void;
}

// ─── SVG Parsing ──────────────────────────────────────────────────────────────

function parseSvgPaths(svgString: string): { paths: SvgPath[]; viewBox: string; width: string; height: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.querySelector("svg");

  const viewBox = svgEl?.getAttribute("viewBox") ?? "0 0 200 160";
  const width = svgEl?.getAttribute("width") ?? "200mm";
  const height = svgEl?.getAttribute("height") ?? "160mm";

  const pathEls = doc.querySelectorAll("path");
  const paths: SvgPath[] = Array.from(pathEls).map((el, i) => ({
    id: el.getAttribute("id") ?? `path-${i}-${Math.random().toString(36).slice(2, 9)}`,
    d: el.getAttribute("d") ?? "",
  }));

  return { paths, viewBox, width, height };
}

function serialiseSvg(
  paths: SvgPath[],
  viewBox: string,
  width: string,
  height: string
): string {
  const pathMarkup = paths
    .map(
      (p) =>
        `  <path id="${p.id}" d="${p.d}" stroke="black" fill="none" stroke-width="0.3"/>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">\n${pathMarkup}\n</svg>`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SvgEditor({ svg, onProceed }: SvgEditorProps) {
  const [paths, setPaths] = useState<SvgPath[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletedStack, setDeletedStack] = useState<SvgPath[]>([]);
  const [svgMeta, setSvgMeta] = useState({ viewBox: "0 0 200 160", width: "200mm", height: "160mm" });
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse SVG on mount / when svg prop changes
  useEffect(() => {
    const { paths: parsed, viewBox, width, height } = parseSvgPaths(svg);
    setPaths(parsed);
    setSelectedId(null);
    setDeletedStack([]);
    setSvgMeta({ viewBox, width, height });
  }, [svg]);

  // Delete selected path
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const target = paths.find((p) => p.id === selectedId);
    if (!target) return;

    setPaths((prev) => prev.filter((p) => p.id !== selectedId));
    // Max depth 1 — replace any existing entry
    setDeletedStack([target]);
    setSelectedId(null);
  }, [selectedId, paths]);

  // Undo last delete
  const undoDelete = useCallback(() => {
    if (deletedStack.length === 0) return;
    const [restored] = deletedStack;
    setPaths((prev) => [...prev, restored]);
    setDeletedStack([]);
  }, [deletedStack]);

  // Keyboard handler — Delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedId) {
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected, selectedId]);

  // Proceed to Compose
  const handleProceed = () => {
    const cleanedSvg = serialiseSvg(paths, svgMeta.viewBox, svgMeta.width, svgMeta.height);
    onProceed(cleanedSvg);
  };

  const hasUndo = deletedStack.length > 0;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#161616] overflow-hidden animate-fade-in">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-500/15">
            <Layers size={16} className="text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">SVG Path Editor</p>
            <p className="text-xs text-white/40">Click a path to select, then delete or proceed</p>
          </div>
        </div>

        {/* Path count badge */}
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full border bg-white/[0.04] border-white/[0.10] text-white/60">
          <span className="text-white font-black">{paths.length}</span> paths
        </span>
      </div>

      {/* ── SVG Canvas ── */}
      <div
        ref={containerRef}
        className="relative bg-white mx-5 my-5 rounded-xl overflow-hidden"
        style={{ minHeight: 320 }}
      >
        {paths.length === 0 ? (
          <div className="flex items-center justify-center h-80 text-gray-400 text-sm">
            No paths to display
          </div>
        ) : (
          <svg
            viewBox={svgMeta.viewBox}
            className="w-full h-full"
            style={{ display: "block", background: "white" }}
            aria-label="SVG path editor canvas"
          >
            {paths.map((path) => {
              const isSelected = path.id === selectedId;
              return (
                <path
                  key={path.id}
                  d={path.d}
                  stroke={isSelected ? "#3B82F6" : "black"}
                  fill="none"
                  strokeWidth={isSelected ? 1.5 : 0.5}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(isSelected ? null : path.id);
                  }}
                  aria-label={`Path ${path.id}${isSelected ? " (selected)" : ""}`}
                />
              );
            })}
          </svg>
        )}

        {/* Deselect on canvas background click */}
        {paths.length > 0 && (
          <div
            className="absolute inset-0 -z-10"
            onClick={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* ── Controls ── */}
      <div className="px-5 pb-5 flex flex-wrap items-center gap-3">
        {/* Delete Path */}
        <button
          onClick={deleteSelected}
          disabled={!selectedId}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border disabled:opacity-30 disabled:cursor-not-allowed bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 disabled:hover:bg-red-500/10 disabled:hover:border-red-500/20"
        >
          <Trash2 size={14} />
          Delete Path
        </button>

        {/* Undo Last Delete */}
        <button
          onClick={undoDelete}
          disabled={!hasUndo}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08] hover:text-white hover:border-white/[0.16] disabled:hover:bg-white/[0.04] disabled:hover:text-white/60 disabled:hover:border-white/[0.08]"
        >
          <Undo2 size={14} />
          Undo Last Delete
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Proceed to Compose */}
        <button
          onClick={handleProceed}
          disabled={paths.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:scale-[1.02] disabled:hover:scale-100 disabled:shadow-none"
        >
          Proceed to Compose
          <ArrowRight size={14} />
        </button>
      </div>

      {/* ── Selection hint ── */}
      {selectedId && (
        <div className="mx-5 mb-5 px-4 py-3 rounded-xl bg-blue-500/[0.08] border border-blue-500/20 text-xs text-blue-300 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
          Path selected — press <kbd className="px-1.5 py-0.5 rounded bg-blue-500/20 font-mono text-[10px]">Delete</kbd> or click "Delete Path" to remove it
        </div>
      )}
    </div>
  );
}
