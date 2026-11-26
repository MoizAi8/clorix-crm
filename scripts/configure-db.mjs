import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";

const local = process.argv.includes("--local");
const base = process.env.DIRECT_DATABASE_URL;
const password = randomBytes(32).toString("hex");
let direct;
if (local) {
  const adminPassword = (await readFile("artifacts/private/local-admin-password","utf8")).trim();
  direct = new URL("postgresql://clorix_admin@127.0.0.1:55439/postgres");
  direct.password = adminPassword;
  const pool = new pg.Pool({connectionString: direct.href, max: 1});
  try {
    if (!(await pool.query("SELECT 1 FROM pg_database WHERE datname='clorix_test'")).rowCount) {
      await pool.query("CREATE DATABASE clorix_test");
    }
  } finally {
    await pool.end();
  }
  direct.pathname = "/clorix_test";
} else {
  if (!base) throw new Error("The direct Neon URL is still missing.");
  direct = new URL(base);
  if (!direct.hostname.endsWith(".neon.tech") || direct.hostname.includes("-pooler")) {
    throw new Error("Use the dedicated Neon direct endpoint.");
  }
}
const pool = new pg.Pool({ connectionString:direct.href, max:1, connectionTimeoutMillis:10000 });
const output = local ? ".env.local" : "artifacts/private/release.env";
try {
  const previous = await readFile(output,"utf8").catch(() => "");
  if (previous.includes("DATABASE_URL=postgres")) throw new Error("Runtime environment already exists.");
  const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='clorix_runtime'");
  if (role.rowCount) throw new Error("Runtime role already exists. Recover or rotate the dedicated role explicitly.");
  await pool.query("CREATE ROLE clorix_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '" + password + "'");
  const runtime = new URL(direct.href);
  runtime.username = "clorix_runtime";
  runtime.password = password;
  if (!local) runtime.hostname = runtime.hostname.replace(".", "-pooler.");
  const appUrl = local ? "http://localhost:3000" : "https://clorix-crm.vercel.app";
  const variables = [
    "DATABASE_URL="+runtime.href, "DIRECT_DATABASE_URL="+direct.href,
    "AUTH_SECRET="+randomBytes(48).toString("hex"), "DEMO_RATE_LIMIT_SECRET="+randomBytes(32).toString("hex"),
    "APP_URL="+appUrl, ...(local ? ["TEST_DATABASE_URL="+runtime.href] : []),
  ];
  await writeFile(output,variables.join("\n")+"\n",{flag:"wx",mode:0o600});
  console.log("Created dedicated runtime role and local environment file.");
} catch (error) {
  console.error("Database setup failed:",error.code ?? error.message);
  process.exitCode=1;
} finally {
  await pool.end();
}
