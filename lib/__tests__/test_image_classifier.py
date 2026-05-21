"""
test_image_classifier.py
Property-based tests for image_classifier.py

# Feature: plotter-studio-upgrade, Property 1: Image Classifier Boundary

Validates: Requirements 1.6, 1.7
"""

import sys
import os
import math
import numpy as np
import unittest
from unittest.mock import patch, MagicMock

from hypothesis import given, settings, assume
import hypothesis.strategies as st

# Add the parent lib directory to sys.path so we can import image_classifier
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import image_classifier


def _make_synthetic_image(channel_std: float) -> np.ndarray:
    """
    Create a 2×1 BGR numpy image whose per-channel std dev equals channel_std.

    For a 2-element array [0, v], std = v/2.  So v = 2 * channel_std.
    We clamp v to [0, 255] to stay within uint8 range.
    """
    v = min(255, int(round(2.0 * channel_std)))
    # Shape: (1, 2, 3) — 1 row, 2 columns, 3 channels (BGR)
    img = np.zeros((1, 2, 3), dtype=np.uint8)
    img[0, 1, :] = v  # second pixel has value v on all channels
    return img


def _make_histogram_with_std(histogram_std: float) -> np.ndarray:
    """
    Construct a 256-bin histogram array whose std dev equals histogram_std.

    Strategy: place all mass in two bins (bin 0 and bin 255) such that
    the resulting std matches the target.  For a 2-element distribution
    [0, x] with equal weight, std = x/2.  We use a 256-bin array where
    only bin 0 and bin 255 are non-zero.

    For a histogram h where h[0] = h[255] = 1 and all others = 0:
      mean = 2/256
      std  = sqrt(mean((h - mean)^2))
    This is complex, so instead we use a simpler construction:
    set h[0] = A and h[255] = B such that std(h) = histogram_std.

    Simplest: use a flat histogram (all bins equal) as baseline, then
    adjust.  Actually, the easiest controllable construction is:
    - h = [0] * 256
    - h[0] = N, h[255] = N  (two spikes)
    - std(h) = N * sqrt(2*(1 - 1/128)^2 + 254*(1/128)^2) ≈ N * sqrt(...)
    This is still complex.

    Cleanest approach: use a histogram where only one bin is non-zero.
    h = [0]*256; h[0] = C
    mean = C/256
    std  = sqrt(((C - C/256)^2 + 255*(C/256)^2) / 256)
         = sqrt(C^2/256 * ((1 - 1/256)^2 + 255*(1/256)^2))
         = (C/16) * sqrt((255/256)^2 + 255/256^2)
         ≈ (C/16) * sqrt(255/256)
         ≈ C * 0.0623...

    So C ≈ histogram_std / 0.0623 = histogram_std * 16.06

    We return a float32 array (matching cv2.calcHist output).
    """
    # Compute the constant for a single-spike histogram
    # std(h) where h[0]=C, rest=0:
    # mean = C/256
    # var = (1/256)*((C - C/256)^2 + 255*(0 - C/256)^2)
    #      = (C^2/256)*((1-1/256)^2 + 255*(1/256)^2)
    #      = (C^2/256)*(255/256)^2 + (C^2/256)*255/256^2
    #      = (C^2/256^2)*(255^2 + 255)
    #      = (C^2 * 255 * 256) / 256^3
    #      = C^2 * 255 / 256^2
    # std = C * sqrt(255) / 256
    # => C = histogram_std * 256 / sqrt(255)
    scale = 256.0 / math.sqrt(255.0)  # ≈ 16.032
    C = histogram_std * scale
    hist = np.zeros(256, dtype=np.float32)
    hist[0] = float(C)
    return hist.reshape(256, 1)  # cv2.calcHist returns shape (256, 1)


