"""
test_auto_trace.py
Property-based tests for auto_trace.py

# Feature: plotter-studio-upgrade, Property 2: Auto-Trace Output Validity

**Validates: Requirements 2.1, 2.4, 2.5, 2.7**
"""

import sys
import os
import re
import xml.etree.ElementTree as ET
import unittest

import numpy as np
from hypothesis import given, settings, assume
import hypothesis.strategies as st

# Add the parent lib directory to sys.path so we can import auto_trace
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import auto_trace


# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_random_bgr_image(width: int, height: int) -> np.ndarray:
    """Create a random uint8 BGR numpy image of the given dimensions."""
    return np.random.randint(0, 256, (height, width, 3), dtype=np.uint8)


def parse_path_d_commands(d: str) -> list[str]:
    """
    Extract the command letters from an SVG path `d` attribute.
    Returns a list of uppercase command letters found.
    """
    return re.findall(r"[A-Za-z]", d)


def extract_coordinates_from_path_d(d: str) -> list[tuple[float, float]]:
    """
    Extract all (x, y) coordinate pairs from an SVG path `d` attribute.
    Handles 'M x,y', 'L x,y' style tokens; ignores 'Z'.
    """
    coords = []
    # Match patterns like "M 10.5,20.3" or "L 5,10"
    for match in re.finditer(r"[ML]\s+([\d.+-]+),([\d.+-]+)", d):
        x = float(match.group(1))
        y = float(match.group(2))
        coords.append((x, y))
    return coords


# ─── SVG Namespace ────────────────────────────────────────────────────────────

SVG_NS = "http://www.w3.org/2000/svg"


# ─── Test Class ───────────────────────────────────────────────────────────────

