"use client";

import { useState,type FormEvent } from "react";
import { api,messageOf } from "@/lib/client";
import { entityLabels,labelFor,majorUnits,minorUnits,money } from "@/lib/crm";
import { dateTime,Dialog,Empty,ErrorNotice,Loading,Title,useLoad } from "@/components/ui/primitives";
import type { Options,Shared } from "@/components/workspace/contracts";
import { useEngineMutation } from "./sales";
import { useEngineData } from "./use-engine-data";

type Tab="Campaigns"|"Email templates"|"Report builder"|"Custom fields"|"Audit log";
type Campaign={id:string;version:number;name:string;channel:string;objective:string;starts_on:string;ends_on:string;
  status:string;budget_minor:string;cost_minor:string;leads:number;converted:number;won_minor:string;
  conversion_percent:number|null;cost_per_lead_minor:string|null};
type Attribution={lead_id:string;campaign_id:string;name:string};
type Template={id:string;version:number;name:string;category:string;subject:string;body:string};
type Rendered={subject:string;body:string};
type Draft=Rendered&{id:string;template:string;contact:string;created_at:string};
type Field={id:string;entity:"leads"|"contacts"|"companies"|"deals";name:string;data_type:string;options:string[];active:boolean;version:number};
type ReportSpec={dimension:string;starts_on:string;ends_on:string};
type ReportData={kind:"money"|"count";currency:string;rows:{label:string;value:string}[]};
type AuditRow={id:string;event_type:string;resource_type:string;resource_id:string|null;actor:string;created_at:string};

export type SavedPreset<T>={id:string;kind:"view"|"report";name:string;specification:T;version:number};
const tabs:Tab[]=["Campaigns","Email templates","Report builder","Custom fields","Audit log"];
const dimensions:Record<string,string>={
  lead_source:"Lead count by source",deal_stage:"Deal value by stage",booked_month:"Won deal revenue by month",
  invoice_status:"Invoice totals by status",payment_month:"Recorded payments by month",forecast:"Stage-weighted open deals by close month",
  customer_health:"Current accounts by health",support_status:"Ticket count by status",
  campaign:"Won deal value by overlapping campaign",team:"Won deal value by owner",workflow_outcome:"Workflow runs by latest outcome",
};

