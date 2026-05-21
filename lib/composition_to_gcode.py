#!/usr/bin/env python3
"""
composition_to_gcode.py
Sovol SV02 Pen Plotter — Composition JSON to G-code converter

Accepts a composition JSON payload and produces a single G-code file with all
layers in the correct draw order, with nearest-neighbour travel optimisation.

Usage:
    python composition_to_gcode.py <composition_json_path> <output_json_path>

Output JSON:
    {
        "gcode": str,
        "stats": {
            "strokeCount": int,
            "estimatedTimeSeconds": int,
            "pathLengthMm": float
        },
        "error": null | str
    }
"""

import sys
import json
import math
import re
import xml.etree.ElementTree as ET

# ─── Defaults ─────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "z_draw": 0.0,
    "z_hop": 3.0,
    "feed_draw": 1500,
    "feed_travel": 3000,
    "canvas_x": 200.0,
    "canvas_y": 160.0,
    "offset_x": 40.0,
    "offset_y": 40.0,
    "detail_level": 5,
}

PASS_OFFSET = 0.3  # mm per additional pass


# ─── SVG Path Parser ──────────────────────────────────────────────────────────

def parse_svg_paths(svg_string):
    """
    Parse an SVG string and extract strokes as lists of (x, y) points.
    Handles M, L, Z commands only (as emitted by auto_trace.py).
    Returns a list of strokes, each stroke is a list of (x, y) tuples.
    """
    strokes = []
    if not svg_string:
        return strokes

    try:
        root = ET.fromstring(svg_string)
    except ET.ParseError:
        return strokes

    # Handle namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    for path_el in root.iter(f"{ns}path"):
        d = path_el.get("d", "")
        if not d:
            continue
        stroke_pts = _parse_path_d(d)
        strokes.extend(stroke_pts)

    return strokes


def _parse_path_d(d):
    """
    Parse a path `d` attribute string into a list of strokes.
    Each M command starts a new stroke; L continues it; Z closes it.
    Returns list of strokes (each stroke = list of (x, y) tuples).
    """
    strokes = []
    current = []

    # Tokenise: split on command letters, keeping the letter
    tokens = re.findall(r'[MLZmlz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?', d)

    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.upper() == "M":
            if current:
                strokes.append(current)
                current = []
            i += 1
            if i + 1 < len(tokens):
                try:
                    x, y = float(tokens[i]), float(tokens[i + 1])
                    current = [(x, y)]
                    i += 2
                except (ValueError, IndexError):
                    i += 1
        elif tok.upper() == "L":
            i += 1
            if i + 1 < len(tokens):
                try:
                    x, y = float(tokens[i]), float(tokens[i + 1])
                    current.append((x, y))
                    i += 2
                except (ValueError, IndexError):
                    i += 1
        elif tok.upper() == "Z":
            if current:
                # Close path: add first point again
                current.append(current[0])
                strokes.append(current)
                current = []
            i += 1
        else:
            # Numeric token without preceding command — skip
            i += 1

    if current:
        strokes.append(current)

    return [s for s in strokes if len(s) >= 2]


# ─── Nearest-Neighbour Travel Optimisation ────────────────────────────────────

def optimise_travel(strokes):
    """
    Reorder strokes using a nearest-neighbour greedy heuristic to minimise
    total pen-up travel distance. Also reverses strokes if approaching from end.
    Returns reordered list of strokes.
    """
    if not strokes:
        return strokes

    remaining = list(strokes)
    ordered = []
    current_pos = (0.0, 0.0)

    while remaining:
        best_idx = 0
        best_dist = float("inf")
        best_reversed = False

        for i, stroke in enumerate(remaining):
            start = stroke[0]
            end = stroke[-1]
            d_start = _dist(current_pos, start)
            d_end = _dist(current_pos, end)
            if d_start <= d_end:
                if d_start < best_dist:
                    best_dist = d_start
                    best_idx = i
                    best_reversed = False
            else:
                if d_end < best_dist:
                    best_dist = d_end
                    best_idx = i
                    best_reversed = True

        stroke = remaining.pop(best_idx)
        if best_reversed:
            stroke = list(reversed(stroke))
        ordered.append(stroke)
        current_pos = stroke[-1]

    return ordered


