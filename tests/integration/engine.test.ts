import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GET as engine } from "../../src/app/api/advanced/[...parts]/route";
import { POST } from "../../src/app/api/v1/[...parts]/route";
import { db } from "../../src/server/db";

test("Next.js authenticates and delegates the selected tenant to the real Python service",{
  skip:process.env.CLORIX_ENGINE_TEST!=="1"?"Python integration environment is not active.":false,
},async ()=>{
  const direct=process.env.DIRECT_DATABASE_URL;
  assert.ok(direct && new URL(direct).pathname==="/clorix_test");
  assert.equal(process.env.DATABASE_URL,process.env.TEST_DATABASE_URL);
  assert.equal(new URL(process.env.CLORIX_ENGINE_URL!).hostname,"127.0.0.1");
  const pool=new Pool({connectionString:direct,max:1});
  const origin=process.env.APP_URL??"http://localhost:3000";
  const token=randomBytes(32).toString("base64url");
  const email="engine-"+randomUUID()+"@clorix.example";
  const headers=new Headers();
  const context={params:Promise.resolve({parts:["workspace"]})};
  const url=origin+"/api/advanced/workspace";
  try {
    assert.equal((await engine(new Request(url),context)).status,401);
    await pool.query("INSERT INTO clorix_access.registration(token_hash,intended_email,workspace_name,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
      [createHash("sha256").update(token).digest("hex"),email,"Python engine verification"]);
    const signed=await POST(new Request(origin+"/api/v1/access/register",{method:"POST",
      headers:{origin,"Content-Type":"application/json"},body:JSON.stringify({
        name:"Verification evaluator",email,password:randomBytes(20).toString("base64url"),token,
      })}),{params:Promise.resolve({parts:["access","register"]})});
    assert.equal(signed.status,200);
    headers.set("cookie",signed.headers.getSetCookie().map(value=>value.split(";")[0]).join("; "));
    const {rows:[workspace]}=await pool.query('SELECT w.id FROM workspaces w JOIN "user" u ON u.id=w.created_by WHERE u.email=$1',[email]);
    headers.set("x-clorix-workspace",workspace.id);
    const response=await engine(new Request(url,{headers}),context);
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.deepEqual((await response.json()).data,{currency:"USD",timezone:"UTC",role:"owner",kind:"private"});
    headers.set("x-clorix-workspace",randomUUID());
    assert.equal((await engine(new Request(url,{headers}),context)).status,404);
  } finally {
    await pool.query('DELETE FROM "user" WHERE email=$1',[email]);
    await pool.query("DELETE FROM clorix_access.registration WHERE intended_email=$1",[email]);
    await pool.end();
    await db().end();
  }
});
