"use client";

import { Download, Clock, Info } from "lucide-react";

interface TestPattern {
  id: string;
  name: string;
  file: string;
  description: string;
  tests: string;
  goodResult: string;
  ifWrong: string;
  estimatedTime: string;
  category: "calibration" | "cartoon";
  svgPreview: React.ReactNode;
}

const patterns: TestPattern[] = [
  // ── CALIBRATION PATTERNS ──────────────────────────────────────────────────
  {
    id: "zhop",
    name: "Z-Hop Test",
    file: "/test-patterns/test_zhop.gcode",
    category: "calibration",
    description: "10 short vertical lines with Z-hops between each. Run this first.",
    tests: "Z-hop height — verifies pen lifts fully between strokes",
    goodResult: "10 clean separate lines with clear white gaps. No drag marks.",
    ifWrong: "Drag marks between lines → increase Z_HOP in settings (try 4mm or 5mm).",
    estimatedTime: "~2 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        {[12,23,34,45,56,67,78,89,100,111].map((x, i) => (
          <line key={i} x1={x} y1="40" x2={x} y2="80" />
        ))}
      </svg>
    ),
  },
  {
    id: "cross",
    name: "Calibration Cross",
    file: "/test-patterns/test_calibration_cross.gcode",
    category: "calibration",
    description: "Full-canvas cross with corner marks and 10mm tick marks on both axes.",
    tests: "Canvas mapping, drawing area verification, coordinate accuracy",
    goodResult: "Cross spans exactly 200×160mm. Corner marks at exact paper corners.",
    ifWrong: "Too small/large → adjust Canvas X/Y in settings. Offset → adjust X/Y Offset.",
    estimatedTime: "~10 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="10" y1="60" x2="110" y2="60" />
        <line x1="60" y1="10" x2="60" y2="110" />
        {([[10,10],[110,10],[10,110],[110,110],[60,60]] as [number,number][]).map(([x,y],i) => (
          <g key={i}>
            <line x1={x-5} y1={y} x2={x+5} y2={y} />
            <line x1={x} y1={y-5} x2={x} y2={y+5} />
          </g>
        ))}
        {[20,30,40,50,70,80,90,100].map((x,i) => <line key={i} x1={x} y1={57} x2={x} y2={63} />)}
        {[20,30,40,50,70,80,90,100].map((y,i) => <line key={i} x1={57} y1={y} x2={63} y2={y} />)}
      </svg>
    ),
  },
  {
    id: "circles",
    name: "Concentric Circles",
    file: "/test-patterns/test_concentric_circles.gcode",
    category: "calibration",
    description: "8 circles r=10–75mm all centered on the canvas center (X140 Y120).",
    tests: "Arc consistency, motor synchronisation, roundness at different speeds",
    goodResult: "All circles perfectly round and evenly spaced. No flat spots.",
    ifWrong: "Oval circles → check X/Y steps-per-mm calibration. Wobbly → tighten belts.",
    estimatedTime: "~6 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {[8,16,24,32,40,48,54,58].map((r, i) => (
          <circle key={i} cx="60" cy="60" r={r} />
        ))}
      </svg>
    ),
  },
  {
    id: "smiley",
    name: "Smiley Face",
    file: "/test-patterns/test_smiley.gcode",
    category: "calibration",
    description: "Face circle, two eyes, a smile arc, and eyebrows — all centered.",
    tests: "Basic arc drawing, pen pressure consistency, circle accuracy",
    goodResult: "Round face, symmetrical eyes, SMILE (not frown), clean arcs.",
    ifWrong: "Oval circles → check belt tension. Jagged arcs → reduce feed rate.",
    estimatedTime: "~3 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="60" cy="60" r="45" />
        <circle cx="44" cy="52" r="6" />
        <circle cx="76" cy="52" r="6" />
        <path d="M 38 52 Q 60 30 82 52" />
        <line x1="36" y1="64" x2="52" y2="66" />
        <line x1="68" y1="66" x2="84" y2="64" />
      </svg>
    ),
  },
  {
    id: "maze",
    name: "Square Maze",
    file: "/test-patterns/test_square_maze.gcode",
    category: "calibration",
    description: "5×5 grid of 20mm cells centered on canvas, with random walls removed.",
    tests: "Corner accuracy, straight line consistency, 90° angle precision",
    goodResult: "Sharp clean corners. Lines are straight. Grid spacing is even.",
    ifWrong: "Corners overshoot → reduce acceleration in firmware. Lines drift → check frame squareness.",
    estimatedTime: "~8 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <rect x="10" y="10" width="100" height="100" />
        <line x1="10" y1="30" x2="30" y2="30" /><line x1="50" y1="30" x2="90" y2="30" />
        <line x1="30" y1="10" x2="30" y2="50" /><line x1="50" y1="30" x2="50" y2="70" />
        <line x1="70" y1="10" x2="70" y2="30" /><line x1="10" y1="50" x2="30" y2="50" />
        <line x1="50" y1="50" x2="70" y2="50" /><line x1="90" y1="50" x2="110" y2="50" />
        <line x1="30" y1="70" x2="50" y2="70" /><line x1="70" y1="70" x2="90" y2="70" />
        <line x1="10" y1="90" x2="50" y2="90" /><line x1="70" y1="90" x2="110" y2="90" />
        <line x1="90" y1="50" x2="90" y2="90" />
      </svg>
    ),
  },
  // ── CARTOON PATTERNS ──────────────────────────────────────────────────────
  {
    id: "tom",
    name: "Tom Cat",
    file: "/test-patterns/test_tom_cat.gcode",
    category: "cartoon",
    description: "Tom cat face with oval head, ears, eyes, nose, mouth W, and whiskers.",
    tests: "Complex curves, multiple strokes, character proportions",
    goodResult: "Recognisable cat face with clean whiskers and symmetrical features.",
    ifWrong: "If head oval is distorted → check belt tension on both axes.",
    estimatedTime: "~12 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="60" cy="60" rx="35" ry="40" />
        <polygon points="25,42 10,72 38,62" />
        <polygon points="95,42 110,72 82,62" />
        <circle cx="46" cy="52" r="7" /><circle cx="74" cy="52" r="7" />
        <circle cx="46" cy="52" r="3" /><circle cx="74" cy="52" r="3" />
        <polygon points="55,65 65,65 60,58" />
        <polyline points="42,72 50,76 60,72 70,76 78,72" />
        <line x1="18" y1="62" x2="48" y2="64" /><line x1="18" y1="68" x2="48" y2="68" />
        <line x1="72" y1="64" x2="102" y2="62" /><line x1="72" y1="68" x2="102" y2="68" />
      </svg>
    ),
  },
  {
    id: "mickey",
    name: "Mickey Mouse",
    file: "/test-patterns/test_mickey_mouse.gcode",
    category: "cartoon",
    description: "Iconic Mickey Mouse silhouette — head with two round ears, eyes, nose, smile.",
    tests: "Large circles, proportional drawing, iconic shape recognition",
    goodResult: "Instantly recognisable Mickey silhouette with round ears.",
    ifWrong: "Ears not round → check arc calibration with concentric circles first.",
    estimatedTime: "~8 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="60" cy="58" r="30" />
        <circle cx="32" cy="30" r="18" />
        <circle cx="88" cy="30" r="18" />
        <circle cx="50" cy="54" r="5" /><circle cx="70" cy="54" r="5" />
        <circle cx="60" cy="66" r="5" />
        <path d="M 42 76 Q 60 88 78 76" />
      </svg>
    ),
  },
  {
    id: "elephant",
    name: "Elephant",
    file: "/test-patterns/test_elephant.gcode",
    category: "cartoon",
    description: "Cute cartoon elephant with body, head, ear, trunk, legs, and tail.",
    tests: "Mixed curves and straight lines, multi-element composition",
    goodResult: "Recognisable elephant with trunk curling down and 4 legs.",
    ifWrong: "Legs misaligned → verify canvas offset settings.",
    estimatedTime: "~10 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="72" cy="58" r="30" />
        <circle cx="44" cy="72" r="18" />
        <circle cx="24" cy="74" r="13" />
        <path d="M 50 62 L 46 50 L 50 38 L 58 32 L 62 36" />
        <circle cx="38" cy="76" r="3" />
        {[38,50,62,74].map((lx,i) => <rect key={i} x={lx} y={88} width="10" height="14" />)}
        <path d="M 100 60 L 108 68 L 112 64 L 110 56" />
      </svg>
    ),
  },
  {
    id: "star",
    name: "5-Point Star",
    file: "/test-patterns/test_star.gcode",
    category: "cartoon",
    description: "Perfect 5-point star, outer r=60mm, inner r=25mm, centered on canvas.",
    tests: "Diagonal lines, sharp angles, symmetry, long straight strokes",
    goodResult: "Perfectly symmetrical star with sharp points.",
    ifWrong: "Asymmetric → check steps-per-mm on X and Y axes.",
    estimatedTime: "~4 min",
    svgPreview: (
      <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="60,8 72,42 108,42 80,62 90,96 60,76 30,96 40,62 12,42 48,42" />
      </svg>
    ),
  },
];

