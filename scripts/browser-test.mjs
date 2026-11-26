import { randomBytes,randomUUID,createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import pg from "pg";

const hosted=process.argv.includes("--hosted");
const direct=process.env.DIRECT_DATABASE_URL;
const origin=process.env.APP_URL;
if(!direct||!origin|| (hosted
  ? origin!=="https://clorix-v2-preview.vercel.app"||new URL(direct).pathname!=="/clorix_v2_staging"
  : origin!=="http://localhost:3000"||new URL(direct).pathname!=="/clorix_test")) {
  throw Error("Browser suites require the isolated local or hosted staging database and origin.");
}
const pool=new pg.Pool({connectionString:direct,max:1,connectionTimeoutMillis:10000});
const stamp=hosted?"hosted":"local";
const email="qa-"+randomUUID()+"@clorix.example";
const title="Browser verification "+randomUUID();
const token=randomBytes(32).toString("base64url");
const tokenHash=createHash("sha256").update(token).digest("hex");
const invite=new URL("/register",origin);
invite.hash=token;
const password=randomBytes(24).toString("base64url");
const sandboxFile="artifacts/private/"+stamp+"-owned-sandboxes.json";
await mkdir("artifacts/private",{recursive:true});
await writeFile(sandboxFile,"[]");
try {
  await pool.query("INSERT INTO clorix_access.registration(token_hash,intended_email,workspace_name,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",[tokenHash,email,title]);
  const args=["node_modules/@playwright/test/cli.js","test",...(hosted?["--grep-invert","@local"]:[]),...(process.env.CLORIX_ENGINE_BROWSER_ONLY==="1"?["--grep","@advanced"]:[])];
  const result=spawnSync(process.execPath,args,{
    stdio:["ignore","inherit","inherit"],
    env:{...process.env,DIRECT_DATABASE_URL:"",DATABASE_URL:"",AUTH_SECRET:"",DEMO_RATE_LIMIT_SECRET:"",
      CLORIX_ENGINE_DATABASE_URL:"",CLORIX_ENGINE_SIGNING_KEY:"",
      ...(hosted?{CLORIX_TEST_ORIGIN:origin}:{}),CLORIX_TEST_PRIVATE_INVITE:invite.href,
      CLORIX_TEST_PRIVATE_EMAIL:email,CLORIX_TEST_PRIVATE_PASSWORD:password},
  });
  process.exitCode=result.status ?? 1;
} finally {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const ids=JSON.parse(await readFile(sandboxFile,"utf8"));
    if(Array.isArray(ids)&&ids.length) {
      await client.query(`DELETE FROM "user" u WHERE u."isAnonymous" IS TRUE AND EXISTS (
        SELECT 1 FROM workspaces w WHERE w.created_by=u.id AND w.id=ANY($1::uuid[]) AND w.kind='sandbox' AND w.name='Sandbox workspace')
        AND NOT EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=u.id AND w.kind='private')`,[ids]);
    }
    await client.query(`DELETE FROM "user" u WHERE u.email=$1 AND u."isAnonymous" IS NOT TRUE AND EXISTS (
      SELECT 1 FROM workspaces w WHERE w.created_by=u.id AND w.kind='private' AND w.name=$2)`,[email,title]);
    await client.query("DELETE FROM clorix_access.registration WHERE token_hash=$1",[tokenHash]);
    await client.query("COMMIT");
  } catch(error) {
    await client.query("ROLLBACK");
    console.error("Owned synthetic browser fixture cleanup failed:",error.code??error.name);
    process.exitCode=1;
  } finally {client.release();await pool.end();}
}
