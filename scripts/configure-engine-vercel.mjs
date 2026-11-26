import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

const project=JSON.parse(readFileSync("backend/.vercel/project.json","utf8"));
if(project.projectName!=="clorix-engine")throw Error("The dedicated engine project must be linked explicitly.");
const names=["CLORIX_ENGINE_DATABASE_URL","CLORIX_ENGINE_SIGNING_KEY"];
const dsn=new URL(process.env.CLORIX_ENGINE_DATABASE_URL??"");
if(dsn.pathname!=="/clorix_v2_staging" || dsn.username!=="clorix_stage_engine" ||
   !dsn.hostname.includes("-pooler.") || process.env.CLORIX_ENGINE_SIGNING_KEY?.length<32) {
  throw Error("The dedicated pooled staging role is required.");
}
for(const name of names) {
  if(!process.env[name])throw Error("Missing "+name);
  const args=["env","add",name,"production","--sensitive","--yes","--force","--non-interactive"];
  const options={cwd:"backend",input:process.env[name],encoding:"utf8"};
  const result=process.platform==="win32"
    ?spawnSync("cmd.exe",["/d","/c","vercel.cmd",...args],options)
    :spawnSync("vercel",args,options);
  if(result.status!==0){
    console.error("Could not configure "+name+" for the dedicated engine project.");
    process.exitCode=1;
    break;
  }
  console.log("Configured "+name+" for the isolated engine project.");
}
