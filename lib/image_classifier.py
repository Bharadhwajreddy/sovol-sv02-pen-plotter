#!/usr/bin/env python3
"""
image_classifier.py
Sovol SV02 Pen Plotter — Image mode classifier

Determines whether an uploaded image is a raw photo or an AI-generated sketch
by analysing per-channel standard deviation and grayscale histogram spread.

Usage:
    python image_classifier.py <image_path> <output_json_path>

Output JSON:
    {
        "mode": "raw_photo" | "ai_sketch",
        "confidence": float,      // 0.0–1.0
        "channel_std": float,     // mean per-channel std dev across R, G, B
        "histogram_std": float    // std dev of grayscale histogram
    }

On error:
    { "error": "<descriptive message>" }
    exit code 1
"""

import sys
import json
import cv2
import numpy as np


# ─── Classification Logic ─────────────────────────────────────────────────────

def classify(image_path: str) -> dict:
    """
    Analyse an image and return classification result.

    Classification rule:
      mean_channel_std > 15 OR histogram_std > 40  →  "raw_photo"
      otherwise                                     →  "ai_sketch"

    Confidence:
      min(1.0, max(mean_channel_std, histogram_std / 40) / 30)
    """
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {image_path}")

    # Per-channel std dev (B, G, R in OpenCV order — we use all 3 channels)
    channel_stds = [float(np.std(img[:, :, c])) for c in range(3)]
    mean_channel_std = float(np.mean(channel_stds))

    # Grayscale histogram std dev
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    histogram_std = float(np.std(hist))

    # Classification decision
    is_raw_photo = mean_channel_std > 15 or histogram_std > 40
    mode = "raw_photo" if is_raw_photo else "ai_sketch"

    # Confidence score clamped to [0.0, 1.0]
    confidence = float(min(1.0, max(mean_channel_std, histogram_std / 40) / 30))

    return {
        "mode": mode,
        "confidence": confidence,
        "channel_std": mean_channel_std,
        "histogram_std": histogram_std,
    }


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: image_classifier.py <image_path> <output_json_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    output_json_path = sys.argv[2]

    try:
        result = classify(image_path)
    except FileNotFoundError as e:
        error_result = {"error": str(e)}
        with open(output_json_path, "w") as f:
            json.dump(error_result, f)
        sys.exit(1)
    except cv2.error as e:
        error_result = {"error": f"OpenCV error: {e}"}
        with open(output_json_path, "w") as f:
            json.dump(error_result, f)
        sys.exit(1)
    except Exception as e:
        error_result = {"error": f"Unexpected error: {e}"}
        with open(output_json_path, "w") as f:
            json.dump(error_result, f)
        sys.exit(1)

    with open(output_json_path, "w") as f:
        json.dump(result, f)

    print(f"Classified as '{result['mode']}' (confidence={result['confidence']:.3f}, "
          f"channel_std={result['channel_std']:.3f}, histogram_std={result['histogram_std']:.3f})")


if __name__ == "__main__":
    main()
