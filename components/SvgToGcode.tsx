"use client";

import { useState, useCallback } from "react";
import { Download, FileCode2, AlertCircle } from "lucide-react";

// ─── SVG path D parser (M/L/Z) ──────────────────────────────────────────────
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

export default function SvgToGcode() {
  const [svgText, setSvgText] = useState("");
  const [zDraw, setZDraw] = useState(0.0);
  const [zHop, setZHop] = useState(3.0);
  const [feedDraw, setFeedDraw] = useState(1500);
  const [feedTravel, setFeedTravel] = useState(3000);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setError(null);
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText.trim(), "image/svg+xml");
      const parseErr = doc.querySelector("parsererror");
      if (parseErr) { setError("Invalid SVG — check syntax"); return; }

      const fmt = (n: number) => n.toFixed(3);
      const lines: string[] = [
        "; Sovol SV02 — SVG to G-code",
        "G21 ; mm units",
        "G90 ; absolute",
        "G28 X Y ; home",
        `G0 Z${fmt(zHop)} F${feedTravel} ; pen up`,
        "",
      ];

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

      lines.push("", `G0 Z${fmt(zHop + 5)} F${feedTravel}`, "M84");

      const gcode = lines.join("\n");
      const blob = new Blob([gcode], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "svg_to_gcode.gcode";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed");
    }
  }, [svgText, zDraw, zHop, feedDraw, feedTravel]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
      <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <FileCode2 size={16} className="text-purple-400" />
          <span className="text-sm font-bold text-white">SVG → G-code</span>
          <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>Paste SVG paths with mm coordinates</span>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <textarea
            value={svgText}
            onChange={(e) => setSvgText(e.target.value)}
            placeholder={'<svg xmlns="http://www.w3.org/2000/svg">\n  <path d="M 10,10 L 50,10 L 50,50 Z"/>\n</svg>'}
            rows={10}
            className="w-full px-3 py-2 rounded-xl border text-xs font-mono resize-y"
            style={{ background: "rgba(0,0,0,0.3)", borderColor: "var(--border)", color: "rgba(255,255,255,0.7)" }}
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Z Draw (mm)", value: zDraw, set: setZDraw, step: 0.1 },
              { label: "Z Hop (mm)", value: zHop, set: setZHop, step: 0.5 },
              { label: "Feed Draw", value: feedDraw, set: setFeedDraw, step: 100 },
              { label: "Feed Travel", value: feedTravel, set: setFeedTravel, step: 100 },
            ].map(({ label, value, set, step }) => (
              <label key={label} className="flex flex-col gap-1">
                <span className="text-[10px] text-white/40">{label}</span>
                <input
                  type="number"
                  value={value}
                  step={step}
                  onChange={(e) => set(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg border text-xs text-white focus:outline-none focus:border-purple-500/50"
                  style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" }}
                />
              </label>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl border text-xs text-red-300"
              style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }}>
              <AlertCircle size={13} />
              {error}
            </div>
          )}

          <button
            onClick={generate}
            disabled={!svgText.trim()}
            className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40"
            style={{ background: "linear-gradient(135deg,#7c3aed,#2563eb)" }}
          >
            <Download size={14} />
            Convert & Download G-code
          </button>
        </div>
      </div>
    </div>
  );
}
