"use client";

import { useState, type FormEvent } from "react";
import { Bell, CirclePlay, Plus, X } from "lucide-react";
import { api, messageOf } from "@/lib/client";
import { labelFor } from "@/lib/crm";
import type { Options, Shared } from "@/components/workspace/contracts";
import { dateTime, Dialog, Empty, ErrorNotice, Loading, Title, useLoad } from "@/components/ui/primitives";
import { useEngineMutation } from "./sales";

const triggerLabels={
  lead_created:"Lead created",lead_qualified:"Lead qualified",lead_high_score:"Lead reaches hot score",
  deal_created:"Deal created",deal_stage_changed:"Deal stage changed",deal_won:"Deal won",deal_lost:"Deal lost",
  task_completed:"Task completed",task_overdue:"Task overdue",customer_inactive:"Customer inactive",
  renewal_approaching:"Renewal approaching",
} as const;
type Trigger=keyof typeof triggerLabels;
type Condition={field:string;compare:string;value:string};
type Action={action:string;value:string};
type Definition={id:string;name:string;version:number;trigger_type:Trigger;enabled:boolean;conditions:Condition[];actions:Action[]};
type Execution={id:string;name:string;status:string;attempts:number;detail:string;updated_at:string;trigger_type:Trigger};
type WorkflowsData={role:string;workflows:Definition[];runs:Execution[];totals:{status:string;count:number}[];pending:number};

const actions=[
  ["task","Create follow-up task"],["notification","Create in-app notification"],["activity","Log a note"],
  ["lead_priority","Set lead priority"],["lead_tag","Add lead tag"],["assign","Assign record"],
] as const;
const numeric=["score","health","days","amount_minor"];
const categories=["assignment","deadline","risk","lead","renewal","workflow"];

function entity(trigger:Trigger) {
  if(trigger.startsWith("lead"))return "leads";
  if(trigger.startsWith("deal"))return "deals";
  if(trigger.startsWith("task"))return "tasks";
  return "companies";
}

function fields(trigger:Trigger) {
  if(trigger==="lead_high_score")return ["score","source","priority","owner_member_id"];
  const type=entity(trigger);
  if(type==="leads")return ["source","priority","owner_member_id"];
  if(type==="deals")return ["stage","amount_minor","owner_member_id"];
  if(type==="tasks")return ["priority","owner_member_id"];
  return ["health","days"];
}

