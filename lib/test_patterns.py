#!/usr/bin/env python3
"""
test_patterns.py
Generates all 5 calibration test pattern G-code files for the Sovol SV02 pen plotter.

Patterns:
  1. smiley_face       — tests basic arc drawing and pen pressure
  2. square_maze       — tests corner accuracy and straight line consistency
  3. concentric_circles — tests arc consistency and motor synchronisation
  4. calibration_cross — tests canvas mapping and drawing area
  5. zhop_test         — tests Z-hop height (pen not dragging between strokes)
"""

import math
import os
import sys

# Add parent dir to path so we can import gcode_utils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gcode_utils import (
    DEFAULT_SETTINGS,
    gcode_header,
    gcode_footer,
    pen_down,
    pen_up,
    travel_to,
    draw_to,
    arc_cw,
    arc_ccw,
    estimate_time,
    path_length,
)


def write_gcode(filename: str, lines: list[str], settings: dict) -> None:
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, "w") as f:
        f.write("\n".join(lines))
    print(f"Written: {filename}")


# ─── Pattern 1: Smiley Face ───────────────────────────────────────────────────

def gen_smiley(settings: dict, output_dir: str) -> None:
    s = settings
    cx = s["offset_x"] + s["canvas_x"] / 2
    cy = s["offset_y"] + s["canvas_y"] / 2

    lines = gcode_header(s)
    lines.append("; === SMILEY FACE ===")
    lines.append("; Tests: arc drawing, pen pressure, circle accuracy")
    lines.append("")

    # Outer face circle (radius 40mm)
    r = 40.0
    lines.append(f"; Face circle (r={r}mm)")
    lines.append(travel_to(cx + r, cy, s))
    lines.append(pen_down(s))
    lines.append(arc_cw(cx + r, cy, -r, 0, s) + " ; full circle")
    lines.append(pen_up(s))
    lines.append("")

    # Left eye (radius 5mm, center at cx-15, cy+15)
    ex1, ey1 = cx - 15, cy + 15
    er = 5.0
    lines.append(f"; Left eye")
    lines.append(travel_to(ex1 + er, ey1, s))
    lines.append(pen_down(s))
    lines.append(arc_cw(ex1 + er, ey1, -er, 0, s) + " ; full circle")
    lines.append(pen_up(s))
    lines.append("")

    # Right eye (radius 5mm, center at cx+15, cy+15)
    ex2, ey2 = cx + 15, cy + 15
    lines.append(f"; Right eye")
    lines.append(travel_to(ex2 + er, ey2, s))
    lines.append(pen_down(s))
    lines.append(arc_cw(ex2 + er, ey2, -er, 0, s) + " ; full circle")
    lines.append(pen_up(s))
    lines.append("")

    # Smile arc (from cx-20,cy-5 to cx+20,cy-5, curving down to cy-20)
    lines.append("; Smile arc")
    lines.append(travel_to(cx - 20, cy - 5, s))
    lines.append(pen_down(s))
    lines.append(f"G2 X{cx + 20:.3f} Y{cy - 5:.3f} I20.000 J-10.000 F{s['feed_draw']}")
    lines.append(pen_up(s))
    lines.append("")

    # Left eyebrow
    lines.append("; Left eyebrow")
    lines.append(travel_to(ex1 - 8, ey1 + 10, s))
    lines.append(pen_down(s))
    lines.append(draw_to(ex1 + 8, ey1 + 12, s))
    lines.append(pen_up(s))
    lines.append("")

    # Right eyebrow
    lines.append("; Right eyebrow")
    lines.append(travel_to(ex2 - 8, ey2 + 12, s))
    lines.append(pen_down(s))
    lines.append(draw_to(ex2 + 8, ey2 + 10, s))
    lines.append(pen_up(s))
    lines.append("")

    lines += gcode_footer(s)
    write_gcode(os.path.join(output_dir, "test_smiley.gcode"), lines, s)


# ─── Pattern 2: Square Maze ───────────────────────────────────────────────────