export default function TestPatterns() {
  const calibration = patterns.filter(p => p.category === "calibration");
  const cartoons = patterns.filter(p => p.category === "cartoon");

  const PatternCard = ({ pattern }: { pattern: TestPattern }) => (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden flex flex-col">
      <div className="bg-white p-4 flex items-center justify-center h-36">
        <div className="w-28 h-28 text-black">{pattern.svgPreview}</div>
      </div>
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-white text-sm">{pattern.name}</h3>
            <div className="flex items-center gap-1 text-xs text-[#6b7280]">
              <Clock size={11} />
              {pattern.estimatedTime}
            </div>
          </div>
          <p className="text-xs text-[#6b7280] leading-relaxed">{pattern.description}</p>
        </div>
        <div className="bg-[#0f0f0f] rounded-lg p-3 space-y-2">
          <div>
            <p className="text-xs font-medium text-[#3b82f6] mb-0.5">Tests</p>
            <p className="text-xs text-gray-400">{pattern.tests}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-green-400 mb-0.5">Good result</p>
            <p className="text-xs text-gray-400">{pattern.goodResult}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-yellow-400 mb-0.5">If wrong</p>
            <p className="text-xs text-gray-400">{pattern.ifWrong}</p>
          </div>
        </div>
        <a
          href={pattern.file}
          download
          className="mt-auto flex items-center justify-center gap-2 py-2.5 px-4 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Download size={14} />
          Download G-code
        </a>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Calibration */}
      <div>
        <h2 className="text-lg font-semibold text-white">Calibration Patterns</h2>
        <p className="text-sm text-[#6b7280] mt-1">
          Run these in order before your first real drawing. Start with Z-Hop, then Calibration Cross.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {calibration.map(p => <PatternCard key={p.id} pattern={p} />)}
      </div>

      {/* Cartoons */}
      <div>
        <h2 className="text-lg font-semibold text-white">Cartoon Patterns</h2>
        <p className="text-sm text-[#6b7280] mt-1">
          Fun drawings to test when you have nothing else to plot. All centered on the canvas.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cartoons.map(p => <PatternCard key={p.id} pattern={p} />)}
      </div>

      {/* Usage note */}
      <div className="flex items-start gap-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
        <Info size={16} className="text-[#3b82f6] mt-0.5 shrink-0" />
        <div className="text-sm text-[#6b7280] space-y-1">
          <p className="text-gray-300 font-medium">How to use test patterns</p>
          <p>1. Download the G-code file and copy it to your SD card.</p>
          <p>2. Mount your pen and manually set Z height so the pen just touches the paper.</p>
          <p>3. Run the pattern and observe the result.</p>
          <p>4. Adjust settings in the Settings tab if needed, then re-run.</p>
          <p className="text-[#3b82f6]">All patterns are centered at X140 Y120 (canvas center on a 280×240mm bed with 40mm offset).</p>
        </div>
      </div>
    </div>
  );
}
