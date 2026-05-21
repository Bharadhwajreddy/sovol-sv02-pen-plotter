# Calibration Guide — Sovol SV02 Pen Plotter

## Before You Start

You will need:
- Sovol SV02 printer (powered on, connected)
- A pen or marker (Sharpie recommended)
- A pen holder or mounting solution (tape, zip ties, or a printed holder)
- A sheet of paper (A4 or similar)
- SD card or USB connection

---

## Step 1 — Remove the Extruder

1. Power off the printer.
2. Disconnect the extruder motor cable, heater cartridge, thermistor, and cooling fan.
3. Remove the extruder assembly from the X-carriage.
4. Keep the X-carriage and its mounting plate in place.

> **Safety**: Never home Z with the pen attached. The Z endstop is calibrated for the nozzle height, not the pen height. Always use `G28 X Y` only.

---

## Step 2 — Mount the Pen

1. Attach your pen holder to the X-carriage. Options:
   - 3D-printed pen holder (search Thingiverse for "Sovol SV02 pen plotter")
   - Zip ties around the carriage
   - Tape (temporary, not recommended for long sessions)
2. Insert a Sharpie or similar marker. The tip should point straight down.
3. The pen tip should be roughly centered on the carriage, aligned with where the nozzle was.

---

## Step 3 — Set Z_DRAW Height

1. Power on the printer.
2. Home X and Y only: send `G28 X Y` from your host software or LCD.
3. Place your paper on the bed.
4. Manually jog Z down in small increments (0.1mm steps) until the pen tip just barely touches the paper.
5. Note the Z value shown on the display.
6. Set this as `Z_DRAW` in the app Settings tab.
7. Start with 0.0mm — adjust if the pen is too light or too heavy.

> **Tip**: The pen should draw with light, consistent pressure. If it's too heavy, the pen will drag and slow down. If too light, lines will be faint or missing.

---

## Step 4 — Set Z_HOP Height

1. Default Z_HOP is 3.0mm.
2. Run the **Z-Hop Test** pattern (download from Test Patterns tab).
3. Observe the result:
   - **Good**: 10 clean, separate lines with clear white gaps between them.
   - **Bad**: Lines connected by drag marks → increase Z_HOP to 4mm or 5mm.
4. Update Z_HOP in Settings and save.

---

## Step 5 — Verify Canvas Mapping

1. Run the **Calibration Cross** pattern.
2. The cross should span exactly 200×160mm on your paper.
3. The corner marks should land at the exact corners of your drawing area.
4. If the cross is too small or large: adjust Canvas X/Y in Settings.
5. If the cross is offset from where you expect: adjust X/Y Offset in Settings.

> **Default offsets**: X=40mm, Y=40mm from home. This leaves room for paper clips on all sides.

---

## Step 6 — Test Arc Quality

1. Run the **Smiley Face** pattern.
2. Check:
   - Circles should be round, not oval.
   - Arcs should be smooth, not jagged.
   - Eyes should be symmetrical.
3. If circles are oval: check belt tension on X and Y axes.
4. If arcs are jagged: reduce Draw Feed Rate (try 1000 mm/min).

---

## Step 7 — Test Straight Lines

1. Run the **Square Maze** pattern.
2. Check:
   - Lines should be straight.
   - Corners should be sharp 90° angles.
   - Grid spacing should be even.
3. If corners overshoot: reduce acceleration in Marlin firmware (M204).
4. If lines drift: check frame squareness and belt tension.

---

## Step 8 — You're Ready

Once all test patterns look good, you're ready to plot real drawings.

**Workflow:**
1. Upload your sketch image in the Upload & Convert tab.
2. Set detail level (start with 5).
3. Click Generate Sketch & G-code.
4. Review the sketch preview and stats.
5. Download the .gcode file.
6. Copy to SD card and run on the printer.

---

## Tips for Best Results

- Use a fresh pen — dried-out markers produce inconsistent lines.
- Tape your paper to the bed to prevent it from shifting.
- Run a test pattern before every new drawing session to verify Z height hasn't drifted.
- For very detailed drawings, reduce the detail level slider to 3–4 to avoid too many strokes.
- For portraits, use detail level 5–7 for best recognition.
