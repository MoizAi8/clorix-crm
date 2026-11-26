import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GET as engine,POST as mutate } from "../../src/app/api/advanced/[...parts]/route";
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
    const advanced=async (route:string,body?:object)=>{
      const sessionHeaders=new Headers(headers);
      if(body){sessionHeaders.set("origin",origin);sessionHeaders.set("Content-Type","application/json");}
      const input=new Request(origin+"/api/advanced/"+route,{headers:sessionHeaders,
        ...(body?{method:"POST",body:JSON.stringify(body)}:{})});
      return (body?mutate:engine)(input,{params:Promise.resolve({parts:[route]})});
    };
    const pipeline=await advanced("pipelines",{key:randomUUID(),version:0,name:"Advanced Verification Pipeline"});
    assert.equal(pipeline.status,200,JSON.stringify(await pipeline.clone().json()));
    const created=(await pipeline.json()).data.id;
    const pipelines=(await (await advanced("pipelines")).json()).data.pipelines;
    assert.equal(pipelines.find((item:{id:string})=>item.id===created).stages.length,4);
    const stage=pipelines.find((item:{id:string})=>item.id===created).stages[0].id;

    const rule=await advanced("workflows",{key:randomUUID(),version:0,name:"Create verification follow-up",
      trigger_type:"lead_created",enabled:true,conditions:[{field:"source",compare:"equals",value:"Fixture"}],
      actions:[{action:"task",value:"Workflow verification task"},{action:"notification",value:"Workflow verification alert"}]});
    assert.equal(rule.status,200,JSON.stringify(await rule.clone().json()));
    const crmHeaders=new Headers(headers);
    crmHeaders.set("origin",origin);
    crmHeaders.set("Content-Type","application/json");
    const crm=async (route:string,body:object)=>POST(new Request(origin+"/api/v1/"+route,{method:"POST",headers:crmHeaders,
      body:JSON.stringify(body)}),{params:Promise.resolve({parts:route.split("/")})});
    const lead=await crm("leads",{name:"Engine cross-language prospect",source:"Fixture",email:"prospect@clorix.example"});
    assert.equal(lead.status,201,JSON.stringify(await lead.clone().json()));
    const createdLead=(await lead.json()).data.id;
    const profile={key:randomUUID(),version:0,lead_id:createdLead,priority:"high",tags:["Fictional","Urgent"]};
    const updated=await advanced("lead-profile",profile);
    assert.equal(updated.status,200,JSON.stringify(await updated.clone().json()));
    assert.deepEqual(await (await advanced("lead-profile",profile)).json(),await updated.json());
    assert.equal((await advanced("lead-profile",{...profile,priority:"low"})).status,409);
    const potential=await crm("deals",{title:"Engine forecast opportunity",stage_id:stage,amount_minor:"14000"});
    assert.equal(potential.status,201,JSON.stringify(await potential.clone().json()));
    const deal=(await potential.json()).data;
    const defaultTarget=pipelines.find((item:{id:null})=>item.id===null).stages[1].id;
    assert.equal((await crm("deals/"+deal.id+"/move",{stage_id:defaultTarget,expected_version:deal.version})).status,422);
    const analytics=await advanced("intelligence");
    assert.equal(analytics.status,200,JSON.stringify(await analytics.clone().json()));
    const data=(await analytics.json()).data;
    assert.equal(data.leads[0].priority,"high");
    assert.deepEqual(data.leads[0].tags,["fictional","urgent"]);
    assert.equal(data.unscheduled_minor,"14000");

    const evaluation={key:randomUUID()};
    const first=await advanced("workflow-evaluate",evaluation);
    assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
    assert.equal((await first.clone().json()).data.completed,1);
    assert.deepEqual(await (await advanced("workflow-evaluate",evaluation)).json(),await first.json());
    assert.equal((await advanced("workflow-evaluate",{key:randomUUID()})).status,200);
    const inbox=(await (await advanced("notifications")).json()).data;
    const alert=inbox.items.filter((item:{title:string})=>item.title==="Workflow verification alert");
    assert.equal(alert.length,1);
    assert.equal((await advanced("notification-read",{key:randomUUID(),notification_id:alert[0].id})).status,200);
    const task=await pool.query("SELECT id FROM tasks WHERE workspace_id=$1 AND title='Workflow verification task'",[workspace.id]);
    assert.equal(task.rowCount,1);
    headers.set("x-clorix-workspace",randomUUID());
    assert.equal((await engine(new Request(url,{headers}),context)).status,404);
  } finally {
    await pool.query('DELETE FROM "user" WHERE email=$1',[email]);
    await pool.query("DELETE FROM clorix_access.registration WHERE intended_email=$1",[email]);
    await pool.end();
    await db().end();
  }
});
