#!/usr/bin/env python3
"""
sketch_to_gcode.py
Sovol SV02 Pen Plotter — Image to G-code converter

Pipeline:
  1. Load and resize image
  2. Convert to grayscale
  3. Apply Gaussian blur
  4. Canny edge detection (thresholds driven by detail_level)
  5. Morphological dilation to thicken edges
  6. Find contours
  7. Simplify contours with Douglas-Peucker (epsilon driven by detail_level)
  8. Filter tiny contours
  9. Scale paths into safe drawing area
  10. Generate G-code with Z-hops
  11. Output JSON with gcode, stats, and sketch preview (base64 PNG)
"""

import sys
import json
import base64
import math
import cv2
import numpy as np
from io import BytesIO

# ─── Constants ────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "z_draw": 0.0,
    "z_hop": 3.0,
    "feed_draw": 1500,
    "feed_travel": 3000,
    "canvas_x": 200,
    "canvas_y": 160,
    "offset_x": 40,
    "offset_y": 40,
    "detail_level": 5,
}

BORDER_RADIUS = 3.0   # mm — rounded corner radius
BORDER_GAP = 5.0      # mm — gap between image area and border
MAX_IMAGE_DIM = 1024  # px — resize input to this before processing


# ─── Image Processing ─────────────────────────────────────────────────────────

