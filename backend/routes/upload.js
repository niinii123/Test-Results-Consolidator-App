// backend/routes/upload.js
import express from "express";
import multer from "multer";
import XLSX from "xlsx";
import { openDb } from "../db.js";
import fs from "fs";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const db = await openDb();

    // Read excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Attempt to parse header values from top rows (best effort)
    // Example: row 0 might contain "Ghana Standards Authority METER VERIFICATION RECORD Model: aMeter100 Type: 5(60)A Class: 1.0 Const: 1000imp/kWh"
    const headerLine = data[0] || [];
    // Fallback parsing: look for "Model:" "Type:" "Class:" "Const:" in first few rows
    const combinedTop = data.slice(0, 6).map(r => (r||[]).join(" ")).join(" ");
    const getVal = (key) => {
      const m = combinedTop.match(new RegExp(key + "\\s*[:\\-]?\\s*([^\\s]+)", "i"));
      return m ? m[1] : null;
    };

    const model = getVal("Model") || getVal("Model:") || "Unknown";
    const type = getVal("Type") || "Unknown";
    const class_ = getVal("Class") || "Unknown";
    const constVal = getVal("Const") || getVal("Const:") || "Unknown";

    // Insert header if not exists
    const existingHeader = await db.get("SELECT * FROM header LIMIT 1");
    let headerId = existingHeader ? existingHeader.id : null;

    if (!existingHeader) {
      const result = await db.run(
        "INSERT INTO header (organization, model, type, class, const) VALUES (?, ?, ?, ?, ?)",
        ["Ghana Standards Authority", model, type, class_, constVal]
      );
      headerId = result.lastID;
    } else {
      headerId = existingHeader.id;
    }

    // Find the start of tabular data
    const startIndex = data.findIndex(
      (row) =>
        Array.isArray(row) &&
        (row.map(c => String(c).toLowerCase()).includes("no.") ||
         row.map(c => String(c).toLowerCase()).includes("asset no.") ||
         row.map(c => String(c).toLowerCase()).includes("meter no."))
    );

    if (startIndex === -1) {
      return res.status(400).json({ error: "Could not find table header (No./Asset No./Meter No.) in the sheet." });
    }

    const headerRow = data[startIndex].map(c => (c||"").toString().trim());
    const rows = data.slice(startIndex + 1);

    // Map columns by index: try find typical columns
    // We'll assume asset_no at index 1 and meter_no at index 2 as your sample showed
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const asset = row[1];
      const meter = row[2];
      if (!asset && !meter) continue;

      await db.run(
        `INSERT INTO test_results (header_id, asset_no, meter_no, error_1, error_2, error_3, error_4, result, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          headerId,
          asset ? String(asset) : null,
          meter ? String(meter) : null,
          row[4] ?? null,
          row[5] ?? null,
          row[6] ?? null,
          row[7] ?? null,
          row[23] ?? null,
          req.body.uploaded_by || "Technician"
        ]
      );
    }

    // remove uploaded file (optional)
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.json({ message: "✅ File processed and results added successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error processing file.", details: error.message });
  }
});

export default router;
