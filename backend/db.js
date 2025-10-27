// backend/db.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";

const UPLOADS_DIR = "./uploads";
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

export async function openDb() {
  return open({
    filename: `${UPLOADS_DIR}/meter_test.db`,
    driver: sqlite3.Database,
  });
}

export async function initDb() {
  const db = await openDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS header (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization TEXT,
      model TEXT,
      type TEXT,
      class TEXT,
      const TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      header_id INTEGER,
      asset_no TEXT,
      meter_no TEXT,
      error_1 REAL,
      error_2 REAL,
      error_3 REAL,
      error_4 REAL,
      result TEXT,
      uploaded_by TEXT,
      upload_date TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(header_id) REFERENCES header(id)
    );
  `);

  console.log("✅ Database initialized");
}
