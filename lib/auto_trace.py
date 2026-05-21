#!/usr/bin/env python3
"""
auto_trace.py
Sovol SV02 Pen Plotter — Raw photo to SVG auto-trace pipeline

Pipeline:
  1. Load + resize to max 1024px (preserve aspect ratio)
  2. Convert to grayscale
  3. CLAHE (clipLimit=2.0, tileGridSize=(8,8))
  4. Gaussian blur (5x5 kernel)
  5. Canny edge detection (low=50, high=150)
  6. Morphological closing (3x3 kernel, 1 iteration)
  7. cv2.findContours(RETR_LIST, CHAIN_APPROX_NONE)
  8. Filter contours with arc length < 5px
  9. Douglas-Peucker simplification (epsilon = 0.01 * arc_length)
  10. Scale coordinates to Drawing_Area mm space (preserve aspect ratio, center)
  11. Emit SVG: one <path d="M x,y L x,y ... Z"> per contour

Usage:
  python auto_trace.py <image_path> <output_json_path> <settings_json>

settings_json: {"canvas_x": float, "canvas_y": float, "offset_x": float, "offset_y": float}

Output JSON:
  {"svg": "...", "path_count": N, "error": null}
  or on error:
  {"error": "..."}
"""

import sys
import json
import cv2
import numpy as np

# ─── Constants ────────────────────────────────────────────────────────────────

MAX_IMAGE_DIM = 1024  # px — resize input to this before processing

DEFAULT_SETTINGS = {
    "canvas_x": 200.0,
    "canvas_y": 160.0,
    "offset_x": 40.0,
    "offset_y": 40.0,
}


# ─── Image Processing Pipeline ────────────────────────────────────────────────

def load_and_resize(path: str) -> np.ndarray:
    """Load image and resize to max 1024px on longest side, preserving aspect ratio."""
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")
    h, w = img.shape[:2]
    scale = min(MAX_IMAGE_DIM / w, MAX_IMAGE_DIM / h, 1.0)
    if scale < 1.0:
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return img


def apply_clahe(gray: np.ndarray) -> np.ndarray:
    """Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)."""
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def detect_edges(img: np.ndarray) -> np.ndarray:
    """
    Full edge detection pipeline:
    grayscale → CLAHE → Gaussian blur → Canny → morphological closing
    """
    # Step 2: Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Step 3: CLAHE
    enhanced = apply_clahe(gray)

    # Step 4: Gaussian blur (5x5 kernel)
    blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)

    # Step 5: Canny edge detection
    edges = cv2.Canny(blurred, 50, 150)

    # Step 6: Morphological closing (3x3 kernel, 1 iteration) — bridges gaps ≤3px
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=1)

    return closed


def find_and_simplify_contours(edges: np.ndarray) -> list:
    """
    Find contours, filter short ones, and simplify with Douglas-Peucker.
    Returns list of numpy arrays (each is a simplified contour).
    """
    # Step 7: Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

    simplified = []
    for cnt in contours:
        # Step 8: Filter contours with arc length < 5px
        arc_len = cv2.arcLength(cnt, closed=True)
        if arc_len < 5.0:
            continue

        # Step 9: Douglas-Peucker simplification (epsilon = 0.01 * arc_length)
        epsilon = 0.01 * arc_len
        approx = cv2.approxPolyDP(cnt, epsilon, closed=True)

        # Need at least 2 points to form a path
        if len(approx) >= 2:
            simplified.append(approx)

    return simplified


# ─── Coordinate Scaling ───────────────────────────────────────────────────────

