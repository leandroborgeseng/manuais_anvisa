import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(__dirname, "../drizzle");

function pgSslConfig(connectionString) {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  return isLocal ? undefined : { rejectUnauthorized: false };
}

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[migrate] DATABASE_URL not set, skipping");
    return;
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: pgSslConfig(databaseUrl),
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      tag VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const journalPath = path.join(drizzleDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  for (const entry of journal.entries) {
    const { rows } = await pool.query(
      "SELECT id FROM __drizzle_migrations WHERE tag = $1",
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
      await pool.query(stmt);
    }

    await pool.query("INSERT INTO __drizzle_migrations (tag) VALUES ($1)", [entry.tag]);
  }

  await pool.end();
  console.log("[migrate] Done");
}

runMigrations().catch((err) => {
  console.error("[migrate] Error:", err.message);
  process.exit(1);
});
