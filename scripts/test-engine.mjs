import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { resolve } from "node:path";

const python=resolve(process.platform==="win32"?"backend/.venv/Scripts/python.exe":"backend/.venv/bin/python");
function command(executable,args,options={}) {
  const child=spawn(executable,args,{stdio:"inherit",...options});
  return once(child,"exit").then(([status])=>{if(status!==0)throw Error(executable+" failed");});
}

const engine=spawn(python,["-m","uvicorn","main:app","--host","127.0.0.1","--port","8812","--no-access-log","--app-dir","backend"],{stdio:"inherit"});
try {
  let healthy=false;
  for(let i=0;i<30&&!healthy;i++) {
    const response=await fetch("http://127.0.0.1:8812/health",{signal:AbortSignal.timeout(1000)}).catch(()=>null);
    healthy=response?.ok===true;
    if(!healthy)await delay(200);
  }
  if(!healthy)throw Error("Local Python health check failed.");
  await command(python,["-m","pytest","-q"],{cwd:"backend",shell:false,env:process.env});
  await command(process.execPath,["--import","tsx","--test","tests/integration/engine.test.ts"],{
    env:{...process.env,CLORIX_ENGINE_TEST:"1"},
  });
} catch (error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  engine.kill();
}
