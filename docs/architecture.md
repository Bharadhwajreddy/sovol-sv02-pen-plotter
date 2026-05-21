# Architecture — Sovol SV02 Pen Plotter Web App

## System Overview

This project has two connected workflows:

**Workflow A — Image to Sketch (ChatGPT)**
```
Photo → ChatGPT (reusable prompt) → Simplified black-on-white sketch
```

**Workflow B — Sketch to G-code (Web App)**
```
Sketch image → Web App → Python processing → G-code → Sovol SV02
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (frontend), Python 3.x (processing) |
| Styling | TailwindCSS |
| Image processing | OpenCV (Python) |
| Deployment | Vercel |
| Repository | GitHub |

---

## File Structure

```
sovol-pen-plotter/
├── app/
│   ├── layout.tsx              — Root layout, metadata
│   ├── page.tsx                — Main page with tab navigation
│   ├── globals.css             — Global styles, CSS variables
│   └── api/
│       └── process/
│           └── route.ts        — API endpoint: image → G-code
├── components/
│   ├── UploadConvert.tsx       — Tab 1: upload, preview, generate
│   ├── TestPatterns.tsx        — Tab 2: test pattern downloads
│   └── SettingsPanel.tsx       — Tab 3: settings + calibration wizard
├── lib/
│   ├── sketch_to_gcode.py      — Core image processing pipeline
│   ├── test_patterns.py        — Test pattern G-code generator
│   └── gcode_utils.py          — Shared G-code helper functions
├── public/
│   └── test-patterns/          — Pre-generated test pattern .gcode files
├── docs/
│   ├── architecture.md         — This file
│   ├── calibration-guide.md    — Step-by-step calibration
│   ├── troubleshooting.md      — Common problems and fixes
│   └── phase-log.md            — Build progress log
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vercel.json
├── requirements.txt
└── README.md
```

---

## Image Processing Pipeline

```
Input image (JPG/PNG/WEBP)
    ↓
Resize to max 1024px (preserve aspect ratio)
    ↓
Convert to grayscale
    ↓
Gaussian blur (kernel size driven by detail_level)
    ↓
Canny edge detection (thresholds driven by detail_level)
    ↓
Morphological dilation (thicken edges)
    ↓
Find contours (cv2.findContours)
    ↓
Douglas-Peucker simplification (epsilon driven by detail_level)
    ↓
Filter tiny contours (noise removal)
    ↓
Scale to plotter coordinates (mm, centered in safe area)
    ↓
Generate G-code (header + border + paths + footer)
    ↓
Output: G-code string + sketch preview PNG (base64)
```

---

## G-code Structure

Every generated file follows this structure:

```gcode
; Header comments
G21          ; mm units
G90          ; absolute positioning
G28 X Y      ; home X and Y ONLY (never Z)
G0 Z3.0      ; pen up — safe travel height

; Border (rounded rectangle, drawn FIRST)
G0 X... Y... ; travel to border start
G0 Z0.0      ; pen down
G1 ...       ; border lines
G2 ...       ; arc corners (r=3mm)
G0 Z3.0      ; pen up

; Drawing paths (one block per stroke)
G0 X... Y... ; travel to stroke start
G0 Z0.0      ; pen down
G1 X... Y... ; draw
G0 Z3.0      ; pen up

; Footer
G0 Z8.0      ; raise pen safely
G0 X40 Y40   ; return to origin
M84          ; disable steppers
```

---

## Machine Constraints (Hardcoded Defaults)

| Parameter | Value | Notes |
|---|---|---|
| Printer | Sovol SV02 | Marlin firmware, ATmega2560 |
| Bed size | 280 × 240mm | Total usable bed |
| Canvas | 200 × 160mm | Safe drawing area |
| Origin offset | X=40, Y=40mm | Leaves room for paper clips |
| Z_DRAW | 0.0mm | Pen touching paper (user calibrates) |
| Z_HOP | 3.0mm | Pen lifted between strokes |
| Feed draw | 1500 mm/min | Drawing speed |
| Feed travel | 3000 mm/min | Travel speed |
| Home | G28 X Y | NEVER G28 alone (Z crash risk) |
| Units | G21 | Millimetres |
| Positioning | G90 | Absolute |

---

## API Design

### POST /api/process

**Request:** `multipart/form-data`
- `image` — image file (JPG/PNG/WEBP)
- `detail` — integer 1–10
- `settings` — JSON string of plotter settings

**Response:** JSON
```json
{
  "gcode": "...",
  "sketchDataUrl": "data:image/png;base64,...",
  "stats": {
    "strokeCount": 42,
    "estimatedTimeSeconds": 480,
    "pathLengthMm": 3200.5
  },
  "warning": "optional warning string"
}
```

The API calls the Python script as a subprocess. If Python/OpenCV is unavailable, it falls back to a border-only G-code response with a warning.

---

## Deployment

- **Vercel**: Next.js app deployed via `@vercel/next` builder
- **Python**: The Python processing runs as a subprocess from the Next.js API route
- **Static files**: Test pattern G-code files are served from `/public/test-patterns/`
- **No database**: All settings stored in browser localStorage
