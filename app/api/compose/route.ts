import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const inputPath = join(tmpdir(), `compose-input-${randomUUID()}.json`);
  const outputPath = join(tmpdir(), `compose-output-${randomUUID()}.json`);

  try {
    // Parse JSON body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body — expected a CompositionPayload object" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid composition: body must be a JSON object" },
        { status: 400 }
      );
    }

    // Write composition JSON to temp file
    writeFileSync(inputPath, JSON.stringify(body), "utf8");

    // Spawn Python subprocess: python lib/composition_to_gcode.py <input> <output>
    const result = spawnSync(
      "python",
      ["lib/composition_to_gcode.py", inputPath, outputPath],
      {
        cwd: process.cwd(),
        timeout: 55_000,
        encoding: "utf8",
      }
    );

    // Check for spawn-level errors
    if (result.error) {
      console.error("compose subprocess spawn error:", result.error);
      return NextResponse.json(
        { error: "Processing unavailable: could not start Python" },
        { status: 503 }
      );
    }

    // Read output JSON
    if (!existsSync(outputPath)) {
      console.error("compose subprocess produced no output. stderr:", result.stderr);
      return NextResponse.json(
        { error: "G-code generator produced no output" },
        { status: 500 }
      );
    }

    let output: Record<string, unknown>;
    try {
      output = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      return NextResponse.json(
        { error: "G-code generator returned invalid JSON" },
        { status: 500 }
      );
    }

    // Propagate Python-side errors
    if (output.error) {
      console.error("compose Python error:", output.error);
      return NextResponse.json(
        { error: String(output.error) },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { gcode: output.gcode, stats: output.stats },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("POST /api/compose error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Composition failed: ${msg}` },
      { status: 500 }
    );
  } finally {
    try { if (existsSync(inputPath)) unlinkSync(inputPath); } catch { /* ignore */ }
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch { /* ignore */ }
  }
}