def load_and_resize(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")
    h, w = img.shape[:2]
    scale = min(MAX_IMAGE_DIM / w, MAX_IMAGE_DIM / h, 1.0)
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def image_to_edges(img: np.ndarray, detail_level: int) -> np.ndarray:
    """
    Convert image to edge map.
    detail_level 1 = very simple (high thresholds, heavy blur)
    detail_level 10 = detailed (low thresholds, light blur)
    """
    # Map detail_level 1-10 to processing parameters
    blur_size = max(1, 11 - detail_level)  # 10 at level 1, 1 at level 10
    if blur_size % 2 == 0:
        blur_size += 1  # must be odd

    # Canny thresholds: lower detail = higher thresholds (fewer edges)
    t_low = int(np.interp(detail_level, [1, 10], [80, 20]))
    t_high = int(np.interp(detail_level, [1, 10], [200, 60]))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (blur_size, blur_size), 0)
    edges = cv2.Canny(blurred, t_low, t_high)

    # Dilate to thicken edges (simulates thick marker)
    dilation_size = max(1, 4 - detail_level // 3)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation_size, dilation_size))
    edges = cv2.dilate(edges, kernel, iterations=1)

    return edges


def find_and_simplify_contours(edges: np.ndarray, detail_level: int) -> list:
    """
    Find contours and simplify with Douglas-Peucker.
    Returns list of numpy arrays (each is a contour).
    """
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

    # Epsilon for Douglas-Peucker: higher = more simplification
    epsilon_factor = np.interp(detail_level, [1, 10], [0.05, 0.005])

    simplified = []
    for cnt in contours:
        arc_len = cv2.arcLength(cnt, closed=False)
        if arc_len < 5:  # skip tiny fragments
            continue
        epsilon = epsilon_factor * arc_len
        approx = cv2.approxPolyDP(cnt, epsilon, closed=False)
        if len(approx) >= 2:
            simplified.append(approx)

    # Filter by minimum arc length (removes noise dots)
    min_len = np.interp(detail_level, [1, 10], [20, 5])
    filtered = [c for c in simplified if cv2.arcLength(c, False) >= min_len]

    return filtered


def render_sketch_preview(contours: list, img_shape: tuple) -> str:
    """
    Render contours onto a white canvas and return as base64 PNG.
    """
    h, w = img_shape[:2]
    canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    cv2.drawContours(canvas, contours, -1, (0, 0, 0), 2)

    _, buf = cv2.imencode(".png", canvas)
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


# ─── G-code Generation ────────────────────────────────────────────────────────

def scale_contours_to_canvas(
    contours: list,
    img_shape: tuple,
    canvas_x: float,
    canvas_y: float,
    offset_x: float,
    offset_y: float,
) -> list:
    """
    Scale pixel contours to mm coordinates within the safe drawing area.
    Maintains aspect ratio and centers the drawing.
    """
    img_h, img_w = img_shape[:2]

    # Compute scale to fit image into canvas while preserving aspect ratio
    scale_x = canvas_x / img_w
    scale_y = canvas_y / img_h
    scale = min(scale_x, scale_y)

    # Center offset
    draw_w = img_w * scale
    draw_h = img_h * scale
    cx_offset = (canvas_x - draw_w) / 2
    cy_offset = (canvas_y - draw_h) / 2

    scaled = []
    for cnt in contours:
        pts = []
        for pt in cnt:
            px, py = pt[0]
            # Flip Y (image Y goes down, plotter Y goes up)
            mx = offset_x + cx_offset + px * scale
            my = offset_y + cy_offset + (img_h - py) * scale
            pts.append((round(mx, 3), round(my, 3)))
        if len(pts) >= 2:
            scaled.append(pts)

    return scaled


def generate_border_gcode(
    canvas_x: float,
    canvas_y: float,
    offset_x: float,
    offset_y: float,
    z_draw: float,
    z_hop: float,
    feed_draw: int,
    feed_travel: int,
    gap: float = BORDER_GAP,
    radius: float = BORDER_RADIUS,
) -> list[str]:
    """
    Generate G-code for a rounded rectangular border.
    Border is drawn FIRST before any image content.
    """
    lines = ["; === BORDER (rounded rectangle) ==="]

    bx = offset_x - gap
    by = offset_y - gap
    bx2 = offset_x + canvas_x + gap
    by2 = offset_y + canvas_y + gap
    r = radius

    # Travel to start (bottom-left, after corner arc start)
    lines.append(f"G0 X{bx + r:.3f} Y{by:.3f} F{feed_travel}")
    lines.append(f"G0 Z{z_draw:.3f} F{feed_travel} ; pen down")

    # Bottom edge →
    lines.append(f"G1 X{bx2 - r:.3f} Y{by:.3f} F{feed_draw}")
    # Bottom-right corner arc
    lines.append(f"G2 X{bx2:.3f} Y{by + r:.3f} I0 J{r:.3f}")
    # Right edge ↑
    lines.append(f"G1 X{bx2:.3f} Y{by2 - r:.3f} F{feed_draw}")
    # Top-right corner arc
    lines.append(f"G2 X{bx2 - r:.3f} Y{by2:.3f} I{-r:.3f} J0")
    # Top edge ←
    lines.append(f"G1 X{bx + r:.3f} Y{by2:.3f} F{feed_draw}")
    # Top-left corner arc
    lines.append(f"G2 X{bx:.3f} Y{by2 - r:.3f} I0 J{-r:.3f}")
    # Left edge ↓
    lines.append(f"G1 X{bx:.3f} Y{by + r:.3f} F{feed_draw}")
    # Bottom-left corner arc (close)
    lines.append(f"G2 X{bx + r:.3f} Y{by:.3f} I{r:.3f} J0")

    lines.append(f"G0 Z{z_hop:.3f} F{feed_travel} ; pen up")
    lines.append("")

    return lines


def paths_to_gcode(
    paths: list,
    z_draw: float,
    z_hop: float,
    feed_draw: int,
    feed_travel: int,
) -> tuple[list[str], int, float]:
    """
    Convert list of (x,y) paths to G-code lines.
    Returns (lines, stroke_count, total_path_length_mm).
    """
    lines = ["; === DRAWING PATHS ==="]
    stroke_count = 0
    total_length = 0.0

    for path in paths:
        if len(path) < 2:
            continue

        stroke_count += 1
        x0, y0 = path[0]

        # Travel to stroke start at Z_HOP
        lines.append(f"G0 X{x0:.3f} Y{y0:.3f} F{feed_travel}")
        lines.append(f"G0 Z{z_draw:.3f} F{feed_travel} ; pen down")

        prev_x, prev_y = x0, y0
        for x, y in path[1:]:
            lines.append(f"G1 X{x:.3f} Y{y:.3f} F{feed_draw}")
            total_length += math.hypot(x - prev_x, y - prev_y)
            prev_x, prev_y = x, y

        # Pen up after stroke
        lines.append(f"G0 Z{z_hop:.3f} F{feed_travel} ; pen up")
        lines.append("")

    return lines, stroke_count, total_length


def build_gcode(
    paths: list,
    settings: dict,
    border_length_mm: float = 0.0,
) -> tuple[str, dict]:
    """
    Assemble complete G-code file with header, border, paths, and footer.
    """
    z_draw = settings["z_draw"]
    z_hop = settings["z_hop"]
    feed_draw = settings["feed_draw"]
    feed_travel = settings["feed_travel"]
    canvas_x = settings["canvas_x"]
    canvas_y = settings["canvas_y"]
    offset_x = settings["offset_x"]
    offset_y = settings["offset_y"]

    lines = []

    # Header
    lines += [
        "; Sovol SV02 Pen Plotter G-code",
        "; Generated by Sovol Pen Plotter Web App",
        f"; Canvas: {canvas_x}x{canvas_y}mm  Offset: ({offset_x},{offset_y})mm",
        f"; Z_DRAW={z_draw}mm  Z_HOP={z_hop}mm",
        f"; Feed draw={feed_draw}mm/min  travel={feed_travel}mm/min",
        ";",
        "G21 ; mm units",
        "G90 ; absolute positioning",
        "G28 X Y ; home X and Y ONLY (never home Z with pen attached)",
        f"G0 Z{z_hop:.3f} F{feed_travel} ; pen up — safe travel height",
        "",
    ]

    # Border first
    border_lines = generate_border_gcode(
        canvas_x, canvas_y, offset_x, offset_y,
        z_draw, z_hop, feed_draw, feed_travel
    )
    lines += border_lines

    # Drawing paths
    path_lines, stroke_count, path_length = paths_to_gcode(
        paths, z_draw, z_hop, feed_draw, feed_travel
    )
    lines += path_lines

    # Footer
    lines += [
        "; === FOOTER ===",
        f"G0 Z{z_hop + 5:.3f} F{feed_travel} ; raise pen safely",
        f"G0 X{offset_x:.3f} Y{offset_y:.3f} F{feed_travel} ; return to origin",
        "M84 ; disable steppers",
    ]

    gcode = "\n".join(lines)

    # Estimate draw time
    total_length = path_length + border_length_mm
    draw_time_s = (path_length / feed_draw) * 60
    travel_time_s = (total_length * 0.3 / feed_travel) * 60  # rough travel estimate
    estimated_time_s = int(draw_time_s + travel_time_s)

    stats = {
        "strokeCount": stroke_count,
        "estimatedTimeSeconds": estimated_time_s,
        "pathLengthMm": round(path_length, 1),
    }

    return gcode, stats


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 4:
        print("Usage: sketch_to_gcode.py <input_image> <output_json> <settings_json>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    settings_str = sys.argv[3]

    # Parse settings
    settings = {**DEFAULT_SETTINGS}
    try:
        user_settings = json.loads(settings_str)
        settings.update(user_settings)
    except json.JSONDecodeError:
        pass  # use defaults

    detail_level = int(settings.get("detail_level", 5))

    # Process image
    img = load_and_resize(input_path)
    edges = image_to_edges(img, detail_level)
    contours = find_and_simplify_contours(edges, detail_level)

    # Render sketch preview
    sketch_data_url = render_sketch_preview(contours, img.shape)

    # Scale to plotter coordinates
    paths = scale_contours_to_canvas(
        contours,
        img.shape,
        settings["canvas_x"],
        settings["canvas_y"],
        settings["offset_x"],
        settings["offset_y"],
    )

    # Generate G-code
    gcode, stats = build_gcode(paths, settings)

    # Write output JSON
    result = {
        "gcode": gcode,
        "sketchDataUrl": sketch_data_url,
        "stats": stats,
    }

    with open(output_path, "w") as f:
        json.dump(result, f)

    print(f"Done: {stats['strokeCount']} strokes, ~{stats['estimatedTimeSeconds']}s")


if __name__ == "__main__":
    main()
