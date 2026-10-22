"use client";

import { useEffect, useState } from "react";

// A small line illustration that draws itself, with a pencil riding the main
// stroke — the same way the plotter will draw your image. Decorative only.

const STROKES: { d: string; len: number; delay: number; dur: number; w?: number }[] = [
  // Vase
  { d: "M150 300 C 132 300 122 286 124 268 C 126 248 140 236 140 222 L 160 222 C 160 236 174 248 176 268 C 178 286 168 300 150 300 Z", len: 330, delay: 0, dur: 1.6, w: 2.2 },
  { d: "M132 252 C 145 258 155 258 168 252", len: 40, delay: 1.3, dur: 0.6 },
  // Main stem (pencil rides this one)
  { d: "M150 222 C 148 190 146 160 152 128 C 156 108 160 92 158 74", len: 160, delay: 1.5, dur: 1.4, w: 2 },
  // Side stems
  { d: "M150 182 C 132 168 118 150 112 128", len: 70, delay: 2.4, dur: 0.9 },
  { d: "M151 160 C 170 146 182 128 188 108", len: 70, delay: 2.6, dur: 0.9 },
  // Leaves
  { d: "M149 200 C 128 198 112 188 104 172 C 124 172 140 182 149 200 Z", len: 110, delay: 2.9, dur: 0.9 },
  { d: "M151 192 C 172 192 188 182 196 168 C 176 166 160 176 151 192 Z", len: 110, delay: 3.1, dur: 0.9 },
  { d: "M104 172 C 120 180 136 188 149 200", len: 55, delay: 3.6, dur: 0.5 },
  // Main flower petals
  { d: "M158 74 C 146 60 146 44 158 36 C 170 44 170 60 158 74 Z", len: 90, delay: 3.3, dur: 0.8, w: 2 },
  { d: "M158 74 C 140 72 128 62 128 48 C 142 46 154 58 158 74 Z", len: 85, delay: 3.6, dur: 0.8, w: 2 },
  { d: "M158 74 C 176 72 188 62 188 48 C 174 46 162 58 158 74 Z", len: 85, delay: 3.8, dur: 0.8, w: 2 },
  { d: "M158 74 C 142 82 128 82 120 74 C 132 64 148 66 158 74 Z", len: 80, delay: 4.0, dur: 0.7 },
  { d: "M158 74 C 174 82 188 82 196 74 C 184 64 168 66 158 74 Z", len: 80, delay: 4.2, dur: 0.7 },
  // Buds
  { d: "M112 128 C 102 118 104 104 114 100 C 122 108 120 120 112 128 Z", len: 70, delay: 4.3, dur: 0.7 },
  { d: "M188 108 C 200 100 200 86 190 82 C 182 90 182 100 188 108 Z", len: 70, delay: 4.5, dur: 0.7 },
  // Table line + shading ticks
  { d: "M70 300 L 232 300", len: 162, delay: 0.2, dur: 1.2, w: 1.6 },
  { d: "M168 268 L 160 290 M172 274 L 166 292 M164 262 L 154 288", len: 80, delay: 4.7, dur: 0.6, w: 1.2 },
];

export default function HeroArt() {
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setCycle((c) => c + 1), 9000);
    return () => clearInterval(t);
  }, []);
  const ride = STROKES[2];

  return (
    <div className="relative ui-float">
      <div className="ui-paper relative w-[260px] h-[300px] sm:w-[300px] sm:h-[340px] rotate-[2deg]">
        {/* paper ruling */}
        <div className="absolute inset-x-6 top-6 h-px" style={{ background: "rgba(180,84,45,0.18)" }} />
        <svg key={cycle} viewBox="60 20 180 300" className="ui-draw absolute inset-0 w-full h-full p-5" fill="none"
          stroke="var(--ui-plot-ink)" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {STROKES.map((s, i) => (
            <path key={i} d={s.d} strokeWidth={s.w ?? 1.6}
              style={{ ["--len" as string]: s.len, ["--delay" as string]: `${s.delay}s`, ["--dur" as string]: `${s.dur}s` }} />
          ))}
          {/* pencil riding the main stem */}
          <g style={{ offsetPath: `path("${ride.d}")`, offsetRotate: "0deg", animation: `ui-pen-ride ${ride.dur}s cubic-bezier(.65,0,.35,1) ${ride.delay}s both` }}>
            <g transform="translate(-2 -26) rotate(0)">
              <path d="M2 26 L5 19 L9 23 Z" fill="#26231f" stroke="none" />
              <path d="M5 19 L9 23 L24 8 L20 4 Z" fill="#2f3a8c" stroke="none" />
              <path d="M20 4 L24 8 L26 6 L22 2 Z" fill="#c9a55c" stroke="none" />
            </g>
          </g>
        </svg>
        <span className="absolute bottom-3 right-4 font-serif-display italic text-[11px]" style={{ color: "var(--ui-text-3)" }}>plotted · 0.6 mm</span>
      </div>
      {/* a second sheet underneath for depth */}
      <div className="ui-paper absolute inset-0 -z-10 -rotate-[4deg] translate-x-2 translate-y-2 opacity-80" />
    </div>
  );
}
