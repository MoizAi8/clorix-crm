import { createHash } from "node:crypto";
import type { Context } from "@/server/workspace/context";
import { AppError } from "@/server/http";
import { assertRelations, audit, compareVersion, get, insert, limitRecords, nextRank, requireActive, stageEvent, systemActivity, update } from "./records";
import { convertInput, moveInput } from "./validation";

type Conversion={lead_id:string;contact_id:string;company_id:string|null;deal_id:string};

export async function convert(context:Context,id:string,body:unknown) {
  const input=convertInput.parse(body);
  const keyHash=createHash("sha256").update(input.key).digest("hex");
  const requestHash=createHash("sha256").update(JSON.stringify([id,input.expected_version,input.title,input.amount_minor,input.company_id??null,
    input.contact_id??null,input.create_contact_if_duplicate===true])).digest("hex");
  const params=[context.workspace.id,keyHash];
  const prior=(await context.client.query<{request_hash:string;result:Conversion}>(
    "SELECT request_hash,result FROM idempotency_keys WHERE workspace_id=$1 AND operation='convert' AND key_hash=$2",params)).rows[0];
  if (prior) {
    if (prior.request_hash!==requestHash) throw new AppError(409,"idempotency","This conversion key was used for a different request.");
    return prior.result;
  }
  const lead=await get(context,"leads",id);
  requireActive(lead);
  compareVersion(lead,input.expected_version);
  if (lead.status!=="qualified") throw new AppError(409,"qualification","Qualify this lead before converting it.");
  await assertRelations(context,{contact_id:input.contact_id,company_id:input.company_id});
  let contactId=input.contact_id??null;
  let companyId=input.company_id??null;
  if (contactId) {
    const contact=await get(context,"contacts",contactId);
    if (contact.company_id && companyId && contact.company_id!==companyId) throw new AppError(422,"contact_company","Choose the selected contact’s company or leave company blank.");
    companyId=companyId??contact.company_id??null;
    if (companyId) await assertRelations(context,{company_id:companyId});
  } else if (lead.email && !input.create_contact_if_duplicate) {
    const match=await context.client.query("SELECT 1 FROM contacts WHERE workspace_id=$1 AND email=$2 AND archived_at IS NULL LIMIT 1",[context.workspace.id,lead.email]);
    if (match.rowCount) throw new AppError(409,"duplicate_contact","A contact already uses this email. Select that contact or confirm creation of a separate contact.");
  }
  await limitRecords(context,2+Number(!contactId)+Number(!contactId && !companyId && !!lead.company_name));
  if (!contactId && !companyId && lead.company_name) {
    companyId=(await insert(context,"companies",{name:lead.company_name})).id;
  }
  if (!contactId) {
    contactId=(await insert(context,"contacts",{name:lead.name,email:lead.email,phone:lead.phone,company_id:companyId,
      owner_member_id:lead.owner_member_id??context.workspace.member_id})).id;
  }
  const stage=(await context.client.query("SELECT id FROM pipeline_stages WHERE workspace_id=$1 AND sort_order=1",[context.workspace.id])).rows[0].id;
  const deal=await insert(context,"deals",{title:input.title,amount_minor:input.amount_minor,stage_id:stage,
    contact_id:contactId,company_id:companyId,lead_id:id,owner_member_id:lead.owner_member_id??context.workspace.member_id,
    rank:await nextRank(context.client,context.workspace.id,stage)});
  await update(context,"leads",id,{status:"converted",converted_contact_id:contactId,converted_deal_id:deal.id});
  await stageEvent(context,deal.id,null,stage,null,"open",input.amount_minor,null);
  await systemActivity(context,"Qualified lead converted into a contact and deal.",{lead_id:id,deal_id:deal.id,contact_id:contactId,company_id:companyId});
  await audit(context,"convert","leads",id);
  const result={lead_id:id,contact_id:contactId,company_id:companyId,deal_id:deal.id};
  await context.client.query("DELETE FROM idempotency_keys WHERE workspace_id=$1 AND expires_at<=now()",[context.workspace.id]);
  await context.client.query("INSERT INTO idempotency_keys(workspace_id,operation,key_hash,request_hash,result) VALUES($1,'convert',$2,$3,$4)",
    [...params,requestHash,result]);
  return result;
}

export async function move(context:Context,id:string,body:unknown) {
  const input=moveInput.parse(body);
  const deal=await get(context,"deals",id);
  requireActive(deal);
  compareVersion(deal,input.expected_version);
  const stage=(await context.client.query<{id:string;name:string;kind:string}>(
    "SELECT id,name,kind FROM pipeline_stages WHERE workspace_id=$1 AND id=$2",[context.workspace.id,input.stage_id])).rows[0];
  if (!stage) throw new AppError(422,"stage","Choose a stage in this workspace.");
  const changed=deal.stage_id!==stage.id;
  if (changed && stage.kind==="lost" && !input.reason) throw new AppError(422,"reason","Enter a reason for closing this deal as lost.");
  if (input.before_id===id) return deal;
  if (changed) await limitRecords(context,1);
  const ordered=(await context.client.query<{id:string}>(
    "SELECT id FROM deals WHERE workspace_id=$1 AND stage_id=$2 AND id<>$3 AND archived_at IS NULL ORDER BY rank,id",
    [context.workspace.id,stage.id,id])).rows.map(row=>row.id);
  const at=input.before_id?ordered.indexOf(input.before_id):ordered.length;
  if (at<0) throw new AppError(409,"order","The drop location changed. Refresh and try again.");
  ordered.splice(at,0,id);
  const changedFields=changed?{stage_id:stage.id,actual_closed_at:stage.kind==="open"?null:new Date(),
    lost_reason:stage.kind==="lost"?input.reason:null}:{};
  const row=await update(context,"deals",id,{...changedFields,rank:(at+1)*100});
  await context.client.query(`UPDATE deals d SET rank=position.ordinality*100 FROM unnest($1::uuid[]) WITH ORDINALITY position(id,ordinality)
    WHERE d.workspace_id=$2 AND d.id=position.id AND d.rank<>position.ordinality*100`,[ordered,context.workspace.id]);
  if (changed) {
    await stageEvent(context,id,deal.stage_id??null,stage.id,deal.stage_kind??null,stage.kind,deal.amount_minor??"0",
      stage.kind==="lost"?input.reason??null:null);
    await systemActivity(context,"Deal moved to "+stage.name+".",{deal_id:id,lead_id:typeof deal.lead_id==="string"?deal.lead_id:null,
      company_id:deal.company_id??null,contact_id:deal.contact_id??null});
    await audit(context,"move","deals",id);
  }
  return {...row,stage_name:stage.name,stage_kind:stage.kind};
}
