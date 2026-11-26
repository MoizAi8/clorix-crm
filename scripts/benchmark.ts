import { performance } from "node:perf_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { GET, POST } from "../src/app/api/v1/[...parts]/route";
import { db } from "../src/server/db";
import { hashPassword } from "better-auth/crypto";

const origin=process.env.APP_URL??"http://localhost:3000";
const direct=process.env.DIRECT_DATABASE_URL;
if (!direct || new URL(direct).pathname!=="/clorix_test" || process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL) {
  throw Error("Benchmark requires the isolated Clorix test database.");
}
const admin=new Pool({connectionString:direct,max:1});
const email="benchmark-"+randomUUID()+"@clorix.example";
const password=randomBytes(24).toString("base64url");
const token=createHash("sha256").update(randomBytes(32)).digest("hex");

async function main() {
  try {
    await admin.query("INSERT INTO clorix_access.registration(token_hash,intended_email,workspace_name,expires_at) VALUES($1,$2,'Performance fixture',now()+interval '15 minutes')",[token,email]);
    await admin.query("SELECT clorix_access.register_private($1,$2,'Performance evaluator',$3)",[token,email,await hashPassword(password)]);
    const {rows:[space]}=await admin.query('SELECT w.id FROM workspaces w JOIN "user" u ON u.id=w.created_by WHERE u.email=$1',[email]);
    const args=[space.id];
    await admin.query("INSERT INTO companies(workspace_id,name,domain) SELECT $1,'Benchmark company '||i,'benchmark-'||i||'.example' FROM generate_series(1,200) g(i)",args);
    await admin.query(`INSERT INTO contacts(workspace_id,name,email,company_id)
      SELECT $1,'Benchmark contact '||i,'contact-'||i||'@clorix.example',company
      FROM generate_series(1,500) g(i) CROSS JOIN
      (SELECT array_agg(id ORDER BY name) AS ids FROM companies WHERE workspace_id=$1) c,
      LATERAL (SELECT c.ids[(i-1)%200+1] AS company) link`,args);
    await admin.query("INSERT INTO leads(workspace_id,name,email,status) SELECT $1,'Benchmark lead '||i,'lead-'||i||'@clorix.example',(ARRAY['new','contacted','qualified'])[1+(i-1)%3] FROM generate_series(1,1000) g(i)",args);
    await admin.query(`INSERT INTO deals(workspace_id,title,stage_id,amount_minor,rank,contact_id,company_id,actual_closed_at)
      SELECT $1,'Benchmark deal '||n.i,s.id,n.i*10005,n.i*100,c.person.id,c.person.company_id,CASE WHEN s.kind<>'open' THEN now()-(n.i%120)*interval '1 day' END
      FROM generate_series(1,500) n(i) JOIN pipeline_stages s ON s.workspace_id=$1 AND s.sort_order=(n.i-1)%6+1
      JOIN (SELECT p AS person,row_number() OVER (ORDER BY p.id) AS i FROM contacts p WHERE workspace_id=$1) c ON c.i=n.i`.replaceAll("c.person.id","(c.person).id").replaceAll("c.person.company_id","(c.person).company_id"),args);
    await admin.query(`INSERT INTO tasks(workspace_id,title,due_at,deal_id)
      SELECT $1,'Benchmark follow-up '||n.i,now()+(n.i%20-10)*interval '1 day',d.id FROM generate_series(1,500) n(i)
      JOIN (SELECT id,row_number() OVER(ORDER BY id) AS i FROM deals WHERE workspace_id=$1) d ON d.i=n.i`,args);
    await admin.query(`INSERT INTO activities(workspace_id,kind,summary,actor_member_id,deal_id)
      SELECT $1,'note','Benchmark interaction '||d.i,m.id,d.id FROM memberships m
      CROSS JOIN (SELECT id,row_number() OVER(ORDER BY id) AS i FROM deals WHERE workspace_id=$1) d WHERE m.workspace_id=$1`,args);
    const signed=await POST(new Request(origin+"/api/v1/access/login",{method:"POST",headers:{"content-type":"application/json",origin},
      body:JSON.stringify({email,password})}),{params:Promise.resolve({parts:["access","login"]})});
    if(signed.status!==200)throw Error("Benchmark authentication setup failed.");
    const cookie=signed.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    const measure=async (route:"search"|"dashboard",q="")=>{
      const start=performance.now();
      const response=await GET(new Request(origin+"/api/v1/"+route+q,{headers:{cookie,"x-clorix-workspace":space.id}}),
        {params:Promise.resolve({parts:[route]})});
      await response.arrayBuffer();
      if(!response.ok)throw Error("Benchmark request failed: "+response.status);
      return performance.now()-start;
    };
    const first={search:await measure("search","?q=Benchmark%20lead"),dashboard:await measure("dashboard")};
    const search:number[]=[],dashboard:number[]=[];
    for(let i=0;i<50;i++){
      search.push(await measure("search","?q="+encodeURIComponent("Benchmark lead "+(i+10))));
      dashboard.push(await measure("dashboard"));
    }
    function summary(values:number[]) {
      const sorted=[...values].sort((a,b)=>a-b);
      const percentile=(p:number)=>Number(sorted[Math.ceil(p*sorted.length)-1].toFixed(1));
      return {n:values.length,p50:percentile(.50),p95:percentile(.95)};
    }
    const {rows:[dbVersion]}=await admin.query("SHOW server_version");
    const result={environment:{platform:process.platform,node:process.version,postgres:dbVersion.server_version,
      mode:"Local authenticated route handlers, including pooled PostgreSQL; HTTP and hosted cold starts excluded",
      concurrency:1},dataset:{leads:1000,contacts:500,companies:200,deals:500,tasks:500,activities:500},
      milliseconds:{firstSearch:Number(first.search.toFixed(1)),firstDashboard:Number(first.dashboard.toFixed(1)),
        warmSearch:summary(search),warmDashboard:summary(dashboard)}};
    await mkdir("artifacts/visual-qa",{recursive:true});
    await writeFile("artifacts/visual-qa/benchmark.json",JSON.stringify(result,null,2)+"\n");
    console.log(JSON.stringify(result));
  } finally {
    await admin.query('DELETE FROM "user" WHERE email=$1',[email]);
    await admin.query("DELETE FROM clorix_access.registration WHERE token_hash=$1",[token]);
    await admin.end();
    await db().end();
  }
}

void main().catch(error=>{console.error("Benchmark failed:",error.code??error.message);process.exitCode=1;});