class TestImageClassifierBoundary(unittest.TestCase):
    """
    **Validates: Requirements 1.6, 1.7**

    Property 1: Image Classifier Boundary

    For any image:
    - If mean_channel_std > 15 OR histogram_std > 40 → classifier returns "raw_photo"
    - If mean_channel_std <= 15 AND histogram_std <= 40 → classifier returns "ai_sketch"
    """

    @given(
        st.floats(min_value=0, max_value=100),
        st.floats(min_value=0, max_value=200),
    )
    @settings(max_examples=200)
    def test_raw_photo_when_channel_std_exceeds_threshold(
        self, channel_std: float, histogram_std: float
    ):
        """
        **Validates: Requirements 1.6, 1.7**

        When mean_channel_std > 15 OR histogram_std > 40, classify() must return "raw_photo".
        """
        assume(channel_std > 15 or histogram_std > 40)
        assume(not math.isnan(channel_std) and not math.isnan(histogram_std))

        synthetic_img = _make_synthetic_image(channel_std)
        synthetic_hist = _make_histogram_with_std(histogram_std)

        with patch("image_classifier.cv2") as mock_cv2:
            mock_cv2.imread.return_value = synthetic_img
            mock_cv2.COLOR_BGR2GRAY = 6  # real OpenCV constant value

            # Make cvtColor return a grayscale image (2D)
            gray = np.zeros((1, 2), dtype=np.uint8)
            mock_cv2.cvtColor.return_value = gray

            # Make calcHist return our controlled histogram
            mock_cv2.calcHist.return_value = synthetic_hist

            # Patch np.std inside image_classifier to return controlled values.
            # We need the channel stds to average to channel_std.
            # np.std is called once per channel (3 times) and once for the histogram.
            # We patch image_classifier.np.std to return channel_std for channel calls
            # and histogram_std for the histogram call.
            call_count = [0]
            original_np_std = np.std

            def controlled_std(arr, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] <= 3:
                    # Channel std calls (one per channel)
                    return float(channel_std)
                else:
                    # Histogram std call
                    return float(histogram_std)

            with patch.object(image_classifier.np, "std", side_effect=controlled_std):
                with patch.object(
                    image_classifier.np, "mean", return_value=float(channel_std)
                ):
                    result = image_classifier.classify("fake_path.jpg")

        self.assertEqual(
            result["mode"],
            "raw_photo",
            f"Expected 'raw_photo' for channel_std={channel_std:.3f}, "
            f"histogram_std={histogram_std:.3f}, but got '{result['mode']}'",
        )

    @given(
        st.floats(min_value=0, max_value=15),
        st.floats(min_value=0, max_value=40),
    )
    @settings(max_examples=200)
    def test_ai_sketch_when_both_below_threshold(
        self, channel_std: float, histogram_std: float
    ):
        """
        **Validates: Requirements 1.6, 1.7**

        When mean_channel_std <= 15 AND histogram_std <= 40, classify() must return "ai_sketch".
        """
        assume(not math.isnan(channel_std) and not math.isnan(histogram_std))

        synthetic_img = _make_synthetic_image(channel_std)
        synthetic_hist = _make_histogram_with_std(histogram_std)

        with patch("image_classifier.cv2") as mock_cv2:
            mock_cv2.imread.return_value = synthetic_img
            mock_cv2.COLOR_BGR2GRAY = 6

            gray = np.zeros((1, 2), dtype=np.uint8)
            mock_cv2.cvtColor.return_value = gray
            mock_cv2.calcHist.return_value = synthetic_hist

            call_count = [0]

            def controlled_std(arr, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] <= 3:
                    return float(channel_std)
                else:
                    return float(histogram_std)

            with patch.object(image_classifier.np, "std", side_effect=controlled_std):
                with patch.object(
                    image_classifier.np, "mean", return_value=float(channel_std)
                ):
                    result = image_classifier.classify("fake_path.jpg")

        self.assertEqual(
            result["mode"],
            "ai_sketch",
            f"Expected 'ai_sketch' for channel_std={channel_std:.3f}, "
            f"histogram_std={histogram_std:.3f}, but got '{result['mode']}'",
        )

    @given(
        st.floats(min_value=0, max_value=100),
        st.floats(min_value=0, max_value=200),
    )
    @settings(max_examples=200)
    def test_classification_boundary_is_exhaustive(
        self, channel_std: float, histogram_std: float
    ):
        """
        **Validates: Requirements 1.6, 1.7**

        For any (channel_std, histogram_std) pair, the result is always either
        "raw_photo" or "ai_sketch" — never any other value.
        The result must be consistent with the decision rule:
          raw_photo iff (channel_std > 15 OR histogram_std > 40)
        """
        assume(not math.isnan(channel_std) and not math.isnan(histogram_std))

        synthetic_img = _make_synthetic_image(channel_std)
        synthetic_hist = _make_histogram_with_std(histogram_std)

        with patch("image_classifier.cv2") as mock_cv2:
            mock_cv2.imread.return_value = synthetic_img
            mock_cv2.COLOR_BGR2GRAY = 6

            gray = np.zeros((1, 2), dtype=np.uint8)
            mock_cv2.cvtColor.return_value = gray
            mock_cv2.calcHist.return_value = synthetic_hist

            call_count = [0]

            def controlled_std(arr, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] <= 3:
                    return float(channel_std)
                else:
                    return float(histogram_std)

            with patch.object(image_classifier.np, "std", side_effect=controlled_std):
                with patch.object(
                    image_classifier.np, "mean", return_value=float(channel_std)
                ):
                    result = image_classifier.classify("fake_path.jpg")

        # Result must always be one of the two valid modes
        self.assertIn(result["mode"], ("raw_photo", "ai_sketch"))

        # Result must be consistent with the decision rule
        expected_raw = channel_std > 15 or histogram_std > 40
        expected_mode = "raw_photo" if expected_raw else "ai_sketch"
        self.assertEqual(
            result["mode"],
            expected_mode,
            f"Decision rule violated: channel_std={channel_std:.3f}, "
            f"histogram_std={histogram_std:.3f} → expected '{expected_mode}', "
            f"got '{result['mode']}'",
        )


if __name__ == "__main__":
    unittest.main()
