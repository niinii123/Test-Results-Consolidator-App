import fs from "fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

(async () => {
  const db = await open({ filename: "./meter_results.db", driver: sqlite3.Database });
  const rows = await db.all("SELECT * FROM results");
  fs.writeFileSync("results-backup.json", JSON.stringify(rows, null, 2));
  console.log("Saved results-backup.json");
  process.exit(0);
})();
