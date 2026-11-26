import { createHash,createHmac,randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, jsonBody, requireOrigin } from "@/server/http";
import { quota } from "@/server/quotas";
import { withWorkspace } from "@/server/workspace/context";

type EngineIdentity={actor:string;workspace:string;country?:string};
type Operation={method:"GET"|"POST"|"PATCH"|"DELETE";path:string;scope:string;binary?:"pdf"|"attachment";bodyLimit?:number};

const routes:Record<string,Operation>={
  "GET workspace":{method:"GET",path:"/v2/workspace",scope:"workspace:read"},
  "GET intelligence":{method:"GET",path:"/v2/intelligence",scope:"intelligence:read"},
  "GET pipelines":{method:"GET",path:"/v2/pipelines",scope:"pipeline:read"},
  "POST pipelines":{method:"POST",path:"/v2/pipelines",scope:"pipeline:write"},
  "POST stages":{method:"POST",path:"/v2/stages",scope:"stage-config:write"},
  "POST lead-profile":{method:"POST",path:"/v2/lead-profile",scope:"lead-profile:write"},
  "POST customer-profile":{method:"POST",path:"/v2/customer-profile",scope:"customer-profile:write"},
  "POST scoring":{method:"POST",path:"/v2/scoring",scope:"scoring:write"},
  "POST sales-target":{method:"POST",path:"/v2/sales-target",scope:"target:write"},
  "GET workflows":{method:"GET",path:"/v2/workflows",scope:"workflow:read"},
  "POST workflows":{method:"POST",path:"/v2/workflows",scope:"workflow:write"},
  "POST workflow-evaluate":{method:"POST",path:"/v2/workflow-evaluate",scope:"workflow:evaluate"},
  "POST workflow-retry":{method:"POST",path:"/v2/workflow-retry",scope:"workflow:retry"},
  "POST workflow-test":{method:"POST",path:"/v2/workflow-test",scope:"workflow:test"},
  "GET billing":{method:"GET",path:"/v2/billing",scope:"billing:read"},
  "POST billing-detail":{method:"POST",path:"/v2/billing-detail",scope:"billing:detail"},
  "POST catalog":{method:"POST",path:"/v2/catalog",scope:"catalog:write"},
  "POST billing-document":{method:"POST",path:"/v2/billing-document",scope:"billing:write"},
  "POST billing-status":{method:"POST",path:"/v2/billing-status",scope:"billing:status"},
  "POST billing-generate":{method:"POST",path:"/v2/billing-generate",scope:"billing:generate"},
  "POST billing-payment":{method:"POST",path:"/v2/billing-payment",scope:"billing:payment"},
  "POST billing-pdf":{method:"POST",path:"/v2/billing-pdf",scope:"billing:pdf",binary:"pdf"},
  "GET support":{method:"GET",path:"/v2/support",scope:"support:read"},
  "POST support":{method:"POST",path:"/v2/support",scope:"support:write"},
  "POST support-detail":{method:"POST",path:"/v2/support-detail",scope:"support:detail"},
  "POST support-note":{method:"POST",path:"/v2/support-note",scope:"support:note"},
  "POST calendar":{method:"POST",path:"/v2/calendar",scope:"calendar:read"},
  "POST calendar-event":{method:"POST",path:"/v2/calendar-event",scope:"calendar:write"},
  "GET team-performance":{method:"GET",path:"/v2/team-performance",scope:"team-performance:read"},
  "POST team-member-target":{method:"POST",path:"/v2/team-member-target",scope:"team-target:write"},
  "GET campaigns":{method:"GET",path:"/v2/campaigns",scope:"productivity:read"},
  "POST campaigns":{method:"POST",path:"/v2/campaigns",scope:"campaign:write"},
  "POST campaign-attribution":{method:"POST",path:"/v2/campaign-attribution",scope:"attribution:write"},
  "GET email-templates":{method:"GET",path:"/v2/email-templates",scope:"productivity:read"},
  "POST email-templates":{method:"POST",path:"/v2/email-templates",scope:"email-template:write"},
  "POST email-draft":{method:"POST",path:"/v2/email-draft",scope:"email-draft:render"},
  "GET custom-fields":{method:"GET",path:"/v2/custom-fields",scope:"productivity:read"},
  "POST custom-fields":{method:"POST",path:"/v2/custom-fields",scope:"field-definition:write"},
  "POST record-fields":{method:"POST",path:"/v2/record-fields",scope:"productivity:read"},
  "POST record-field":{method:"POST",path:"/v2/record-field",scope:"field-value:write"},
  "GET saved-presets":{method:"GET",path:"/v2/saved-presets",scope:"productivity:read"},
  "POST saved-presets":{method:"POST",path:"/v2/saved-presets",scope:"preset:write"},
  "POST report-records":{method:"POST",path:"/v2/report-records",scope:"productivity:read"},
  "POST report-builder":{method:"POST",path:"/v2/report-builder",scope:"productivity:read"},
  "POST commercial-search":{method:"POST",path:"/v2/commercial-search",scope:"productivity:read"},
  "POST audit-history":{method:"POST",path:"/v2/audit-history",scope:"audit:read"},
  "POST attachments-list":{method:"POST",path:"/v2/attachments-list",scope:"attachment:read"},
  "POST attachment-upload":{method:"POST",path:"/v2/attachment-upload",scope:"attachment:upload",bodyLimit:351_000},
  "POST attachment-delete":{method:"POST",path:"/v2/attachment-delete",scope:"attachment:delete"},
  "POST attachment-download":{method:"POST",path:"/v2/attachment-download",scope:"attachment:read",binary:"attachment"},
  "GET copilot":{method:"GET",path:"/v2/copilot",scope:"copilot:read"},
  "POST copilot-ask":{method:"POST",path:"/v2/copilot-ask",scope:"copilot:ask"},
  "POST copilot-delete":{method:"POST",path:"/v2/copilot-delete",scope:"copilot:delete"},
  "GET notifications":{method:"GET",path:"/v2/notifications",scope:"notification:read"},
  "POST notification-read":{method:"POST",path:"/v2/notification-read",scope:"notification:write"},
  "POST notification-preferences":{method:"POST",path:"/v2/notification-preferences",scope:"notification:preferences"},
};
const recognizedErrors=z.object({error:z.object({code:z.string().regex(/^[a-z_]{1,45}$/),message:z.string().max(250)})});

