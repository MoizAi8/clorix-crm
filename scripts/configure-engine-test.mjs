import { readFile,writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";

const output="artifacts/private/engine.env";
const direct=new URL(process.env.DIRECT_DATABASE_URL??"");
if (direct.pathname!=="/clorix_test" || direct.hostname!=="127.0.0.1") {
  throw Error("Only the dedicated loopback clorix_test database is supported by this script.");
}
const pool=new pg.Pool({connectionString:direct.href,max:1});
try {
  const existing=await readFile(output,"utf8").catch(error=>{
    if(error.code!=="ENOENT")throw error;
    return "";
  });
  if(!existing) {
    const password=randomBytes(32).toString("hex");
    await pool.query("CREATE ROLE clorix_engine LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+password+"'");
    const engine=new URL(direct);
    engine.username="clorix_engine";
    engine.password=password;
    await writeFile(output,
      "CLORIX_ENGINE_DATABASE_URL="+engine.href+"\nCLORIX_ENGINE_URL=http://127.0.0.1:8812/\nCLORIX_ENGINE_SIGNING_KEY="+randomBytes(32).toString("hex")+"\n",
      {flag:"wx",mode:0o600});
  }
  await pool.query(await readFile("db/schema/engine-grants.sql","utf8"));
  console.log("Prepared the isolated Clorix engine role and configuration.");
} catch (error) {
  console.error("Could not configure the dedicated engine role:",error.code??error.name);
  process.exitCode=1;
} finally { await pool.end(); }