def _dist(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


# ─── G-code Emission ──────────────────────────────────────────────────────────

def fmt(n):
    return f"{n:.3f}"


def emit_stroke(stroke, settings):
    """Emit G-code lines for a single stroke (pen-down sequence)."""
    lines = []
    z_draw = settings["z_draw"]
    z_hop = settings["z_hop"]
    feed_draw = settings["feed_draw"]
    feed_travel = settings["feed_travel"]

    x0, y0 = stroke[0]
    lines.append(f"G0 X{fmt(x0)} Y{fmt(y0)} F{feed_travel}")
    lines.append(f"G0 Z{fmt(z_draw)} F{feed_travel}")
    for x, y in stroke[1:]:
        lines.append(f"G1 X{fmt(x)} Y{fmt(y)} F{feed_draw}")
    lines.append(f"G0 Z{fmt(z_hop)} F{feed_travel}")
    return lines


def emit_layer(strokes, settings, section_comment):
    """Emit G-code for a complete layer with section comment and optimised travel."""
    lines = [f"; === {section_comment}"]
    optimised = optimise_travel(strokes)
    for stroke in optimised:
        lines.extend(emit_stroke(stroke, settings))
    return lines, optimised


# ─── Border Layer ─────────────────────────────────────────────────────────────

def border_to_strokes(border_config, drawing_area, settings):
    """
    Generate border strokes from border config.
    Returns list of strokes (each stroke = list of (x, y) tuples).
    """
    style = border_config.get("style", "none")
    margin = float(border_config.get("margin", 5.0))
    thickness = int(border_config.get("thickness", 1))

    if style == "none":
        return []

    x = float(drawing_area.get("x", settings["offset_x"]))
    y = float(drawing_area.get("y", settings["offset_y"]))
    w = float(drawing_area.get("width", settings["canvas_x"]))
    h = float(drawing_area.get("height", settings["canvas_y"]))

    bx = x - margin
    by = y - margin
    bx2 = x + w + margin
    by2 = y + h + margin

    strokes = []

    for pass_idx in range(thickness):
        offset = pass_idx * PASS_OFFSET
        px, py = bx - offset, by - offset
        px2, py2 = bx2 + offset, by2 + offset

        if style in ("simple-rect", "rounded-rect", "double-line"):
            strokes.append([(px, py), (px2, py), (px2, py2), (px, py2), (px, py)])
            if style == "double-line":
                gap = 2.0
                strokes.append([
                    (px - gap, py - gap), (px2 + gap, py - gap),
                    (px2 + gap, py2 + gap), (px - gap, py2 + gap),
                    (px - gap, py - gap)
                ])
        elif style == "corner-marks":
            arm = 8.0
            corners = [(px, py, 1, 1), (px2, py, -1, 1),
                       (px2, py2, -1, -1), (px, py2, 1, -1)]
            for cx, cy, dx, dy in corners:
                ocx = cx - dx * offset
                ocy = cy - dy * offset
                strokes.append([(ocx, ocy), (ocx + dx * arm, ocy)])
                strokes.append([(ocx, ocy), (ocx, ocy + dy * arm)])
        elif style == "dashed":
            dash, gap = 4.0, 2.0
            period = dash + gap
            sides = [(px, py, px2, py), (px2, py, px2, py2),
                     (px2, py2, px, py2), (px, py2, px, py)]
            for x1, y1, x2, y2 in sides:
                dx, dy = x2 - x1, y2 - y1
                length = math.sqrt(dx * dx + dy * dy)
                if length == 0:
                    continue
                ux, uy = dx / length, dy / length
                t = 0.0
                while t < length:
                    end_t = min(t + dash, length)
                    strokes.append([
                        (x1 + ux * t, y1 + uy * t),
                        (x1 + ux * end_t, y1 + uy * end_t)
                    ])
                    t += period
        elif style == "ornamental-corners":
            box = 12.0
            corners = [(px, py, 1, 1), (px2, py, -1, 1),
                       (px2, py2, -1, -1), (px, py2, 1, -1)]
            for cx, cy, dx, dy in corners:
                ocx = cx - dx * offset
                ocy = cy - dy * offset
                # Approximate Bezier with line segments
                p0 = (ocx + dx * box, ocy)
                p3 = (ocx, ocy + dy * box)
                cp1 = (ocx + dx * box * 0.8, ocy + dy * box * 0.2)
                cp2 = (ocx + dx * box * 0.2, ocy + dy * box * 0.8)
                pts = []
                for i in range(21):
                    t = i / 20.0
                    mt = 1 - t
                    bx_pt = mt**3*p0[0] + 3*mt**2*t*cp1[0] + 3*mt*t**2*cp2[0] + t**3*p3[0]
                    by_pt = mt**3*p0[1] + 3*mt**2*t*cp1[1] + 3*mt*t**2*cp2[1] + t**3*p3[1]
                    pts.append((bx_pt, by_pt))
                strokes.append(pts)

    return strokes


# ─── Text Layer ───────────────────────────────────────────────────────────────

def text_element_to_strokes(element):
    """
    Convert a text element to strokes using pre-resolved SVG path data if available,
    or generate simple placeholder strokes based on position.
    """
    # Text elements carry pre-resolved svgPaths from the frontend renderer.
    # If svgPaths is provided, parse them; otherwise use position as a single dot.
    svg_paths = element.get("svgPaths", "")
    x = float(element.get("x", 0))
    y = float(element.get("y", 0))
    passes = int(element.get("passes", 1))

    if svg_paths:
        strokes = parse_svg_paths(svg_paths)
        # Apply multi-pass offset
        all_strokes = []
        for pass_idx in range(passes):
            offset = pass_idx * PASS_OFFSET
            for stroke in strokes:
                all_strokes.append([(px, py + offset) for px, py in stroke])
        return all_strokes

    # Fallback: single dot at position
    return [[(x, y), (x + 0.1, y)]]


# ─── Sticker Layer ────────────────────────────────────────────────────────────

def sticker_element_to_strokes(element):
    """
    Convert a sticker element to strokes by parsing its pre-resolved SVG path data,
    scaling to element size, and translating to element position.
    """
    svg_paths_str = element.get("svgPaths", "")
    x = float(element.get("x", 0))
    y = float(element.get("y", 0))
    width = float(element.get("width", 20))
    height = float(element.get("height", 20))
    passes = int(element.get("passes", 1))

    if not svg_paths_str:
        return []

    # Parse the SVG — sticker SVGs use viewBox="0 0 100 100"
    raw_strokes = parse_svg_paths(svg_paths_str)

    # Scale from 0-100 viewBox to element dimensions and translate to position
    scale_x = width / 100.0
    scale_y = height / 100.0

    scaled_strokes = []
    for stroke in raw_strokes:
        scaled = [(x + px * scale_x, y + py * scale_y) for px, py in stroke]
        scaled_strokes.append(scaled)

    # Apply multi-pass offset
    all_strokes = []
    for pass_idx in range(passes):
        offset = pass_idx * PASS_OFFSET
        for stroke in scaled_strokes:
            all_strokes.append([(px, py + offset) for px, py in stroke])

    return all_strokes


# ─── Stats Calculation ────────────────────────────────────────────────────────

def calculate_stats(all_strokes, settings):
    """Calculate stroke count, path length, and estimated time."""
    stroke_count = len(all_strokes)
    path_length_mm = 0.0

    for stroke in all_strokes:
        for i in range(1, len(stroke)):
            path_length_mm += _dist(stroke[i - 1], stroke[i])

    feed_draw = settings.get("feed_draw", 1500)  # mm/min
    estimated_time_s = int((path_length_mm / feed_draw) * 60) if feed_draw > 0 else 0

    return {
        "strokeCount": stroke_count,
        "estimatedTimeSeconds": estimated_time_s,
        "pathLengthMm": round(path_length_mm, 2),
    }


# ─── Main G-code Assembly ─────────────────────────────────────────────────────

def generate_gcode(composition):
    """
    Generate G-code from a composition payload.
    Returns (gcode_string, stats_dict).
    """
    settings = {**DEFAULT_SETTINGS, **composition.get("settings", {})}
    drawing_area = composition.get("drawingArea", {
        "x": settings["offset_x"],
        "y": settings["offset_y"],
        "width": settings["canvas_x"],
        "height": settings["canvas_y"],
    })
    border_config = composition.get("border", {"style": "none", "margin": 5, "thickness": 1})
    base_layer = composition.get("baseLayer", {})
    text_elements = composition.get("textElements", [])
    sticker_elements = composition.get("stickerElements", [])

    z_hop = settings["z_hop"]
    feed_travel = settings["feed_travel"]

    lines = []

    # ── Header ────────────────────────────────────────────────────────────────
    lines.append("; === HEADER")
    lines.append("G21 ; mm units")
    lines.append("G90 ; absolute positioning")
    lines.append("G28 X Y ; home X and Y")
    lines.append(f"G0 Z{fmt(z_hop)} F{feed_travel} ; initial Z-hop")

    # ── Border ────────────────────────────────────────────────────────────────
    border_strokes = border_to_strokes(border_config, drawing_area, settings)
    border_lines, _ = emit_layer(border_strokes, settings, "BORDER")
    lines.extend(border_lines)

    # ── Base Image ────────────────────────────────────────────────────────────
    base_strokes = []
    if base_layer.get("type") == "svg" and base_layer.get("svg"):
        base_strokes = parse_svg_paths(base_layer["svg"])
    elif base_layer.get("type") == "paths" and base_layer.get("paths"):
        # paths is a list of strokes, each stroke is a list of [x, y] pairs
        for stroke_data in base_layer["paths"]:
            if isinstance(stroke_data, list) and len(stroke_data) >= 2:
                base_strokes.append([(float(pt[0]), float(pt[1])) for pt in stroke_data])

    base_lines, _ = emit_layer(base_strokes, settings, "BASE IMAGE")
    lines.extend(base_lines)

    # ── Text Elements ─────────────────────────────────────────────────────────
    all_text_strokes = []
    for element in text_elements:
        all_text_strokes.extend(text_element_to_strokes(element))
    text_lines, _ = emit_layer(all_text_strokes, settings, "TEXT")
    lines.extend(text_lines)

    # ── Sticker Elements ──────────────────────────────────────────────────────
    all_sticker_strokes = []
    for element in sticker_elements:
        all_sticker_strokes.extend(sticker_element_to_strokes(element))
    sticker_lines, _ = emit_layer(all_sticker_strokes, settings, "STICKERS")
    lines.extend(sticker_lines)

    # ── Footer ────────────────────────────────────────────────────────────────
    lines.append("; === FOOTER")
    lines.append(f"G0 Z{fmt(z_hop)} F{feed_travel} ; pen up")
    lines.append(f"G0 X0 Y0 F{feed_travel} ; return to origin")
    lines.append("M84 ; disable motors")

    gcode = "\n".join(lines)

    # Collect all strokes for stats
    all_strokes = border_strokes + base_strokes + all_text_strokes + all_sticker_strokes
    stats = calculate_stats(all_strokes, settings)

    return gcode, stats


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: composition_to_gcode.py <composition_json_path> <output_json_path>")
        sys.exit(1)

    composition_json_path = sys.argv[1]
    output_json_path = sys.argv[2]

    try:
        with open(composition_json_path, "r", encoding="utf-8") as f:
            composition = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        result = {"error": f"Failed to read composition JSON: {e}"}
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        sys.exit(1)

    try:
        gcode, stats = generate_gcode(composition)
        result = {"gcode": gcode, "stats": stats, "error": None}
    except Exception as e:
        result = {"error": f"G-code generation failed: {e}"}
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        sys.exit(1)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f)

    print(f"Done: {stats['strokeCount']} strokes, {stats['pathLengthMm']:.1f}mm, "
          f"~{stats['estimatedTimeSeconds']}s")


if __name__ == "__main__":
    main()