export function enabled() {
  return !!process.env.CLORIX_ENGINE_URL && (process.env.CLORIX_ENGINE_SIGNING_KEY?.length??0)>=32;
}

export function copilotEnabled(actor:string,country: string|null) {
  return process.env.VERCEL==="1" && process.env.CLORIX_GEMINI_FRONTEND==="true" &&
    process.env.CLORIX_GEMINI_REVIEWER_IDS?.split(",").includes(actor)===true &&
    !!country && /^(PK|US|CA|AU|NZ|JP|SG|IN|BR)$/.test(country);
}

export function serviceGrant(identity:EngineIdentity,op:Operation,body:string,requestId:string,key:string) {
  const now=Math.floor(Date.now()/1000);
  const encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const input=encode({alg:"HS256",typ:"JWT"})+"."+encode({
    iss:"clorix-gateway",aud:"clorix-engine",sub:identity.actor,workspace:identity.workspace,
    scope:op.scope,jti:randomUUID(),request_id:requestId,method:op.method,target:op.path,
    digest:createHash("sha256").update(body).digest("hex"),iat:now,exp:now+35,country:identity.country,
  });
  return input+"."+createHmac("sha256",key).update(input).digest("base64url");
}

export async function forward(request:Request,segments:string[]) {
  if (!enabled()) throw new AppError(404,"engine_off","Advanced services are not configured.");
  const operation=routes[request.method+" "+segments[0]];
  if (segments.length!==1 || !operation || operation.method!==request.method) {
    throw new AppError(404,"engine_route","Advanced action unavailable.");
  }
  const writes=operation.method!=="GET";
  if (writes) requireOrigin(request);
  const body=writes ? JSON.stringify(await jsonBody(request,operation.bodyLimit??32_768)) : "";
  const principal=await withWorkspace(request,async ({user,workspace})=>({actor:user.id,workspace:workspace.id}));
  const country=request.headers.get("x-vercel-ip-country");
  if(operation.scope.startsWith("copilot:")&&!copilotEnabled(principal.actor,country)) {
    throw new AppError(403,"copilot_eligibility","The fictional lab is only available to approved eligible reviewers.");
  }
  await quota(request,"engine-user",120,60,principal.actor);
  if (writes) await quota(request,"engine-write",40,60,principal.actor);
  if (operation.binary==="pdf") await quota(request,"engine-pdf",20,3600,principal.actor);
  if (operation.scope==="attachment:upload") await quota(request,"engine-attachment-upload",10,3600,principal.actor);
  if (operation.binary==="attachment") await quota(request,"engine-attachment-download",45,3600,principal.actor);
  if (operation.scope==="workflow:evaluate") await quota(request,"engine-evaluate",6,60,principal.workspace);
  const base=new URL(process.env.CLORIX_ENGINE_URL!);
  if ((base.protocol!=="https:" && !(base.protocol==="http:"&&["localhost","127.0.0.1"].includes(base.hostname))) ||
      base.username || base.password || base.search || base.hash || base.pathname!=="/") {
    throw new AppError(503,"engine_origin","Advanced services are unavailable.");
  }
  const url=new URL(operation.path,base);
  const requestId=randomUUID();
  const grant=serviceGrant({...principal,country:operation.scope.startsWith("copilot:")?country??undefined:undefined},operation,body,requestId,process.env.CLORIX_ENGINE_SIGNING_KEY!);
  let response:Response;
  try {
    response=await fetch(url,{
      method:operation.method,headers:{Authorization:"Bearer "+grant,"X-Request-Id":requestId,
        ...(writes?{"Content-Type":"application/json"}:{})},body:writes?body:undefined,
      signal:AbortSignal.timeout(operation.scope==="copilot:ask"?16000:8500),redirect:"error",cache:"no-store",
    });
  } catch {
    throw new AppError(503,"engine_timeout","Advanced services could not respond. Try again shortly.");
  }
  if (!response.ok) {
    const detail=recognizedErrors.safeParse(await response.json().catch(()=>null));
    if ([400,403,404,409,413,422,429].includes(response.status)&&detail.success) {
      throw new AppError(response.status,detail.data.error.code,detail.data.error.message);
    }
    if(operation.scope.startsWith("copilot:")&&detail.success&&/^copilot_(provider|disabled)$/.test(detail.data.error.code)) {
      throw new AppError(503,detail.data.error.code,detail.data.error.message);
    }
    throw new AppError(503,"engine_response","Advanced services are temporarily unavailable.");
  }
  const type=response.headers.get("Content-Type");
  if (!type?.startsWith(operation.binary==="pdf"?"application/pdf":operation.binary==="attachment"?"application/octet-stream":"application/json")) {
    throw new AppError(503,"engine_response","Advanced services returned an unexpected response.");
  }
  const disposition=response.headers.get("Content-Disposition");
  const attachment=disposition&&/^attachment; filename="clorix-(q|inv)-[0-9]{5,10}\\.pdf"$/.test(disposition)?disposition:'attachment; filename="clorix-document.pdf"';
  return new Response(response.body,{status:response.status,headers:{
    "Content-Type":type,"Cache-Control":"private, no-store","X-Request-Id":requestId,
    ...(operation.binary?{"Content-Disposition":operation.binary==="pdf"?attachment:'attachment; filename="clorix-attachment"'}:{}),
  }});
}
