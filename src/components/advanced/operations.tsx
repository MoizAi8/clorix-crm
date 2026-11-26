"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { messageOf } from "@/lib/client";
import { labelFor, majorUnits, minorUnits, money } from "@/lib/crm";
import { dateTime, Dialog, Empty, ErrorNotice, Loading, Title, useLoad } from "@/components/ui/primitives";
import type { Options, Shared } from "@/components/workspace/contracts";
import { useEngineMutation } from "./sales";
import { useEngineData } from "./use-engine-data";

const statuses=["open","in_progress","resolved","closed"];
const priorities=["low","normal","high","urgent"];
const ticketNumber=(serial:number)=>"T-"+String(serial).padStart(5,"0");

type Ticket={id:string;serial:number;subject:string;status:string;priority:string;category:string;assignee_id:string|null;company_name:string;
  company_id:string;contact_id:string|null;description:string;resolution:string;version:number;updated_at:string};
type SupportDetail={ticket:Ticket;history:{id:string;action:string;body:string;created_at:string;actor:string|null}[]};
type SupportData={tickets:Ticket[];metrics:{open:number;resolved:number;response_minutes:number|null;resolution_minutes:number|null}};

function TicketEditor({ticket,shared,close}:{ticket?:Ticket;shared:Shared;close:()=>void}){
  const {data:options,error:choicesError}=useLoad<Options>("options",shared.workspace.id);
  const {save,busy,error}=useEngineMutation(shared);
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const values=new FormData(event.currentTarget);
    const input=(key:string)=>String(values.get(key)??"").trim();
    void save<{id:string}>("support",{key:crypto.randomUUID(),id:ticket?.id??null,version:ticket?.version??0,
      company_id:input("company"),contact_id:input("contact")||null,assignee_id:input("assignee")||null,
      subject:input("subject"),category:input("category"),priority:input("priority"),status:ticket?input("status"):"open",
      description:input("description"),resolution:input("resolution")},"Support ticket saved.",
      result=>{close();shared.navigate("support",result.id);});
  }
  return <Dialog title={ticket?"Edit support ticket":"Open support ticket"} onClose={()=>{if(!busy)close();}} wide>
    {choicesError?<ErrorNotice message={choicesError}/>:!options?<Loading/>:<form className="editor" onSubmit={submit}>
      <label>Subject<input name="subject" required maxLength={120} defaultValue={ticket?.subject}/></label>
      <div className="field-grid">
        <label>Company<select aria-label="Company" name="company" defaultValue={ticket?.company_id??""} required>
          <option value="">Select customer company</option>{options.companies?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Contact<select name="contact" defaultValue={ticket?.contact_id??""}><option value="">None</option>
          {options.contacts?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Assignee<select name="assignee" defaultValue={ticket?.assignee_id??""}><option value="">Unassigned</option>
          {options.members?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Category<input name="category" required maxLength={80} defaultValue={ticket?.category??"General"}/></label>
        <label>Priority<select name="priority" defaultValue={ticket?.priority??"normal"}>{priorities.map(item=><option key={item} value={item}>{labelFor(item)}</option>)}</select></label>
        {ticket&&<label>Status<select name="status" defaultValue={ticket.status}>{statuses.map(item=><option key={item} value={item}>{labelFor(item)}</option>)}</select></label>}
      </div>
      <label>Description<textarea name="description" rows={4} required maxLength={2500} defaultValue={ticket?.description}/></label>
      {ticket&&<label>Resolution note<textarea name="resolution" rows={3} maxLength={2000} defaultValue={ticket.resolution}/></label>}
      {error&&<ErrorNotice message={error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{ticket?"Save ticket":"Open ticket"}</button></div>
    </form>}
  </Dialog>;
}

export function Support({recordId,...shared}:Shared&{recordId?:string}){
  const {data,error}=useLoad<SupportData>("advanced/support",shared.workspace.id,shared.revision,true);
  const detail=useEngineData<SupportDetail>("support-detail",recordId?{id:recordId}:null,shared);
  const {save,busy,error:saveError}=useEngineMutation(shared);
  const [state,setState]=useState("");
  const [query,setQuery]=useState("");
  const [edit,setEdit]=useState(false);
  const found=detail?.data?.ticket;
  const ticket=found??undefined;
  const results=data?.tickets.filter(item=>(!state||item.status===state)&&
    [ticketNumber(item.serial),item.subject,item.company_name,item.category].join(" ").toLowerCase().includes(query.trim().toLowerCase()))??[];
  return <>
    {recordId?<>
      <button type="button" className="plain-button back-link" onClick={()=>shared.navigate("support")}><ArrowLeft size={16}/>Back to tickets</button>
      {detail?.error?<ErrorNotice message={detail.error} action={shared.refresh}/>:!ticket?<Loading label="Loading ticket…"/>:<>
        <Title title={ticketNumber(ticket.serial)+" · "+ticket.subject} description={ticket.company_name+" · "+labelFor(ticket.status)+" · "+labelFor(ticket.priority)}
          actions={<button className="button primary" onClick={()=>setEdit(true)}>Edit ticket</button>}/>
        <div className="details-grid">
          <article className="surface report-card"><div className="card-title"><h2>Ticket details</h2></div>
            <p className="billing-copy">{ticket.description}</p>
            <button className="plain-button" onClick={()=>shared.navigate("companies",ticket.company_id)}>Open company</button>
            {ticket.resolution&&<><h3>Resolution</h3><p className="billing-copy">{ticket.resolution}</p></>}
          </article>
          <article className="surface report-card"><div className="card-title"><h2>Internal notes</h2></div>
            <form className="editor" onSubmit={event=>{
              event.preventDefault();const form=event.currentTarget;const body=new FormData(form).get("note");
              void save("support-note",{key:crypto.randomUUID(),id:ticket.id,version:ticket.version,body},"Internal note saved.",()=>form.reset());
            }}><label>New note<textarea name="note" required rows={3} maxLength={2000}/></label>
              {saveError&&<ErrorNotice message={saveError}/>}<button className="button primary" disabled={busy}>Add internal note</button></form>
          </article>
        </div>
        <article className="surface report-card"><h2>Ticket history</h2><div className="advanced-list">{detail?.data?.history.map(event=><article key={event.id}>
          <strong>{labelFor(event.action)}</strong><p className="billing-copy">{event.body}</p>
          <small>{event.actor??"Previous member"} · {dateTime(event.created_at,shared.workspace.timezone,true)}</small></article>)}</div></article>
      </>}
    </>:<>
      <Title title="Customer support" description="Track customer requests, assignments and resolution history."
        actions={<button className="button primary" onClick={()=>setEdit(true)}><Plus size={18}/>New ticket</button>}/>
      {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:<>
        <div className="kpis">{[
          ["Open tickets",data.metrics.open],["Resolved tickets",data.metrics.resolved],
          ["Average first team action",data.metrics.response_minutes===null?"—":data.metrics.response_minutes+" min"],
          ["Average resolution",data.metrics.resolution_minutes===null?"—":data.metrics.resolution_minutes+" min"],
        ].map(([label,value])=><article className="surface kpi" key={String(label)}><div><span>{label}</span></div><strong>{value}</strong></article>)}</div>
        <section className="surface report-card"><div className="advanced-filters">
          <label>Search tickets<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={100}/></label>
          <label>Status<select value={state} onChange={event=>setState(event.target.value)}><option value="">All</option>
            {statuses.map(item=><option key={item} value={item}>{labelFor(item)}</option>)}</select></label>
        </div>{results.length?<div className="table-wrap"><table><thead><tr>{["Ticket","Subject","Customer","Status","Priority"].map(title=>
          <th scope="col" key={title}>{title}</th>)}</tr></thead><tbody>{results.map(item=><tr key={item.id}>
            <th scope="row"><button className="row-link" onClick={()=>shared.navigate("support",item.id)}>{ticketNumber(item.serial)}</button></th>
            <td>{item.subject}</td><td>{item.company_name}</td><td>{labelFor(item.status)}</td><td>{labelFor(item.priority)}</td></tr>)}</tbody></table></div>:
          <Empty title="No matching tickets"/>}</section>
      </>}
    </>}
    {edit&&(!recordId||ticket)&&<TicketEditor ticket={ticket} shared={shared} close={()=>setEdit(false)}/>}
  </>;
}

type Appointment={id:string;title:string;kind:string;day:string;entity:string;owner_id:string|null;description:string;
  starts_at:string|null;ends_at:string|null;version:number;company_id:string|null;lead_id:string|null;deal_id:string|null};
type CalendarData={first:string;end:string;anchor:string;today:string;zone:string;events:Appointment[];limited:boolean};
type CalendarMode="month"|"week"|"agenda";
const eventKinds=["meeting","call","follow_up","task","deal","renewal"];

function shiftDate(input:string,mode:CalendarMode,direction:number){
  const date=new Date(input+"T00:00:00Z");
  if(mode==="month"){date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+direction);}
  else date.setUTCDate(date.getUTCDate()+direction*(mode==="week"?7:30));
  return date.toISOString().slice(0,10);
}

function endLabel(exclusive:string){
  const date=new Date(exclusive+"T00:00:00Z");
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}

function localInput(input?:string|null){
  if(!input)return "";
  const dt=new Date(input);
  return new Date(dt.getTime()-dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

function EventEditor({entry,day,shared,close}:{entry?:Appointment;day:string;shared:Shared;close:()=>void}){
  const {data:options,error:loadError}=useLoad<Options>("options",shared.workspace.id);
  const {save,busy,error}=useEngineMutation(shared);
  const [invalid,setInvalid]=useState("");
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setInvalid("");
    const form=new FormData(event.currentTarget);
    const get=(key:string)=>String(form.get(key)??"").trim();
    try{
      void save("calendar-event",{key:crypto.randomUUID(),id:entry?.id??null,version:entry?.version??0,kind:get("kind"),title:get("title"),
        starts_at:new Date(get("start")).toISOString(),ends_at:new Date(get("end")).toISOString(),description:get("description"),
        assignee_id:get("assignee"),company_id:get("company")||null,lead_id:get("lead")||null,deal_id:get("deal")||null,cancelled:form.has("cancelled")},
        form.has("cancelled")?"Event cancelled.":"Calendar event saved.",close);
    }catch(caught){setInvalid(messageOf(caught));}
  }
  return <Dialog title={entry?"Edit calendar event":"New calendar event"} onClose={()=>{if(!busy)close();}} wide>
    {loadError?<ErrorNotice message={loadError}/>:!options?<Loading/>:<form className="editor" onSubmit={submit}>
      <label>Title<input name="title" required maxLength={120} defaultValue={entry?.title}/></label>
      <div className="field-grid">
        <label>Kind<select name="kind" defaultValue={entry?.kind??"meeting"}>{eventKinds.slice(0,3).map(value=><option key={value} value={value}>{labelFor(value)}</option>)}</select></label>
        <label>Assignee<select name="assignee" required defaultValue={entry?.owner_id??shared.workspace.member_id}>
          {options.members?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Starts (device time)<input type="datetime-local" name="start" defaultValue={localInput(entry?.starts_at)||day+"T09:00"} required/></label>
        <label>Ends (device time)<input type="datetime-local" name="end" defaultValue={localInput(entry?.ends_at)||day+"T10:00"} required/></label>
        {(["companies","leads","deals"] as const).map(type=><label key={type}>{type==="companies"?"Company":type==="leads"?"Lead":"Deal"}
          <select name={type==="companies"?"company":type==="leads"?"lead":"deal"} defaultValue={(type==="companies"?entry?.company_id:type==="leads"?entry?.lead_id:entry?.deal_id)??""}>
            <option value="">None</option>{options[type]?.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>)}
      </div>
      <label>Description<textarea name="description" maxLength={2000} rows={3} defaultValue={entry?.description}/></label>
      {entry&&<label className="check"><input name="cancelled" type="checkbox"/>Cancel this event</label>}
      {(error||invalid)&&<ErrorNotice message={error||invalid}/>}
      <button className="button primary" disabled={busy}>Save event</button>
    </form>}
  </Dialog>;
}

export function SalesCalendar(shared:Shared){
  const [mode,setMode]=useState<CalendarMode>("month");
  const [anchor,setAnchor]=useState<string|null>(null);
  const [kind,setKind]=useState("");
  const [editor,setEditor]=useState<Appointment|"new"|null>(null);
  const response=useEngineData<CalendarData>("calendar",{date:anchor,mode,kind:kind||null},shared);
  const data=response?.data;
  const [owner,setOwner]=useState("");
  const {data:options}=useLoad<Options>("options",shared.workspace.id);
  function open(entry:Appointment){if(entry.entity==="calendar")setEditor(entry);else shared.navigate(entry.entity,entry.id);}
  let days:string[]=[];
  if(data&&mode!=="agenda"){
    const first=new Date(data.first+"T00:00:00Z");
    if(mode==="month")first.setUTCDate(first.getUTCDate()-(first.getUTCDay()+6)%7);
    const end=new Date(data.end+"T00:00:00Z");
    if(mode==="month")end.setUTCDate(end.getUTCDate()+(8-end.getUTCDay())%7);
    days=Array.from({length:Math.round((+end-+first)/86400000)},(_,i)=>new Date(+first+i*86400000).toISOString().slice(0,10));
  }
  const events=(data?.events??[]).filter(item=>!owner||item.owner_id===owner);
  return <>
    <Title title="Sales calendar" description={"Meetings, follow-ups, tasks, expected closes and renewals · "+shared.workspace.timezone}
      actions={<button className="button primary" onClick={()=>setEditor("new")} disabled={!data}><Plus size={18}/>New event</button>}/>
    <div className="advanced-filters">
      <label>View<select value={mode} onChange={event=>setMode(event.target.value as CalendarMode)}>
        {["month","week","agenda"].map(item=><option key={item} value={item}>{labelFor(item)}</option>)}</select></label>
      <label>Event type<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">All</option>
        {eventKinds.map(item=><option key={item} value={item}>{labelFor(item)}</option>)}</select></label>
      <label>Assignee<select value={owner} onChange={event=>setOwner(event.target.value)}><option value="">Anyone</option>
        {options?.members?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <div className="actions">
        <button className="icon-button" aria-label="Previous period" disabled={!data} onClick={()=>data&&setAnchor(shiftDate(data.anchor,mode,-1))}><ChevronLeft size={19}/></button>
        <button className="button secondary" onClick={()=>setAnchor(null)}>Today</button>
        <button className="icon-button" aria-label="Next period" disabled={!data} onClick={()=>data&&setAnchor(shiftDate(data.anchor,mode,1))}><ChevronRight size={19}/></button>
      </div>
    </div>
    {response?.error?<ErrorNotice message={response.error} action={shared.refresh}/>:!data?<Loading label="Loading calendar…"/>:
      <section className="surface report-card"><div className="card-title"><div><h2>{data.first} to {endLabel(data.end)}</h2>
        <p>{data.limited?"Showing the earliest 250 results. Choose a narrower period.":"Dates and times shown in "+data.zone}</p></div><CalendarDays size={19}/></div>
      {mode==="agenda"?events.length?<div className="advanced-list">{events.map(item=><article key={item.entity+item.id}>
        <button className="row-link" onClick={()=>open(item)}>{item.title}</button>
        <p>{item.day}{item.starts_at?" · "+dateTime(item.starts_at,data.zone,true):""} · {labelFor(item.kind)}</p></article>)}</div>:<Empty title="No events in this period"/>:
        <div className="calendar-grid">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><strong className="calendar-weekday" key={day}>{day}</strong>)}
          {days.map(day=><section className={"calendar-day"+(day===data.today?" calendar-today":"")} key={day} aria-label={day}>
            <strong>{Number(day.slice(8))}</strong>{events.filter(item=>item.day===day).map(item=><button className="calendar-entry" type="button"
              title={item.title+" · "+labelFor(item.kind)} key={item.entity+item.id} onClick={()=>open(item)}>{item.title}</button>)}
          </section>)}</div>}
      </section>}
    {editor&&data&&<EventEditor entry={editor==="new"?undefined:editor} day={data.anchor} shared={shared} close={()=>setEditor(null)}/>}
  </>;
}

type Member={member_id:string;display_name:string;member_role:string;booked_minor:string;won:number;lost:number;leads:number;converted:number;
  open_deals:number;open_tasks:number;overdue:number;target_minor:string|null;target_version:number;achievement:number|null};
type Performance={month:string;currency:string;role:string;members:Member[]};

export function TeamPerformance(shared:Shared){
  const {data,error}=useLoad<Performance>("advanced/team-performance",shared.workspace.id,shared.revision,true);
  const [editing,setEditing]=useState<Member|null>(null);
  const [validation,setValidation]=useState("");
  const {save,busy,error:saveError}=useEngineMutation(shared);
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setValidation("");
    if(!editing||!data)return;
    try {
      void save("team-member-target",{key:crypto.randomUUID(),version:editing.target_version,member_id:editing.member_id,month:data.month,
        amount_minor:minorUnits(String(new FormData(event.currentTarget).get("amount")).trim())},"Individual target updated.",()=>setEditing(null));
    }catch(error){setValidation(messageOf(error));}
  }
  return <>
    <Title title="Team performance" description="Current workloads and recorded results by owner."/>
    {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:
      <article className="surface report-card"><div className="card-title"><div><h2>{data.month.slice(0,7)} performance</h2>
        <p>Booked won deals and lead conversions for this month. Open workloads are current.</p></div><Users size={19}/></div>
        {data.members.length?<div className="table-wrap"><table><thead><tr>
          {["Team member","Leads / converted","Won / lost","Open deals","Open tasks / overdue","Booked value","Target / achievement"].map(title=>
            <th scope="col" key={title}>{title}</th>)}</tr></thead>
          <tbody>{data.members.map(member=><tr key={member.member_id}><th scope="row">{member.display_name}</th>
            <td>{member.leads} / {member.converted}</td><td>{member.won} / {member.lost}</td><td>{member.open_deals}</td>
            <td>{member.open_tasks} / {member.overdue}</td><td>{money(member.booked_minor,data.currency)}</td>
            <td>{member.target_minor?money(member.target_minor,data.currency)+" · "+member.achievement+"%":"—"}
              {data.role==="owner"&&<button className="plain-button" onClick={()=>{setValidation("");setEditing(member);}}>Set target</button>}</td>
          </tr>)}</tbody></table></div>:<Empty title="No active members"/>}</article>}
    {editing&&data&&<Dialog title={"Set sales target for "+editing.display_name} onClose={()=>{if(!busy)setEditing(null);}}>
      <form className="editor" onSubmit={submit}><label>Target ({data.currency})<input name="amount" required inputMode="decimal"
        defaultValue={editing.target_minor?majorUnits(editing.target_minor):""}/></label>
        {(saveError||validation)&&<ErrorNotice message={saveError||validation}/>}
        <button className="button primary" disabled={busy}>Save target</button></form>
    </Dialog>}
  </>;
}
