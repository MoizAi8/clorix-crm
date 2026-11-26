import type { PoolClient } from "pg";
import { z } from "zod";
import { entities, type Entity, type RecordRow } from "@/lib/crm";
import { AppError } from "@/server/http";
import type { Context } from "@/server/workspace/context";
import { identifier, schemas, version } from "./validation";

const recordEntities=entities.filter(entity=>entity!=="activities");
const names:Record<Entity,string>={leads:"name",contacts:"name",companies:"name",deals:"title",tasks:"title",activities:"summary"};
const searchColumns:Record<Entity,string>={
  leads:"concat_ws(' ',r.name,r.email,r.company_name,r.source)",contacts:"concat_ws(' ',r.name,r.email,r.title)",
  companies:"concat_ws(' ',r.name,r.domain,r.industry)",deals:"r.title",tasks:"r.title",activities:"r.summary",
};
const joins:Record<Entity,string>={
  leads:"",contacts:" LEFT JOIN companies c ON c.id=r.company_id",companies:"",
  deals:" JOIN pipeline_stages s ON s.id=r.stage_id LEFT JOIN companies c ON c.id=r.company_id",
  tasks:"",activities:' JOIN memberships m ON m.id=r.actor_member_id JOIN "user" u ON u.id=m.user_id',
};
const extra:Record<Entity,string>={
  leads:"",contacts:",c.name AS company_name",companies:"",deals:",s.name AS stage_name,s.kind AS stage_kind,s.pipeline_id,c.name AS company_name",
  tasks:"",activities:",u.name AS actor_name",
};
const parents:Record<string,Entity|"memberships">={
  company_id:"companies",contact_id:"contacts",deal_id:"deals",lead_id:"leads",task_id:"tasks",owner_member_id:"memberships",
};

export const escapeLike = (value:string) => value.replace(/[\\%_]/g, "\\$&");

export async function list(context:Context,entity:Entity,query:URLSearchParams) {
  const sort=z.enum(["recent","oldest","name"]).catch("recent").parse(query.get("sort"));
  const limit=z.coerce.number().int().min(1).max(100).parse(query.get("limit") ?? 25);
  const text=z.string().trim().max(100).parse(query.get("q") ?? "");
  const rawStatus=z.string().max(40).parse(query.get("status") ?? "");
  const source=z.string().trim().max(80).parse(query.get("source") ?? "");
  const owner=query.get("owner");
  const after=query.get("after");
  const recent=entity==="activities"?"occurred_at":"updated_at";
  const column=sort==="name"?names[entity]:recent;
  const direction=sort==="recent"?"DESC":"ASC";
  const params:unknown[]=[context.workspace.id];
  const bind=(value:unknown)=>"$"+params.push(value);
  const where=["r.workspace_id=$1"];
  if (entity!=="activities") where.push(query.get("archived")==="true" ? "r.archived_at IS NOT NULL" : "r.archived_at IS NULL");
  if (text) where.push(searchColumns[entity]+" ILIKE "+bind("%"+escapeLike(text)+"%"));
  if (source && entity==="leads") where.push("r.source ILIKE "+bind(escapeLike(source)));
  if (owner && ["leads","contacts","deals","tasks"].includes(entity)) where.push("r.owner_member_id="+bind(identifier.parse(owner)));
  if (rawStatus) {
    if (entity==="leads") where.push("r.status="+bind(z.enum(["new","contacted","qualified","disqualified","converted"]).parse(rawStatus)));
    if (entity==="deals") where.push("r.stage_id="+bind(identifier.parse(rawStatus)));
    if (entity==="activities") where.push("r.kind="+bind(z.enum(["call","meeting","email","note","system"]).parse(rawStatus)));
    if (entity==="tasks") {
      const type=z.enum(["open","done","overdue","today"]).parse(rawStatus);
      if (type==="overdue") where.push("r.status='open' AND r.due_at<now()");
      else if (type==="today") {
        const zone=bind(context.workspace.timezone);
        where.push("r.status='open' AND (r.due_at AT TIME ZONE "+zone+")::date=(now() AT TIME ZONE "+zone+")::date");
      } else where.push("r.status="+bind(type));
    }
  }
  if (after) {
    const cursor=bind(identifier.parse(after));
    const compare=direction==="DESC"?"<":">";
    where.push(`(r.${column},r.id) ${compare} (SELECT ${column},id FROM ${entity} WHERE id=${cursor} AND workspace_id=$1)`);
  }
  const result=await context.client.query<RecordRow>(
    `SELECT r.*${extra[entity]} FROM ${entity} r${joins[entity]} WHERE ${where.join(" AND ")}
    ORDER BY r.${column} ${direction},r.id ${direction} LIMIT ${bind(limit+1)}`,params);
  return { records:result.rows.slice(0,limit), after:result.rows.length>limit?result.rows[limit-1].id:null };
}