function today(zone:string) {
  return new Intl.DateTimeFormat("sv-SE",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

function formValues(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}

export function Productivity(shared:Shared) {
  const [tab,setTab]=useState<Tab>("Campaigns");
  return <>
    <Title title="Productivity" description="Manage campaigns, drafts, reports and workspace data."/>
    <div className="advanced-tabs" aria-label="Productivity sections">
      {tabs.filter(item=>item!=="Audit log"||shared.workspace.role==="owner").map(item=>
        <button key={item} className="button secondary" aria-pressed={tab===item} onClick={()=>setTab(item)}>{item}</button>)}
    </div>
    {tab==="Campaigns"?<CampaignPanel {...shared}/>:tab==="Email templates"?<TemplatePanel {...shared}/>:
      tab==="Report builder"?<ReportPanel {...shared}/>:tab==="Custom fields"?<FieldPanel {...shared}/>:<AuditPanel {...shared}/>}
  </>;
}

function CampaignPanel(shared:Shared) {
  const {workspace,revision,refresh}=shared;
  const {data,error}=useLoad<{campaigns:Campaign[];attribution:Attribution[]}>("advanced/campaigns",workspace.id,revision);
  const options=useLoad<Options>(data?"options":null,workspace.id,revision);
  const editor=useEngineMutation(shared);
  const [editing,setEditing]=useState<Campaign|null|undefined>(undefined);
  const [selected,setSelected]=useState("");
  const [leadId,setLeadId]=useState("");
  if(error)return <ErrorNotice message={error} action={refresh}/>;
  if(!data)return <Loading label="Loading campaigns…"/>;
  const current=data.campaigns.find(row=>row.id===selected);
  function save(event:FormEvent<HTMLFormElement>) {
    const values=formValues(event);
    void editor.save("campaigns",{...values,id:editing?.id??null,version:editing?.version??0,
      budget_minor:minorUnits(String(values.budget)),cost_minor:minorUnits(String(values.cost)),budget:undefined,cost:undefined},
      "Campaign saved.",()=>setEditing(undefined));
  }
  return <section className="surface report-card">
    <div className="card-title"><h2>Campaign performance</h2><button className="button secondary" onClick={()=>setEditing(null)}>New campaign</button></div>
    {editor.error&&editing===undefined&&<ErrorNotice message={editor.error}/>}
    {data.campaigns.length?<div className="table-wrap"><table><thead><tr>
      <th scope="col">Campaign</th><th scope="col">Status</th><th scope="col">Leads</th><th scope="col">Converted</th>
      <th scope="col">Spent</th><th scope="col">Won value</th>
    </tr></thead><tbody>{data.campaigns.map(row=><tr key={row.id}>
      <td><button className="row-link" onClick={()=>setSelected(row.id)}>{row.name}</button><br/><small>{row.channel}</small></td>
      <td>{labelFor(row.status)}</td><td>{row.leads}</td><td>{row.converted}{row.conversion_percent!==null?" ("+row.conversion_percent+"%)":""}</td>
      <td>{money(row.cost_minor,workspace.currency)}</td><td>{money(row.won_minor,workspace.currency)}</td>
    </tr>)}</tbody></table></div>:<Empty title="No campaigns yet"/>}
    {current&&<>
      <div className="card-title"><div><h3>{current.name}</h3><p>{current.starts_on} to {current.ends_on} · Budget {money(current.budget_minor,workspace.currency)} · Cost per lead {current.cost_per_lead_minor===null?"—":money(current.cost_per_lead_minor,workspace.currency)}</p>
        {current.objective&&<p>{current.objective}</p>}</div><button className="button secondary" onClick={()=>setEditing(current)}>Edit campaign</button></div>
      <form className="advanced-filters" onSubmit={event=>{
        event.preventDefault();
        const previous=data.attribution.find(row=>row.lead_id===leadId)?.campaign_id??null;
        void editor.save("campaign-attribution",{version:0,lead_id:leadId,campaign_id:current.id,previous_campaign_id:previous},"Lead attributed.",()=>setLeadId(""));
      }}>
        <label>Lead<select required value={leadId} onChange={event=>setLeadId(event.target.value)}><option value="">Choose a lead</option>
          {options.data?.leads?.map(option=><option key={option.id} value={option.id}>{option.label}{data.attribution.some(row=>row.lead_id===option.id)?" · attributed":""}</option>)}
        </select></label>
        <button className="button secondary" disabled={!leadId||editor.busy}>Attribute lead</button>
      </form>
      {options.error&&<ErrorNotice message={options.error}/>}
      <div className="advanced-list">{data.attribution.filter(row=>row.campaign_id===current.id).map(row=><article key={row.lead_id} className="advanced-row">
        <button className="row-link" onClick={()=>shared.navigate("leads",row.lead_id)}>{row.name}</button>
        <button className="button secondary" disabled={editor.busy} onClick={()=>void editor.save("campaign-attribution",
          {version:0,lead_id:row.lead_id,campaign_id:null,previous_campaign_id:current.id},"Attribution removed.")}>Remove attribution</button>
      </article>)}</div>
    </>}
    {editing!==undefined&&<Dialog title={editing?"Edit campaign":"New campaign"} onClose={()=>setEditing(undefined)} wide>
      <form onSubmit={save} className="form-stack">
        <label>Campaign name<input name="name" required maxLength={120} defaultValue={editing?.name}/></label>
        <label>Channel<input name="channel" required maxLength={60} defaultValue={editing?.channel}/></label>
        <label>Objective<textarea name="objective" maxLength={1200} defaultValue={editing?.objective}/></label>
        <div className="form-grid"><label>Starts on<input name="starts_on" type="date" required defaultValue={editing?.starts_on??today(workspace.timezone)}/></label>
          <label>Ends on<input name="ends_on" type="date" required defaultValue={editing?.ends_on??today(workspace.timezone)}/></label>
          <label>Budget ({workspace.currency})<input name="budget" inputMode="decimal" pattern="[0-9]{1,11}([.][0-9]{1,2})?" required defaultValue={majorUnits(editing?.budget_minor)||"0"}/></label>
          <label>Actual cost ({workspace.currency})<input name="cost" inputMode="decimal" pattern="[0-9]{1,11}([.][0-9]{1,2})?" required defaultValue={majorUnits(editing?.cost_minor)||"0"}/></label></div>
        <label>Status<select name="status" defaultValue={editing?.status??"planned"}>{["planned","active","completed","cancelled"].map(status=>
          <option key={status} value={status}>{labelFor(status)}</option>)}</select></label>
        {editor.error&&<ErrorNotice message={editor.error}/>}<div className="dialog-actions"><button className="button primary" disabled={editor.busy}>Save campaign</button></div>
      </form>
    </Dialog>}
  </section>;
}

function TemplatePanel(shared:Shared) {
  const {workspace,revision,refresh}=shared;
  const {data,error}=useLoad<{templates:Template[];drafts:Draft[];variables:string[]}>("advanced/email-templates",workspace.id,revision);
  const options=useLoad<Options>(data?"options":null,workspace.id,revision);
  const editor=useEngineMutation(shared);
  const [editing,setEditing]=useState<Template|null|undefined>(undefined);
  const [preview,setPreview]=useState<Rendered|null>(null);
  const [previewError,setPreviewError]=useState("");
  const [previewBusy,setPreviewBusy]=useState(false);
  if(error)return <ErrorNotice message={error} action={refresh}/>;
  if(!data)return <Loading label="Loading email templates…"/>;
  async function render(event:FormEvent<HTMLFormElement>) {
    const submit=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
    const values=formValues(event);
    const body={template_id:values.template_id,contact_id:values.contact_id,deal_id:values.deal_id||null,save:submit?.value==="save"};
    setPreview(null);setPreviewError("");
    if(body.save) {
      await editor.save<Rendered>("email-draft",body,"Draft saved.",setPreview);
      return;
    }
    setPreviewBusy(true);
    try {
      const result=await api<Rendered>("advanced/email-draft",{workspace:workspace.id,method:"POST",body:{...body,key:crypto.randomUUID()}});
      setPreview(result.data);
    }catch(caught){setPreviewError(messageOf(caught));}
    finally{setPreviewBusy(false);}
  }
  return <>
    <section className="surface report-card">
      <div className="card-title"><h2>Template library</h2><button className="button secondary" onClick={()=>setEditing(null)}>New template</button></div>
      <div className="advanced-list">{data.templates.map(item=><article className="advanced-row" key={item.id}>
        <button className="row-link" onClick={()=>setEditing(item)}>{item.name}</button><span className="pill">{item.category}</span></article>)}</div>
      {!data.templates.length&&<Empty title="No email templates yet"/>}
    </section>
    {data.templates.length>0&&<section className="surface report-card">
      <div className="card-title"><div><h2>Generate a draft</h2><p>Review a personal draft before using it in your email client.</p></div></div>
      <form className="advanced-filters" onSubmit={render}>
        <label>Template<select name="template_id" required>{data.templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Contact<select name="contact_id" required><option value="">Choose a contact</option>{options.data?.contacts?.map(item=>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Related deal<select name="deal_id"><option value="">Optional</option>{options.data?.deals?.map(item=>
          <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button className="button secondary" value="preview" disabled={previewBusy||editor.busy}>Preview draft</button>
        <button className="button primary" value="save" disabled={previewBusy||editor.busy}>Save draft</button>
      </form>
      {(options.error||previewError||editor.error)&&editing===undefined&&<ErrorNotice message={options.error||previewError||editor.error}/>}
      {preview&&<article className="draft-text"><h3>{preview.subject}</h3><p>{preview.body}</p></article>}
      {data.drafts.length>0&&<div className="advanced-list"><h3>Recent drafts</h3>{data.drafts.map(item=><article key={item.id}>
        <details className="advanced-explanation"><summary>{item.subject} · {item.contact}</summary>
          <small>{item.template} · {dateTime(item.created_at,workspace.timezone,true)}</small><div className="draft-text"><p>{item.body}</p></div></details>
      </article>)}</div>}
    </section>}
    {editing!==undefined&&<Dialog title={editing?"Edit email template":"New email template"} onClose={()=>setEditing(undefined)} wide>
      <form className="form-stack" onSubmit={event=>void editor.save("email-templates",{...formValues(event),id:editing?.id??null,version:editing?.version??0},
        "Email template saved.",()=>setEditing(undefined))}>
        <label>Template name<input name="name" maxLength={100} required defaultValue={editing?.name}/></label>
        <label>Category<input name="category" maxLength={60} required defaultValue={editing?.category}/></label>
        <label>Subject<input name="subject" maxLength={200} required defaultValue={editing?.subject}/></label>
        <label>Body<textarea name="body" rows={6} maxLength={5000} required defaultValue={editing?.body}/></label>
        <p className="muted">Placeholders {data.variables.map(variable=>"{{"+variable+"}}").join(", ")}</p>
        {editor.error&&<ErrorNotice message={editor.error}/>}<div className="dialog-actions"><button className="button primary" disabled={editor.busy}>Save template</button></div>
      </form>
    </Dialog>}
  </>;
}

function csvCell(input:string,numeric=false) {
  const safe=!numeric&&/^[\s\uFEFF]*[=+@-]/.test(input)?"'"+input:input;
  return '"'+safe.replaceAll('"','""')+'"';
}

function exportReport(data:ReportData,spec:ReportSpec) {
  const contents=["Group,"+csvCell(data.kind==="money"?"Minor units ("+data.currency+")":"Count"),
    ...data.rows.map(row=>csvCell(row.label)+","+csvCell(row.value,true))].join("\r\n")+"\r\n";
  const url=URL.createObjectURL(new Blob([contents],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="clorix-"+spec.dimension+"-"+spec.ends_on+".csv";link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function ReportPanel(shared:Shared) {
  const {workspace,revision}=shared;
  const now=today(workspace.timezone);
  const initial={dimension:"lead_source",starts_on:now.slice(0,7)+"-01",ends_on:now};
  const [spec,setSpec]=useState<ReportSpec|null>(null);
  const [selected,setSelected]=useState<SavedPreset<ReportSpec>|null>(null);
  const engine=useEngineData<ReportData>("report-builder",spec,shared);
  const presets=useLoad<SavedPreset<ReportSpec>[]>("advanced/saved-presets",workspace.id,revision);
  const editor=useEngineMutation(shared);
  return <section className="surface report-card">
    <div className="card-title"><h2>Report builder</h2></div>
    <form key={JSON.stringify(spec)} className="advanced-filters" onSubmit={event=>{
      const values=formValues(event);
      setSpec({dimension:String(values.dimension),starts_on:String(values.starts_on),ends_on:String(values.ends_on)});
    }}>
      <label>Measure<select name="dimension" defaultValue={(spec??initial).dimension}>{Object.entries(dimensions).map(([id,label])=>
        <option key={id} value={id}>{label}</option>)}</select></label>
      <label>From<input name="starts_on" type="date" defaultValue={(spec??initial).starts_on} required/></label>
      <label>To<input name="ends_on" type="date" defaultValue={(spec??initial).ends_on} required/></label>
      <button className="button primary">Run report</button>
    </form>
    <div className="advanced-filters">
      <label>Saved report<select value={selected?.id??""} onChange={event=>{
        const saved=presets.data?.find(item=>item.kind==="report"&&item.id===event.target.value)??null;
        setSelected(saved);if(saved)setSpec(saved.specification);
      }}><option value="">Select a saved report</option>{presets.data?.filter(item=>item.kind==="report").map(item=>
        <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    {spec&&engine?.data&&<>
      <div className="card-title"><h3>{dimensions[spec.dimension]}</h3><button className="button secondary" onClick={()=>exportReport(engine.data!,spec)}>Export report CSV</button></div>
      {engine.data.rows.length?<div className="table-wrap"><table><thead><tr><th scope="col">Group</th><th scope="col">Value</th></tr></thead>
        <tbody>{engine.data.rows.map((row,index)=><tr key={row.label+index}><td>{row.label}</td><td>
          {engine.data?.kind==="money"?money(row.value,engine.data.currency):row.value}</td></tr>)}</tbody></table></div>:<Empty title="No results in this date range"/>}
      <form key={selected?.id??"new"} className="advanced-filters" onSubmit={event=>{
        const values=formValues(event);
        void editor.save("saved-presets",{id:selected?.id??null,version:selected?.version??0,name:values.name,kind:"report",specification:spec},
          "Report saved.",()=>setSelected(null));
      }}>
        <label>Report name<input name="name" maxLength={80} required defaultValue={selected?.name}/></label>
        <button className="button secondary" disabled={editor.busy}>{selected?"Update saved report":"Save report"}</button>
      </form>
    </>}
    {spec&&!engine&&<Loading label="Calculating report…"/>}
    {(engine?.error||presets.error||editor.error)&&<ErrorNotice message={engine?.error||presets.error||editor.error}/>}
  </section>;
}

function FieldPanel(shared:Shared) {
  const {workspace,revision,refresh}=shared;
  const {data,error}=useLoad<Field[]>("advanced/custom-fields",workspace.id,revision);
  const editor=useEngineMutation(shared);
  const [editing,setEditing]=useState<Field|null|undefined>(undefined);
  const [kind,setKind]=useState("text");
  if(error)return <ErrorNotice message={error} action={refresh}/>;
  if(!data)return <Loading label="Loading custom fields…"/>;
  function open(field:Field|null){setKind(field?.data_type??"text");setEditing(field);}
  return <section className="surface report-card">
    <div className="card-title"><div><h2>Custom fields</h2><p>Values are edited on their individual records.</p></div>
      {workspace.role==="owner"&&<button className="button secondary" onClick={()=>open(null)}>New custom field</button>}</div>
    {data.length?<div className="advanced-list">{data.map(field=><article key={field.id} className="advanced-row">
      {workspace.role==="owner"?<button className="row-link" onClick={()=>open(field)}>{field.name}</button>:<strong>{field.name}</strong>}
      <small>{entityLabels[field.entity].many} · {labelFor(field.data_type)}</small><span className="pill">{field.active?"Active":"Archived"}</span>
    </article>)}</div>:<Empty title="No custom fields yet"/>}
    {editing!==undefined&&<Dialog title={editing?"Edit custom field":"New custom field"} onClose={()=>setEditing(undefined)}>
      <form className="form-stack" onSubmit={event=>{
        const values=formValues(event);
        const options=kind.endsWith("_select")?String(values.options??"").split("\n").map(value=>value.trim()).filter(Boolean):[];
        void editor.save("custom-fields",{id:editing?.id??null,version:editing?.version??0,entity:editing?.entity??values.entity,
          name:values.name,data_type:kind,options,active:values.active==="true"},"Custom field saved.",()=>setEditing(undefined));
      }}>
        <label>Field name<input name="name" required maxLength={80} defaultValue={editing?.name}/></label>
        <label>Record type<select name="entity" disabled={Boolean(editing)} defaultValue={editing?.entity??"leads"}>
          {(["leads","contacts","companies","deals"] as const).map(entity=><option key={entity} value={entity}>{entityLabels[entity].many}</option>)}</select></label>
        <label>Field type<select value={kind} disabled={Boolean(editing)} onChange={event=>setKind(event.target.value)}>
          {["text","number","date","boolean","single_select","multi_select"].map(type=><option key={type} value={type}>{labelFor(type)}</option>)}
        </select></label>
        {kind.endsWith("_select")&&<label>Options, one per line<textarea name="options" required maxLength={1200} defaultValue={editing?.options.join("\n")}/></label>}
        <label>Field status<select name="active" defaultValue={editing?.active===false?"false":"true"}><option value="true">Active</option><option value="false">Archived</option></select></label>
        {editor.error&&<ErrorNotice message={editor.error}/>}<div className="dialog-actions"><button className="button primary" disabled={editor.busy}>Save custom field</button></div>
      </form>
    </Dialog>}
  </section>;
}

function AuditPanel(shared:Shared) {
  const [filter,setFilter]=useState({event:"",entity:"",record_id:null as string|null});
  const results=useEngineData<AuditRow[]>("audit-history",filter,shared);
  return <section className="surface report-card">
    <div className="card-title"><h2>Audit log</h2></div>
    <form className="advanced-filters" onSubmit={event=>{
      const fields=formValues(event);
      setFilter({event:String(fields.event).trim(),entity:String(fields.entity).trim(),record_id:String(fields.record_id).trim()||null});
    }}>
      <label>Event<input name="event" maxLength={80} placeholder="Any event"/></label>
      <label>Resource type<input name="entity" maxLength={80} placeholder="Any resource"/></label>
      <label>Record ID<input name="record_id" maxLength={36} placeholder="Any record"/></label>
      <button className="button secondary">Filter audit log</button>
    </form>
    {results?.error?<ErrorNotice message={results.error}/>:!results?.data?<Loading label="Loading audit history…"/>:
      results.data.length?<div className="advanced-list">{results.data.map(row=><article key={row.id}>
        <div className="advanced-row"><strong>{labelFor(row.event_type)}</strong><span className="pill">{labelFor(row.resource_type)}</span></div>
        <small>{row.actor} · {dateTime(row.created_at,shared.workspace.timezone,true)}</small>
        {row.resource_id&&<p className="audit-id">{row.resource_id}</p>}
      </article>)}</div>:<Empty title="No matching audit events"/>}
  </section>;
}
