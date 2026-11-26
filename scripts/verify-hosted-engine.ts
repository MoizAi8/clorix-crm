import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { GET,POST } from "../src/app/api/v1/[...parts]/route";
import { GET as engine,POST as change } from "../src/app/api/advanced/[...parts]/route";
import { db } from "../src/server/db";

const direct=process.env.DIRECT_DATABASE_URL;
const runtime=process.env.DATABASE_URL;
const origin=process.env.APP_URL;
const engineUrl=process.env.CLORIX_ENGINE_URL;
if(!direct||!runtime||!origin||new URL(direct).pathname!=="/clorix_v2_staging"||
   new URL(runtime).pathname!=="/clorix_v2_staging"||engineUrl!=="https://clorix-engine.vercel.app/") {
  throw Error("The dedicated hosted staging configuration is required.");
}

async function main(){
  const admin=new Pool({connectionString:direct,max:1});
  const base=new URL(origin!);
  const writeHeaders=new Headers({origin:base.origin,"Content-Type":"application/json"});
  let owned:string|undefined;
  try{
    const health=await fetch(engineUrl+"health",{signal:AbortSignal.timeout(12000)});
    assert.equal(health.status,200);
    assert.deepEqual((await health.json()).data,{status:"ok",service:"clorix-engine"});
    assert.equal((await fetch(engineUrl+"v2/workspace",{signal:AbortSignal.timeout(12000)})).status,401);
    const opened=await POST(new Request(new URL("/api/v1/access/sandbox",base),{
      method:"POST",headers:writeHeaders,body:JSON.stringify({synthetic:true}),
    }),{params:Promise.resolve({parts:["access","sandbox"]})});
    assert.equal(opened.status,200);
    writeHeaders.set("cookie",opened.headers.getSetCookie().map(value=>value.split(";")[0]).join("; "));
    const list=await GET(new Request(new URL("/api/v1/workspaces",base),{headers:writeHeaders}),
      {params:Promise.resolve({parts:["workspaces"]})});
    owned=(await list.json()).data.workspaces[0].id;
    assert.ok(owned);
    writeHeaders.set("x-clorix-workspace",owned);
    const advanced=(parts:string[],body?:object)=>{
      const request=new Request(new URL("/api/advanced/"+parts.join("/"),base),
        {headers:writeHeaders,...(body?{method:"POST",body:JSON.stringify(body)}:{})});
      return (body?change:engine)(request,{params:Promise.resolve({parts})});
    };
    const timing=performance.now();
    const info=await advanced(["workspace"]);
    assert.equal(info.status,200);
    assert.equal((await info.json()).data.kind,"sandbox");
    const identityMs=Math.round(performance.now()-timing);
    const reportStart=performance.now();
    const report=await advanced(["intelligence"]);
    assert.equal(report.status,200,JSON.stringify(await report.clone().json()));
    const analysis=await report.json();
    assert.equal(analysis.data.leads.length,12);
    assert.ok(analysis.data.risks.length>0);
    const analysisMs=Math.round(performance.now()-reportStart);
    const changed=await advanced(["lead-profile"],{
      key:crypto.randomUUID(),version:0,lead_id:analysis.data.leads[0].id,tags:["hosted-verification"],priority:"high",
    });
    assert.equal(changed.status,200);
    const {rows:[persisted]}=await admin.query("SELECT priority,tags FROM lead_profiles WHERE workspace_id=$1 AND lead_id=$2",
      [owned,analysis.data.leads[0].id]);
    assert.equal(persisted.priority,"high");
    assert.deepEqual(persisted.tags,["hosted-verification"]);
    const result={mode:"Local Next.js route handler calling hosted FastAPI and isolated Neon PostgreSQL",
      publicEngineHealth:engineUrl+"health",engineCommit:process.env.CLORIX_ENGINE_DEPLOYED_SHA??null,
      signedReadMs:identityMs,advancedAnalysisMs:analysisMs,
      anonymousRequestDenied:true,syntheticSandbox:true,persistedProfileWrite:true};
    await mkdir("artifacts/visual-qa",{recursive:true});
    await writeFile("artifacts/visual-qa/staging-engine-verification.json",JSON.stringify(result,null,2)+"\n");
    console.log(JSON.stringify(result));
  } finally {
    if(owned) await admin.query(`DELETE FROM "user" u WHERE u."isAnonymous" IS TRUE AND EXISTS
      (SELECT 1 FROM workspaces w WHERE w.id=$1 AND w.created_by=u.id AND w.kind='sandbox')`,[owned]);
    await admin.end();
    await db().end();
  }
}

void main().catch(error=>{console.error("Hosted staging verification failed:",error instanceof Error?error.message:"request error");process.exitCode=1;});
