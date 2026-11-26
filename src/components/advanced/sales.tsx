"use client";

import { useRef, useState, type FormEvent } from "react";
import { BarChart3, CalendarClock, ChevronDown, ChevronUp, Plus, Settings2 } from "lucide-react";
import { api, messageOf } from "@/lib/client";
import { labelFor, majorUnits, minorUnits, money } from "@/lib/crm";
import { dateTime, Dialog, Empty, ErrorNotice, Loading, Title, useLoad } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";

type Factor={factor:string;weight:number;signal:number;explanation:string;missing:boolean};
type Score={id:string;name:string;score:number;coverage:number;classification:string;recommended:string;factors:Factor[];
  tags:string[];version:number;last?:string;priority?:string;source?:string;lifecycle?:string;renewal_date?:string;notes?:string};
type Risk={id:string;title:string;stage:string;pipeline:string|null;stage_age:number;configured_amount_minor:string;
  expected_close_date:string|null;risk:number;classification:string;factors:{reason:string;points:number}[];probability:Record<string,number>};
type Month={month:string;closed_won_minor:string;expected_minor:string;conservative_minor:string;best_case_minor:string;
  target:{amount_minor:string;version:number}|null};
type Settings={version:number;lead:Record<string,number>;health:Record<string,number>};
type Snapshot={
  generated_for:string;currency:string;role:string;settings:Settings;leads:Score[];customers:Score[];risks:Risk[];
  unscheduled_minor:string;series:Month[];
  source_performance:{source:string;leads:number;conversions:number}[];
  lost_reasons:{reason:string;count:number}[];
  bottlenecks:{pipeline:string;stage:string;count:number;stalled:number;amount_minor:string}[];
  insights:{closed_won_minor:string;won_count:number;lost_count:number;average_deal_minor:string|null;average_sales_days:number|null;
    growth_percent:number|null;win_rate:number|null;month_expected_minor:string;quarter_expected_minor:string};
};
type Tab="Forecast"|"Lead scores"|"Deal risk"|"Customer health";
const tabs:Tab[]=["Forecast","Lead scores","Deal risk","Customer health"];

export function useEngineMutation({workspace,notify,refresh}:Shared) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const pending=useRef<{fingerprint:string;key:string}|null>(null);

  async function save(path:string, input:Record<string,unknown>, message:string, finish:()=>void=()=>{}) {
    setError("");setBusy(true);
    try {
      const {key,...parameters}=input;
      const fingerprint=JSON.stringify([path,parameters]);
      if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,key:String(key??crypto.randomUUID())};
      await api("advanced/"+path,{method:"POST",body:{...parameters,key:pending.current.key},workspace:workspace.id});
      pending.current=null;
      notify(message);finish();refresh();
    } catch(caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return {error,busy,save};
}

function Description({factors}:{factors:Factor[]}) {
  return <details className="advanced-explanation"><summary>Scoring explanation</summary>
    <ul>{factors.map(factor=><li key={factor.factor}><strong>{labelFor(factor.factor)} · {factor.weight}% weight</strong>
      <span>{factor.explanation}{factor.missing?" · Missing input":""}</span></li>)}</ul>
  </details>;
}

