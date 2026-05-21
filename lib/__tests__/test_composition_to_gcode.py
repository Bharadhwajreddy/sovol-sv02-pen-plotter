"""
test_composition_to_gcode.py
Property-based tests for composition_to_gcode.py

# Feature: plotter-studio-upgrade, Property 7: G-code Layer Order
# Feature: plotter-studio-upgrade, Property 8: G-code Validity

Validates: Requirements 11.1, 11.3, 11.8
"""

import sys
import os
import json
import subprocess
import tempfile
import unittest

from hypothesis import given, settings, assume
import hypothesis.strategies as st

# ─── Helpers ──────────────────────────────────────────────────────────────────

SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "lib", "composition_to_gcode.py"
)

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

DEFAULT_DRAWING_AREA = {
    "x": 40.0,
    "y": 40.0,
    "width": 100.0,
    "height": 80.0,
}

SIMPLE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">'
    '<path d="M 10,10 L 50,10 L 50,50 Z" stroke="black" fill="none"/>'
    '</svg>'
)

SIMPLE_STICKER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<path d="M 10,10 L 90,10 L 90,90 L 10,90 Z" stroke="black" fill="none"/>'
    '</svg>'
)


def make_composition(border_style="simple-rect", include_text=True,
                     include_sticker=True, include_base=True):
    """Build a minimal composition payload with at least one element per layer."""
    comp = {
        "settings": DEFAULT_SETTINGS,
        "drawingArea": DEFAULT_DRAWING_AREA,
        "orientation": "portrait",
        "border": {
            "style": border_style,
            "margin": 5.0,
            "thickness": 1,
        },
        "baseLayer": {
            "type": "svg",
            "svg": SIMPLE_SVG if include_base else None,
        },
        "textElements": [],
        "stickerElements": [],
    }
    if include_text:
        comp["textElements"] = [{
            "text": "Hi",
            "font": "sans",
            "sizeMm": 10.0,
            "passes": 1,
            "x": 50.0,
            "y": 50.0,
            "svgPaths": SIMPLE_SVG,
        }]
    if include_sticker:
        comp["stickerElements"] = [{
            "stickerId": "geometric-star",
            "svgPaths": SIMPLE_STICKER_SVG,
            "x": 60.0,
            "y": 60.0,
            "width": 20.0,
            "height": 20.0,
            "passes": 1,
        }]
    return comp