export async function get(context:Context,entity:Entity,id:string) {
  const {rows:[record]}=await context.client.query<RecordRow>(
    `SELECT r.*${extra[entity]} FROM ${entity} r${joins[entity]} WHERE r.workspace_id=$1 AND r.id=$2`,[context.workspace.id,id]);
  if (!record) throw new AppError(404,"record","This record is unavailable.");
  return record;
}

export async function detail(context:Context,entity:Entity,id:string) {
  const record=await get(context,entity,id);
  const links:Partial<Record<Entity,string>>={leads:"lead_id",contacts:"contact_id",companies:"company_id",deals:"deal_id",tasks:"task_id"};
  const field=links[entity];
  const related:Partial<Record<Entity,RecordRow[]>>={};
  if (field) {
    const targets:Entity[]=entity==="companies"?["contacts","deals","tasks","activities"]:
      entity==="contacts"?["deals","tasks","activities"]:entity==="tasks"?["activities"]:["tasks","activities"];
    for (const target of targets) {
      related[target]=(await context.client.query<RecordRow>(
        `SELECT r.*${extra[target]} FROM ${target} r${joins[target]} WHERE r.workspace_id=$1 AND r.${field}=$2
         ORDER BY r.created_at DESC,r.id LIMIT 30`,[context.workspace.id,id])).rows;
    }
  }
  if (entity==="leads" && record.converted_contact_id && record.converted_deal_id) {
    related.contacts=[await get(context,"contacts",String(record.converted_contact_id))];
    related.deals=[await get(context,"deals",String(record.converted_deal_id))];
  }
  const history=entity==="deals"?(await context.client.query(
    'SELECT e.event_at,e.from_status,e.to_status,e.amount_minor,e.reason,coalesce(e.to_stage_name,b.name) AS stage_name,u.name AS actor FROM deal_stage_events e JOIN pipeline_stages b ON b.id=e.to_stage_id JOIN memberships m ON m.id=e.actor_member_id JOIN "user" u ON u.id=m.user_id WHERE e.workspace_id=$1 AND e.deal_id=$2 ORDER BY e.event_at DESC,e.id LIMIT 50',
    [context.workspace.id,id])).rows:[];
  return {record,related,history};
}

export async function choices(context:Context) {
  const result:Record<string,{id:string;label:string}[]>={};
  for (const entity of ["companies","contacts","leads","deals","tasks"] as const) {
    result[entity]=(await context.client.query<{id:string;label:string}>(
      `SELECT id,${names[entity]} AS label FROM ${entity} WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY ${names[entity]},id LIMIT 1000`,[context.workspace.id])).rows;
  }
  result.members=(await context.client.query<{id:string;label:string}>(
    'SELECT m.id,u.name AS label FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status=\'active\' ORDER BY u.name,m.id LIMIT 100',[context.workspace.id])).rows;
  result.stages=(await context.client.query<{id:string;label:string}>("SELECT s.id,coalesce(p.name||' · ','')||s.name AS label FROM pipeline_stages s LEFT JOIN sales_pipelines p ON p.id=s.pipeline_id WHERE s.workspace_id=$1 AND s.kind='open' ORDER BY s.pipeline_id NULLS FIRST,s.sort_order",[context.workspace.id])).rows;
  return result;
}

export async function limitRecords(context:Context,additional:number) {
  if (context.workspace.kind!=="sandbox") return;
  const counts=entities.map(entity=>`(SELECT count(*) FROM ${entity} WHERE workspace_id=$1)`);
  const result=await context.client.query<{allowed:boolean}>(
    `SELECT ${counts.join("+")}+$2<=clorix_access.record_limit() AS allowed`,[context.workspace.id,additional]);
  if (!result.rows[0].allowed) throw new AppError(429,"record_limit","This sandbox has reached its record limit.");
}

