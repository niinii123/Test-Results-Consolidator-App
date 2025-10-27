
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


app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));


{/*app.post("/upload-multiple", upload.array("files"), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

    const db = await dbPromise;
    let totalInserted = 0;

    for (const file of files) {
      const filePath = path.resolve(file.path);
      const workbook = xlsx.readFile(filePath, { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // convert sheet to array-of-rows
      const sheetRows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false });

      // find header row index (where column labels like No., Asset No., Meter No. appear)
      const headerIndex = findHeaderIndex(sheetRows);
      if (headerIndex === -1) {
        // fallback: try first non-empty row as header
        const fallback = sheetRows.findIndex(r => Array.isArray(r) && r.some(c => c !== null && c !== undefined && String(c).trim() !== ""));
        if (fallback === -1) {
          console.warn(`Skipping ${file.originalname}: no header found`);
          // remove uploaded file from disk
          try { fs.unlinkSync(filePath); } catch (e) {}
          continue;
        }
        // use fallback
        headerIdx = fallback;
      } else {
        headerIdx = headerIndex;
      }

      // We will attempt to merge the header row with up to 1 row above it (if that row has non-empty cells),
      // this helps capture multi-row headers (like "Error" on one row and subcolumns on the next).
      const headerRowsToMerge = [];
      // include the row above header if it has non-empty entries
      if (headerIdx - 1 >= 0) {
        const prevRow = sheetRows[headerIdx - 1];
        const prevNotEmpty = Array.isArray(prevRow) && prevRow.some(c => c !== null && c !== undefined && String(c).trim() !== "");
        if (prevNotEmpty) headerRowsToMerge.push(prevRow);
      }
      // include header row itself
      headerRowsToMerge.push(sheetRows[headerIdx] || []);

      // build final header names
      const headerNames = buildHeaderNames(headerRowsToMerge);

      // data rows start after header row (we used headerIdx), but if we merged previous row as part of header,
      // we still start at headerIdx + 1
      const dataStart = headerIdx + 1;
      const dataRows = sheetRows.slice(dataStart);

      for (const row of dataRows) {
        if (!Array.isArray(row)) continue;
        // if entire row is empty, skip
        const allEmpty = row.every(c => c === null || c === undefined || String(c).trim() === "");
        if (allEmpty) continue;

        // build object mapping headerNames -> cell value
        const obj = {};
        for (let i = 0; i < headerNames.length; i++) {
          const key = headerNames[i] || `col_${i}`;
          const rawVal = row[i] === undefined ? null : row[i];
          obj[key] = rawVal;
        }

        // store JSON string of obj in row_data
        await db.run(
          `INSERT INTO results (row_data) VALUES (?)`,
          [JSON.stringify(obj)]
        );
        totalInserted++;
      }

      // delete uploaded file from uploads folder (we keep only DB)
      try { fs.unlinkSync(filePath); } catch (e) {}

      console.log(`Processed ${file.originalname}, inserted ${totalInserted} so far`);
    }

    res.json({ message: `Processed ${files.length} file(s)`, recordsInserted: totalInserted });
  } catch (err) {
    console.error("❌ Upload-multiple error:", err);
    res.status(500).json({ error: "Failed to process uploads" });
  }
});
*/}



{/*import express from "express";
import multer from "multer";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";
import xlsx from "xlsx";
import createManageRouter from "./routes/manage.js";


const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ✅ Setup uploads folder
const upload = multer({ dest: "uploads/" });

// ✅ Connect to database (auto creates file)
const dbPromise = open({
  filename: "./meter_results.db",
  driver: sqlite3.Database,
});

// DELETE all results (for admin)
app.delete("/admin/results", async (req, res) => {
  try {
    const db = await dbPromise; // same dbPromise you use elsewhere
    await db.run("DELETE FROM results");
    return res.json({ ok: true, message: "All consolidated results deleted." });
  } catch (err) {
    console.error("Delete all results error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// mount admin/manage routes under /admin
app.use("/admin", createManageRouter(dbPromise));



// ✅ Initialize database table
(async () => {
  const db = await dbPromise;
  await db.run(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      serial_no TEXT,
      test_result TEXT,
      date_tested TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
})();

// ✅ Test route
app.get("/", (req, res) => {
  res.send("✅ Meter Consolidator Backend is running (multi-file mode)");
});

// ✅ Upload multiple files route
app.post("/upload-multiple", upload.array("files"), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0)
      return res.status(400).json({ error: "No files uploaded" });

    const db = await dbPromise;

    let totalInserted = 0;

    for (const file of files) {
      const filePath = path.resolve(file.path);
      const workbook = xlsx.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

      // Skip header rows (1–5)
      const meterData = jsonData.slice(5);

      for (const row of meterData) {
        // Skip empty rows
        if (!row || row.length === 0) continue;

        // Example: Assuming columns are [SerialNo, TestResult, DateTested]
        const serial_no = row[0] ? String(row[0]).trim() : null;
        const test_result = row[1] ? String(row[1]).trim() : null;
        const date_tested = row[2] ? String(row[2]).trim() : null;

        // Only insert valid rows
        if (serial_no) {
          await db.run(
            `INSERT INTO results (filename, serial_no, test_result, date_tested)
             VALUES (?, ?, ?, ?)`,
            [file.originalname, serial_no, test_result, date_tested]
          );
          totalInserted++;
        }
      }

      console.log(`✅ Processed ${file.originalname}`);
    }

    res.json({
      message: `✅ Successfully processed ${files.length} file(s)`,
      recordsInserted: totalInserted,
    });
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ error: "Failed to process multiple uploads" });
  }
});

// ✅ Retrieve all test results (for viewing)
app.get("/results", async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all("SELECT * FROM results ORDER BY uploaded_at DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve results" });
  }
});

// ✅ Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

*/}

