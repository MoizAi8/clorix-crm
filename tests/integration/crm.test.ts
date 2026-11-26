import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DELETE,GET,PATCH,POST } from "../../src/app/api/v1/[...parts]/route";
import { db } from "../../src/server/db";
import { quotaHash } from "../../src/server/quotas";

const direct=process.env.DIRECT_DATABASE_URL;
const runtime=process.env.TEST_DATABASE_URL;
if (!direct || !runtime || process.env.DATABASE_URL!==runtime || new URL(direct).pathname!=="/clorix_test" || new URL(runtime).pathname!=="/clorix_test")
  throw Error("Integration suite requires the isolated clorix_test database and its restricted role.");
const dbAdmin=new Pool({connectionString:direct,max:2});
const origin=process.env.APP_URL ?? "http://localhost:3000";
const identities:{cookie:string;workspace:string;user:string;email?:string}[]=[];
const routes={GET,POST,PATCH,DELETE};

async function request(method:keyof typeof routes,path:string,body?:unknown,cookie?:string,workspace?:string,host=origin,network?:string) {
  const headers=new Headers({origin:host});
  if(cookie)headers.set("cookie",cookie);
  if(network)headers.set("x-vercel-forwarded-for",network);
  if(workspace)headers.set("x-clorix-workspace",workspace);
  if(body!==undefined)headers.set("content-type","application/json");
  const url=new URL("/api/v1/"+path,origin);
  const response=await routes[method](new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),
    {params:Promise.resolve({parts:url.pathname.split("/").slice(3)})});
  return { status:response.status,response,data:(response.headers.get("content-type")?.includes("json")?await response.json():await response.text()) };
}

function cookie(response:Response) {
  return response.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
}

async function prepareSandbox(existing?:string) {
  const prepared=await request("GET","access/sandbox",undefined,existing);
  assert.equal(prepared.status,200);
  return cookie(prepared.response);
}

async function start(kind:"sandbox"|"register",email?:string) {
  const token=randomBytes(32).toString("base64url");
  if(email) await dbAdmin.query("INSERT INTO clorix_access.registration(token_hash,intended_email,workspace_name,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')",
    [createHash("sha256").update(token).digest("hex"),email,"Test "+email.split("@")[0]]);
  const result=await request("POST","access/"+kind,kind==="sandbox"?{synthetic:true}:{name:"Test evaluator",email,password:"Fictional testing password 49",token},
    kind==="sandbox"?await prepareSandbox():undefined);
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.match(result.response.headers.getSetCookie()[0],/HttpOnly/i);
  const key=cookie(result.response);
  const spaces=await request("GET","workspaces",undefined,key);
  assert.equal(spaces.status,200);
  const workspace=spaces.data.data.workspaces[0].id;
  const {rows:[owner]}=await dbAdmin.query("SELECT created_by FROM workspaces WHERE id=$1",[workspace]);
  const item={cookie:key,workspace,user:owner.created_by,email};
  identities.push(item);
  return item;
}

after(async ()=>{
  for(const item of identities) {
    if(item.email)await dbAdmin.query("DELETE FROM invites WHERE workspace_id=$1 AND created_by=$2",[item.workspace,item.user]);
    await dbAdmin.query('DELETE FROM "user" WHERE id=$1',[item.user]);
    if(item.email)await dbAdmin.query("DELETE FROM clorix_access.registration WHERE intended_email=$1",[item.email]);
  }
  await dbAdmin.end();
  await db().end();
});