export async function assertRelations(context:Context,values:Record<string,unknown>,previous:Record<string,unknown>={}) {
  for (const [field,table] of Object.entries(parents)) {
    const id=values[field];
    if (!id || id===previous[field]) continue;
    const condition=table==="memberships" ? "status='active'" : "archived_at IS NULL";
    const row=await context.client.query(`SELECT 1 FROM ${table} WHERE workspace_id=$1 AND id=$2 AND ${condition}`,[context.workspace.id,id]);
    if (!row.rowCount) throw new AppError(422,"relationship","A selected record is unavailable in this workspace.");
  }
}

export async function audit(context:Context,action:string,entity:string,id?:string) {
  await context.client.query("INSERT INTO audit_events(workspace_id,actor_member_id,event_type,resource_type,resource_id) VALUES($1,$2,$3,$4,$5)",
    [context.workspace.id,context.workspace.member_id,action,entity,id ?? null]);
}

export async function systemActivity(context:Context,summary:string,links:Partial<Record<"lead_id"|"contact_id"|"company_id"|"deal_id"|"task_id",string|null>>) {
  await insert(context,"activities",{kind:"system",summary,actor_member_id:context.workspace.member_id,...links});
}

export async function insert(context:Context,entity:Entity,input:Record<string,unknown>) {
  const fields=Object.keys(input);
  const values=fields.map(key=>input[key]);
  const {rows:[row]}=await context.client.query<RecordRow>(
    `INSERT INTO ${entity}(workspace_id,${fields.join(",")}) VALUES($1,${fields.map((_,index)=>"$"+(index+2)).join(",")}) RETURNING *`,
    [context.workspace.id,...values]);
  return row;
}

export async function update(context:Context,entity:Entity,id:string,input:Record<string,unknown>) {
  const fields=Object.keys(input);
  const {rows:[row]}=await context.client.query<RecordRow>(
    `UPDATE ${entity} SET ${fields.map((key,index)=>key+"=$"+(index+3)).concat(["updated_at=now()","version=version+1"]).join(",")}
    WHERE workspace_id=$1 AND id=$2 RETURNING *`,[context.workspace.id,id,...fields.map(key=>input[key])]);
  return row;
}

function stripUndefined(input:Record<string,unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined));
}

export async function newRecord(context:Context,entity:Entity,body:unknown) {
  const raw=stripUndefined(schemas[entity].parse(body));
  await assertRelations(context,raw);
  await limitRecords(context,entity==="deals"?2:1);
  if (["leads","contacts","deals","tasks"].includes(entity) && !("owner_member_id" in raw)) raw.owner_member_id=context.workspace.member_id;
  if (entity==="activities") raw.actor_member_id=context.workspace.member_id;
  if (entity==="tasks" && raw.status==="done") raw.completed_at=new Date();
  if (entity==="deals") {
    const stage=(await context.client.query("SELECT id FROM pipeline_stages WHERE workspace_id=$1 AND kind='open' AND (($2::uuid IS NULL AND pipeline_id IS NULL) OR id=$2) ORDER BY sort_order LIMIT 1",
      [context.workspace.id,raw.stage_id ?? null])).rows[0];
    if (!stage) throw new AppError(422,"stage","Choose an open stage in this workspace.");
    raw.stage_id=stage.id;
    raw.rank=await nextRank(context.client,context.workspace.id,stage.id);
  }
  if (["leads","contacts"].includes(entity) && raw.email) {
    const duplicate=await context.client.query(`SELECT 1 FROM ${entity} WHERE workspace_id=$1 AND email=$2 AND archived_at IS NULL LIMIT 1`,
      [context.workspace.id,raw.email]);
    if (duplicate.rowCount) throw new AppError(409,"duplicate","An active record already uses this email.");
  }
  const row=await insert(context,entity,raw);
  if (entity==="deals") await stageEvent(context,row.id,null,String(row.stage_id),null,"open",row.amount_minor ?? "0",null);
  await audit(context,"create",entity,row.id);
  return row;
}

export function compareVersion(row:RecordRow,expected:number) {
  if (row.version!==expected) throw new AppError(409,"stale","This record changed. Refresh it before trying again.");
}

export function requireActive(row:RecordRow) {
  if (row.archived_at) throw new AppError(409,"archived","Restore this record before editing it.");
}

