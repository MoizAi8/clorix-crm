import { createHash,createHmac,timingSafeEqual } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { AppError } from "@/server/http";
import type { Context } from "@/server/workspace/context";
import { audit, insert, limitRecords, list } from "@/server/crm/records";
import { schemas } from "@/server/crm/validation";

const tables=z.enum(["leads","contacts"]);
const exportTables=z.enum(["leads","contacts","deals"]);
const mode=z.enum(["skip","error"]);
const base=z.strictObject({entity:tables,csv:z.string(),duplicate:mode});
const confirm=base.extend({token:z.string().max(200),key:z.uuid()});
const headersByTable = {
  leads:["name","email","phone","company_name","source","status"],
  contacts:["name","email","phone","title"],
  deals:["title","company_name","stage_name","amount_minor","expected_close_date","actual_closed_at"],
};
const settings=(key:string,value:number,limit:number)=>z.coerce.number().int().positive().max(limit).parse(process.env[key] ?? value);
export const bodyLimit=()=>settings("MAX_CSV_BYTES",262144,1048576)*3+8192;

function fileHash(csv:string) {
  return createHash("sha256").update(csv).digest("hex");
}

function signature(context:Context, input:z.infer<typeof base>,expiry:number) {
  const secret=process.env.DEMO_RATE_LIMIT_SECRET;
  if (!secret) throw Error("Import signing unavailable.");
  return createHmac("sha256",secret).update(JSON.stringify([context.workspace.id,context.user.id,input.entity,input.duplicate,fileHash(input.csv),expiry])).digest();
}

async function scan(context:Context,input:z.infer<typeof base>) {
  const maxBytes=settings("MAX_CSV_BYTES",262144,1048576);
  const maxRows=settings("MAX_CSV_ROWS",200,500);
  if (Buffer.byteLength(input.csv)>maxBytes) throw new AppError(413,"csv_size","The CSV exceeds the file size limit.");
  let all:unknown;
  try { all=parse(input.csv,{bom:true,skip_empty_lines:true,trim:true,max_record_size:15000}); }
  catch { throw new AppError(422,"csv_format","Could not parse the CSV. Check quoting and column counts."); }
  const [head,...rows]=z.array(z.array(z.string())).parse(all);
  const allowed:string[]=headersByTable[input.entity];
  if (!head?.includes("name") || head.some(header=>!allowed.includes(header)) || new Set(head).size!==head.length) {
    throw new AppError(422,"csv_header","Add a name column and use only supported column names.");
  }
  if (!rows.length) throw new AppError(422,"csv_empty","The CSV has no data rows.");
  if (rows.length>maxRows) throw new AppError(413,"csv_rows","The CSV exceeds the row limit.");
  const seen=new Set<string>();
  const parsed=rows.map((row,index)=>{
    const cells=Object.fromEntries(head.flatMap((header,column)=>row[column]?[ [header,row[column]] ]:[]));
    return {line:index+2,check:schemas[input.entity].safeParse(cells)};
  });
  const emails=parsed.flatMap(({check})=>check.success && check.data.email?[check.data.email]:[]);
  if (emails.length) {
    const existing=await context.client.query<{email:string}>(
      `SELECT DISTINCT email FROM ${input.entity} WHERE workspace_id=$1 AND archived_at IS NULL AND email=ANY($2::text[])`,[context.workspace.id,emails]);
    existing.rows.forEach(row=>seen.add(row.email));
  }
  const errors:{line:number;message:string}[]=[];
  let skipped=0;
  const valid:Record<string,unknown>[]=[];
  for (const {line,check} of parsed) {
    if (!check.success) {
      errors.push({line,message:(check.error.issues[0].path.join(".") || "Row")+" has an invalid value."});
      continue;
    }
    if (check.data.email && seen.has(check.data.email)) {
      if (input.duplicate==="skip") skipped++;
      else errors.push({line,message:"An active record or earlier row uses this email."});
      continue;
    }
    if (check.data.email) seen.add(check.data.email);
    valid.push(check.data);
  }
  return {errors,skipped,valid};
}

export async function preview(context:Context,body:unknown) {
  const input=base.parse(body);
  const result=await scan(context,input);
  const expiry=Date.now()+15*60*1000;
  return {errors:result.errors,skipped:result.skipped,count:result.valid.length,rows:result.valid.slice(0,10),
    token:expiry+"."+signature(context,input,expiry).toString("base64url")};
}

export async function commit(context:Context,body:unknown) {
  const input=confirm.parse(body);
  const hash=fileHash(JSON.stringify([context.user.id,input.entity,input.duplicate,fileHash(input.csv)]));
  const key=fileHash(input.key);
  const existing=(await context.client.query("SELECT request_hash,result FROM idempotency_keys WHERE workspace_id=$1 AND operation='import' AND key_hash=$2",
    [context.workspace.id,key])).rows[0];
  if (existing) {
    if (existing.request_hash!==hash) throw new AppError(409,"idempotency","This import key was used for another request.");
    return existing.result;
  }
  const [timestamp,supplied,...extra]=input.token.split(".");
  const expiry=Number(timestamp);
  const digest=Buffer.from(supplied ?? "","base64url");
  if (extra.length || !Number.isSafeInteger(expiry) || expiry<Date.now() || digest.length!==32 || !timingSafeEqual(signature(context,input,expiry),digest)) {
    throw new AppError(409,"preview","The file changed or the preview expired. Preview it again.");
  }
  const result=await scan(context,input);
  if (result.errors.length) throw new AppError(422,"csv_errors","Fix invalid rows and preview the file again.");
  await limitRecords(context,result.valid.length);
  for (const values of result.valid) await insert(context,input.entity,{...values,owner_member_id:context.workspace.member_id});
  await audit(context,"csv_import",input.entity);
  const summary={created:result.valid.length,skipped:result.skipped};
  await context.client.query("DELETE FROM idempotency_keys WHERE workspace_id=$1 AND expires_at<=now()",[context.workspace.id]);
  await context.client.query("INSERT INTO idempotency_keys(workspace_id,operation,key_hash,request_hash,result) VALUES($1,'import',$2,$3,$4)",
    [context.workspace.id,key,hash,summary]);
  return summary;
}

export function csvCell(raw:unknown,numeric=false):string {
  let value=raw===null || raw===undefined?"":raw instanceof Date?raw.toISOString():String(raw);
  if (!numeric && (/^[\t\r\n]/.test(value) || /^\s*[=+\-@\t\r\n]/u.test(value))) value="'"+value;
  return '"'+value.replaceAll('"','""')+'"';
}

export async function exportCsv(context:Context,raw:string,params:URLSearchParams) {
  if (context.workspace.role!=="owner") throw new AppError(403,"export","Only workspace owners may export records.");
  const entity=exportTables.parse(raw);
  const headings=headersByTable[entity];
  const data=[headings.join(",")];
  const limit=settings("MAX_EXPORT_ROWS",1000,2000);
  const filters=new URLSearchParams(params);
  filters.delete("after");
  let count=0;
  do {
    filters.set("limit",String(Math.min(100,limit-count)));
    const page=await list(context,entity,filters);
    for (const row of page.records) data.push(headings.map(field=>csvCell(row[field],field==="amount_minor")).join(","));
    count+=page.records.length;
    if (!page.after) break;
    filters.set("after",page.after);
  } while(count<limit);
  return new Response(data.join("\r\n")+"\r\n",{headers:{"Content-Type":"text/csv; charset=utf-8",
    "Content-Disposition":'attachment; filename="clorix-'+entity+'.csv"',"Cache-Control":"private, no-store","X-Clorix-Exported":String(count)}});
}
