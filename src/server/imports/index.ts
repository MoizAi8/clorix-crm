import { createHash,createHmac,timingSafeEqual } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { AppError } from "@/server/http";
import type { Context } from "@/server/workspace/context";
import { audit, insert, limitRecords, list, newRecord } from "@/server/crm/records";
import { schemas } from "@/server/crm/validation";

import { csvCell,importColumns } from "@/lib/csv";
export { csvCell } from "@/lib/csv";

const tables=z.enum(["leads","contacts","companies","deals"]);
const mode=z.enum(["skip","error"]);
const file=z.strictObject({entity:tables,csv:z.string()});
const base=file.extend({duplicate:mode,mapping:z.record(z.string().min(1).max(200),z.string().min(1).max(40)).optional()});
const confirm=base.extend({token:z.string().max(200),key:z.uuid()});
const headersByTable = {
  ...importColumns,
  deals:["title","company_name","stage_name","amount_minor","expected_close_date","actual_closed_at"],
};
const settings=(key:string,value:number,limit:number)=>z.coerce.number().int().positive().max(limit).parse(process.env[key] ?? value);
export const bodyLimit=()=>settings("MAX_CSV_BYTES",262144,1048576)*3+8192;

function fileHash(csv:string) {
  return createHash("sha256").update(csv).digest("hex");
}

function selectionHash(input:z.infer<typeof base>) {
  const mapping=input.mapping?Object.entries(input.mapping).sort(([left],[right])=>left.localeCompare(right)):null;
  return fileHash(JSON.stringify([input.entity,input.duplicate,fileHash(input.csv),mapping]));
}

function signature(context:Context, input:z.infer<typeof base>,expiry:number) {
  const secret=process.env.DEMO_RATE_LIMIT_SECRET;
  if (!secret) throw Error("Import signing unavailable.");
  return createHmac("sha256",secret).update(JSON.stringify([context.workspace.id,context.user.id,selectionHash(input),expiry])).digest();
}

function readFile(input:z.infer<typeof file>) {
  const maxBytes=settings("MAX_CSV_BYTES",262144,1048576);
  const maxRows=settings("MAX_CSV_ROWS",200,500);
  if (Buffer.byteLength(input.csv)>maxBytes) throw new AppError(413,"csv_size","The CSV exceeds the file size limit.");
  let all:unknown;
  try { all=parse(input.csv,{bom:true,skip_empty_lines:true,trim:true,max_record_size:15000}); }
  catch { throw new AppError(422,"csv_format","Could not parse the CSV. Check quoting and column counts."); }
  const [head,...rows]=z.array(z.array(z.string())).parse(all);
  if(!head?.length||head.length>40||head.some(header=>!header||header.length>200)||new Set(head).size!==head.length) {
    throw new AppError(422,"csv_header","Provide 1 to 40 unique, nonempty column headings.");
  }
  if (!rows.length) throw new AppError(422,"csv_empty","The CSV has no data rows.");
  if (rows.length>maxRows) throw new AppError(413,"csv_rows","The CSV exceeds the row limit.");
  return {head,rows};
}

export function columns(body:unknown) {
  const input=file.parse(body);
  const {head}=readFile(input);
  return {head};
}

async function scan(context:Context,input:z.infer<typeof base>) {
  const {head,rows}=readFile(input);
  const allowed:readonly string[]=importColumns[input.entity];
  const required=input.entity==="deals"?"title":"name";
  const mapping=input.mapping??Object.fromEntries(head.map(header=>[header,header]));
  const destinations=Object.values(mapping);
  if(!destinations.includes(required)||new Set(destinations).size!==destinations.length||
    Object.entries(mapping).some(([source,target])=>!head.includes(source)||!allowed.includes(target))) {
    throw new AppError(422,"csv_header","Map the required "+required+" column and select each supported destination once.");
  }
  const duplicateField=input.entity==="deals"?null:input.entity==="companies"?"domain":"email";
  const seen=new Set<string>();
  const parsed=rows.map((row,index)=>{
    const cells=Object.fromEntries(head.flatMap((header,column)=>row[column]&&Object.hasOwn(mapping,header)?[[mapping[header],row[column]]]:[]));
    return {line:index+2,check:schemas[input.entity].safeParse(cells)};
  });
  const valueOf=(data:Record<string,unknown>)=>duplicateField?String(data[duplicateField]??""):"";
  const identifiers=parsed.flatMap(({check})=>check.success&&valueOf(check.data)?[valueOf(check.data)]:[]);
  if(duplicateField&&identifiers.length) {
    const existing=await context.client.query<{value:string}>(
      `SELECT DISTINCT ${duplicateField} AS value FROM ${input.entity} WHERE workspace_id=$1 AND archived_at IS NULL AND ${duplicateField}=ANY($2::text[])`,
      [context.workspace.id,identifiers]);
    existing.rows.forEach(row=>seen.add(row.value));
  }
  const errors:{line:number;message:string}[]=[];
  let skipped=0;
  const valid:Record<string,unknown>[]=[];
  for (const {line,check} of parsed) {
    if (!check.success) {
      errors.push({line,message:(check.error.issues[0].path.join(".") || "Row")+" has an invalid value."});
      continue;
    }
    const duplicateValue=valueOf(check.data);
    if (duplicateValue && seen.has(duplicateValue)) {
      if (input.duplicate==="skip") skipped++;
      else errors.push({line,message:"An active record or earlier row uses this "+duplicateField+"."});
      continue;
    }
    if(duplicateValue) seen.add(duplicateValue);
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
  const hash=fileHash(JSON.stringify(input.mapping?[context.user.id,selectionHash(input)]:
    [context.user.id,input.entity,input.duplicate,fileHash(input.csv)]));
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
  await limitRecords(context,result.valid.length*(input.entity==="deals"?2:1));
  for(const values of result.valid) {
    if(input.entity==="deals") await newRecord(context,"deals",values);
    else {
      const assignment=input.entity==="companies"?{}:{owner_member_id:context.workspace.member_id};
      const row=await insert(context,input.entity,{...values,...assignment});
      await audit(context,"create",input.entity,row.id);
    }
  }
  await audit(context,"csv_import",input.entity);
  const summary={created:result.valid.length,skipped:result.skipped};
  await context.client.query("DELETE FROM idempotency_keys WHERE workspace_id=$1 AND expires_at<=now()",[context.workspace.id]);
  await context.client.query("INSERT INTO idempotency_keys(workspace_id,operation,key_hash,request_hash,result) VALUES($1,'import',$2,$3,$4)",
    [context.workspace.id,key,hash,summary]);
  return summary;
}

export async function exportCsv(context:Context,raw:string,params:URLSearchParams) {
  if (context.workspace.role!=="owner") throw new AppError(403,"export","Only workspace owners may export records.");
  const entity=tables.parse(raw);
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
