import { createHash,createHmac,randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, jsonBody, requireOrigin } from "@/server/http";
import { withWorkspace } from "@/server/workspace/context";

type EngineIdentity={actor:string;workspace:string};
type Operation={method:"GET"|"POST"|"PATCH"|"DELETE";path:string;scope:string;binary?:boolean};

const routes:Record<string,Operation>={
  workspace:{method:"GET",path:"/v2/workspace",scope:"workspace:read"},
};
const recognizedErrors=z.object({error:z.object({code:z.string().regex(/^[a-z_]{1,45}$/),message:z.string().max(250)})});

export function enabled() {
  return !!process.env.CLORIX_ENGINE_URL && (process.env.CLORIX_ENGINE_SIGNING_KEY?.length??0)>=32;
}

export function serviceGrant(identity:EngineIdentity,op:Operation,body:string,requestId:string,key:string) {
  const now=Math.floor(Date.now()/1000);
  const encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const input=encode({alg:"HS256",typ:"JWT"})+"."+encode({
    iss:"clorix-gateway",aud:"clorix-engine",sub:identity.actor,workspace:identity.workspace,
    scope:op.scope,jti:randomUUID(),request_id:requestId,method:op.method,target:op.path,
    digest:createHash("sha256").update(body).digest("hex"),iat:now,exp:now+35,
  });
  return input+"."+createHmac("sha256",key).update(input).digest("base64url");
}

export async function forward(request:Request,segments:string[]) {
  if (!enabled()) throw new AppError(404,"engine_off","Advanced services are not configured.");
  const operation=routes[segments[0]];
  if (segments.length!==1 || !operation || operation.method!==request.method) {
    throw new AppError(404,"engine_route","Advanced action unavailable.");
  }
  const writes=operation.method!=="GET";
  if (writes) requireOrigin(request);
  const body=writes ? JSON.stringify(await jsonBody(request,32_768)) : "";
  const principal=await withWorkspace(request,async ({user,workspace})=>({actor:user.id,workspace:workspace.id}));
  const base=new URL(process.env.CLORIX_ENGINE_URL!);
  if ((base.protocol!=="https:" && !(base.protocol==="http:"&&["localhost","127.0.0.1"].includes(base.hostname))) ||
      base.username || base.password || base.search || base.hash || base.pathname!=="/") {
    throw new AppError(503,"engine_origin","Advanced services are unavailable.");
  }
  const url=new URL(operation.path,base);
  const requestId=randomUUID();
  const grant=serviceGrant(principal,operation,body,requestId,process.env.CLORIX_ENGINE_SIGNING_KEY!);
  let response:Response;
  try {
    response=await fetch(url,{
      method:operation.method,headers:{Authorization:"Bearer "+grant,"X-Request-Id":requestId,
        ...(writes?{"Content-Type":"application/json"}:{})},body:writes?body:undefined,
      signal:AbortSignal.timeout(8500),redirect:"error",cache:"no-store",
    });
  } catch {
    throw new AppError(503,"engine_timeout","Advanced services could not respond. Try again shortly.");
  }
  if (!response.ok) {
    const detail=recognizedErrors.safeParse(await response.json().catch(()=>null));
    if ([400,403,404,409,413,422,429].includes(response.status)&&detail.success) {
      throw new AppError(response.status,detail.data.error.code,detail.data.error.message);
    }
    throw new AppError(503,"engine_response","Advanced services are temporarily unavailable.");
  }
  const type=response.headers.get("Content-Type");
  if (!type?.startsWith(operation.binary?"application/pdf":"application/json")) {
    throw new AppError(503,"engine_response","Advanced services returned an unexpected response.");
  }
  return new Response(response.body,{status:response.status,headers:{
    "Content-Type":type,"Cache-Control":"private, no-store","X-Request-Id":requestId,
    ...(operation.binary?{"Content-Disposition":'attachment; filename="clorix-document.pdf"'}:{}),
  }});
}
