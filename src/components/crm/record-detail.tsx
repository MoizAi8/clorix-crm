"use client";

import { useState } from "react";
import { Archive,ArrowLeft,ArrowRight,ClipboardPlus,Edit3,MoveRight,NotebookPen,RefreshCw,UserRoundCheck } from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { entityLabels,labelFor,money,recordLabel,type Entity,type RecordRow,type Stage } from "@/lib/crm";
import { dateTime,Dialog,Empty,ErrorNotice,Loading,Title,useLoad } from "@/components/ui/primitives";
import type { Detail,Options,Shared } from "@/components/workspace/contracts";
import { RecordForm,fields } from "./record-form";
import { ConvertLead } from "./convert-lead";
import { hasCustomFields,RecordFields } from "@/components/advanced/record-fields";
import { MoveDeal } from "@/components/pipeline/move-deal";

const relationKey:Partial<Record<Entity,string>>={leads:"lead_id",contacts:"contact_id",companies:"company_id",deals:"deal_id",tasks:"task_id"};

export function RecordDetail({entity,id,advanced=false,...shared}:{entity:Entity;id:string;advanced?:boolean}&Shared) {
  const {workspace,revision,refresh,notify,navigate}=shared;
  const {data,error}=useLoad<Detail>(entity+"/"+id,workspace.id,revision);
  const opts=useLoad<Options>(data&&entity!=="activities"?"options":null,workspace.id,revision);
  const stages=useLoad<Stage[]>(entity==="deals"?"stages":null,workspace.id,revision);
  const [dialog,setDialog]=useState<"edit"|"convert"|"archive"|"purge"|"move"|"activity"|"task"|null>(null);
  const [mutationError,setMutationError]=useState("");
  const [busy,setBusy]=useState(false);
  const row=data?.record;
  const one=entityLabels[entity].one;
  const close=()=>setDialog(null);
  const related=relationKey[entity];

  async function write(path:string,method:string,body:unknown,success:string,onSuccess?:()=>void) {
    setBusy(true);setMutationError("");
    try{await api(path,{method,body,workspace:workspace.id});notify(success);refresh();close();onSuccess?.();}
    catch(caught){setMutationError(messageOf(caught));}
    finally{setBusy(false);}
  }

  function renderValue(field:typeof fields[Entity][number],record:RecordRow) {
    const value=record[field.key];
    if(value===null || value===undefined)return "—";
    if(field.type==="money")return money(String(value),workspace.currency);
    if(field.type==="datetime-local")return dateTime(value,workspace.timezone,true);
    if(field.type==="date")return String(value).slice(0,10);
    if(field.key==="stage_id")return String(record.stage_name??"—");
    if(field.source){
      const option=opts.data?.[field.source]?.find(item=>item.id===value);
      const target=field.source as Entity;
      if(["companies","contacts","leads","deals","tasks"].includes(target)) {
        return <button className="plain-button" onClick={()=>navigate(target,String(value))}>{option?.label??String(record.company_name??"Open linked "+entityLabels[target].one)} <ArrowRight size={14}/></button>;
      }
      return option?.label??"Previous assignment";
    }
    return field.choices?labelFor(value):String(value);
  }

  return <>
    <button className="plain-button back-link" onClick={()=>navigate(entity)}><ArrowLeft size={17}/>Back to {entityLabels[entity].many.toLowerCase()}</button>
    {error?<ErrorNotice message={error} action={refresh}/>:!row||!data?<Loading label="Loading record…"/>:<>
      <Title title={recordLabel(row,entity)} description={(row.archived_at?"Archived ":"")+one[0].toUpperCase()+one.slice(1)+" details"}
        actions={entity!=="activities"&&<>{row.archived_at?<><button className="button secondary" disabled={busy} onClick={()=>write(entity+"/"+id+"/restore","POST",{expected_version:row.version},"Record restored.")}>
          <RefreshCw size={17}/>Restore</button>{workspace.role==="owner"&&entity==="leads"&&row.status==="new"&&<button className="button secondary" onClick={()=>{setMutationError("");setDialog("purge");}}>Delete draft</button>}</>:<>
          {entity==="leads"&&row.status!=="converted"&&<button className="button primary" disabled={busy}
            onClick={()=>row.status==="qualified"?setDialog("convert"):write(entity+"/"+id,"PATCH",{expected_version:row.version,status:"qualified"},"Lead qualified.")}>
            <UserRoundCheck size={17}/>{row.status==="qualified"?"Convert lead":"Qualify lead"}</button>}
          {entity==="deals"&&stages.data&&<button className="button secondary" onClick={()=>setDialog("move")}><MoveRight size={17}/>Move deal</button>}
          {entity==="tasks"&&<button className="button primary" disabled={busy}
            onClick={()=>write(entity+"/"+id,"PATCH",{expected_version:row.version,status:row.status==="done"?"open":"done"},row.status==="done"?"Task reopened.":"Task completed.")}>
            {row.status==="done"?"Reopen task":"Complete task"}</button>}
          <button className="button secondary" onClick={()=>setDialog("edit")}><Edit3 size={17}/>Edit</button>
          <button className="button secondary" onClick={()=>{setMutationError("");setDialog("archive");}}><Archive size={17}/>Archive</button>
        </>}</>}/>
      {mutationError&&dialog!=="archive"&&dialog!=="purge"&&<ErrorNotice message={mutationError} action={refresh}/>}
      <div className="details-grid">
        <section className="surface report-card"><div className="card-title"><h2>Record details</h2></div>
          <dl className="detail-fields">{fields[entity].filter(field=>field.key!==entityLabels[entity].title||field.key==="summary").map(field=>
            <div key={field.key}><dt>{field.label.replace(" (device time)","")}</dt><dd>{renderValue(field,row)}</dd></div>)}
            {entity==="activities"&&<div><dt>Logged by</dt><dd>{String(row.actor_name??"—")}</dd></div>}
            {entity==="deals"&&row.actual_closed_at!==null&&<div><dt>Closed</dt><dd>{dateTime(row.actual_closed_at,workspace.timezone,true)}</dd></div>}
            {entity==="deals"&&!!row.lost_reason&&<div><dt>Lost reason</dt><dd>{String(row.lost_reason)}</dd></div>}
            {entity==="tasks"&&row.status==="done"&&<div><dt>Completed</dt><dd>{dateTime(row.completed_at,workspace.timezone,true)}</dd></div>}
          </dl>
        </section>
        {related&&<section className="surface report-card"><div className="card-title"><h2>Related records</h2></div>
          {!row.archived_at&&<div className="actions detail-actions"><button className="button secondary" onClick={()=>setDialog("activity")}><NotebookPen size={17}/>Log activity</button>
            {entity!=="tasks"&&<button className="button secondary" onClick={()=>setDialog("task")}><ClipboardPlus size={17}/>Add linked task</button>}</div>}
          {Object.values(data.related).some(records=>records.length)?Object.entries(data.related).map(([target,rows])=>{
            const type=target as Entity;
            return rows.length>0&&<div className="related" key={target}><h3>{entityLabels[type].many}</h3><div className="report-list">{rows.map(record=>
              <button key={record.id} onClick={()=>navigate(type,record.id)}><strong>{recordLabel(record,type)}</strong>
                <small>{record.archived_at?"Archived":type==="activities"?dateTime(record.occurred_at,workspace.timezone,true):labelFor(record.status??record.stage_name)}</small>
              </button>)}</div></div>;
          }):<Empty title="No related records yet"/>}
        </section>}
      </div>
      {advanced&&hasCustomFields(entity)&&<RecordFields {...shared} entity={entity} id={id} archived={Boolean(row.archived_at)}/>}
      {entity==="deals"&&<section className="surface report-card"><div className="card-title"><div><h2>Stage history</h2><p>Recorded transitions and amount snapshots</p></div></div>
        {data.history.length?<ol className="timeline">{data.history.map((event,index)=><li key={event.event_at+"-"+index}>
          <strong>{event.stage_name}</strong><span>{dateTime(event.event_at,workspace.timezone,true)} · {event.actor} · {money(event.amount_minor,workspace.currency)}</span>
          {event.reason&&<p>{event.reason}</p>}</li>)}</ol>:<Empty title="No stage changes recorded"/>}</section>}
      {dialog==="edit"&&<RecordForm {...shared} entity={entity} row={row} close={close}/>}
      {dialog==="move"&&stages.data&&<MoveDeal {...shared} deal={row} stages={stages.data.filter(stage=>stage.pipeline_id===(row.pipeline_id??null))} close={close}/>}
      {dialog==="convert"&&<ConvertLead {...shared} lead={row} close={close}/>}
      {(dialog==="activity"||dialog==="task")&&related&&<RecordForm {...shared} entity={dialog==="activity"?"activities":"tasks"} prefill={{[related]:id}} close={close}/>}
      {dialog==="purge"&&<Dialog title="Permanently delete draft lead" onClose={()=>{if(!busy)close();}}>
        <p className="muted">Delete {recordLabel(row,entity)} permanently? This action cannot be undone.</p>
        {mutationError&&<ErrorNotice message={mutationError}/>}<div className="dialog-actions">
          <button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
          <button className="button danger" disabled={busy} onClick={()=>write(entity+"/"+id+"/purge","DELETE",{expected_version:row.version},"Draft deleted.",()=>navigate(entity))}>{busy?"Deleting…":"Delete permanently"}</button>
        </div>
      </Dialog>}
      {dialog==="archive"&&<Dialog title={"Archive "+one} onClose={()=>{if(!busy)close();}}>
        <p className="muted">Archive {recordLabel(row,entity)}? You can restore it from the archived records filter.</p>
        {mutationError&&<ErrorNotice message={mutationError}/>}<div className="dialog-actions">
          <button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
          <button className="button danger" disabled={busy} onClick={()=>write(entity+"/"+id,"DELETE",{expected_version:row.version},"Record archived.")}>{busy?"Archiving…":"Archive record"}</button>
        </div>
      </Dialog>}
    </>}
  </>;
}
