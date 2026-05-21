import Database from "better-sqlite3";
import path from "path";

export interface RatingRecord {
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

const DB_PATH = path.join(process.cwd(), "data", "ratings.db");

export function initDb(): void {
  const db = new Database(DB_PATH);
  db.exec(`
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
  `);
  db.close();
}

export function insertRating(record: RatingRecord): number {
  initDb();
  const db = new Database(DB_PATH);
  try {
    const stmt = db.prepare(`
      INSERT INTO ratings (
        timestamp,
        rating,
        upload_mode,
        orientation,
        drawing_mode,
        detail_level,
        stroke_weight,
        border_style,
        stroke_count,
        path_length_mm,
        estimated_time_s
      ) VALUES (
        @timestamp,
        @rating,
        @upload_mode,
        @orientation,
        @drawing_mode,
        @detail_level,
        @stroke_weight,
        @border_style,
        @stroke_count,
        @path_length_mm,
        @estimated_time_s
      )
    `);
    const result = stmt.run(record);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}
