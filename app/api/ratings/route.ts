import { NextRequest, NextResponse } from "next/server";
import { insertRating, RatingRecord } from "@/lib/ratings-db";

export const runtime = "nodejs";
export const maxDuration = 10;

const REQUIRED_FIELDS: (keyof RatingRecord)[] = [
  "timestamp",
  "rating",
  "upload_mode",
  "orientation",
  "drawing_mode",
  "detail_level",
  "stroke_weight",
  "border_style",
  "stroke_count",
  "path_length_mm",
  "estimated_time_s",
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Validate all required fields are present
    const missingFields = REQUIRED_FIELDS.filter(
      (field) => body[field] === undefined || body[field] === null
    );

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: "Missing required fields", missingFields },
        { status: 400 }
      );
    }

    // Validate rating is an integer in [1, 5]
    const rating = body["rating"];
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return NextResponse.json(
        { error: "Rating must be an integer between 1 and 5" },
        { status: 422 }
      );
    }

    const record = body as unknown as RatingRecord;
    const id = insertRating(record);

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/ratings error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
