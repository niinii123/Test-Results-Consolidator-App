// backend/routes/manage.js
import express from "express";
import path from "path";
import fs from "fs";

const router = express.Router();

// NOTE: assumes your server has `dbPromise` available via import in server.js
// We'll accept a dbPromise function injected when mounting the router.
// To keep things simple, we'll export a function that accepts dbPromise.

export default function createManageRouter(dbPromise) {
  const r = express.Router();

  // DELETE all results
  r.delete("/results", async (req, res) => {
    try {
      const db = await dbPromise();
      await db.run("DELETE FROM results");
      res.json({ ok: true, message: "All results deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE single result by id
  r.delete("/results/:id", async (req, res) => {
    try {
      const db = await dbPromise();
      const { id } = req.params;
      await db.run("DELETE FROM results WHERE id = ?", id);
      res.json({ ok: true, message: `Deleted result id=${id}` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST to clear uploaded files in uploads/ folder
  r.post("/clear-uploads", async (req, res) => {
    try {
      const dir = path.resolve("uploads");
      if (!fs.existsSync(dir)) return res.json({ ok: true, deleted: 0 });

      const files = fs.readdirSync(dir);
      let deleted = 0;
      for (const f of files) {
        const p = path.join(dir, f);
        try { fs.unlinkSync(p); deleted++; } catch(e) { console.warn("Could not delete", p, e.message); }
      }
      res.json({ ok: true, deleted });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // (Optional) endpoint to recreate the results table (dev only)
  r.post("/reset-table", async (req, res) => {
    try {
      const db = await dbPromise();
      await db.exec("DROP TABLE IF EXISTS results");
      await db.exec(`
        CREATE TABLE IF NOT EXISTS results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT,
          serial_no TEXT,
          test_result TEXT,
          date_tested TEXT,
          uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      res.json({ ok: true, message: "results table recreated" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return r;
}