def scale_contours_to_drawing_area(
    contours: list,
    img_shape: tuple,
    canvas_x: float,
    canvas_y: float,
) -> list:
    """
    Step 10: Scale pixel contours to mm coordinates within the Drawing_Area.
    Preserves aspect ratio and centers the drawing within the canvas.

    Returns list of lists of (x_mm, y_mm) tuples.
    Coordinates are relative to the Drawing_Area origin (0, 0), not the plotter offset.
    """
    img_h, img_w = img_shape[:2]

    # Compute scale to fit image into canvas while preserving aspect ratio
    scale_x = canvas_x / img_w
    scale_y = canvas_y / img_h
    scale = min(scale_x, scale_y)

    # Center offset within the Drawing_Area
    draw_w = img_w * scale
    draw_h = img_h * scale
    cx_offset = (canvas_x - draw_w) / 2.0
    cy_offset = (canvas_y - draw_h) / 2.0

    scaled = []
    for cnt in contours:
        pts = []
        for pt in cnt:
            px, py = float(pt[0][0]), float(pt[0][1])
            # Flip Y axis: image Y goes down, SVG Y also goes down (no flip needed for SVG)
            # SVG coordinate system: origin top-left, Y increases downward
            mx = cx_offset + px * scale
            my = cy_offset + py * scale
            pts.append((round(mx, 3), round(my, 3)))
        if len(pts) >= 2:
            scaled.append(pts)

    return scaled


# ─── SVG Generation ───────────────────────────────────────────────────────────

def points_to_path_d(points: list) -> str:
    """
    Convert a list of (x, y) tuples to an SVG path data string.
    Uses absolute M, L, Z commands only.
    """
    if not points:
        return ""

    parts = []
    x0, y0 = points[0]
    parts.append(f"M {x0},{y0}")

    for x, y in points[1:]:
        parts.append(f"L {x},{y}")

    parts.append("Z")
    return " ".join(parts)


def build_svg(
    scaled_contours: list,
    canvas_x: float,
    canvas_y: float,
) -> tuple[str, int]:
    """
    Step 11: Build SVG document with one <path> per contour.
    Returns (svg_string, path_count).
    """
    path_elements = []
    for pts in scaled_contours:
        d = points_to_path_d(pts)
        if d:
            path_elements.append(
                f'  <path d="{d}" stroke="black" fill="none" stroke-width="0.3"/>'
            )

    path_count = len(path_elements)
    paths_str = "\n".join(path_elements)

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {canvas_x} {canvas_y}" '
        f'width="{canvas_x}mm" height="{canvas_y}mm">\n'
        f'{paths_str}\n'
        f'</svg>'
    )

    return svg, path_count


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 4:
        print(
            "Usage: auto_trace.py <image_path> <output_json_path> <settings_json>",
            file=sys.stderr,
        )
        sys.exit(1)

    image_path = sys.argv[1]
    output_json_path = sys.argv[2]
    settings_str = sys.argv[3]

    # Parse settings (fall back to defaults on parse error)
    settings = {**DEFAULT_SETTINGS}
    try:
        user_settings = json.loads(settings_str)
        for key in ("canvas_x", "canvas_y", "offset_x", "offset_y"):
            if key in user_settings:
                settings[key] = float(user_settings[key])
    except (json.JSONDecodeError, ValueError, TypeError):
        pass  # use defaults

    canvas_x = settings["canvas_x"]
    canvas_y = settings["canvas_y"]

    try:
        # Step 1: Load + resize
        img = load_and_resize(image_path)

        # Steps 2–6: Edge detection pipeline
        edges = detect_edges(img)

        # Steps 7–9: Find, filter, and simplify contours
        contours = find_and_simplify_contours(edges)

        # Step 10: Scale to Drawing_Area mm coordinates
        scaled_contours = scale_contours_to_drawing_area(
            contours,
            img.shape,
            canvas_x,
            canvas_y,
        )

        # Step 11: Build SVG
        svg, path_count = build_svg(scaled_contours, canvas_x, canvas_y)

        result = {
            "svg": svg,
            "path_count": path_count,
            "error": None,
        }

    except ValueError as e:
        result = {"error": str(e)}
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        sys.exit(1)

    except cv2.error as e:
        result = {"error": f"OpenCV error: {e}"}
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        sys.exit(1)

    except Exception as e:
        result = {"error": f"Unexpected error: {e}"}
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        sys.exit(1)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f)

    print(f"Done: {path_count} paths traced from {image_path}")


if __name__ == "__main__":
    main()
