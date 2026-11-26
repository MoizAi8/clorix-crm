import { access } from "@/server/auth/access";
import { prepareSandbox } from "@/server/auth/sandbox";
import { archive,choices,detail,list,newRecord,patchRecord,purgeDraft } from "@/server/crm/records";
import { convert,move } from "@/server/crm/lifecycle";
import { entityType,identifier } from "@/server/crm/validation";
import { db } from "@/server/db";
import { AppError,failed,jsonBody,payload,requireOrigin } from "@/server/http";
import { bodyLimit,columns,commit,exportCsv,preview } from "@/server/imports";
import { board,report,stageTotals } from "@/server/reporting";
import { search } from "@/server/search";
import { actorContext,withWorkspace,workspaces } from "@/server/workspace/context";
import { accept,invite,revoke,settings,updateMember,updateProfile,updateSettings } from "@/server/workspace/settings";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;

type RouteContext={params:Promise<{parts:string[]}>};

async function handle(request:Request,route:RouteContext) {
  try {
    const {parts}=await route.params;
    const [head,id,action]=parts;
    if (parts.length>3) throw new AppError(404,"route","Action unavailable.");
    const method=request.method;
    const query=new URL(request.url).searchParams;
    const write=method!=="GET";
    if (write) requireOrigin(request);
    if (head==="health" && parts.length===1 && method==="GET") {
      await db().query("SELECT 1");
      return payload({status:"ok"});
    }
    if (head==="access" && parts.length===2) {
      if (method==="GET" && id==="sandbox") return prepareSandbox(request);
      if (method==="POST") return await access(request,id);
    }
    if (head==="workspaces" && parts.length===1 && method==="GET") {
      return payload(await actorContext(request.headers,async (client,user)=>({workspaces:await workspaces(client),name:user.name})));
    }
    if (head==="invites" && id==="accept" && parts.length===2 && method==="POST") {
      return payload(await accept(request,await jsonBody(request)));
    }
    const body=write?await jsonBody(request,head==="imports"?bodyLimit():32768):undefined;
    return await withWorkspace(request,async context=>{
      if (method==="GET") {
        if (parts.length===1) {
          switch (head) {
            case "options": return payload(await choices(context));
            case "stages": return payload(await stageTotals(context));
            case "pipeline": return payload(await board(context));
            case "dashboard":
            case "reports": return payload(await report(context,query));
            case "search": return payload(await search(context,query.get("q")??""));
            case "settings": return payload(await settings(context));
          }
        }
        if (head==="exports" && parts.length===2) return await exportCsv(context,id,query);
      }
      if (parts.length===1 && method==="PATCH") {
        if (head==="settings") return payload(await updateSettings(context,body));
        if (head==="profile") return payload(await updateProfile(context,body));
      }
      if (head==="invites") {
        if (parts.length===1 && method==="POST") return payload(await invite(request,context,body),undefined,201);
        if (parts.length===2 && method==="DELETE") return payload(await revoke(context,id));
      }
      if (head==="members" && parts.length===2 && method==="PATCH") return payload(await updateMember(context,identifier.parse(id),body));
      if (head==="imports" && parts.length===2 && method==="POST") {
        if (id==="columns") return payload(columns(body));
        if (id==="preview") return payload(await preview(context,body));
        if (id==="commit") return payload(await commit(context,body),undefined,201);
      }
      const checked=entityType.safeParse(head);
      if (!checked.success) throw new AppError(404,"route","Action unavailable.");
      const entity=checked.data;
      if (parts.length===1) {
        if (method==="GET") {
          const {records,after}=await list(context,entity,query);
          return payload(records,{after});
        }
        if (method==="POST") return payload(await newRecord(context,entity,body),undefined,201);
      }
      if (parts.length===2) {
        const key=identifier.parse(id);
        if (method==="GET") return payload(await detail(context,entity,key));
        if (method==="PATCH") return payload(await patchRecord(context,entity,key,body));
        if (method==="DELETE") return payload(await archive(context,entity,key,body));
      }
      if (parts.length===3 && method==="DELETE" && entity==="leads" && action==="purge") return payload(await purgeDraft(context,identifier.parse(id),body));
      if (parts.length===3 && method==="POST") {
        const key=identifier.parse(id);
        if (action==="restore") return payload(await archive(context,entity,key,body,true));
        if (action==="convert" && entity==="leads") return payload(await convert(context,key,body));
        if (action==="move" && entity==="deals") return payload(await move(context,key,body));
      }
      throw new AppError(404,"route","Action unavailable.");
    },write && !(head==="imports" && (id==="preview"||id==="columns")));
  } catch (error) {
    return failed(error);
  }
}

export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const DELETE=handle;
