# Troubleshooting Guide — Sovol SV02 Pen Plotter

## G-code Issues

### Printer homes Z and crashes
**Cause**: You sent `G28` instead of `G28 X Y`.  
**Fix**: Always use `G28 X Y` only. Never home Z with the pen attached. The Z endstop is calibrated for the nozzle, not the pen.

### Printer tries to heat up
**Cause**: G-code contains temperature commands (M104, M109, M140, M190).  
**Fix**: The app should never generate these. If you see them, regenerate the G-code. Do not run G-code with temperature commands on a pen plotter.

### Printer moves extruder motor
**Cause**: G-code contains E-axis commands.  
**Fix**: The app should never generate E commands. Regenerate the G-code.

---

## Drawing Quality Issues

### Pen drags between strokes (lines connected)
**Cause**: Z_HOP is too low — pen doesn't lift fully.  
**Fix**: Increase Z_HOP in Settings. Try 4mm, then 5mm. Run the Z-Hop Test to verify.

### Lines are too faint or missing
**Cause**: Z_DRAW is too high — pen not touching paper.  
**Fix**: Lower Z_DRAW by 0.1mm increments until pen draws consistently.

### Lines are too heavy / pen slows down
**Cause**: Z_DRAW is too low — pen pressing too hard.  
**Fix**: Raise Z_DRAW by 0.1mm increments.

### Circles are oval, not round
**Cause**: Belt tension uneven between X and Y axes.  
**Fix**: Tighten both belts equally. Check that both axes move smoothly by hand.

### Arcs are jagged or stepped
**Cause**: Draw feed rate too high for the arc resolution.  
**Fix**: Reduce Draw Feed Rate in Settings. Try 1000 mm/min.

### Drawing is too small
**Cause**: Canvas size or offset settings don't match your paper placement.  
**Fix**: Run the Calibration Cross. Adjust Canvas X/Y and offsets in Settings.

### Drawing is offset from center
**Cause**: X/Y offset values don't match your paper position.  
**Fix**: Adjust X Offset and Y Offset in Settings. Default is 40mm each.

### Lines drift or are not straight
**Cause**: Frame not square, or belt tension uneven.  
**Fix**: Check that the printer frame is square. Tighten all belts. Check that the X-axis is level.

---

## App Issues

### "Python not available" warning
**Cause**: Python 3 is not installed or not in PATH on the server.  
**Fix**: Install Python 3 and OpenCV (`pip install opencv-python-headless numpy Pillow scipy`). The app falls back to border-only G-code when Python is unavailable.

### Processing fails with no sketch preview
**Cause**: OpenCV not installed, or image format not supported.  
**Fix**: Install dependencies from `requirements.txt`. Use JPG, PNG, or WEBP images only.

### G-code download is empty
**Cause**: Processing error.  
**Fix**: Check the browser console for errors. Try a different image. Reduce detail level.

### Settings not saving
**Cause**: Browser localStorage blocked or in private mode.  
**Fix**: Allow localStorage in browser settings, or use a non-private window.

---

## Image Quality Issues

### Sketch has too many strokes / too detailed
**Fix**: Lower the detail level slider (try 2–3). Use a simpler source image.

### Sketch is unrecognisable / too simple
**Fix**: Raise the detail level slider (try 7–8). Use a higher-contrast source image.

### Background noise in sketch
**Fix**: Use a source image with a plain background. The ChatGPT prompt should remove backgrounds — re-run the prompt if needed.

### Sketch has disconnected dots and specks
**Fix**: Lower the detail level. The noise filter removes small contours, but very low detail levels may still produce some specks.

---

## Hardware Issues

### Pen holder slipping during drawing
**Fix**: Use a more secure mounting method. Zip ties or a printed holder are more reliable than tape.

### Paper shifting during drawing
**Fix**: Tape the paper to the bed at all four corners.

### Printer stops mid-drawing
**Cause**: SD card read error, or thermal runaway triggered (if heater is still connected).  
**Fix**: Ensure all heater/thermistor cables are disconnected. Use a reliable SD card.

### Z axis drifts during drawing
**Cause**: Z axis not locked, or gravity pulling the carriage down.  
**Fix**: After homing, the Z stepper holds position. If it drifts, check that M84 is not sent before the drawing is complete.
