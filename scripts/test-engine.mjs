import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { resolve } from "node:path";

const sensitive = ["DATABASE_URL", "DIRECT_DATABASE_URL", "CLORIX_ENGINE_DATABASE_URL", "CLORIX_ENGINE_SIGNING_KEY"]
  .flatMap((name) => {
    const value = process.env[name];
    if (!value) return [];
    try {
      const parsed = new URL(value);
      return [value, parsed.password, decodeURIComponent(parsed.password)].filter(Boolean);
    } catch {
      return [value];
    }
  }).sort((a, b) => b.length - a.length);

function clean(data) {
  return sensitive.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), data.toString());
}

const python=resolve(process.platform==="win32"?"backend/.venv/Scripts/python.exe":"backend/.venv/bin/python");
function command(executable,args,options={}) {
  const child=spawn(executable,args,{stdio:["ignore","pipe","pipe"],...options});
  const stdout = [], stderr = [];
  child.stdout.on("data", chunk => stdout.push(chunk));
  child.stderr.on("data", chunk => stderr.push(chunk));
  return once(child,"close").then(([status])=>{
    process.stdout.write(clean(Buffer.concat(stdout)));
    process.stderr.write(clean(Buffer.concat(stderr)));
    if(status!==0)throw Error(executable+" failed");
  });
}

const browser=process.argv.includes("--browser");
let frontend;
const engine=spawn(python,["-m","uvicorn","main:app","--host","127.0.0.1","--port","8812","--no-access-log","--app-dir","backend"],{stdio:"inherit"});
try {
  let healthy=false;
  for(let i=0;i<30&&!healthy;i++) {
    const response=await fetch("http://127.0.0.1:8812/health",{signal:AbortSignal.timeout(1000)}).catch(()=>null);
    healthy=response?.ok===true;
    if(!healthy)await delay(200);
  }
  if(!healthy)throw Error("Local Python health check failed.");
  if (browser) {
    frontend=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1"],{stdio:"inherit",env:{...process.env,SANDBOX_IP_DAILY_LIMIT:"20"}});
    let frontendReady=false;
    for(let i=0;i<30&&!frontendReady;i++) {
      const response=await fetch("http://localhost:3000/api/v1/health",{signal:AbortSignal.timeout(1000)}).catch(()=>null);
      frontendReady=response?.ok===true;
      if(!frontendReady)await delay(300);
    }
    if(!frontendReady)throw Error("Local frontend health check failed.");
    await command(process.execPath,["scripts/browser-test.mjs"],{
      env:{...process.env,CLORIX_ENGINE_BROWSER_TEST:"1",CLORIX_ENGINE_BROWSER_ONLY:process.argv.includes("--advanced-only")?"1":""},
    });
  } else {
    await command(python,["-m","pytest","-q"],{cwd:"backend",shell:false,env:process.env});
  await command(process.execPath,["--import","tsx","--test","tests/integration/engine.test.ts"],{
    env:{...process.env,CLORIX_ENGINE_TEST:"1"},
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  frontend?.kill();
  engine.kill();
}
