// Feature: plotter-studio-upgrade, Property 9: Rating Insertion Round-Trip
// Feature: plotter-studio-upgrade, Property 10: Rating Missing Field Validation
// Feature: plotter-studio-upgrade, Property 11: Rating Out-of-Range Validation
// Validates: Requirements 13.3, 13.4, 13.5

/**
 * Properties 9, 10, 11: Rating DB and API validation tests
 *
 * Uses fast-check for property-based testing.
 * Uses an in-memory / temp SQLite DB for isolation.
 *
 * Run: npx ts-node lib/__tests__/ratings-db.test.ts
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fc = require("fast-check") as typeof import("fast-check");
const Database = require("better-sqlite3") as typeof import("better-sqlite3");
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RatingRecord {
  timestamp: string;
  rating: number;
  upload_mode: "raw_photo" | "ai_sketch";
  orientation: "portrait" | "landscape";
  drawing_mode: string;
  detail_level: number;
  stroke_weight: number;
  border_style: string;
  stroke_count: number;
  path_length_mm: number;
  estimated_time_s: number;
}

// ─── DB helpers (inline, using temp file) ────────────────────────────────────

const REQUIRED_FIELDS: (keyof RatingRecord)[] = [
  "timestamp", "rating", "upload_mode", "orientation", "drawing_mode",
  "detail_level", "stroke_weight", "border_style", "stroke_count",
  "path_length_mm", "estimated_time_s",
];

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ratings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp        TEXT    NOT NULL,
    rating           INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    upload_mode      TEXT    NOT NULL CHECK(upload_mode IN ('raw_photo','ai_sketch')),
    orientation      TEXT    NOT NULL CHECK(orientation IN ('portrait','landscape')),
    drawing_mode     TEXT    NOT NULL,
    detail_level     INTEGER NOT NULL,
    stroke_weight    INTEGER NOT NULL,
    border_style     TEXT    NOT NULL,
    stroke_count     INTEGER NOT NULL,
    path_length_mm   REAL    NOT NULL,
    estimated_time_s INTEGER NOT NULL
  );
`;

function createTempDb(): { db: InstanceType<typeof Database>; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `ratings-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  db.exec(CREATE_TABLE_SQL);
  return { db, dbPath };
}

function insertRating(db: InstanceType<typeof Database>, record: RatingRecord): number {
  const stmt = db.prepare(`
    INSERT INTO ratings (timestamp, rating, upload_mode, orientation, drawing_mode,
      detail_level, stroke_weight, border_style, stroke_count, path_length_mm, estimated_time_s)
    VALUES (@timestamp, @rating, @upload_mode, @orientation, @drawing_mode,
      @detail_level, @stroke_weight, @border_style, @stroke_count, @path_length_mm, @estimated_time_s)
  `);
  const result = stmt.run(record);
  return Number(result.lastInsertRowid);
}

function getById(db: InstanceType<typeof Database>, id: number): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM ratings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}

function countRows(db: InstanceType<typeof Database>): number {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM ratings").get() as { cnt: number };
  return row.cnt;
}

// ─── Validation logic (mirrors /api/ratings/route.ts) ────────────────────────

function validatePayload(body: Record<string, unknown>): { status: number; json: Record<string, unknown> } | null {
  const missingFields = REQUIRED_FIELDS.filter(
    (f) => body[f] === undefined || body[f] === null
  );
  if (missingFields.length > 0) {
    return { status: 400, json: { error: "Missing required fields", missingFields } };
  }
  const rating = body["rating"];
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { status: 422, json: { error: "Rating must be an integer between 1 and 5" } };
  }
  return null; // valid
}

// ─── Strategies ───────────────────────────────────────────────────────────────

const validRecordArb = fc.record<RatingRecord>({
  timestamp: fc.date().map((d) => d.toISOString()),
  rating: fc.integer({ min: 1, max: 5 }),
  upload_mode: fc.constantFrom("raw_photo" as const, "ai_sketch" as const),
  orientation: fc.constantFrom("portrait" as const, "landscape" as const),
  drawing_mode: fc.string({ minLength: 1, maxLength: 50 }),
  detail_level: fc.integer({ min: 1, max: 10 }),
  stroke_weight: fc.integer({ min: 1, max: 5 }),
  border_style: fc.string({ minLength: 1, maxLength: 50 }),
  stroke_count: fc.integer({ min: 0, max: 10000 }),
  path_length_mm: fc.float({ min: 0, max: 100000, noNaN: true }),
  estimated_time_s: fc.integer({ min: 0, max: 86400 }),
});

// ─── Property 9: Rating Insertion Round-Trip ──────────────────────────────────

function runProperty9(): void {
  const { db, dbPath } = createTempDb();
  try {
    fc.assert(
      fc.property(validRecordArb, (record: RatingRecord) => {
        const id = insertRating(db, record);

        // id must be a positive integer
        if (!Number.isInteger(id) || id <= 0) {
          throw new Error(`Expected positive integer id, got ${id}`);
        }

        const row = getById(db, id);
        if (!row) {
          throw new Error(`Row with id=${id} not found after insert`);
        }

        // Every field must match exactly
        for (const field of REQUIRED_FIELDS) {
          const expected = record[field];
          const actual = row[field];
          // For floats, allow tiny floating-point tolerance
          if (typeof expected === "number" && typeof actual === "number") {
            if (Math.abs(expected - actual) > 1e-6) {
              throw new Error(
                `Field "${field}": expected ${expected}, got ${actual}`
              );
            }
          } else if (String(actual) !== String(expected)) {
            throw new Error(
              `Field "${field}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
            );
          }
        }

        return true;
      }),
      { numRuns: 200, verbose: false }
    );
  } finally {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  }
}

// ─── Property 10: Rating Missing Field Validation ────────────────────────────

function runProperty10(): void {
  fc.assert(
    fc.property(
      validRecordArb,
      fc.constantFrom(...REQUIRED_FIELDS),
      (record: RatingRecord, fieldToRemove: keyof RatingRecord) => {
        const payload = { ...record } as Record<string, unknown>;
        delete payload[fieldToRemove];

        const result = validatePayload(payload);

        // Must return HTTP 400
        if (!result || result.status !== 400) {
          throw new Error(
            `Expected HTTP 400 when "${fieldToRemove}" is missing, got ${result?.status ?? "null"}`
          );
        }

        // missingFields must include the removed field
        const missingFields = result.json.missingFields as string[];
        if (!Array.isArray(missingFields) || !missingFields.includes(fieldToRemove)) {
          throw new Error(
            `Expected missingFields to include "${fieldToRemove}", got ${JSON.stringify(missingFields)}`
          );
        }

        return true;
      }
    ),
    { numRuns: 500, verbose: false }
  );
}

// ─── Property 11: Rating Out-of-Range Validation ─────────────────────────────

function runProperty11(): void {
  const { db, dbPath } = createTempDb();
  try {
    fc.assert(
      fc.property(
        validRecordArb,
        fc.oneof(
          fc.integer({ max: 0 }),           // 0 or negative
          fc.integer({ min: 6 }),           // 6 or above
          fc.float({ noNaN: true }).filter((n) => !Number.isInteger(n)), // non-integer float
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
          fc.string(),                      // non-numeric
        ),
        (record: RatingRecord, invalidRating: unknown) => {
          const payload = { ...record, rating: invalidRating } as Record<string, unknown>;

          const countBefore = countRows(db);
          const result = validatePayload(payload);

          // Must return HTTP 422
          if (!result || result.status !== 422) {
            throw new Error(
              `Expected HTTP 422 for invalid rating ${JSON.stringify(invalidRating)}, got ${result?.status ?? "null"}`
            );
          }

          // No row should have been inserted (validation happens before DB write)
          const countAfter = countRows(db);
          if (countAfter !== countBefore) {
            throw new Error(
              `Expected no new row for invalid rating ${JSON.stringify(invalidRating)}, ` +
              `but count changed from ${countBefore} to ${countAfter}`
            );
          }

          return true;
        }
      ),
      { numRuns: 300, verbose: false }
    );
  } finally {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  let allPassed = true;

  console.log("Running Property 9: Rating Insertion Round-Trip (200 runs)...");
  try {
    runProperty9();
    console.log("✓ Property 9 passed");
  } catch (err) {
    console.error("✗ Property 9 FAILED:", err);
    allPassed = false;
  }

  console.log("Running Property 10: Rating Missing Field Validation (500 runs)...");
  try {
    runProperty10();
    console.log("✓ Property 10 passed");
  } catch (err) {
    console.error("✗ Property 10 FAILED:", err);
    allPassed = false;
  }

  console.log("Running Property 11: Rating Out-of-Range Validation (300 runs)...");
  try {
    runProperty11();
    console.log("✓ Property 11 passed");
  } catch (err) {
    console.error("✗ Property 11 FAILED:", err);
    allPassed = false;
  }

  if (!allPassed) process.exit(1);
  console.log("\n✓ All rating DB tests passed");
}

main();