export async function patchRecord(context:Context,entity:Entity,id:string,body:unknown) {
  if (entity==="activities") throw new AppError(405,"immutable","Activity entries preserve the original timeline.");
  const {expected_version,...raw}=schemas[entity].partial().extend({expected_version:version}).parse(body);
  const values=stripUndefined(raw);
  const record=await get(context,entity,id);
  compareVersion(record,expected_version);
  requireActive(record);
  await assertRelations(context,values,record);
  if (entity==="leads" && values.status!==undefined && record.status==="converted") throw new AppError(409,"converted","A converted lead keeps its conversion status.");
  if (entity==="deals") {
    if (values.stage_id!==undefined) throw new AppError(422,"stage_action","Use the stage move action to change a stage.");
    if (values.amount_minor!==undefined && values.amount_minor!==record.amount_minor && record.stage_kind!=="open") {
      throw new AppError(409,"closed_amount","Reopen the deal before changing its amount.");
    }
  }
  if (["leads","contacts"].includes(entity) && values.email && values.email!==record.email) {
    const duplicate=await context.client.query(`SELECT 1 FROM ${entity} WHERE workspace_id=$1 AND email=$2 AND archived_at IS NULL AND id<>$3 LIMIT 1`,
      [context.workspace.id,values.email,id]);
    if (duplicate.rowCount) throw new AppError(409,"duplicate","An active record already uses this email.");
  }
  if (entity==="tasks" && values.status!==undefined && values.status!==record.status) values.completed_at=values.status==="done"?new Date():null;
  if (!Object.keys(values).length) return record;
  const row=await update(context,entity,id,values);
  await audit(context,"update",entity,id);
  return row;
}

export async function purgeDraft(context:Context,id:string,body:unknown) {
  if(context.workspace.role!=="owner") throw new AppError(403,"owner","A workspace owner must delete this draft.");
  const input=z.strictObject({expected_version:version}).parse(body);
  const lead=await get(context,"leads",id);
  compareVersion(lead,input.expected_version);
  if (!lead.archived_at || lead.status!=="new") throw new AppError(409,"draft","Only archived new leads can be permanently deleted.");
  const references=await context.client.query(`SELECT EXISTS(
    SELECT 1 FROM deals WHERE workspace_id=$1 AND lead_id=$2
    UNION ALL SELECT 1 FROM tasks WHERE workspace_id=$1 AND lead_id=$2
    UNION ALL SELECT 1 FROM activities WHERE workspace_id=$1 AND lead_id=$2) AS linked`,[context.workspace.id,id]);
  if(references.rows[0].linked) throw new AppError(409,"linked","This lead has related history. Keep it archived.");
  await context.client.query("DELETE FROM leads WHERE workspace_id=$1 AND id=$2",[context.workspace.id,id]);
  await audit(context,"delete_draft","leads",id);
  return {deleted:true};
}

export async function archive(context:Context,entity:Entity,id:string,body:unknown,restore=false) {
  if (!recordEntities.includes(entity as Exclude<Entity,"activities">)) throw new AppError(405,"immutable","Activity entries preserve the original timeline.");
  const input=z.strictObject({expected_version:version}).parse(body);
  const row=await get(context,entity,id);
  compareVersion(row,input.expected_version);
  if (!!row.archived_at===!restore) return row;
  if (restore && ["leads","contacts"].includes(entity) && row.email) {
    const duplicate=await context.client.query("SELECT 1 FROM "+entity+" WHERE workspace_id=$1 AND email=$2 AND archived_at IS NULL LIMIT 1",[context.workspace.id,row.email]);
    if(duplicate.rowCount) throw new AppError(409,"duplicate","An active record already uses this email.");
  }
  const result=await update(context,entity,id,{archived_at:restore?null:new Date()});
  await audit(context,restore?"restore":"archive",entity,id);
  return result;
}

export async function nextRank(client:PoolClient,workspace:string,stage:string) {
  const {rows}=await client.query<{rank:number}>("SELECT coalesce(max(rank),0)+100 AS rank FROM deals WHERE workspace_id=$1 AND stage_id=$2 AND archived_at IS NULL",[workspace,stage]);
  return rows[0].rank;
}

export async function stageEvent(context:Context,id:string,previous:string|null,next:string,from:string|null,to:string,amount:string,reason:string|null) {
  await context.client.query(`INSERT INTO deal_stage_events
    (workspace_id,deal_id,from_stage_id,to_stage_id,actor_member_id,from_status,to_status,amount_minor,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[context.workspace.id,id,previous,next,context.workspace.member_id,from,to,amount,reason]);
}
