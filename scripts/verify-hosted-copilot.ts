import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { serviceGrant } from "../src/server/engine/gateway";

const direct=process.env.DIRECT_DATABASE_URL;
const engine=process.env.CLORIX_ENGINE_URL;
const key=process.env.CLORIX_ENGINE_SIGNING_KEY;
if(!direct||new URL(direct).pathname!=="/clorix_v2_staging"||
  engine!=="https://clorix-engine.vercel.app/"||!key||key.length<32||
  process.env.CLORIX_APPROVED_REVIEWER_REGION!=="PK") throw Error("Use isolated staging and an approved Pakistan reviewer.");

async function verify() {
  const admin=new Pool({connectionString:direct,max:1,connectionTimeoutMillis:10000});
  const actor=randomUUID();
  const email=actor+"@clorix.example";
  const model=process.env.CLORIX_GEMINI_MODEL??"";
  assert.equal(model,"gemini-3.5-flash-lite");
  try {
    await admin.query(`INSERT INTO "user"(id,name,email,"createdAt","updatedAt") VALUES($1,'Fictional Copilot reviewer',$2,now(),now())`,[actor,email]);
    const {rows:[space]}=await admin.query("SELECT clorix_access.init_workspace($1,'Fictional Gemini verification','private',null) AS id",[actor]);
    await admin.query("INSERT INTO copilot_reviewers(workspace_id,user_id,jurisdiction) VALUES($1,$2,'PK')",[space.id,actor]);
    function call(method:"GET"|"POST",path:string,scope:string,input:object|null=null,country="PK") {
      const body=input?JSON.stringify(input):"";
      const requestId=randomUUID();
      const token=serviceGrant({actor,workspace:space.id,country},{method,path,scope},body,requestId,key!);
      return fetch(new URL(path,engine),{method,body:body||undefined,headers:{
        "Content-Type":"application/json","X-Request-Id":requestId,"Authorization":"Bearer "+token,
      },cache:"no-store",signal:AbortSignal.timeout(25_000)});
    }
    const anonymous=await fetch(new URL("/v2/copilot",engine),{signal:AbortSignal.timeout(10_000)});
    assert.equal(anonymous.status,401);
    const excluded=await call("GET","/v2/copilot","copilot:read",null,"GB");
    assert.equal(excluded.status,403);
    const input={key:randomUUID(),fixture:"paper",action:"meeting",consent:true};
    const timed=performance.now();
    const result=await call("POST","/v2/copilot-ask","copilot:ask",input);
    const latencyMs=Math.round(performance.now()-timed);
    const payload=await result.json();
    assert.equal(result.status,200,"Gemini verified request returned "+(payload.error?.code??result.status));
    const answer=payload.data.response;
    assert.equal(payload.data.status,"completed");
    assert.ok(answer.title&&answer.summary&&answer.context_refs.length);
    assert.ok(answer.context_refs.every((value:string)=>["paper-renewal","paper-support","paper-training"].includes(value)));
    const {rows:[persisted]}=await admin.query("SELECT status,response FROM copilot_messages WHERE workspace_id=$1 AND user_id=$2 AND id=$3",[space.id,actor,payload.data.id]);
    assert.equal(persisted.status,"completed");
    assert.deepEqual(persisted.response,answer);
    const replay=await call("POST","/v2/copilot-ask","copilot:ask",input);
    assert.equal(replay.status,200);
    assert.deepEqual((await replay.json()).data,payload.data);
    const deleted=await call("POST","/v2/copilot-delete","copilot:delete",{id:payload.data.conversation_id});
    assert.equal(deleted.status,200);
    const history=await call("GET","/v2/copilot","copilot:read");
    assert.equal(history.status,200);
    assert.deepEqual((await history.json()).data.messages,[]);
    const evidence={engineCommit:process.env.CLORIX_ENGINE_DEPLOYED_SHA??null,model,fixture:input.fixture,action:input.action,
      realGemini:true,latencyMs,signedReviewer:true,persistedResponse:true,idempotentReplay:true,historyDeleted:true,
      unauthorizedDenied:true,unsupportedRegionDenied:true,responseDigest:createHash("sha256").update(JSON.stringify(answer)).digest("hex")};
    await mkdir("artifacts/visual-qa",{recursive:true});
    await writeFile("artifacts/visual-qa/gemini-hosted-verification.json",JSON.stringify(evidence,null,2)+"\n");
    console.log(JSON.stringify(evidence));
  } finally {
    await admin.query(`DELETE FROM "user" WHERE id=$1 AND email=$2`,[actor,email]);
    await admin.end();
  }
}
void verify().catch(error=>{
  console.error("Hosted Gemini verification failed:",error instanceof assert.AssertionError?error.message:error.code??error.name);
  process.exitCode=1;
});
