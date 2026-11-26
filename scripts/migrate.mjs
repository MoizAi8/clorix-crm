import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";

const direct = process.env.DIRECT_DATABASE_URL;
if (!direct) throw new Error("Set the direct migration connection in the local environment.");
const pool = new pg.Pool({ connectionString: direct, max: 1, connectionTimeoutMillis: 10000 });

try {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(620102545)");
    await client.query("CREATE TABLE IF NOT EXISTS clorix_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const folder = new URL("../db/migrations/", import.meta.url);
    for (const name of (await readdir(folder)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(new URL(name, folder), "utf8");
      const hash = createHash("sha256").update(sql.replaceAll("\r\n","\n")).digest("hex");
      const previous = (await client.query("SELECT sha256 FROM clorix_migrations WHERE name=$1",[name])).rows[0];
      if (previous) {
        if (previous.sha256 !== hash) throw new Error("Applied migration has changed: " + name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO clorix_migrations(name,sha256) VALUES($1,$2)",[name,hash]);
        await client.query("COMMIT");
        console.log("Applied " + name);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Migration failed:",name,error.code ?? "unknown",error.message);
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    client.release();
  }
} catch (error) {
  console.error("Migration connection or state failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
