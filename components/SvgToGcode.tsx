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
    <div className="flex flex-col gap-7 w-full max-w-4xl mx-auto">
      <div>
        <span className="ui-badge ui-badge-ink"><FileCode2 size={12} />Advanced</span>
        <h2 className="mt-4 font-serif-display text-[34px] sm:text-[42px] leading-[1.05] font-semibold text-tx">SVG <em className="text-ink">→</em> G-code</h2>
        <p className="mt-2 text-[15px] text-tx2 max-w-2xl">Paste SVG paths that already use millimetre coordinates and download plot-ready G-code — no tracing involved.</p>
      </div>

      <section className="ui-panel overflow-hidden">
        <div className="ui-section flex flex-col gap-5">
          <label className="ui-field">
            <span>SVG markup</span>
            <textarea
              value={svgText}
              onChange={(e) => setSvgText(e.target.value)}
              placeholder={'<svg xmlns="http://www.w3.org/2000/svg">\n  <path d="M 10,10 L 50,10 L 50,50 Z"/>\n</svg>'}
              rows={11}
              className="ui-input font-mono !text-[12.5px] resize-y"
            />
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Pen down (Z)", unit: "mm", value: zDraw, set: setZDraw, step: 0.1 },
              { label: "Pen up (Z)", unit: "mm", value: zHop, set: setZHop, step: 0.5 },
              { label: "Draw speed", unit: "mm/min", value: feedDraw, set: setFeedDraw, step: 100 },
              { label: "Travel speed", unit: "mm/min", value: feedTravel, set: setFeedTravel, step: 100 },
            ].map(({ label, unit, value, set, step }) => (
              <label key={label} className="ui-field">
                <span>{label}</span>
                <input
                  type="number"
                  value={value}
                  step={step}
                  onChange={(e) => set(Number(e.target.value))}
                  className={`ui-input ${unit.length > 3 ? "!pr-16" : ""}`}
                />
                <span className="ui-unit">{unit}</span>
              </label>
            ))}
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl border text-[13px] text-errc"
              style={{ background: "var(--ui-err-soft)", borderColor: "rgba(176,58,46,0.25)" }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>
        <div className="ui-section ui-muted">
          <button onClick={generate} disabled={!svgText.trim()} className="ui-btn ui-btn-primary ui-btn-lg ui-shine w-full">
            <Download size={16} />
            Convert &amp; download G-code
          </button>
        </div>
      </section>
    </div>
  );
}
