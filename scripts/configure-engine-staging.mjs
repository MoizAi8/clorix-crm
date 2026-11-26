import { readFile,writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";

const file="artifacts/private/engine-staging.env";
const name="clorix_v2_staging";
const source=new URL(process.env.DIRECT_DATABASE_URL??"");
if(!source.hostname.endsWith(".neon.tech") || source.hostname.includes("-pooler") || source.pathname==="/"+name) {
  throw Error("Use the existing Clorix Neon direct administrative connection.");
}
source.searchParams.set("sslmode","verify-full");
const admin=new pg.Pool({connectionString:source.href,max:1,connectionTimeoutMillis:10000});
try {
  const known=(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1",[name])).rowCount;
  if(!known) await admin.query("CREATE DATABASE clorix_v2_staging TEMPLATE template0");
  const existing=await readFile(file,"utf8").catch(error=>{if(error.code!=="ENOENT")throw error;return "";});
  if(!existing) {
    if(known) throw Error("Staging already exists. Recover its ignored configuration before proceeding.");
    const roles=["clorix_stage_gateway","clorix_stage_engine"];
    const passwords=roles.map(()=>randomBytes(32).toString("hex"));
    const sql=roles.map((key,index)=>"CREATE ROLE "+key+" LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+passwords[index]+"'").join(";\n");
    await admin.query(sql);
    const direct=new URL(source);
    direct.pathname="/"+name;
    const urls=roles.map((role,index)=>{
      const runtime=new URL(direct);
      runtime.hostname=runtime.hostname.replace(".","-pooler.");
      runtime.username=role;
      runtime.password=passwords[index];
      if(index===1)runtime.searchParams.set("sslrootcert","system");
      return runtime.href;
    });
    await writeFile(file,[
      "DIRECT_DATABASE_URL="+direct.href,
      "DATABASE_URL="+urls[0],
      "CLORIX_ENGINE_DATABASE_URL="+urls[1],
      "CLORIX_ENGINE_SIGNING_KEY="+randomBytes(32).toString("hex"),
      "CLORIX_ENGINE_URL=https://clorix-engine.vercel.app/",
      "APP_URL=http://localhost:3000",
      "AUTH_SECRET="+randomBytes(48).toString("hex"),
      "DEMO_RATE_LIMIT_SECRET="+randomBytes(32).toString("hex"),
      "SANDBOX_IP_DAILY_LIMIT=20",
    ].join("\n")+"\n",{flag:"wx",mode:0o600});
  }
  console.log("Dedicated empty Clorix upgrade database and restricted staging credentials prepared.");
} catch(error) {
  console.error("Clorix staging preparation failed:",error.code??error.message);
  process.exitCode=1;
} finally { await admin.end(); }