def gen_maze(settings: dict, output_dir: str) -> None:
    s = settings
    # 5x5 grid of 20x20mm squares, starting at offset+10
    grid_x = s["offset_x"] + 10
    grid_y = s["offset_y"] + 10
    cell = 20
    cols, rows = 5, 5

    lines = gcode_header(s)
    lines.append("; === SQUARE MAZE (5x5 grid) ===")
    lines.append("; Tests: corner accuracy, straight line consistency")
    lines.append("")

    # Outer border of maze
    mx = grid_x
    my = grid_y
    mw = cols * cell
    mh = rows * cell

    lines.append("; Outer border")
    lines.append(travel_to(mx, my, s))
    lines.append(pen_down(s))
    lines.append(draw_to(mx + mw, my, s))
    lines.append(draw_to(mx + mw, my + mh, s))
    lines.append(draw_to(mx, my + mh, s))
    lines.append(draw_to(mx, my, s))
    lines.append(pen_up(s))
    lines.append("")

    # Internal walls — a simple fixed maze pattern
    # Each wall is defined as (col, row, direction) where direction is 'h' or 'v'
    # 'h' = horizontal wall on top of cell (col, row)
    # 'v' = vertical wall on right of cell (col, row)
    walls = [
        # Horizontal walls (top of cell)
        (0, 1, 'h'), (1, 1, 'h'), (3, 1, 'h'), (4, 1, 'h'),
        (0, 2, 'h'), (2, 2, 'h'), (3, 2, 'h'),
        (1, 3, 'h'), (2, 3, 'h'), (4, 3, 'h'),
        (0, 4, 'h'), (3, 4, 'h'),
        # Vertical walls (right of cell)
        (0, 0, 'v'), (2, 0, 'v'), (3, 0, 'v'),
        (1, 1, 'v'), (3, 1, 'v'),
        (0, 2, 'v'), (2, 2, 'v'), (4, 2, 'v'),
        (1, 3, 'v'), (3, 3, 'v'),
        (0, 4, 'v'), (2, 4, 'v'),
    ]

    lines.append("; Internal walls")
    for col, row, direction in walls:
        if direction == 'h':
            x1 = mx + col * cell
            y1 = my + row * cell
            x2 = x1 + cell
            y2 = y1
        else:  # 'v'
            x1 = mx + (col + 1) * cell
            y1 = my + row * cell
            x2 = x1
            y2 = y1 + cell

        lines.append(travel_to(x1, y1, s))
        lines.append(pen_down(s))
        lines.append(draw_to(x2, y2, s))
        lines.append(pen_up(s))

    lines.append("")
    lines += gcode_footer(s)
    write_gcode(os.path.join(output_dir, "test_square_maze.gcode"), lines, s)


# ─── Pattern 3: Concentric Circles ────────────────────────────────────────────

def gen_concentric_circles(settings: dict, output_dir: str) -> None:
    s = settings
    cx = s["offset_x"] + s["canvas_x"] / 2
    cy = s["offset_y"] + s["canvas_y"] / 2

    lines = gcode_header(s)
    lines.append("; === CONCENTRIC CIRCLES (8 circles) ===")
    lines.append("; Tests: arc consistency, motor synchronisation, roundness")
    lines.append("")

    for i in range(1, 9):
        r = i * 10.0  # 10mm to 80mm
        lines.append(f"; Circle r={r}mm")
        lines.append(travel_to(cx + r, cy, s))
        lines.append(pen_down(s))
        lines.append(arc_cw(cx + r, cy, -r, 0, s) + f" ; r={r}mm full circle")
        lines.append(pen_up(s))
        lines.append("")

    lines += gcode_footer(s)
    write_gcode(os.path.join(output_dir, "test_concentric_circles.gcode"), lines, s)


# ─── Pattern 4: Calibration Cross ─────────────────────────────────────────────

