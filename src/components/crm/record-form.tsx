"use client";

import { useState,type FormEvent } from "react";
import { api,messageOf } from "@/lib/client";
import { activityKinds,entityLabels,leadStatuses,majorUnits,minorUnits,priorities,type Entity,type RecordRow } from "@/lib/crm";
import { Dialog,ErrorNotice,Loading,useLoad } from "@/components/ui/primitives";
import type { Options,Shared } from "@/components/workspace/contracts";

type Field={key:string;label:string;type?:string;required?:boolean;source?:string;choices?:readonly string[];max?:number};
const name:Field={key:"name",label:"Name",required:true,max:120};
const title:Field={...name,key:"title",label:"Title"};
const email:Field={key:"email",label:"Email",type:"email",max:254};
const phone:Field={key:"phone",label:"Phone",type:"tel",max:40};
const owner:Field={key:"owner_member_id",label:"Owner",source:"members"};
const company:Field={key:"company_id",label:"Company",source:"companies"};
const contact:Field={key:"contact_id",label:"Contact",source:"contacts"};
const lead:Field={key:"lead_id",label:"Lead",source:"leads"};
const deal:Field={key:"deal_id",label:"Deal",source:"deals"};
const task:Field={key:"task_id",label:"Task",source:"tasks"};
const relationships=[lead,contact,company,deal];

export const fields:Record<Entity,Field[]>={
  leads:[name,email,phone,{key:"company_name",label:"Company name",max:120},{key:"source",label:"Source",max:80},
    {key:"status",label:"Status",choices:leadStatuses},owner],
  contacts:[name,email,phone,{key:"title",label:"Job title",max:120},company,owner],
  companies:[name,{key:"domain",label:"Domain",max:253},{key:"industry",label:"Industry",max:100},
    {key:"website",label:"Website",type:"url",max:500},{key:"notes",label:"Notes",type:"textarea",max:2000}],
  deals:[title,{key:"amount_minor",label:"Deal amount",type:"money"},{key:"stage_id",label:"Open stage",source:"stages"},
    {key:"expected_close_date",label:"Expected close date",type:"date"},company,contact,owner],
  tasks:[title,{key:"description",label:"Description",type:"textarea",max:2000},{key:"due_at",label:"Due date and time (device time)",type:"datetime-local"},
    {key:"priority",label:"Priority",choices:priorities},{key:"status",label:"Status",choices:["open","done"]},owner,...relationships],
  activities:[{key:"kind",label:"Activity type",choices:activityKinds,required:true},
    {key:"summary",label:"Summary",type:"textarea",max:2000,required:true},{key:"occurred_at",label:"Occurred (device time)",type:"datetime-local"},
    ...relationships,task],
};

function localTime(value:string) {
  const date=new Date(value);
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

function format(field:Field,value:unknown) {
  if (value===null || value===undefined) return "";
  if (field.type==="money") return majorUnits(String(value));
  if (field.type==="datetime-local") return localTime(String(value));
  if (field.type==="date") return String(value).slice(0,10);
  return String(value);
}

function label(value:string) {return value[0].toUpperCase()+value.slice(1);}

export function RecordForm({entity,row,prefill,close,workspace,revision,notify,refresh,onSaved}:{entity:Entity;row?:RecordRow;prefill?:Record<string,string>;
  close:()=>void;onSaved?:(row:RecordRow)=>void}&Shared) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const view=fields[entity].filter(field=>!(row&&((entity==="deals"&&field.key==="stage_id")||(entity==="leads"&&row.status==="converted"&&field.key==="status"))));
  const needsOptions=view.some(field=>field.source);
  const options=useLoad<Options>(needsOptions?"options":null,workspace.id,revision);
  const one=entityLabels[entity].one;
  const defaults:Record<string,string>={status:entity==="tasks"?"open":"new",priority:"normal",kind:"note",owner_member_id:workspace.member_id};
  const readOnlyAmount=entity==="deals" && !!row && row.stage_kind!=="open";
  const original:Record<string,unknown>=row??prefill??{};

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setBusy(true);
    try {
      const form=new FormData(event.currentTarget);
      const body:Record<string,unknown>={};
      for(const field of view) {
        if (!form.has(field.key)) continue;
        const raw=String(form.get(field.key)??"").trim();
        if (raw) body[field.key]=field.type==="money"?minorUnits(raw):field.type==="datetime-local"?new Date(raw).toISOString():raw;
        else if (field.key==="stage_id" || field.key==="occurred_at" || field.type==="money" || field.choices) continue;
        else if (row || field.source) body[field.key]=null;
      }
      if (row) body.expected_version=row.version;
      const result=await api<RecordRow>(entity+(row?"/"+row.id:""),{method:row?"PATCH":"POST",body,workspace:workspace.id});
      notify(label(one)+(row?" updated.":" created."));refresh();close();onSaved?.(result.data);
    } catch(caught){setError(messageOf(caught));setBusy(false);}
  }

  return <Dialog title={(row?"Edit ":"New ")+one} onClose={()=>{if(!busy) close();}} wide>
    {options.error?<ErrorNotice message={options.error} action={refresh}/>:needsOptions&&!options.data?<Loading label="Loading form choices…"/>:
      <form className="editor" onSubmit={submit}>
        <div className="field-grid">{view.map(field=>{
          const stored=format(field,original[field.key]);
          const value=row?stored:stored||defaults[field.key]||"";
          return <label key={field.key} className={field.type==="textarea"?"full-field":undefined}>{field.label}{field.type==="money"?" ("+workspace.currency+")":""}
            {field.type==="textarea"?<textarea name={field.key} rows={4} defaultValue={value} required={field.required} maxLength={field.max}/>:
            field.source||field.choices?<select name={field.key} defaultValue={value} required={field.required}>
              {field.source&&<option value="">{field.key==="stage_id"?"Default stage":"Choose "+field.label.toLowerCase()+" (optional)"}</option>}
              {value&&field.source&&!options.data?.[field.source]?.some(option=>option.id===value)&&<option value={value}>Current assignment</option>}
              {field.source?options.data?.[field.source]?.map(option=><option key={option.id} value={option.id}>{option.label}</option>):
                field.choices?.map(choice=><option key={choice} value={choice}>{label(choice)}</option>)}
            </select>:<input name={field.key} type={field.type==="money"?"text":field.type??"text"} inputMode={field.type==="money"?"decimal":undefined}
              defaultValue={value} required={field.required} maxLength={field.max??(field.type==="money"?14:undefined)}
              disabled={field.type==="money"&&readOnlyAmount} placeholder={field.type==="money"?"0.00":undefined}/>}
          </label>;
        })}</div>
        {entity==="activities"&&<p className="muted">Activities are manual logs. No messages are sent.</p>}
        {error&&<ErrorNotice message={error}/>}
        <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy}>{busy?"Saving…":row?"Save changes":"Create "+one}</button></div>
      </form>}
  </Dialog>;
}