class TestAutoTraceOutputValidity(unittest.TestCase):
    """
    **Validates: Requirements 2.1, 2.4, 2.5, 2.7**

    Property 2: Auto-Trace Output Validity

    For any random image and drawing area dimensions:
    - Output SVG is valid XML parseable by xml.etree.ElementTree
    - All path `d` attributes contain only M, L, Z commands
    - All numeric coordinate values fall within [0, canvas_x] x [0, canvas_y]
    - No path corresponds to a source contour with arc length < 5px
    """

    @given(
        st.integers(min_value=10, max_value=1024),
        st.integers(min_value=10, max_value=1024),
        st.floats(min_value=10, max_value=200),
        st.floats(min_value=10, max_value=160),
    )
    @settings(max_examples=50, deadline=None)
    def test_output_svg_is_valid_xml(
        self,
        img_width: int,
        img_height: int,
        canvas_x: float,
        canvas_y: float,
    ):
        """
        **Validates: Requirements 2.1**

        For any random image dimensions and drawing area, the full pipeline
        must produce a valid XML SVG document parseable by ElementTree.
        """
        assume(not (canvas_x != canvas_x) and not (canvas_y != canvas_y))  # no NaN

        img = make_random_bgr_image(img_width, img_height)

        # Run the pipeline
        edges = auto_trace.detect_edges(img)
        contours = auto_trace.find_and_simplify_contours(edges)
        scaled = auto_trace.scale_contours_to_drawing_area(
            contours, img.shape, canvas_x, canvas_y
        )
        svg, path_count = auto_trace.build_svg(scaled, canvas_x, canvas_y)

        # Must be parseable as XML
        try:
            root = ET.fromstring(svg)
        except ET.ParseError as e:
            self.fail(
                f"SVG output is not valid XML for image {img_width}x{img_height}, "
                f"canvas {canvas_x}x{canvas_y}: {e}\nSVG:\n{svg[:500]}"
            )

        # Root element must be <svg>
        self.assertIn(
            "svg",
            root.tag.lower(),
            f"Root element should be <svg>, got <{root.tag}>",
        )

    @given(
        st.integers(min_value=10, max_value=1024),
        st.integers(min_value=10, max_value=1024),
        st.floats(min_value=10, max_value=200),
        st.floats(min_value=10, max_value=160),
    )
    @settings(max_examples=50, deadline=None)
    def test_path_d_contains_only_mlz_commands(
        self,
        img_width: int,
        img_height: int,
        canvas_x: float,
        canvas_y: float,
    ):
        """
        **Validates: Requirements 2.4**

        All path `d` attributes in the SVG output must contain only M, L, Z
        commands — no curves (C, Q, A), relative commands (m, l, z), or others.
        """
        assume(not (canvas_x != canvas_x) and not (canvas_y != canvas_y))

        img = make_random_bgr_image(img_width, img_height)

        edges = auto_trace.detect_edges(img)
        contours = auto_trace.find_and_simplify_contours(edges)
        scaled = auto_trace.scale_contours_to_drawing_area(
            contours, img.shape, canvas_x, canvas_y
        )
        svg, path_count = auto_trace.build_svg(scaled, canvas_x, canvas_y)

        # Parse SVG
        root = ET.fromstring(svg)

        # Collect all <path> elements (handle namespace)
        paths = root.findall(f".//{{{SVG_NS}}}path") + root.findall(".//path")

        for path_elem in paths:
            d = path_elem.get("d", "")
            commands = parse_path_d_commands(d)

            # All commands must be M, L, or Z (uppercase only)
            allowed = {"M", "L", "Z"}
            disallowed = [cmd for cmd in commands if cmd.upper() not in allowed]
            self.assertEqual(
                disallowed,
                [],
                f"Path `d` contains disallowed commands {disallowed} in: {d[:200]}",
            )

            # Must not contain lowercase variants (relative commands)
            lowercase_cmds = [cmd for cmd in commands if cmd.islower()]
            self.assertEqual(
                lowercase_cmds,
                [],
                f"Path `d` contains relative (lowercase) commands {lowercase_cmds} in: {d[:200]}",
            )

    @given(
        st.integers(min_value=10, max_value=1024),
        st.integers(min_value=10, max_value=1024),
        st.floats(min_value=10, max_value=200),
        st.floats(min_value=10, max_value=160),
    )
    @settings(max_examples=50, deadline=None)
    def test_coordinates_within_drawing_area_bounds(
        self,
        img_width: int,
        img_height: int,
        canvas_x: float,
        canvas_y: float,
    ):
        """
        **Validates: Requirements 2.5**

        All numeric coordinate values in path `d` attributes must fall within
        [0, canvas_x] x [0, canvas_y] (the Drawing_Area bounds).
        """
        assume(not (canvas_x != canvas_x) and not (canvas_y != canvas_y))

        img = make_random_bgr_image(img_width, img_height)

        edges = auto_trace.detect_edges(img)
        contours = auto_trace.find_and_simplify_contours(edges)
        scaled = auto_trace.scale_contours_to_drawing_area(
            contours, img.shape, canvas_x, canvas_y
        )
        svg, path_count = auto_trace.build_svg(scaled, canvas_x, canvas_y)

        root = ET.fromstring(svg)
        paths = root.findall(f".//{{{SVG_NS}}}path") + root.findall(".//path")

        for path_elem in paths:
            d = path_elem.get("d", "")
            coords = extract_coordinates_from_path_d(d)

            for x, y in coords:
                self.assertGreaterEqual(
                    x,
                    -1e-6,  # small tolerance for floating-point rounding
                    f"X coordinate {x} is below 0 in path: {d[:200]}",
                )
                self.assertLessEqual(
                    x,
                    canvas_x + 1e-6,
                    f"X coordinate {x} exceeds canvas_x={canvas_x} in path: {d[:200]}",
                )
                self.assertGreaterEqual(
                    y,
                    -1e-6,
                    f"Y coordinate {y} is below 0 in path: {d[:200]}",
                )
                self.assertLessEqual(
                    y,
                    canvas_y + 1e-6,
                    f"Y coordinate {y} exceeds canvas_y={canvas_y} in path: {d[:200]}",
                )

    @given(
        st.integers(min_value=10, max_value=1024),
        st.integers(min_value=10, max_value=1024),
        st.floats(min_value=10, max_value=200),
        st.floats(min_value=10, max_value=160),
    )
    @settings(max_examples=50, deadline=None)
    def test_no_short_contours_in_output(
        self,
        img_width: int,
        img_height: int,
        canvas_x: float,
        canvas_y: float,
    ):
        """
        **Validates: Requirements 2.7**

        No path in the output should correspond to a source contour with
        arc length < 5px. We verify this by checking find_and_simplify_contours
        directly: every returned contour must have arc length >= 5px.
        """
        assume(not (canvas_x != canvas_x) and not (canvas_y != canvas_y))

        import cv2

        img = make_random_bgr_image(img_width, img_height)

        edges = auto_trace.detect_edges(img)
        contours = auto_trace.find_and_simplify_contours(edges)

        # Every contour returned by find_and_simplify_contours must have
        # originated from a source contour with arc length >= 5px.
        # We verify by re-running findContours and counting how many pass the filter.
        raw_contours, _ = cv2.findContours(
            edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE
        )

        # Count raw contours that pass the arc length filter (>= 5px)
        # and have at least 2 points after simplification (matching the pipeline logic)
        passing_count = 0
        for cnt in raw_contours:
            arc_len = cv2.arcLength(cnt, closed=True)
            if arc_len < 5.0:
                continue
            epsilon = 0.01 * arc_len
            approx = cv2.approxPolyDP(cnt, epsilon, closed=True)
            if len(approx) >= 2:
                passing_count += 1

        # The number of simplified contours must equal the number of
        # raw contours that passed both the arc length filter and the point count filter
        self.assertEqual(
            len(contours),
            passing_count,
            f"Simplified contour count ({len(contours)}) does not match "
            f"raw contours passing arc length filter ({passing_count}). "
            f"This suggests short contours are leaking through or being dropped incorrectly.",
        )

        # Additionally, verify the SVG path count matches the simplified contour count
        scaled = auto_trace.scale_contours_to_drawing_area(
            contours, img.shape, canvas_x, canvas_y
        )
        svg, path_count = auto_trace.build_svg(scaled, canvas_x, canvas_y)

        root = ET.fromstring(svg)
        svg_paths = root.findall(f".//{{{SVG_NS}}}path") + root.findall(".//path")

        self.assertEqual(
            len(svg_paths),
            path_count,
            f"path_count={path_count} does not match actual <path> elements={len(svg_paths)}",
        )


if __name__ == "__main__":
    unittest.main()
