# Sovol SV02 Pen Plotter

A web app that converts sketch images into G-code for the Sovol SV02 3D printer used as a pen plotter.

## Quick Start

### 1. Photo → Sketch (ChatGPT)

1. Open `../prompt-output/chatgpt-sketch-prompt.md`
2. Copy the prompt text
3. Paste it into ChatGPT and attach your photo
4. Download the resulting sketch image

### 2. Sketch → G-code (Web App)

1. Open the web app
2. Upload your sketch image
3. Adjust the detail level slider
4. Click **Generate Sketch & G-code**
5. Download the `.gcode` file

### 3. G-code → Printer

1. Copy the `.gcode` file to your SD card
2. Mount your pen on the Sovol SV02 X-carriage
3. Home X and Y only: `G28 X Y`
4. Manually set Z height so pen just touches paper
5. Run the G-code file

---

## Installation

### Prerequisites

- Node.js 18+
- Python 3.9+ with pip
- Git

### Setup

```bash
# Install Node dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Machine Specs

| Parameter | Value |
|---|---|
| Printer | Sovol SV02 |
| Firmware | Marlin |
| Bed size | 280 × 240mm |
| Drawing canvas | 200 × 160mm |
| Origin offset | X=40mm, Y=40mm |
| Z_DRAW | 0.0mm (calibrate) |
| Z_HOP | 3.0mm |
| Draw feed | 1500 mm/min |
| Travel feed | 3000 mm/min |

---

## G-code Rules

- `G21` — mm units
- `G90` — absolute positioning
- `G28 X Y` — home X and Y **only** (never home Z with pen attached)
- Z-hop between every stroke
- No temperature commands
- No extruder commands
- Border drawn first

---

## Calibration

See `docs/calibration-guide.md` for full step-by-step calibration instructions.

Run the test patterns in this order:
1. Z-Hop Test — verify pen lifts between strokes
2. Calibration Cross — verify canvas mapping
3. Concentric Circles — verify arc quality
4. Smiley Face — verify arc + pressure
5. Square Maze — verify straight lines + corners

---

## Deployment

### Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

### GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/sovol-sv02-pen-plotter.git
git push -u origin main
```

---

## Project Structure

```
sovol-pen-plotter/
├── app/                    — Next.js app
│   ├── api/process/        — Image processing API
│   ├── layout.tsx
│   └── page.tsx
├── components/             — React components
├── lib/                    — Python processing scripts
├── public/test-patterns/   — Pre-generated test G-code files
├── docs/                   — Documentation
└── prompt-output/          — ChatGPT sketch prompt files
```

---

## Troubleshooting

See `docs/troubleshooting.md` for common issues and fixes.

---

## License

MIT