function WorkflowEditor({existing,shared,close}:{existing?:Definition;shared:Shared;close:()=>void}) {
  const [kind,setKind]=useState<Trigger>(existing?.trigger_type??"lead_created");
  const [conditions,setConditions]=useState<Condition[]>(existing?.conditions??[]);
  const [effects,setEffects]=useState<Action[]>(existing?.actions??[{action:"task",value:""}]);
  const {error,busy,save}=useEngineMutation(shared);
  const {data:options}=useLoad<Options>("options",shared.workspace.id);
  const allowed=actions.filter(([key])=>entity(kind)==="leads"||(!key.startsWith("lead_")&&(key!=="assign"||entity(kind)==="deals")));
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    void save("workflows",{key:crypto.randomUUID(),workflow_id:existing?.id??null,version:existing?.version??0,
      name:form.get("name"),trigger_type:kind,enabled:form.has("enabled"),conditions,actions:effects},"Workflow saved.",close);
  }
  return <Dialog title={existing?"Edit workflow":"New workflow"} onClose={()=>{if(!busy)close();}} wide>
    <form className="editor" onSubmit={submit}>
      <label>Name<input name="name" defaultValue={existing?.name} maxLength={100} required/></label>
      <label>Trigger<select value={kind} onChange={event=>{
        setKind(event.target.value as Trigger);setConditions([]);setEffects([{action:"task",value:""}]);
      }}>{Object.entries(triggerLabels).map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></label>
      <label className="check"><input type="checkbox" name="enabled" defaultChecked={existing?.enabled??false}/>Active</label>
      <fieldset><legend>Conditions (optional)</legend><div className="editor">
        {conditions.map((condition,index)=>{
          const change=(patch:Partial<Condition>)=>setConditions(items=>items.map((row,i)=>i===index?{...row,...patch}:row));
          return <div key={index} className="advanced-filters">
            <label>Field<select value={condition.field} onChange={event=>change({field:event.target.value,compare:"equals",value:""})}>
              {fields(kind).map(field=><option key={field} value={field}>{labelFor(field)}</option>)}</select></label>
            <label>Comparison<select value={condition.compare} onChange={event=>change({compare:event.target.value})}>
              <option value="equals">Equals</option>{numeric.includes(condition.field)&&<>
                <option value="at_least">At least</option><option value="at_most">At most</option></>}</select></label>
            <label>Value{condition.field==="owner_member_id"?<select value={condition.value} required onChange={event=>change({value:event.target.value})}>
              <option value="">Select a member</option>{options?.members?.map(person=><option key={person.id} value={person.id}>{person.label}</option>)}</select>:
              <input value={condition.value} maxLength={100} required inputMode={numeric.includes(condition.field)?"numeric":undefined}
                onChange={event=>change({value:event.target.value})}/>}</label>
            <button className="icon-button" aria-label={"Remove condition "+(index+1)} type="button"
              onClick={()=>setConditions(rows=>rows.filter((_,i)=>i!==index))}><X size={17}/></button></div>;
        })}
        <button type="button" className="button secondary" disabled={conditions.length>=6}
          onClick={()=>setConditions(rows=>[...rows,{field:fields(kind)[0],compare:"equals",value:""}])}>Add condition</button>
      </div></fieldset>
      <fieldset><legend>Actions</legend><div className="editor">
        {effects.map((effect,index)=>{
          const change=(patch:Partial<Action>)=>setEffects(items=>items.map((row,i)=>i===index?{...row,...patch}:row));
          return <div key={index} className="advanced-filters">
            <label>Action<select aria-label={"Action "+(index+1)} value={effect.action} onChange={event=>change({action:event.target.value,value:""})}>
              {allowed.map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label>
            <label>{effect.action==="assign"?"Assignee":"Action value"}
              {effect.action==="assign"||effect.action==="lead_priority"?<select required value={effect.value} onChange={event=>change({value:event.target.value})}>
                <option value="">Choose a value</option>{effect.action==="assign"?
                  options?.members?.map(person=><option key={person.id} value={person.id}>{person.label}</option>):
                  ["low","normal","high"].map(value=><option key={value} value={value}>{labelFor(value)}</option>)}</select>:
                <input required value={effect.value} maxLength={120} onChange={event=>change({value:event.target.value})}/>}</label>
            <button className="icon-button" aria-label={"Remove action "+(index+1)} disabled={effects.length===1} type="button"
              onClick={()=>setEffects(rows=>rows.filter((_,i)=>i!==index))}><X size={17}/></button></div>;
        })}
        <button type="button" className="button secondary" disabled={effects.length>=5}
          onClick={()=>setEffects(rows=>[...rows,{action:"task",value:""}])}>Add action</button>
      </div></fieldset>
      {error&&<ErrorNotice message={error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy?"Saving…":"Save workflow"}</button></div>
    </form>
  </Dialog>;
}

function PreviewWorkflow({rule,shared,close}:{rule:Definition;shared:Shared;close:()=>void}) {
  const {data:options}=useLoad<Options>("options",shared.workspace.id);
  const [state,setState]=useState<{busy:boolean;error?:string;result?:{matches:boolean;actions:Action[]}}>({busy:false});
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const id=new FormData(event.currentTarget).get("entity");
    setState({busy:true});
    try {const {data}=await api<{matches:boolean;actions:Action[]}>("advanced/workflow-test",{method:"POST",
      body:{workflow_id:rule.id,entity_id:id},workspace:shared.workspace.id});
      setState({busy:false,result:data});
    } catch(error){setState({busy:false,error:messageOf(error)});}
  }
  return <Dialog title={"Test "+rule.name} onClose={()=>{if(!state.busy)close();}}>
    <form className="editor" onSubmit={submit}>
      <p className="muted">Check the rule against a current record. This test has no side effects.</p>
      <label>Record<select name="entity" disabled={!options} required><option value="">Choose a record</option>
        {options?.[entity(rule.trigger_type)]?.map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
      {state.error&&<ErrorNotice message={state.error}/>}
      {state.result&&<div role="status">{state.result.matches?<ul>{state.result.actions.map((action,i)=><li key={i}>{labelFor(action.action)} · {action.value}</li>)}</ul>:"These conditions did not match."}</div>}
      <button className="button primary" disabled={state.busy||!options}>{state.busy?"Testing…":"Test rule"}</button>
    </form>
  </Dialog>;
}

export function Workflows(shared:Shared) {
  const {data,error}=useLoad<WorkflowsData>("advanced/workflows",shared.workspace.id,shared.revision,true);
  const [editing,setEditing]=useState<Definition|"new"|null>(null);
  const [testing,setTesting]=useState<Definition|null>(null);
  const {save,busy,error:failure}=useEngineMutation(shared);
  const owner=data?.role==="owner";
  function modify(workflow:Definition,copy=false) {
    void save("workflows",{key:crypto.randomUUID(),workflow_id:copy?null:workflow.id,version:copy?0:workflow.version,
      name:copy?workflow.name.slice(0,92)+" (copy)":workflow.name,trigger_type:workflow.trigger_type,
      enabled:copy?false:!workflow.enabled,conditions:workflow.conditions,actions:workflow.actions},
      copy?"Workflow duplicated.":workflow.enabled?"Workflow deactivated.":"Workflow activated.");
  }
  return <>
    <Title title="Workflow studio" description="Create rules and run pending work in bounded batches."
      actions={owner&&<><button className="button secondary" disabled={busy} onClick={()=>{
        void save("workflow-evaluate",{key:crypto.randomUUID()},"Evaluation complete. Review the run history.");
      }}><CirclePlay size={17}/>Evaluate now</button><button className="button primary" onClick={()=>setEditing("new")}><Plus size={18}/>New workflow</button></>}/>
    <p className="muted">Record events are saved as they happen. Time-based rules and alerts are checked when an owner selects Evaluate now.</p>
    {failure&&<ErrorNotice message={failure}/>}
    {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:<>
      <section className="surface report-card"><div className="card-title"><div><h2>Rules</h2><p>{data.pending} pending events</p></div></div>
        {data.workflows.length?<div className="advanced-list">{data.workflows.map(rule=><article key={rule.id}>
          <div className="advanced-row"><strong>{rule.name}</strong><span className="pill">{rule.enabled?"Active":"Inactive"}</span>
            <span>{triggerLabels[rule.trigger_type]}</span></div>
          <p>{rule.conditions.length} conditions · {rule.actions.length} actions</p>
          <div className="actions"><button className="button secondary" onClick={()=>setTesting(rule)}>Test rule</button>
            {owner&&<><button className="button secondary" onClick={()=>setEditing(rule)}>Edit</button>
              <button className="button secondary" disabled={busy} onClick={()=>modify(rule,true)}>Duplicate</button>
              <button className="button secondary" disabled={busy} onClick={()=>modify(rule)}>{rule.enabled?"Deactivate":"Activate"}</button></>}</div>
        </article>)}</div>:<Empty title="No workflows yet"/>}
      </section>
      <section className="surface report-card"><div className="card-title"><div><h2>Execution history</h2>
        <p>{data.totals.length?data.totals.map(item=>labelFor(item.status)+" "+item.count).join(" · "):"No executions yet"}</p></div></div>
        {data.runs.length?<div className="table-wrap"><table><thead><tr>
          {["Workflow","Outcome","Attempts","Result","When","Action"].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.runs.map(run=><tr key={run.id}><th scope="row">{run.name}</th><td>{labelFor(run.status)}</td>
            <td>{run.attempts}</td><td>{run.detail}</td><td>{dateTime(run.updated_at,shared.workspace.timezone,true)}</td>
            <td>{owner&&run.status==="failed"&&run.attempts<3?<button className="plain-button" disabled={busy}
              onClick={()=>void save("workflow-retry",{key:crypto.randomUUID(),run_id:run.id},"Retry evaluated.")}>Retry</button>:"—"}</td></tr>)}</tbody></table></div>:
          <Empty title="No runs recorded"/>}
      </section>
    </>}
    {editing&&<WorkflowEditor existing={editing==="new"?undefined:editing} shared={shared} close={()=>setEditing(null)}/>}
    {testing&&<PreviewWorkflow rule={testing} shared={shared} close={()=>setTesting(null)}/>}
  </>;
}

type NotificationsData={items:{id:string;title:string;category:string;entity_type?:string;entity_id?:string;created_at:string;read_at?:string}[];
  unread:number;preferences:{version:number;categories:string[]}};

export function NotificationCenter(shared:Shared) {
  const {data,error}=useLoad<NotificationsData>("advanced/notifications",shared.workspace.id,shared.revision,true);
  const {save,busy,error:failure}=useEngineMutation(shared);
  function read(id?:string,unread=false){
    void save("notification-read",{key:crypto.randomUUID(),notification_id:id??null,unread},unread?"Marked as unread.":"Marked as read.");
  }
  return <>
    <Title title="Notifications" description="Workspace alerts and workflow notifications."
      actions={!!data?.unread&&<button className="button secondary" disabled={busy} onClick={()=>read()}>Mark all as read ({data.unread})</button>}/>
    {failure&&<ErrorNotice message={failure}/>}
    {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:<div className="details-grid">
      <section className="surface report-card"><div className="card-title"><h2>Inbox</h2><Bell size={19}/></div>
        {data.items.length?<div className="advanced-list">{data.items.map(item=><article key={item.id}>
          <div className="advanced-row"><strong>{item.title}</strong>{!item.read_at&&<span className="pill">Unread</span>}</div>
          <p>{labelFor(item.category)} · {dateTime(item.created_at,shared.workspace.timezone,true)}</p>
          <div className="actions">{item.entity_type&&item.entity_id&&<button className="plain-button"
            onClick={()=>shared.navigate(item.entity_type!,item.entity_id)}>Open record</button>}
            <button className="plain-button" disabled={busy} onClick={()=>read(item.id,!!item.read_at)}>{item.read_at?"Mark unread":"Mark read"}</button></div>
        </article>)}</div>:<Empty title="No notifications"/>}
      </section>
      <section className="surface report-card"><div className="card-title"><h2>Preferences</h2></div>
        <form className="editor" key={data.preferences.version} onSubmit={event=>{
          event.preventDefault();
          void save("notification-preferences",{key:crypto.randomUUID(),version:data.preferences.version,categories:new FormData(event.currentTarget).getAll("category")},
            "Notification preferences saved.");
        }}>{categories.map(category=><label className="check" key={category}><input name="category" value={category} type="checkbox"
            defaultChecked={data.preferences.categories.includes(category)}/>{labelFor(category)}</label>)}
          <button className="button primary" disabled={busy}>Save preferences</button>
        </form>
      </section>
    </div>}
  </>;
}
