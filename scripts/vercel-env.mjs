import { spawnSync } from "node:child_process";

const names=["DATABASE_URL","AUTH_SECRET","DEMO_RATE_LIMIT_SECRET","APP_URL"];
if(!process.env.DATABASE_URL?.includes("clorix_runtime") || !process.env.DATABASE_URL.includes("-pooler.") ||
   !process.env.APP_URL?.startsWith("https://") || names.some(name=>!process.env[name])) {
  throw Error("Expected a restricted pooled Neon connection and the HTTPS production origin.");
}
for(const name of names) {
  const args=["env","add",name,"production","--sensitive","--yes","--force","--non-interactive"];
  const run=process.platform==="win32"
    ?spawnSync("cmd.exe",["/d","/c","vercel.cmd",...args],{input:process.env[name],encoding:"utf8"})
    :spawnSync("vercel",args,{input:process.env[name],encoding:"utf8"});
  if(run.status!==0){
    console.error("Vercel did not accept "+name+". Check access and the project environment.");
    process.exitCode=1;
    break;
  }
  console.log("Configured production "+name);
}