test("PostgreSQL-backed CRM and access contract",async t=>{
  await dbAdmin.query("DELETE FROM clorix_access.quota");
  let a:Awaited<ReturnType<typeof start>>,b:Awaited<ReturnType<typeof start>>;
  let lead:{id:string;version:number},deal:string,contact:string,company:string,task:string;
  let stage:{id:string;kind:string;name:string}[];
  let base:string;
  const auth=(method:keyof typeof routes,path:string,body?:unknown)=>request(method,path,body,a.cookie,a.workspace);

  await t.test("restricted role has no owner, bypass or DDL rights",async()=>{
    const {rows:[role]}=await db().query("SELECT rolname,rolsuper,rolbypassrls,has_schema_privilege(current_user,'public','CREATE') AS ddl FROM pg_roles WHERE rolname=current_user");
    assert.deepEqual(role,{rolname:"clorix_runtime",rolsuper:false,rolbypassrls:false,ddl:false});
    assert.equal((await db().query("SELECT id FROM companies")).rowCount,0);
    await assert.rejects(db().query("SELECT browser_hash FROM clorix_access.sandbox_admissions"),{code:"42501"});
    await assert.rejects(db().query("SELECT clorix_access.init_workspace($1,'unauthorized','private',NULL)",[randomUUID()]),{code:"42501"});
  });

  await t.test("unauthenticated and foreign-origin requests are denied",async()=>{
    assert.equal((await request("GET","leads")).status,401);
    assert.equal((await request("POST","access/sandbox",{synthetic:true},undefined,undefined,"https://other.example")).status,403);
    assert.equal((await request("POST","access/sandbox",{synthetic:false})).status,422);
    assert.equal((await request("POST","access/sandbox",{synthetic:true})).data.error.code,"sandbox_cookie");
  });

  await t.test("two anonymous identities are isolated and seeded",async()=>{
    a=await start("sandbox");b=await start("sandbox");
    assert.notEqual(a.workspace,b.workspace);
    assert.equal((await auth("GET","leads")).data.data.length,12);
    assert.equal((await auth("POST","access/sandbox",{synthetic:true})).status,200);
    assert.equal((await request("GET","leads",undefined,b.cookie,a.workspace)).status,404);
    const dashboard=await auth("GET","dashboard");
    assert.equal(dashboard.status,200,JSON.stringify(dashboard.data));
    base=dashboard.data.data.won_minor;
    assert.equal(dashboard.data.data.active_leads,12);
    assert.equal(dashboard.data.data.stages.length,6);
    stage=dashboard.data.data.stages;
    assert.ok(BigInt(dashboard.data.data.open_minor)>0n);
  });

  await t.test("concurrent starts and a lost response reuse one session and one charge",async()=>{
    const browser=await prepareSandbox();
    assert.match(browser,/^clorix-sandbox=[A-Za-z0-9_-]{43}$/);
    assert.equal(await prepareSandbox(browser),"");
    const scopes=[quotaHash("sandbox-ip","local"),quotaHash("sandbox-global","all")];
    const counts=async()=> (await dbAdmin.query("SELECT count FROM clorix_access.quota WHERE scope=ANY($1) ORDER BY scope",[scopes])).rows.map(row=>row.count);
    const before=await counts();
    const starts=await Promise.all(Array.from({length:4},()=>request("POST","access/sandbox",{synthetic:true},browser)));
    assert.ok(starts.every(result=>result.status===200));
    assert.equal(starts.filter(result=>result.data.data.resumed===false).length,1);
    const sameSessions=new Set(starts.map(result=>cookie(result.response)));
    assert.equal(sameSessions.size,1);
    const session=cookie(starts[0].response);
    const spaces=(await request("GET","workspaces",undefined,session)).data.data.workspaces;
    assert.equal(spaces.length,1);
    assert.notEqual(spaces[0].id,a.workspace);
    const {rows:[owner]}=await dbAdmin.query("SELECT created_by FROM workspaces WHERE id=$1",[spaces[0].id]);
    identities.push({cookie:session,workspace:spaces[0].id,user:owner.created_by});
    assert.deepEqual(await counts(),before.map(count=>count+1));

    const networkLimit=process.env.SANDBOX_IP_DAILY_LIMIT;
    process.env.SANDBOX_IP_DAILY_LIMIT="1";
    try {
      const replay=await request("POST","access/sandbox",{synthetic:true},browser);
      assert.equal(replay.status,200);
      assert.equal(replay.data.data.resumed,true);
      assert.equal(cookie(replay.response),session);
      assert.equal((await request("POST","access/sandbox",{synthetic:true},a.cookie)).status,200);
      const limited=await request("POST","access/sandbox",{synthetic:true},await prepareSandbox());
      assert.equal(limited.status,429);
      assert.equal(limited.data.error.code,"sandbox_network");
      const seconds=Number(limited.response.headers.get("retry-after"));
      assert.ok(seconds>0&&seconds<=86400);
      assert.deepEqual(await counts(),before.map(count=>count+1));
      await request("POST","access/logout",{},session);
      const afterLogout=await request("POST","access/sandbox",{synthetic:true},browser);
      assert.equal(afterLogout.status,429,"A signed-out session cannot be reissued from its browser receipt");
    } finally {
      if(networkLimit===undefined)delete process.env.SANDBOX_IP_DAILY_LIMIT;
      else process.env.SANDBOX_IP_DAILY_LIMIT=networkLimit;
    }
  });

  await t.test("global quota returns its remaining window without charging the network",async()=>{
    const network=quotaHash("sandbox-ip","local");
    const global=quotaHash("sandbox-global","all");
    const {rows:[previous]}=await dbAdmin.query("SELECT count,expires_at FROM clorix_access.quota WHERE scope=$1",[global]);
    const {rows:[before]}=await dbAdmin.query("SELECT count FROM clorix_access.quota WHERE scope=$1",[network]);
    await dbAdmin.query("UPDATE clorix_access.quota SET count=90,expires_at=now()+interval '90 seconds' WHERE scope=$1",[global]);
    try {
      const limited=await request("POST","access/sandbox",{synthetic:true},await prepareSandbox());
      assert.equal(limited.status,429);
      assert.equal(limited.data.error.code,"sandbox_daily");
      const seconds=Number(limited.response.headers.get("retry-after"));
      assert.ok(seconds>=85&&seconds<=90);
      const {rows:[after]}=await dbAdmin.query("SELECT count FROM clorix_access.quota WHERE scope=$1",[network]);
      assert.equal(after.count,before.count);
    } finally {
      await dbAdmin.query("UPDATE clorix_access.quota SET count=$2,expires_at=$3 WHERE scope=$1",[global,previous.count,previous.expires_at]);
    }
  });

  await t.test("hosted network limits isolate distinct verified addresses",async()=>{
    const mode=process.env.VERCEL;
    const limit=process.env.SANDBOX_IP_DAILY_LIMIT;
    process.env.VERCEL="1";
    process.env.SANDBOX_IP_DAILY_LIMIT="1";
    try {
      const first="203.0.113.7",second="203.0.113.8";
      const open=async(network?:string)=>request("POST","access/sandbox",{synthetic:true},await prepareSandbox(),undefined,origin,network);
      assert.equal((await open()).data.error.code,"network");
      assert.equal((await open(first+", "+second)).data.error.code,"network");
      const firstResult=await open(first);
      assert.equal(firstResult.status,200);
      const firstCookie=cookie(firstResult.response);
      const firstWorkspace=(await request("GET","workspaces",undefined,firstCookie)).data.data.workspaces[0].id;
      const {rows:[firstOwner]}=await dbAdmin.query("SELECT created_by FROM workspaces WHERE id=$1",[firstWorkspace]);
      identities.push({cookie:firstCookie,workspace:firstWorkspace,user:firstOwner.created_by});
      assert.equal((await open(first)).data.error.code,"sandbox_network");
      const secondResult=await open(second);
      assert.equal(secondResult.status,200);
      const secondCookie=cookie(secondResult.response);
      const secondWorkspace=(await request("GET","workspaces",undefined,secondCookie)).data.data.workspaces[0].id;
      const {rows:[secondOwner]}=await dbAdmin.query("SELECT created_by FROM workspaces WHERE id=$1",[secondWorkspace]);
      identities.push({cookie:secondCookie,workspace:secondWorkspace,user:secondOwner.created_by});
      assert.notEqual(firstWorkspace,secondWorkspace);
      assert.equal((await request("GET","leads",undefined,secondCookie,firstWorkspace)).status,404);
    } finally {
      if(mode===undefined)delete process.env.VERCEL;
      else process.env.VERCEL=mode;
      if(limit===undefined)delete process.env.SANDBOX_IP_DAILY_LIMIT;
      else process.env.SANDBOX_IP_DAILY_LIMIT=limit;
    }
  });

  await t.test("lead validation, search and scope",async()=>{
    assert.ok(a);
    assert.equal((await auth("POST","leads",{name:"Bad",email:"invalid"})).status,422);
    const created=await auth("POST","leads",{name:"Fictional Integration Prospect",email:"integration-prospect@clorix.example",company_name:"Fictional Integration Studio"});
    assert.equal(created.status,201,JSON.stringify(created.data));lead=created.data.data;
    assert.equal((await auth("POST","leads",{name:"Duplicate",email:"integration-prospect@clorix.example"})).status,409);
    assert.equal((await request("GET","leads/"+lead.id,undefined,b.cookie,b.workspace)).status,404);
    assert.equal((await request("GET","search?q=Fictional%20Integration",undefined,b.cookie,b.workspace)).data.data.length,0);
    assert.equal((await auth("GET","search?q=Fictional%20Integration")).data.data[0].id,lead.id);
    assert.equal((await auth("POST","leads/"+lead.id+"/convert",{expected_version:lead.version,key:randomUUID(),title:"Before qualifying",amount_minor:"76"})).status,409);
  });

  await t.test("convert once under concurrent retries and preserve relationships",async()=>{
    const qualified=await auth("PATCH","leads/"+lead.id,{expected_version:lead.version,status:"qualified"});
    assert.equal(qualified.status,200,JSON.stringify(qualified.data));
    const input={expected_version:qualified.data.data.version,key:randomUUID(),title:"Fictional Integration Deal",amount_minor:"1001"};
    const [first,second]=await Promise.all([auth("POST","leads/"+lead.id+"/convert",input),auth("POST","leads/"+lead.id+"/convert",input)]);
    assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(second.status,200,JSON.stringify(second.data));
    assert.deepEqual(first.data.data,second.data.data);
    ({deal_id:deal,contact_id:contact,company_id:company}=first.data.data);
    assert.equal((await auth("POST","leads/"+lead.id+"/convert",{...input,title:"Changed retry"})).status,409);
    assert.equal((await auth("GET","companies/"+company)).data.data.related.contacts[0].id,contact);
    assert.equal((await auth("GET","contacts/"+contact)).data.data.related.deals[0].id,deal);
    assert.equal((await auth("GET","leads/"+lead.id)).data.data.record.status,"converted");
    assert.equal((await request("POST","contacts",{name:"Cross tenant link",company_id:company},b.cookie,b.workspace)).status,422);
  });

  await t.test("PostgreSQL denies changes with another workspace selected for the actor",async()=>{
    const client=await db().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('clorix.actor',$1,true),set_config('clorix.tenant',$2,true)",[b.user,a.workspace]);
      assert.equal((await client.query("SELECT id FROM leads WHERE id=$1",[lead.id])).rowCount,0);
      assert.equal((await client.query("SELECT id FROM memberships WHERE workspace_id=$1",[a.workspace])).rowCount,0);
      await assert.rejects(client.query("INSERT INTO leads(workspace_id,name) VALUES($1,'Cross-tenant')",[a.workspace]),{code:"42501"});
      await client.query("ROLLBACK");
      assert.equal((await client.query("SELECT id FROM leads")).rowCount,0);
    }finally{client.release();}
  });

  await t.test("version races, lost reasons, won metrics and reopen retain exact history",async()=>{
    const item=await auth("GET","deals/"+deal);
    assert.equal(item.status,200);
    const rev=item.data.data.record.version;
    const proposal=stage.find(s=>s.name==="Proposal")!.id;
    const negotiation=stage.find(s=>s.name==="Negotiation")!.id;
    const race=await Promise.all([auth("POST","deals/"+deal+"/move",{expected_version:rev,stage_id:proposal}),
      auth("POST","deals/"+deal+"/move",{expected_version:rev,stage_id:negotiation})]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const won=stage.find(s=>s.kind==="won")!.id;
    const lost=stage.find(s=>s.kind==="lost")!.id;
    assert.equal((await auth("POST","deals/"+deal+"/move",{expected_version:rev+1,stage_id:lost})).status,422);
    const result=await auth("POST","deals/"+deal+"/move",{expected_version:rev+1,stage_id:won});
    assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal((await auth("GET","reports")).data.data.won_minor,(BigInt(base)+1001n).toString());
    assert.equal((await auth("PATCH","deals/"+deal,{expected_version:rev+2,amount_minor:"2000"})).status,409);
    assert.equal((await auth("POST","deals/"+deal+"/move",{expected_version:rev+2,stage_id:lost,reason:"Fictional outcome"})).status,200);
    assert.equal((await auth("GET","reports")).data.data.won_minor,base);
    assert.equal((await auth("POST","deals/"+deal+"/move",{expected_version:rev+3,stage_id:proposal})).status,200);
    assert.equal((await auth("GET","deals/"+deal)).data.data.history.length,5);
    assert.equal((await auth("GET","reports?from=2024-01-01&to=2024-01-01")).data.data.won_count,0);
  });

  await t.test("tasks, linked notes, archival and restoration",async()=>{
    const created=await auth("POST","tasks",{title:"Fictional task",contact_id:contact,due_at:new Date(Date.now()-3600000).toISOString()});
    assert.equal(created.status,201,JSON.stringify(created.data));task=created.data.data.id;
    assert.ok((await auth("GET","tasks?status=overdue")).data.data.some((record:{id:string})=>record.id===task));
    assert.equal((await auth("PATCH","tasks/"+task,{expected_version:1,status:"done"})).status,200);
    assert.equal((await auth("PATCH","tasks/"+task,{expected_version:2,status:"open"})).data.data.completed_at,null);
    assert.equal((await auth("POST","activities",{kind:"note",summary:"Fictional note",contact_id:contact,task_id:task})).status,201);
    assert.ok((await auth("GET","contacts/"+contact)).data.data.related.activities.length);
    assert.equal((await auth("DELETE","tasks/"+task,{expected_version:3})).status,200);
    assert.equal((await auth("POST","activities",{kind:"note",summary:"No new archived links",task_id:task})).status,422);
    assert.equal((await auth("POST","tasks/"+task+"/restore",{expected_version:4})).status,200);
  });

  await t.test("CSV preview, mismatch, atomic duplicate skip, idempotency and safe export",async()=>{
    const invalid={entity:"contacts",duplicate:"skip",csv:"name,email\nFictional Invalid,invalid-address\n"};
    assert.equal((await auth("POST","imports/preview",invalid)).data.data.errors.length,1);
    const input={entity:"contacts",duplicate:"skip",csv:"name,email\n=Fictional formula,import-check@clorix.example\nRepeated,import-check@clorix.example\n"};
    const preview=await auth("POST","imports/preview",input);
    assert.equal(preview.status,200,JSON.stringify(preview.data));
    assert.equal(preview.data.data.count,1);
    assert.equal(preview.data.data.skipped,1);
    const payload={...input,token:preview.data.data.token,key:randomUUID()};
    assert.equal((await auth("POST","imports/commit",{...payload,csv:input.csv+"Changed,other@clorix.example\n"})).status,409);
    assert.deepEqual((await auth("POST","imports/commit",payload)).data.data,{created:1,skipped:1});
    assert.deepEqual((await auth("POST","imports/commit",payload)).data.data,{created:1,skipped:1});
    assert.match((await auth("GET","exports/contacts?q=Fictional%20formula")).data,/'=Fictional formula/);
    assert.doesNotMatch((await request("GET","exports/contacts",undefined,b.cookie,b.workspace)).data,/import-check/);
  });

  await t.test("mapped companies and deals validate destinations and sign exact column mappings",async()=>{
    const csv="Organization,Homepage,Private Notes\nMapped Fictional Studio,https://mapped.clorix.example,Imported note\n";
    const source={entity:"companies",duplicate:"skip",csv};
    assert.deepEqual((await auth("POST","imports/columns",{entity:"companies",csv})).data.data.head,["Organization","Homepage","Private Notes"]);
    assert.equal((await auth("POST","imports/preview",{...source,mapping:{Organization:"name",Homepage:"name"}})).status,422);
    assert.equal((await auth("POST","imports/preview",{...source,mapping:{Organization:"name",Homepage:"workspace_id"}})).status,422);
    const input={...source,mapping:{Organization:"name",Homepage:"website",["Private Notes"]:"notes"}};
    const preview=await auth("POST","imports/preview",input);
    assert.equal(preview.data.data.count,1);
    const payload={...input,token:preview.data.data.token,key:randomUUID()};
    assert.equal((await auth("POST","imports/commit",{...payload,mapping:{Organization:"name",Homepage:"notes"}})).status,409);
    const first=await auth("POST","imports/commit",payload);
    assert.deepEqual(first.data.data,{created:1,skipped:0});
    assert.match((await auth("GET","exports/companies?q=Mapped%20Fictional")).data,/Imported note/);

    const deal={entity:"deals",duplicate:"skip",csv:"Opportunity,Cents\nMapped Fictional Deal,11285\n",mapping:{Opportunity:"title",Cents:"amount_minor"}};
    const dealPreview=await auth("POST","imports/preview",deal);
    assert.equal(dealPreview.data.data.count,1);
    const created=await auth("POST","imports/commit",{...deal,key:randomUUID(),token:dealPreview.data.data.token});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const deals=await auth("GET","deals?q=Mapped%20Fictional%20Deal");
    assert.equal(deals.data.data[0].amount_minor,"11285");
    const record=await auth("GET","deals/"+deals.data.data[0].id);
    assert.equal(record.data.data.history.length,1);
  });

  await t.test("draft deletion preserves referenced leads and respects versions",async()=>{
    const result=await auth("POST","leads",{name:"Disposable unlinked draft"});
    assert.equal(result.status,201);
    const id=result.data.data.id;
    assert.equal((await auth("DELETE","leads/"+id+"/purge",{expected_version:1})).status,409);
    assert.equal((await auth("DELETE","leads/"+id,{expected_version:1})).status,200);
    assert.equal((await auth("DELETE","leads/"+id+"/purge",{expected_version:1})).status,409);
    assert.equal((await auth("DELETE","leads/"+id+"/purge",{expected_version:2})).status,200);
    assert.equal((await auth("GET","leads/"+id)).status,404);
    assert.equal((await auth("DELETE","leads/"+lead.id+"/purge",{expected_version:3})).status,409);
  });

  await t.test("durable quota admits only the configured count under concurrent requests",async()=>{
    const scope=createHash("sha256").update(randomUUID()).digest("hex");
    try {
      const results=await Promise.all(Array.from({length:10},()=>db().query("SELECT clorix_access.consume_quota($1,3,60) AS allowed",[scope])));
      assert.equal(results.filter(result=>result.rows[0].allowed===true).length,3);
    } finally { await dbAdmin.query("DELETE FROM clorix_access.quota WHERE scope=$1",[scope]); }
  });

  await t.test("global active sandbox cap rejects additional admission",async()=>{
    const previous=(await dbAdmin.query("SELECT max_active FROM clorix_access.sandbox_policy")).rows[0].max_active;
    await dbAdmin.query("UPDATE clorix_access.sandbox_policy SET max_active=1");
    try {
      const result=await request("POST","access/sandbox",{synthetic:true},await prepareSandbox());
      assert.equal(result.status,429,JSON.stringify(result.data));
      assert.equal(result.data.error.code,"sandbox_capacity");
      assert.ok(Number(result.response.headers.get("Retry-After"))>0);
    }finally{await dbAdmin.query("UPDATE clorix_access.sandbox_policy SET max_active=$1",[previous]);}
  });

  await t.test("sandbox denies invitations, enforces expiry and cleans only expired guests",async()=>{
    assert.equal((await auth("POST","invites",{role:"member"})).status,403);
    await dbAdmin.query("UPDATE workspaces SET expires_at=now()-interval '1 minute' WHERE id=$1",[b.workspace]);
    assert.equal((await request("GET","leads",undefined,b.cookie,b.workspace)).status,404);
    assert.equal((await dbAdmin.query("SELECT clorix_access.cleanup_guests(1,true) AS count")).rows[0].count,1);
    assert.equal((await dbAdmin.query("SELECT clorix_access.cleanup_guests(1,false) AS count")).rows[0].count,1);
    assert.equal((await request("GET","workspaces",undefined,b.cookie)).status,401);
    assert.equal((await auth("GET","workspaces")).status,200);
  });

  await t.test("private registration, team invites, owner protection and session revocation",async()=>{
    const owner=await start("register","owner-"+randomUUID()+"@clorix.example");
    const member=await start("register","member-"+randomUUID()+"@clorix.example");
    const own=(method:keyof typeof routes,path:string,body?:unknown)=>request(method,path,body,owner.cookie,owner.workspace);
    const ownerSetting=await own("GET","settings");
    assert.equal(ownerSetting.status,200,JSON.stringify(ownerSetting.data));
    const ownerId=ownerSetting.data.data.members[0].id;
    assert.equal((await own("PATCH","members/"+ownerId,{role:"member",status:"active"})).status,409);
    const invite=await own("POST","invites",{email:member.email,role:"member"});
    assert.equal(invite.status,201,JSON.stringify(invite.data));
    const token=new URL(invite.data.data.link).hash.slice(1);
    assert.equal((await request("POST","invites/accept",{token},a.cookie)).status,422);
    assert.equal((await request("POST","invites/accept",{token},member.cookie)).status,200);
    assert.equal((await request("POST","invites/accept",{token},member.cookie)).status,422);
    assert.equal((await request("GET","exports/leads",undefined,member.cookie,owner.workspace)).status,403);
    assert.equal((await request("POST","invites",{role:"member"},member.cookie,owner.workspace)).status,403);
    const members=(await own("GET","settings")).data.data.members;
    const invited=members.find((row:{role:string})=>row.role==="member");
    assert.equal((await own("PATCH","members/"+invited.id,{role:"member",status:"removed"})).status,200);
    assert.equal((await request("GET","workspaces",undefined,member.cookie)).status,401);
    assert.equal((await own("POST","access/logout",{})).status,200);
    assert.equal((await own("GET","workspaces")).status,401);
    assert.equal((await request("POST","access/login",{email:owner.email,password:"Fictional testing password 49"})).status,200);
  });
});
