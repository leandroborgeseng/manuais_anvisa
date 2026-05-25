import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(__dirname, "../drizzle");

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[migrate] DATABASE_URL not set, skipping");
    return;
  }

  const connection = await mysql.createConnection(databaseUrl);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tag VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const journalPath = path.join(drizzleDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  for (const entry of journal.entries) {
    const [rows] = await connection.execute(
      "SELECT id FROM __drizzle_migrations WHERE tag = ?",
      [entry.tag]
    );
    if (rows.length > 0) {
      console.log(`[migrate] Already applied: ${entry.tag}`);
      continue;
    }

    const sqlFile = path.join(drizzleDir, `${entry.tag}.sql`);
    const raw = fs.readFileSync(sqlFile, "utf-8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`[migrate] Applying: ${entry.tag} (${statements.length} statements)`);
    for (const stmt of statements) {
      await connection.execute(stmt);
    }

    await connection.execute(
      "INSERT INTO __drizzle_migrations (tag) VALUES (?)",
      [entry.tag]
    );
  }

  await connection.end();
  console.log("[migrate] Done");
}

runMigrations().catch((err) => {
  console.error("[migrate] Error:", err.message);
  process.exit(1);
});