def gen_calibration_cross(settings: dict, output_dir: str) -> None:
    s = settings
    ox = s["offset_x"]
    oy = s["offset_y"]
    cx_end = ox + s["canvas_x"]
    cy_end = oy + s["canvas_y"]
    cx = ox + s["canvas_x"] / 2
    cy = oy + s["canvas_y"] / 2

    lines = gcode_header(s)
    lines.append("; === CALIBRATION CROSS ===")
    lines.append("; Tests: canvas mapping, drawing area verification")
    lines.append("; Expected: cross spans full 200x160mm area, corners at exact positions")
    lines.append("")

    # Horizontal line (full width)
    lines.append("; Horizontal axis")
    lines.append(travel_to(ox, cy, s))
    lines.append(pen_down(s))
    lines.append(draw_to(cx_end, cy, s))
    lines.append(pen_up(s))
    lines.append("")

    # Vertical line (full height)
    lines.append("; Vertical axis")
    lines.append(travel_to(cx, oy, s))
    lines.append(pen_down(s))
    lines.append(draw_to(cx, cy_end, s))
    lines.append(pen_up(s))
    lines.append("")

    # Corner dots (small cross marks)
    corners = [
        (ox, oy, "bottom-left"),
        (cx_end, oy, "bottom-right"),
        (ox, cy_end, "top-left"),
        (cx_end, cy_end, "top-right"),
        (cx, cy, "center"),
    ]
    dot_size = 3.0
    for dx, dy, label in corners:
        lines.append(f"; Corner dot: {label}")
        lines.append(travel_to(dx - dot_size, dy, s))
        lines.append(pen_down(s))
        lines.append(draw_to(dx + dot_size, dy, s))
        lines.append(pen_up(s))
        lines.append(travel_to(dx, dy - dot_size, s))
        lines.append(pen_down(s))
        lines.append(draw_to(dx, dy + dot_size, s))
        lines.append(pen_up(s))
        lines.append("")

    # Tick marks every 10mm along horizontal axis
    lines.append("; Tick marks — horizontal axis (every 10mm)")
    tick_h = 3.0
    x = ox + 10
    while x < cx_end:
        lines.append(travel_to(x, cy - tick_h, s))
        lines.append(pen_down(s))
        lines.append(draw_to(x, cy + tick_h, s))
        lines.append(pen_up(s))
        x += 10

    lines.append("")

    # Tick marks every 10mm along vertical axis
    lines.append("; Tick marks — vertical axis (every 10mm)")
    y = oy + 10
    while y < cy_end:
        lines.append(travel_to(cx - tick_h, y, s))
        lines.append(pen_down(s))
        lines.append(draw_to(cx + tick_h, y, s))
        lines.append(pen_up(s))
        y += 10

    lines.append("")
    lines += gcode_footer(s)
    write_gcode(os.path.join(output_dir, "test_calibration_cross.gcode"), lines, s)


# ─── Pattern 5: Z-Hop Test ────────────────────────────────────────────────────

def gen_zhop_test(settings: dict, output_dir: str) -> None:
    s = settings
    ox = s["offset_x"]
    oy = s["offset_y"]
    cy = oy + s["canvas_y"] / 2

    lines = gcode_header(s)
    lines.append("; === Z-HOP TEST (10 lines with Z-hops) ===")
    lines.append("; Tests: Z-hop height — pen must NOT drag between lines")
    lines.append("; Expected: 10 clean separate lines with clear gaps between them")
    lines.append("; If lines are connected by drag marks, increase Z_HOP in settings")
    lines.append("")

    line_length = 15.0
    gap = 15.0
    line_height = 10.0

    for i in range(10):
        x = ox + 10 + i * gap
        y_bottom = cy - line_height / 2
        y_top = cy + line_height / 2

        lines.append(f"; Line {i + 1} of 10")
        lines.append(travel_to(x, y_bottom, s))
        lines.append(pen_down(s))
        lines.append(draw_to(x, y_top, s))
        lines.append(pen_up(s))
        lines.append("")

    lines += gcode_footer(s)
    write_gcode(os.path.join(output_dir, "test_zhop.gcode"), lines, s)


# ─── Main ─────────────────────────────────────────────────────────────────────

def generate_all(output_dir: str, settings: dict = None) -> None:
    s = {**DEFAULT_SETTINGS, **(settings or {})}
    os.makedirs(output_dir, exist_ok=True)

    gen_smiley(s, output_dir)
    gen_maze(s, output_dir)
    gen_concentric_circles(s, output_dir)
    gen_calibration_cross(s, output_dir)
    gen_zhop_test(s, output_dir)

    print(f"\nAll 5 test patterns written to: {output_dir}")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "public/test-patterns"
    generate_all(out)
