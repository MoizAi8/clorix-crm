import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cwd="artifacts/private/staging-web";
const project=JSON.parse(readFileSync(cwd+"/.vercel/project.json","utf8"));
const database=new URL(process.env.DATABASE_URL??"");
if(project.projectName!=="clorix-v2-preview"||database.pathname!=="/clorix_v2_staging"||
  database.username!=="clorix_stage_gateway"||!database.hostname.includes("-pooler.")||
  process.env.CLORIX_ENGINE_URL!=="https://clorix-engine.vercel.app/") {
  throw Error("Use the dedicated Clorix staging frontend and gateway role.");
}

const config={
  DATABASE_URL:process.env.DATABASE_URL,
  AUTH_SECRET:process.env.AUTH_SECRET,
  DEMO_RATE_LIMIT_SECRET:process.env.DEMO_RATE_LIMIT_SECRET,
  CLORIX_ENGINE_SIGNING_KEY:process.env.CLORIX_ENGINE_SIGNING_KEY,
  CLORIX_ENGINE_URL:process.env.CLORIX_ENGINE_URL,
  APP_URL:"https://clorix-v2-preview.vercel.app",
  SANDBOX_IP_DAILY_LIMIT:"20",
};
const sensitive=new Set(["DATABASE_URL","AUTH_SECRET","DEMO_RATE_LIMIT_SECRET","CLORIX_ENGINE_SIGNING_KEY"]);
for(const [name,value] of Object.entries(config)) {
  if(!value||sensitive.has(name)&&value.length<32)throw Error("Missing staging configuration for "+name);
  const args=["env","add",name,"production",...(sensitive.has(name)?["--sensitive"]:[]),"--yes","--force","--non-interactive"];
  const options={cwd,input:value,encoding:"utf8"};
  const command=process.platform==="win32"
    ?spawnSync("cmd.exe",["/d","/c","vercel.cmd",...args],options)
    :spawnSync("vercel",args,options);
  if(command.status!==0) {
    console.error("Could not configure "+name+" for isolated web staging.");
    process.exitCode=1;
    break;
  }
  console.log("Configured "+name+" for isolated web staging.");
}
