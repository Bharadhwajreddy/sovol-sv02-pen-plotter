import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

// Accepted MIME types and their corresponding file extensions
const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const inputPath = join(tmpdir(), `classify-input-${randomUUID()}.bin`);
  const outputPath = join(tmpdir(), `classify-output-${randomUUID()}.json`);

  try {
    // Parse multipart/form-data
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Invalid multipart/form-data request" },
        { status: 400 }
      );
    }

    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    // Validate file type — accept JPEG, PNG, WEBP only
    const mimeType = file.type.toLowerCase();
    const ext = ACCEPTED_TYPES[mimeType];
    if (!ext) {
      return NextResponse.json(
        { error: "Unsupported file type. Accepted: JPEG, PNG, WEBP" },
        { status: 415 }
      );
    }

    // Rename input temp file to use the correct extension so OpenCV can read it
    const inputPathWithExt = inputPath.replace(".bin", ext);

    // Write image bytes to temp file
    const bytes = Buffer.from(await file.arrayBuffer());
    writeFileSync(inputPathWithExt, bytes);

    // Spawn Python subprocess: python lib/image_classifier.py <input> <output>
    const result = spawnSync(
      "python",
      ["lib/image_classifier.py", inputPathWithExt, outputPath],
      {
        cwd: process.cwd(),
        timeout: 25_000, // 25s — leave headroom within maxDuration of 30s
        encoding: "utf8",
      }
    );

    // Check for spawn-level errors (e.g. python not found)
    if (result.error) {
      console.error("classify subprocess spawn error:", result.error);
      return NextResponse.json(
        { error: "Processing unavailable: could not start Python" },
        { status: 503 }
      );
    }

    // Read output JSON written by the Python script
    if (!existsSync(outputPath)) {
      console.error("classify subprocess produced no output file. stderr:", result.stderr);
      return NextResponse.json(
        { error: "Classifier produced no output" },
        { status: 500 }
      );
    }

    let output: Record<string, unknown>;
    try {
      output = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      return NextResponse.json(
        { error: "Classifier returned invalid JSON" },
        { status: 500 }
      );
    }

    // Propagate any error field from the Python script as HTTP 500
    if (output.error) {
      console.error("classify Python error:", output.error);
      return NextResponse.json(
        { error: String(output.error) },
        { status: 500 }
      );
    }

    // Return classification result
    return NextResponse.json(
      {
        mode: output.mode,
        confidence: output.confidence,
        channel_std: output.channel_std,
        histogram_std: output.histogram_std,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("POST /api/classify error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Classification failed: ${msg}` },
      { status: 500 }
    );
  } finally {
    // Clean up temp files regardless of success or failure
    const inputPathWithExt = inputPath.replace(".bin", "");
    // Try all possible extensions
    for (const ext of Object.values(ACCEPTED_TYPES)) {
      const candidate = inputPath.replace(".bin", ext);
      try {
        if (existsSync(candidate)) unlinkSync(candidate);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Also try the raw .bin path in case it was written before extension was known
    try {
      if (existsSync(inputPath)) unlinkSync(inputPath);
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