function Scores({rows,tab,shared,edit}:{rows:Score[];tab:Tab;shared:Shared;edit:(row:Score)=>void}) {
  const [search,setSearch]=useState("");
  const [band,setBand]=useState("");
  const lead=tab==="Lead scores";
  const visible=rows.filter(row=>(!band||row.classification===band)&&
    [row.name,row.source,...row.tags].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="surface report-card">
    <div className="card-title"><div><h2>{tab}</h2><p>{lead?"Ranked by score. Active leads only.":"Lowest scores first. Review missing data before acting."}</p></div></div>
    <div className="advanced-filters">
      <label>Find {lead?"leads":"customers"}<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Name or tag"/></label>
      <label>Classification<select value={band} onChange={event=>setBand(event.target.value)}><option value="">All</option>
        {(lead?["hot","warm","cold"]:["review","healthy","watch","at_risk"]).map(value=><option key={value} value={value}>{labelFor(value)}</option>)}</select></label>
    </div>
    {visible.length?<div className="advanced-list">{visible.map(row=><article key={row.id}>
      <div className="advanced-row"><button className="row-link" type="button" onClick={()=>shared.navigate(lead?"leads":"companies",row.id)}>{row.name}</button>
        <span className="pill">{labelFor(row.classification)}</span><strong>{row.score}/100</strong>
        <button type="button" className="button secondary" onClick={()=>edit(row)}>Edit profile</button></div>
      <p>{row.recommended} · {row.coverage}% input coverage</p>
      <small>Last contact {dateTime(row.last,shared.workspace.timezone)}{row.tags.length?" · "+row.tags.join(", "):""}
        {row.renewal_date?" · Renewal "+row.renewal_date:""}</small>
      <Description factors={row.factors}/>
    </article>)}</div>:<Empty title="No matching records"/>}
  </section>;
}

function RiskList({rows,navigate,currency}:{rows:Risk[];navigate:Shared["navigate"];currency:string}) {
  return <section className="surface report-card"><div className="card-title"><div><h2>Deal risk</h2>
    <p>Risk factors use recorded stage age, outreach and expected close dates.</p></div></div>
    {rows.length?<div className="advanced-list">{rows.map(row=><article key={row.id}>
      <div className="advanced-row"><button className="row-link" onClick={()=>navigate("deals",row.id)}>{row.title}</button>
        <span className="pill">{labelFor(row.classification)} risk</span><strong>{row.risk} points</strong></div>
      <p>{row.pipeline??"Default pipeline"} · {row.stage} · {row.stage_age} days in stage · {money(row.configured_amount_minor,currency)}</p>
      <small>Expected probability {row.probability.expected}% · Expected close {row.expected_close_date??"—"}</small>
      {row.factors.length>0&&<ul>{row.factors.map(factor=><li key={factor.reason}>{factor.reason} · {factor.points} points</li>)}</ul>}
    </article>)}</div>:<Empty title="No open deals"/>}
  </section>;
}

function Forecast({data,edit}:{data:Snapshot;edit:(month:Month)=>void}) {
  const {currency,insights}=data;
  const today=data.generated_for.slice(0,7)+"-01";
  return <>
    <div className="kpis">{[
      ["Expected this month",money(insights.month_expected_minor,currency),"Risk-adjusted open deals"],
      ["Expected this quarter",money(insights.quarter_expected_minor,currency),"Remaining scheduled opportunities"],
      ["Booked value",money(insights.closed_won_minor,currency),"Current closed wins over six months"],
      ["Win rate",insights.win_rate===null?"—":insights.win_rate+"%","Won deals ÷ all closed deals"],
    ].map(([label,value,detail],index)=><article key={label} className={"kpi surface"+(index===0?" kpi-featured":"")}>
      <div><span>{label}</span><BarChart3 size={17}/></div><strong>{value}</strong><small>{detail}</small></article>)}</div>
    <section className="surface report-card"><div className="card-title"><div><h2>Monthly forecast scenarios</h2>
      <p>Estimates use configured probabilities and recorded risk. {money(data.unscheduled_minor,currency)} is overdue or unscheduled.</p></div><CalendarClock size={20}/></div>
      <div className="table-wrap"><table>
        <thead><tr>{["Month","Booked value","Conservative","Expected","Best case","Target","Achievement"].map(item=><th scope="col" key={item}>{item}</th>)}</tr></thead>
        <tbody>{data.series.filter(row=>row.month>=today&&row.month<=data.series[11].month||row.month<today&&row.closed_won_minor!=="0").map(row=><tr key={row.month}>
          <th scope="row">{row.month.slice(0,7)}</th><td>{money(row.closed_won_minor,currency)}</td>
          {[row.conservative_minor,row.expected_minor,row.best_case_minor].map((value,index)=><td key={index}>{money(value,currency)}</td>)}
          <td>{data.role==="owner"?<button className="plain-button" onClick={()=>edit(row)} aria-label={"Edit target "+row.month}>
            {row.target?money(row.target.amount_minor,currency):"Set target"}</button>:row.target?money(row.target.amount_minor,currency):"—"}</td>
          <td>{row.target?String((100n*BigInt(row.closed_won_minor)+BigInt(row.target.amount_minor)/2n)/BigInt(row.target.amount_minor))+"%":"—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <div className="details-grid">
      <section className="surface report-card"><div className="card-title"><h2>Sales outcomes</h2></div>
        <dl className="detail-fields">
          <div><dt>Average won deal</dt><dd>{insights.average_deal_minor?money(insights.average_deal_minor,currency):"—"}</dd></div>
          <div><dt>Average sales cycle</dt><dd>{insights.average_sales_days===null?"—":insights.average_sales_days+" days"}</dd></div>
          <div><dt>Booked growth</dt><dd>{insights.growth_percent===null?"—":insights.growth_percent+"%"}</dd></div>
          <div><dt>Won / lost</dt><dd>{insights.won_count} / {insights.lost_count}</dd></div>
        </dl>
        {data.lost_reasons.length>0&&<><h3>Recorded loss reasons</h3><ul>{data.lost_reasons.map(item=><li key={item.reason}>{item.reason} · {item.count}</li>)}</ul></>}
      </section>
      <section className="surface report-card"><div className="card-title"><h2>Lead sources</h2></div>
        {data.source_performance.length?<div className="table-wrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Leads</th><th scope="col">Converted</th></tr></thead>
          <tbody>{data.source_performance.map(row=><tr key={row.source}><th scope="row">{row.source}</th><td>{row.leads}</td>
            <td>{row.conversions} · {Math.round(100*row.conversions/row.leads)}%</td></tr>)}</tbody></table></div>:<Empty title="No source history"/>}
      </section>
    </div>
    <section className="surface report-card"><div className="card-title"><h2>Stage bottlenecks</h2></div>
      {data.bottlenecks.length?<div className="table-wrap"><table><thead><tr><th scope="col">Stage</th><th scope="col">Open</th><th scope="col">21+ days</th><th scope="col">Value</th></tr></thead>
        <tbody>{data.bottlenecks.map(row=><tr key={row.pipeline+row.stage}><th scope="row">{row.pipeline} · {row.stage}</th>
          <td>{row.count}</td><td>{row.stalled}</td><td>{money(row.amount_minor,currency)}</td></tr>)}</tbody></table></div>:<Empty title="No open pipeline"/>}
    </section>
  </>;
}

type Edit={kind:"weights"}|{kind:"lead"|"customer";row:Score}|{kind:"target";month:Month};

function SalesEdit({edit,data,close,shared}:{edit:Edit;data:Snapshot;close:()=>void;shared:Shared}) {
  const {busy,error,save}=useEngineMutation(shared);
  const [local,setLocal]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setLocal("");
    const fields=new FormData(event.currentTarget);
    const value=(name:string)=>String(fields.get(name)??"").trim();
    const key=crypto.randomUUID();
    try {
      if(edit.kind==="weights") {
        const weights=(group:"lead"|"health")=>Object.fromEntries(Object.keys(data.settings[group]).map(name=>[name,Number(value(group+"-"+name))]));
        await save("scoring",{key,version:data.settings.version,lead:weights("lead"),health:weights("health")},"Scoring weights updated.",close);
      } else if(edit.kind==="target") {
        await save("sales-target",{key,version:edit.month.target?.version??0,month:edit.month.month,amount_minor:minorUnits(value("amount"))},"Sales target saved.",close);
      } else {
        const tags=value("tags").split(",").map(tag=>tag.trim()).filter(Boolean);
        const body={key,version:edit.row.version,tags};
        if(edit.kind==="lead") await save("lead-profile",{...body,lead_id:edit.row.id,priority:value("priority")},"Lead profile saved.",close);
        else await save("customer-profile",{...body,company_id:edit.row.id,lifecycle:value("lifecycle"),renewal_date:value("renewal")||null,notes:value("notes")},"Customer profile saved.",close);
      }
    } catch(caught){setLocal(messageOf(caught));}
  }
  const item="row" in edit?edit.row:null;
  return <Dialog title={edit.kind==="weights"?"Scoring weights":edit.kind==="target"?"Monthly sales target":"Edit "+item?.name} onClose={()=>{if(!busy)close();}} wide>
    <form className="editor" onSubmit={submit}>
      {edit.kind==="weights"?<>
        <p className="muted">Each group must add up to 100. Missing inputs reduce coverage.</p>
        {(["lead","health"] as const).map(group=><fieldset key={group}><legend>{group==="lead"?"Lead scoring":"Customer health"}</legend>
          <div className="field-grid">{Object.entries(data.settings[group]).map(([name,value])=>
            <label key={name}>{labelFor(name)}<input type="number" min={0} max={100} step={1} required name={group+"-"+name} defaultValue={value}/></label>)}</div></fieldset>)}
      </>:edit.kind==="target"?<label>Target for {edit.month.month.slice(0,7)} ({data.currency})
        <input inputMode="decimal" name="amount" required defaultValue={edit.month.target?majorUnits(edit.month.target.amount_minor):""}/></label>:<>
        {edit.kind==="lead"?<label>Priority<select name="priority" defaultValue={item?.priority}>
          {["low","normal","high"].map(value=><option key={value} value={value}>{labelFor(value)}</option>)}</select></label>:<>
          <label>Customer lifecycle<select name="lifecycle" defaultValue={item?.lifecycle}>
            {["prospect","onboarding","active","renewal","former"].map(value=><option key={value} value={value}>{labelFor(value)}</option>)}</select></label>
          <label>Renewal date<input name="renewal" type="date" defaultValue={item?.renewal_date??""}/></label>
          <label>Relationship notes<textarea name="notes" maxLength={1500} rows={3} defaultValue={item?.notes}/></label>
        </>}
        <label>Tags, separated by commas<input name="tags" maxLength={400} defaultValue={item?.tags.join(", ")}/></label>
      </>}
      {(local||error)&&<ErrorNotice message={local||error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy?"Saving…":"Save"}</button></div>
    </form>
  </Dialog>;
}

export function SalesIntelligence(shared:Shared) {
  const [tab,setTab]=useState<Tab>("Forecast");
  const [edit,setEdit]=useState<Edit|null>(null);
  const {data,error}=useLoad<Snapshot>("advanced/intelligence",shared.workspace.id,shared.revision,true);
  return <>
    <Title title="Sales intelligence" description="Explainable scores and forecasts calculated from workspace activity."
      actions={data?.role==="owner"&&<button className="button secondary" onClick={()=>setEdit({kind:"weights"})}><Settings2 size={17}/>Scoring weights</button>}/>
    <nav className="advanced-tabs" aria-label="Sales intelligence views">{tabs.map(item=><button type="button"
      className="button secondary" key={item} aria-pressed={tab===item} onClick={()=>setTab(item)}>{item}</button>)}</nav>
    {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading label="Calculating workspace intelligence…"/>:
      tab==="Forecast"?<Forecast data={data} edit={month=>setEdit({kind:"target",month})}/>:
      tab==="Deal risk"?<RiskList rows={data.risks} navigate={shared.navigate} currency={data.currency}/>:
      <Scores key={tab} rows={tab==="Lead scores"?data.leads:data.customers} tab={tab} shared={shared}
        edit={row=>setEdit({kind:tab==="Lead scores"?"lead":"customer",row})}/>}
    {edit&&data&&<SalesEdit edit={edit} data={data} close={()=>setEdit(null)} shared={shared}/>}
  </>;
}

type ConfigStage={id?:string;name:string;kind:"open"|"won"|"lost";probability:number;version:number};
type PipelineGroup={id:string|null;name:string;version:number;stages:ConfigStage[]};
type Groups={role:string;pipelines:PipelineGroup[]};

function StageEditor({pipeline,shared,close}:{pipeline:PipelineGroup;shared:Shared;close:()=>void}) {
  const [stages,setStages]=useState(pipeline.stages.map(stage=>({...stage,editKey:stage.id??crypto.randomUUID()})));
  const {error,busy,save}=useEngineMutation(shared);
  function update(index:number, patch:Partial<ConfigStage>) {
    setStages(values=>values.map((item,i)=>i===index?{...item,...patch}:item));
  }
  function shift(index:number,by:number) {
    setStages(values=>{
      const list=values.slice();
      [list[index],list[index+by]]=[list[index+by],list[index]];
      return list;
    });
  }
  return <Dialog title={"Stages for "+pipeline.name} onClose={()=>{if(!busy)close();}} wide>
    <form className="editor" onSubmit={event=>{
      event.preventDefault();
      void save("stages",{key:crypto.randomUUID(),version:pipeline.version,pipeline_id:pipeline.id,
        stages:stages.map(({id,name,kind,probability,version})=>({id:id??null,name,kind,probability,version}))},"Pipeline stages saved.",close);
    }}>
      <p className="muted">Reorder stages, adjust open-stage probability, or add a new open stage. Existing outcomes and history stay linked.</p>
      {stages.map((stage,index)=><div key={stage.editKey} className="stage-editor-row">
        <label>Stage name<input required maxLength={80} value={stage.name} onChange={event=>update(index,{name:event.target.value})}/></label>
        <label>Probability %<input type="number" min={0} max={100} step={1} disabled={stage.kind!=="open"} required value={stage.probability}
          onChange={event=>update(index,{probability:Number(event.target.value)})}/></label>
        <button type="button" className="icon-button" aria-label={"Move "+stage.name+" up"} disabled={!index} onClick={()=>shift(index,-1)}><ChevronUp size={18}/></button>
        <button type="button" className="icon-button" aria-label={"Move "+stage.name+" down"} disabled={index===stages.length-1} onClick={()=>shift(index,1)}><ChevronDown size={18}/></button>
      </div>)}
      <button type="button" className="button secondary" disabled={stages.length>=14} onClick={()=>setStages(values=>[
        ...values,{editKey:crypto.randomUUID(),name:"",kind:"open",probability:50,version:0},
      ])}><Plus size={16}/>Add open stage</button>
      {error&&<ErrorNotice message={error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy?"Saving…":"Save stages"}</button></div>
    </form>
  </Dialog>;
}

export function PipelineSettings(shared:Shared) {
  const {data,error}=useLoad<Groups>("advanced/pipelines",shared.workspace.id,shared.revision,true);
  const [editing,setEditing]=useState<PipelineGroup|null>(null);
  const {save,busy,error:saveError}=useEngineMutation(shared);
  function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;const name=new FormData(form).get("name");
    void save("pipelines",{key:crypto.randomUUID(),version:0,name},"Sales pipeline created.",()=>form.reset());
  }
  return <>
    <Title title="Pipeline settings" description="Configure sales stages, order and forecast probabilities."/>
    {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:<>
      {data.role==="owner"&&<section className="surface report-card"><h2>Create sales pipeline</h2>
        <form className="advanced-filters" onSubmit={create}><label>Pipeline name<input name="name" maxLength={80} required/></label>
          <button className="button primary" disabled={busy}><Plus size={16}/>Create pipeline</button></form></section>}
      {saveError&&<ErrorNotice message={saveError}/>}
      {data.pipelines.map(group=><article className="surface report-card" key={group.id??"default"}>
        <div className="card-title"><h2>{group.name}</h2>{data.role==="owner"&&<button type="button" className="button secondary" onClick={()=>setEditing(group)}>Edit stages</button>}</div>
        {group.id&&data.role==="owner"&&<form className="advanced-filters" key={group.version} onSubmit={event=>{
          event.preventDefault();const name=new FormData(event.currentTarget).get("name");
          void save("pipelines",{key:crypto.randomUUID(),version:group.version,pipeline_id:group.id,name},"Pipeline renamed.");
        }}><label>Pipeline name<input name="name" defaultValue={group.name} maxLength={80} required/></label>
          <button className="button secondary" disabled={busy}>Rename</button></form>}
        <div className="actions">{group.stages.map(stage=><span key={stage.id} className="pill">{stage.name} · {stage.probability}%</span>)}</div>
      </article>)}
    </>}
    {editing&&<StageEditor pipeline={editing} shared={shared} close={()=>setEditing(null)}/>}
  </>;
}
