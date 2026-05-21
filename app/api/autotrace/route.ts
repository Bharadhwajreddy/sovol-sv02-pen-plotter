import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accepted MIME types and their corresponding file extensions
const ACCEPTED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const inputPath = join(tmpdir(), `autotrace-input-${randomUUID()}.bin`);
  const outputPath = join(tmpdir(), `autotrace-output-${randomUUID()}.json`);

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
    const settingsRaw = formData.get("settings") as string | null;

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

    // Build subprocess args: python lib/auto_trace.py <input> <output> [<settings>]
    const args = ["lib/auto_trace.py", inputPathWithExt, outputPath];
    if (settingsRaw) {
      args.push(settingsRaw);
    }

    // Spawn Python subprocess
    const result = spawnSync("python", args, {
      cwd: process.cwd(),
      timeout: 55_000, // 55s — leave headroom within maxDuration of 60s
      encoding: "utf8",
    });

    // Check for spawn-level errors (e.g. python not found)
    if (result.error) {
      console.error("autotrace subprocess spawn error:", result.error);
      return NextResponse.json(
        { error: "Processing unavailable: could not start Python" },
        { status: 503 }
      );
    }

    // Read output JSON written by the Python script
    if (!existsSync(outputPath)) {
      console.error(
        "autotrace subprocess produced no output file. stderr:",
        result.stderr
      );
      return NextResponse.json(
        { error: "Auto-trace produced no output" },
        { status: 500 }
      );
    }

    let output: Record<string, unknown>;
    try {
      output = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      return NextResponse.json(
        { error: "Auto-trace returned invalid JSON" },
        { status: 500 }
      );
    }

    // Propagate any error field from the Python script as HTTP 500
    if (output.error) {
      console.error("autotrace Python error:", output.error);
      return NextResponse.json(
        { error: String(output.error) },
        { status: 500 }
      );
    }

    // Return auto-trace result
    return NextResponse.json(
      {
        svg: output.svg,
        path_count: output.path_count,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("POST /api/autotrace error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Auto-trace failed: ${msg}` },
      { status: 500 }
    );
  } finally {
    // Clean up temp files regardless of success or failure
    // Try all possible extensions for the input file
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
