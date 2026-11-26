import {readFile} from "node:fs/promises";
import pg from "pg";
const direct=new URL(process.env.DIRECT_DATABASE_URL??"");
if(direct.pathname!=="/clorix_v2_staging")throw Error("Only the Clorix staging database is authorized.");
const pool=new pg.Pool({connectionString:direct.href,max:1,connectionTimeoutMillis:10000});
try {
  const legacy=(await readFile("db/schema/runtime-grants.sql","utf8")).replaceAll("clorix_runtime","clorix_stage_gateway");
  const engine=(await readFile("db/schema/engine-grants.sql","utf8")).replaceAll("clorix_engine","clorix_stage_engine");
  await pool.query(legacy+"\n"+engine);
  console.log("Gateway and FastAPI staging grants applied.");
} catch(error) {
  console.error("Clorix staging grants failed:",error.code??error.name);
  process.exitCode=1;
} finally {await pool.end();}
