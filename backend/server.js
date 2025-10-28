
import express from "express";
import multer from "multer";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";
import xlsx from "xlsx";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
const UPLOADS_DIR = path.resolve("uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer config
const upload = multer({ dest: UPLOADS_DIR });

// SQLite connection
const dbPromise = open({
  filename: path.resolve("./meter_results.db"),
  driver: sqlite3.Database,
});

// Initialize DB
(async () => {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_data TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ DB initialized");
})();

// Helper: Detect footer lines (tester/date rows)
function isFooterRow(row) {
  return row.some(cell => {
    if (!cell) return false;
    const text = String(cell).toLowerCase();
    return (
      text.includes("Tester") ||
      text.includes("Date") ||
      text.includes("Notice") ||
      text.includes("p") ||
      text === "p"
    );
  });
}

app.post("/upload-multiple", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: "No files uploaded" });

  try {
    const db = new sqlite3.Database("./meter_data.db");
    await new Promise((resolve, reject) =>
      db.run(
        `CREATE TABLE IF NOT EXISTS consolidated_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_name TEXT,
          row_data TEXT
        )`,
        (err) => (err ? reject(err) : resolve())
      )
    );

    let newRows = [];

    for (const file of req.files) {
      const workbook = xlsx.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Read starting from row 6 (index 5)
      let jsonData = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        range: 5,
        defval: "",
      });

      // Filter out unwanted footer rows (tester/date/notice)
      jsonData = jsonData.filter((row) => {
       if (!Array.isArray(row) || row.length === 0) return false;

      // If all cells are empty → skip
       const allEmpty = row.every(cell => String(cell).trim() === "");
      if (allEmpty) return false;

      // Convert entire row into one lowercase string
       const joined = row.map(cell => String(cell).toLowerCase()).join(" ");

      // Skip footer/tester/date/notice rows
      if (
       joined.includes("tester") ||
       joined.includes("date") ||
       joined.includes("notice") ||
       joined.match(/^p(\s|$)/) ||     // matches 'P' or 'p' alone
       joined.trim() === "p"
      ){
        return false;
      }

  return true;
});


      // Insert into DB
      for (const row of jsonData) {
        await new Promise((resolve, reject) =>
          db.run(
            "INSERT INTO consolidated_data (file_name, row_data) VALUES (?, ?)",
            [file.originalname, JSON.stringify(row)],
            (err) => (err ? reject(err) : resolve())
          )
        );
      }

      console.log(`✅ Processed ${jsonData.length} valid rows from ${file.originalname}`);
      newRows.push(...jsonData);
      fs.unlinkSync(file.path);
    }

    db.close();

    res.json({
      message: "Files processed and data appended successfully",
      rows: newRows,
    });
  } catch (err) {
    console.error("❌ Upload-multiple error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});


// ✅ Fetch all stored rows
app.get("/data", (req, res) => {
  const db = new sqlite3.Database("./meter_data.db");
  db.all("SELECT row_data FROM consolidated_data", [], (err, rows) => {
    if (err) {
      console.error("❌ Fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch stored data" });
    }
    const parsed = rows.map((r) => JSON.parse(r.row_data));
    res.json(parsed);
  });
  db.close();
});


// ✅ Delete all consolidated data
app.delete("/delete-all", (req, res) => {
  const db = new sqlite3.Database("./meter_data.db");
  db.run("DELETE FROM consolidated_data", (err) => {
    if (err) {
      console.error("❌ Delete error:", err);
      return res.status(500).json({ error: "Failed to delete data" });
    }
    console.log("🗑️ All data deleted from DB");
    res.json({ message: "All data deleted successfully" });
  });
  db.close();
});


// Get total number of uploaded meter rows
app.get("/count", (req, res) => {
  const db = new sqlite3.Database("./meter_data.db");
  db.get("SELECT COUNT(*) AS total FROM consolidated_data", (err, row) => {
    if (err) {
      console.error("Count error:", err);
      return res.status(500).json({ error: "Failed to count rows" });
    }
    res.json({ total: row.total });
  });
  db.close();
});


app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