def run_composition(composition):
    """Run composition_to_gcode.py via subprocess and return the output dict."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json",
                                     delete=False, encoding="utf-8") as f:
        json.dump(composition, f)
        input_path = f.name

    output_path = input_path.replace(".json", "_out.json")

    try:
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH, input_path, output_path],
            capture_output=True, text=True, timeout=30
        )
        if not os.path.exists(output_path):
            raise RuntimeError(
                f"No output file produced. stderr: {result.stderr}"
            )
        with open(output_path, "r", encoding="utf-8") as f:
            return json.load(f)
    finally:
        for p in [input_path, output_path]:
            try:
                os.unlink(p)
            except OSError:
                pass


def find_section_index(gcode_lines, section_name):
    """Return the line index of the first occurrence of '; === {section_name}'."""
    marker = f"; === {section_name}"
    for i, line in enumerate(gcode_lines):
        if line.strip() == marker:
            return i
    return -1


# ─── Property 7: G-code Layer Order ──────────────────────────────────────────

class TestGcodeLayerOrder(unittest.TestCase):
    """
    **Validates: Requirements 11.1**

    Property 7: G-code Layer Order

    For any composition containing at least one element in each layer,
    the generated G-code must contain sections in this order:
    BORDER < BASE IMAGE < TEXT < STICKERS
    """

    @given(
        st.sampled_from(["simple-rect", "rounded-rect", "double-line",
                         "corner-marks", "dashed"]),
    )
    @settings(max_examples=20, deadline=None)
    def test_layer_order_border_before_base_image(self, border_style):
        """BORDER section must appear before BASE IMAGE section."""
        comp = make_composition(border_style=border_style)
        output = run_composition(comp)

        self.assertIsNone(output.get("error"),
                          f"Unexpected error: {output.get('error')}")

        gcode_lines = output["gcode"].splitlines()
        border_idx = find_section_index(gcode_lines, "BORDER")
        base_idx = find_section_index(gcode_lines, "BASE IMAGE")

        self.assertGreater(border_idx, -1,
                           "'; === BORDER' section not found in G-code")
        self.assertGreater(base_idx, -1,
                           "'; === BASE IMAGE' section not found in G-code")
        self.assertLess(border_idx, base_idx,
                        f"BORDER ({border_idx}) must come before BASE IMAGE ({base_idx})")

    @given(
        st.sampled_from(["simple-rect", "rounded-rect"]),
    )
    @settings(max_examples=20, deadline=None)
    def test_layer_order_base_image_before_text(self, border_style):
        """BASE IMAGE section must appear before TEXT section."""
        comp = make_composition(border_style=border_style)
        output = run_composition(comp)

        self.assertIsNone(output.get("error"))

        gcode_lines = output["gcode"].splitlines()
        base_idx = find_section_index(gcode_lines, "BASE IMAGE")
        text_idx = find_section_index(gcode_lines, "TEXT")

        self.assertGreater(base_idx, -1, "'; === BASE IMAGE' not found")
        self.assertGreater(text_idx, -1, "'; === TEXT' not found")
        self.assertLess(base_idx, text_idx,
                        f"BASE IMAGE ({base_idx}) must come before TEXT ({text_idx})")

    @given(
        st.sampled_from(["simple-rect", "rounded-rect"]),
    )
    @settings(max_examples=20, deadline=None)
    def test_layer_order_text_before_stickers(self, border_style):
        """TEXT section must appear before STICKERS section."""
        comp = make_composition(border_style=border_style)
        output = run_composition(comp)

        self.assertIsNone(output.get("error"))

        gcode_lines = output["gcode"].splitlines()
        text_idx = find_section_index(gcode_lines, "TEXT")
        sticker_idx = find_section_index(gcode_lines, "STICKERS")

        self.assertGreater(text_idx, -1, "'; === TEXT' not found")
        self.assertGreater(sticker_idx, -1, "'; === STICKERS' not found")
        self.assertLess(text_idx, sticker_idx,
                        f"TEXT ({text_idx}) must come before STICKERS ({sticker_idx})")

    def test_full_layer_order_all_sections(self):
        """All four sections must appear in strict order: BORDER < BASE IMAGE < TEXT < STICKERS."""
        comp = make_composition(border_style="simple-rect")
        output = run_composition(comp)

        self.assertIsNone(output.get("error"))

        gcode_lines = output["gcode"].splitlines()
        border_idx = find_section_index(gcode_lines, "BORDER")
        base_idx = find_section_index(gcode_lines, "BASE IMAGE")
        text_idx = find_section_index(gcode_lines, "TEXT")
        sticker_idx = find_section_index(gcode_lines, "STICKERS")

        self.assertGreater(border_idx, -1, "BORDER section missing")
        self.assertGreater(base_idx, -1, "BASE IMAGE section missing")
        self.assertGreater(text_idx, -1, "TEXT section missing")
        self.assertGreater(sticker_idx, -1, "STICKERS section missing")

        self.assertLess(border_idx, base_idx,
                        "BORDER must come before BASE IMAGE")
        self.assertLess(base_idx, text_idx,
                        "BASE IMAGE must come before TEXT")
        self.assertLess(text_idx, sticker_idx,
                        "TEXT must come before STICKERS")


# ─── Property 8: G-code Validity ─────────────────────────────────────────────

class TestGcodeValidity(unittest.TestCase):
    """
    **Validates: Requirements 11.3, 11.8**

    Property 8: G-code Validity

    For any composition, the generated G-code must:
    (a) contain G21, G90, and G28 X Y in the header before any drawing moves
    (b) contain no M104, M109, M140 (temperature) or E (extruder) commands
    (c) every stroke ends with a pen-up move G0 Z{z_hop}
    """

    @given(
        st.sampled_from(["simple-rect", "rounded-rect", "none"]),
        st.booleans(),
        st.booleans(),
    )
    @settings(max_examples=20, deadline=None)
    def test_header_contains_required_commands(self, border_style, include_text,
                                                include_sticker):
        """G21, G90, G28 X Y must appear in the header before any G0/G1 drawing moves."""
        comp = make_composition(border_style=border_style,
                                include_text=include_text,
                                include_sticker=include_sticker)
        output = run_composition(comp)
        self.assertIsNone(output.get("error"))

        gcode_lines = output["gcode"].splitlines()

        # Find the first drawing move (G0 X or G1 X)
        first_draw_idx = len(gcode_lines)
        for i, line in enumerate(gcode_lines):
            stripped = line.strip()
            if (stripped.startswith("G0 X") or stripped.startswith("G1 X")):
                first_draw_idx = i
                break

        # G21, G90, G28 X Y must all appear before the first drawing move
        header_text = "\n".join(gcode_lines[:first_draw_idx])
        self.assertIn("G21", header_text,
                      "G21 (mm units) must appear in header before drawing moves")
        self.assertIn("G90", header_text,
                      "G90 (absolute positioning) must appear in header")
        self.assertIn("G28 X Y", header_text,
                      "G28 X Y (home) must appear in header")

    @given(
        st.sampled_from(["simple-rect", "rounded-rect", "none"]),
    )
    @settings(max_examples=20, deadline=None)
    def test_no_temperature_or_extruder_commands(self, border_style):
        """G-code must not contain M104, M109, M140, or extruder E commands."""
        comp = make_composition(border_style=border_style)
        output = run_composition(comp)
        self.assertIsNone(output.get("error"))

        gcode = output["gcode"]

        self.assertNotIn("M104", gcode,
                         "M104 (set hotend temp) must not appear in plotter G-code")
        self.assertNotIn("M109", gcode,
                         "M109 (wait hotend temp) must not appear in plotter G-code")
        self.assertNotIn("M140", gcode,
                         "M140 (set bed temp) must not appear in plotter G-code")

        # No extruder commands (E parameter in G0/G1 lines)
        import re
        extruder_moves = re.findall(r'G[01]\s+.*\bE[-\d.]+', gcode)
        self.assertEqual(extruder_moves, [],
                         f"Extruder commands found: {extruder_moves[:3]}")

    def test_pen_up_after_every_stroke(self):
        """Every pen-down (G0 Z0.000) must be followed eventually by a pen-up (G0 Z3.000)."""
        comp = make_composition(border_style="simple-rect")
        output = run_composition(comp)
        self.assertIsNone(output.get("error"))

        gcode_lines = output["gcode"].splitlines()
        z_draw = DEFAULT_SETTINGS["z_draw"]
        z_hop = DEFAULT_SETTINGS["z_hop"]

        pen_down_pattern = f"G0 Z{z_draw:.3f}"
        pen_up_pattern = f"G0 Z{z_hop:.3f}"

        pen_down_count = sum(1 for l in gcode_lines if l.strip().startswith(pen_down_pattern))
        pen_up_count = sum(1 for l in gcode_lines if l.strip().startswith(pen_up_pattern))

        # Every pen-down must have a matching pen-up
        self.assertEqual(
            pen_down_count, pen_up_count,
            f"Pen-down count ({pen_down_count}) != pen-up count ({pen_up_count}). "
            "Every stroke must end with a pen-up move."
        )

    def test_stats_are_present_and_valid(self):
        """Output must include stats with strokeCount, estimatedTimeSeconds, pathLengthMm."""
        comp = make_composition(border_style="simple-rect")
        output = run_composition(comp)
        self.assertIsNone(output.get("error"))

        stats = output.get("stats")
        self.assertIsNotNone(stats, "stats must be present in output")
        self.assertIn("strokeCount", stats)
        self.assertIn("estimatedTimeSeconds", stats)
        self.assertIn("pathLengthMm", stats)
        self.assertGreaterEqual(stats["strokeCount"], 0)
        self.assertGreaterEqual(stats["estimatedTimeSeconds"], 0)
        self.assertGreaterEqual(stats["pathLengthMm"], 0.0)


if __name__ == "__main__":
    unittest.main()
