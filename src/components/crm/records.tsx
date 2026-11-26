"use client";

import { useState,type FormEvent } from "react";
import { ArrowDownToLine,ArrowLeft,ArrowRight,Check,FileUp,Plus,Search } from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { activityKinds,entityLabels,labelFor,leadStatuses,money,recordLabel,type Entity,type RecordRow,type Stage } from "@/lib/crm";
import { dateTime,Empty,ErrorNotice,Loading,Title,useLoad } from "@/components/ui/primitives";
import type { Options,Shared } from "@/components/workspace/contracts";
import { RecordForm } from "./record-form";
import { SavedViews } from "@/components/advanced/saved-views";
import { CsvImport } from "./csv-import";

const copy:Record<Entity,string>={
  leads:"Qualify inquiries and turn them into deals and customer relationships.",
  contacts:"Manage the people involved in your deals and follow-ups.",
  companies:"Keep account details and connected customer records together.",
  deals:"Review deal amounts, stages and expected close dates.",
  tasks:"Plan next steps, track due dates and close completed work.",
  activities:"Log conversations, notes, meetings and emails in one timeline.",
};

export function RecordList({entity,create,advanced=false,...shared}:{entity:Entity;create:boolean;advanced?:boolean}&Shared) {
  const {workspace,revision,refresh,notify,navigate}=shared;
  const [filters,setFilters]=useState("");
  const [cursors,setCursors]=useState<string[]>([]);
  const [importing,setImporting]=useState(false);
  const [localCreate,setLocalCreate]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [exporting,setExporting]=useState(false);
  const query=new URLSearchParams(filters);
  if(cursors.length)query.set("after",cursors[cursors.length-1]);
  const archived=query.get("archived")==="true";
  const options=useLoad<Options>(["leads","contacts","deals","tasks"].includes(entity)?"options":null,workspace.id,revision);
  const stages=useLoad<Stage[]>(entity==="deals"?"stages":null,workspace.id,revision);
  const list=useLoad<RecordRow[]>(entity+"?"+query.toString(),workspace.id,revision);
  const one=entityLabels[entity].one;
  const titles=entityLabels[entity].many;
  const canImport=entity==="leads"||entity==="contacts";
  const canExport=workspace.role==="owner"&&(canImport||entity==="deals");
  const canAssign=["leads","contacts","deals","tasks"].includes(entity);
  const statusOptions=entity==="leads"?[...leadStatuses,"converted"]:entity==="tasks"?["open","done","overdue","today"]:
    entity==="activities"?[...activityKinds,"system"]:[];

  function apply(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const next=new URLSearchParams();
    for(const [key,value] of form){if(typeof value==="string"&&value.trim())next.set(key,value.trim());}
    setFilters(next.toString());setCursors([]);
  }

  async function finish(row:RecordRow) {
    setBusy(row.id);setError("");
    const status=row.status==="done"?"open":"done";
    try{
      await api("tasks/"+row.id,{method:"PATCH",workspace:workspace.id,body:{expected_version:row.version,status}});
      notify(status==="done"?"Task completed.":"Task reopened.");refresh();
    }catch(caught){setError(messageOf(caught));}
    finally{setBusy("");}
  }

  async function download(){
    setError("");setExporting(true);
    try{
      const response=await fetch("/api/v1/exports/"+entity+"?"+filters,{headers:{"x-clorix-workspace":workspace.id},cache:"no-store"});
      if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error?.message??"Export failed. Try again.");
      const source=URL.createObjectURL(await response.blob());
      const link=document.createElement("a");link.href=source;link.download="clorix-"+entity+".csv";link.click();
      window.setTimeout(()=>URL.revokeObjectURL(source),1000);
      notify("CSV downloaded.");
    }catch(caught){setError(messageOf(caught));}
    finally{setExporting(false);}
  }

  function detail(row:RecordRow) {
    if(entity==="leads")return [row.company_name??"—",row.source??"—",labelFor(row.status)];
    if(entity==="contacts")return [row.company_name??"—",row.email??"—",row.title??"—"];
    if(entity==="companies")return [row.industry??"—",row.domain??"—",dateTime(row.updated_at,workspace.timezone)];
    if(entity==="deals")return [row.company_name??"—",money(row.amount_minor,workspace.currency),row.stage_name??"—"];
    if(entity==="tasks")return [dateTime(row.due_at,workspace.timezone,true),labelFor(row.priority),labelFor(row.status)];
    return [labelFor(row.kind),row.actor_name??"—",dateTime(row.occurred_at,workspace.timezone,true)];
  }
  const columns:Record<Entity,string[]>={leads:["Company","Source","Status"],contacts:["Company","Email","Job title"],
    companies:["Industry","Domain","Updated"],deals:["Company","Amount","Stage"],tasks:["Due","Priority","Status"],activities:["Type","Logged by","Occurred"]};

  return <>
    <Title title={titles} description={copy[entity]} actions={<>
      {canImport&&<button className="button secondary" onClick={()=>setImporting(true)}><FileUp size={17}/>Import CSV</button>}
      {canExport&&<button className="button secondary" onClick={download} disabled={exporting}><ArrowDownToLine size={17}/>Export CSV</button>}
      <button className="button primary" onClick={()=>setLocalCreate(true)}><Plus size={18}/>{entity==="activities"?"Log activity":"New "+one}</button>
    </>}/>
    {error&&<ErrorNotice message={error}/>}
    <section className="surface table-panel">
      {advanced&&entity!=="activities"&&<SavedViews {...shared} entity={entity} filters={filters} apply={next=>{setFilters(next);setCursors([]);}}/>}
      <form className="record-filters" key={filters} onSubmit={apply}>
        <label className="search-field"><span>Search {titles.toLowerCase()}</span><span className="input-icon"><Search size={17}/><input name="q"
          defaultValue={query.get("q")??""} maxLength={100} placeholder={"Search "+titles.toLowerCase()}/></span></label>
        {(statusOptions.length>0||entity==="deals")&&<label>{entity==="activities"?"Activity type":entity==="deals"?"Stage":"Status"}
          <select name="status" defaultValue={query.get("status")??""}><option value="">All</option>
            {entity==="deals"?stages.data?.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>):
              statusOptions.map(option=><option key={option} value={option}>{labelFor(option)}</option>)}</select></label>}
        {entity==="leads"&&<label>Source<input name="source" defaultValue={query.get("source")??""} maxLength={80} placeholder="Any source"/></label>}
        {canAssign&&<label>Owner<select name="owner" defaultValue={query.get("owner")??""}><option value="">Any owner</option>
          {options.data?.members?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
        <label>Sort<select name="sort" defaultValue={query.get("sort")??"recent"}><option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option><option value="name">A–Z</option></select></label>
        {entity!=="activities"&&<label>Records<select name="archived" defaultValue={query.get("archived")??""}>
          <option value="">Active</option><option value="true">Archived</option></select></label>}
        <button className="button secondary">Apply filters</button>
        {filters&&<button type="button" className="plain-button" onClick={()=>{setFilters("");setCursors([]);}}>Reset</button>}
      </form>
      {list.error?<ErrorNotice message={list.error} action={refresh}/>:!list.data?<Loading label={"Loading "+titles.toLowerCase()+"…"}/>:list.data.length?
        <div className="table-wrap record-table"><table>
          <thead><tr>{entity==="tasks"&&!archived&&<th scope="col"><span className="sr-only">Completion</span></th>}
            <th scope="col">{entity==="activities"?"Summary":entity==="deals"||entity==="tasks"?"Title":"Name"}</th>
            {columns[entity].map(column=><th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{list.data.map(row=><tr key={row.id}>
            {entity==="tasks"&&!archived&&<td className="completion-cell"><button
              className={"completion"+(row.status==="done"?" done":"")} aria-label={(row.status==="done"?"Reopen ":"Complete ")+row.title}
              type="button" disabled={!!busy} onClick={()=>finish(row)}>{row.status==="done"&&<Check size={15}/>}</button></td>}
            <td data-label="Record"><button className="row-link" onClick={()=>navigate(entity,row.id)}>{recordLabel(row,entity)}</button></td>
            {detail(row).map((value,index)=><td key={index} data-label={columns[entity][index]}>
              {(entity==="leads"||entity==="tasks"||entity==="deals")&&index===2?<span className="pill">{String(value)}</span>:String(value)}
            </td>)}</tr>)}</tbody>
        </table></div>:<Empty title={archived?"No archived records":"No "+titles.toLowerCase()+" found"}>{filters?"Try a different filter.":"Create a record to get started."}</Empty>}
      {(cursors.length>0||list.after)&&<div className="pagination">
        <button className="button secondary" disabled={!cursors.length} onClick={()=>setCursors(previous=>previous.slice(0,-1))}><ArrowLeft size={16}/>Previous</button>
        <span>Page {cursors.length+1}</span>
        <button className="button secondary" disabled={!list.after} onClick={()=>{if(list.after)setCursors([...cursors,list.after]);}}>Next <ArrowRight size={16}/></button>
      </div>}
    </section>
    {(create||localCreate)&&<RecordForm {...shared} entity={entity} close={()=>{setLocalCreate(false);if(create)navigate(entity);}}
      onSaved={row=>{setLocalCreate(false);navigate(entity,row.id);}}/>}
    {importing&&canImport&&<CsvImport {...shared} entity={entity} close={()=>setImporting(false)}/>}
  </>;
}
