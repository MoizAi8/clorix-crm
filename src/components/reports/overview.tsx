"use client";

import { useState,type FormEvent,type ReactNode } from "react";
import { Activity,ArrowUpRight,BriefcaseBusiness,CalendarDays,ChartNoAxesCombined,CircleCheck,Clock,Plus,Users } from "lucide-react";
import { labelFor,money } from "@/lib/crm";
import { dateTime,Empty,ErrorNotice,Loading,Title,useLoad } from "@/components/ui/primitives";
import type { Report } from "@/server/reporting";
import type { Shared } from "@/components/workspace/contracts";

function Kpi({name,value,detail,icon,featured=false}:{name:string;value:string|number;detail:string;icon:ReactNode;featured?:boolean}) {
  return <article className={"surface kpi"+(featured?" kpi-featured":"")}>
    <div><span>{name}</span>{icon}</div><strong>{value}</strong><small>{detail}</small></article>;
}

function WonChart({report,currency}:{report:Report;currency:string}) {
  const max=report.trend.reduce((acc,row)=>BigInt(row.amount_minor)>acc?BigInt(row.amount_minor):acc,0n);
  const coords=report.trend.map((row,index)=>{
    const x=report.trend.length===1?310:30+index*560/(report.trend.length-1);
    const y=145-(max?Number(BigInt(row.amount_minor)*12000n/max)/100:0);
    return [x,y] as const;
  });
  const path=coords.map(([x,y],index)=>(index===0?"M":"L")+x+" "+y).join(" ");
  const month=(value:string)=>new Intl.DateTimeFormat("en",{month:"short",timeZone:"UTC"}).format(new Date(value+"-01T00:00:00Z"));
  return <article className="surface report-card">
    <div className="card-title"><div><h2>Won deal value</h2><p>Booked value in the selected period</p></div><ChartNoAxesCombined size={20}/></div>
    <strong className="chart-total">{money(report.won_minor,currency)}</strong>
    {max>0n?<div className="plot"><svg viewBox="0 0 620 170" role="img" aria-label="Won deal value by month. Values are in the table below.">
      <path d="M30 25H590 M30 65H590 M30 105H590 M30 145H590" stroke="#dce5e0" fill="none"/>
      {coords.length>1&&<path d={path+" L590 145 L30 145 Z"} fill="#eaf8f0"/>}
      <path d={path} stroke="#205b49" strokeWidth="3" fill="none" strokeLinejoin="round"/>
      {coords.length<=12&&coords.map(([x,y],index)=><circle key={report.trend[index].month} cx={x} cy={y} r="4" fill="#205b49" stroke="white" strokeWidth="2"/>)}
    </svg><div className="chart-months">{report.trend.filter((_,i)=>report.trend.length<=8||i%Math.ceil(report.trend.length/8)===0).map(row=><span key={row.month}>{month(row.month)}</span>)}</div></div>
      :<Empty title="No wins in this period">Closed-won deals are shown here as they’re recorded.</Empty>}
    <details className="chart-data"><summary>View monthly data</summary><table><caption className="sr-only">Monthly closed-won deal totals</caption>
      <thead><tr><th scope="col">Month</th><th scope="col">Won deals</th><th scope="col">Value</th></tr></thead>
      <tbody>{report.trend.map(row=><tr key={row.month}><td>{row.month}</td><td>{row.count}</td><td>{money(row.amount_minor,currency)}</td></tr>)}</tbody>
    </table></details>
  </article>;
}

export function Overview({workspace,revision,refresh,navigate,reports=false,followOnly=false}:{reports?:boolean;followOnly?:boolean}&Shared) {
  const [range,setRange]=useState("");
  const {data,error}=useLoad<Report>((reports?"reports":"dashboard")+range,workspace.id,revision);
  const currency=workspace.currency;
  function dates(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values=new FormData(event.currentTarget);
    setRange("?"+new URLSearchParams({from:String(values.get("from")),to:String(values.get("to"))}).toString());
  }
  return <>
    <Title title={followOnly?"Follow-up queue":reports?"Reports":"Business overview"}
      description={followOnly?"Ordered by due dates and recent activity.":reports?"Review current pipeline and closed deal outcomes.":"Keep track of your pipeline and customer relationships."}
      actions={!reports&&!followOnly&&<button className="button primary" onClick={()=>navigate("leads",undefined,true)}><Plus size={19}/>New lead</button>}/>
    {error?<ErrorNotice message={error} action={()=>{if(range)setRange("");else refresh();}}/>:!data?<Loading/>:<>
      {!followOnly&&<>
        <form className="date-toolbar" key={data.from+"|"+data.to} onSubmit={dates}>
          <CalendarDays size={19}/><label>From <input type="date" name="from" defaultValue={data.from} required/></label>
          <label>Through <input type="date" name="to" defaultValue={data.to} required/></label>
          <button className="button secondary">Apply date range</button>{range&&<button type="button" className="plain-button" onClick={()=>setRange("")}>Reset</button>}
        </form>
        <div className="kpis">
          <Kpi name="Open pipeline" value={money(data.open_minor,currency)} detail="Current open opportunities" icon={<BriefcaseBusiness size={18}/>} featured/>
          <Kpi name="Active leads" value={data.active_leads} detail="Current, across all dates" icon={<Users size={18}/>}/>
          <Kpi name="Deals won" value={data.won_count} detail="In selected date range" icon={<CircleCheck size={18}/>}/>
          <Kpi name="Win rate" value={data.won_count+data.lost_count?Math.round(100*data.won_count/(data.won_count+data.lost_count))+"%":"N/A"}
            detail="Won ÷ all closed in range" icon={<ChartNoAxesCombined size={18}/>}/>
        </div>
        <div className="dashboard-grid">
          <WonChart report={data} currency={currency}/>
          <article className="surface report-card"><div className="card-title"><div><h2>Sales pipeline</h2><p>Current counts and values</p></div>
            <button type="button" className="icon-button" aria-label="Open pipeline" onClick={()=>navigate("pipeline")}><ArrowUpRight size={18}/></button></div>
            <div className="stage-breakdown">{data.stages.map(stage=>{
              const max=Math.max(1,...data.stages.map(v=>v.count));
              return <div key={stage.id}><div><span>{stage.name} <small>· {stage.count}</small></span><strong>{money(stage.amount_minor,currency)}</strong></div>
                <progress value={stage.count} max={max} aria-label={stage.name+" deal count"}/></div>;
            })}</div>
            <div className="forecast"><span>Weighted forecast <small>Estimate from open deal probabilities</small></span><strong>{money(data.weighted_minor,currency)}</strong></div>
          </article>
        </div>
      </>}
      {!reports&&<div className={followOnly?"":"dashboard-grid"}>
        {!followOnly&&<article className="surface report-card"><div className="card-title"><div><h2>Recent deals</h2><p>Most recently updated</p></div>
          <button type="button" className="button secondary" onClick={()=>navigate("deals")}>View deals</button></div>
          {data.recent.length?<div className="report-list">{data.recent.map(deal=><button key={deal.id} onClick={()=>navigate("deals",deal.id)}>
            <strong>{deal.title}</strong><span className="pill">{deal.stage_name}</span><b>{money(deal.amount_minor,currency)}</b>
          </button>)}</div>:<Empty title="No deals yet"/>}</article>}
        <article className="surface report-card follow-panel"><div className="card-title"><div><h2>{followOnly?"Prioritized records":"Follow-up queue"}</h2>
          <p>Rules-based · {data.overdue} overdue · {data.upcoming} due this week</p></div><Clock size={20}/></div>
          {data.follow_up.length?<div className="report-list">{data.follow_up.slice(0,followOnly?20:4).map(item=><button key={item.id} onClick={()=>navigate(item.entity,item.id)}>
            <strong>{item.title}</strong><small>{item.reason}</small>{followOnly&&item.due_at&&<span>{dateTime(item.due_at,workspace.timezone)}</span>}
          </button>)}</div>:<Empty title="You’re caught up"/>}
          {!followOnly&&<button className="plain-button" onClick={()=>navigate("follow-up")}>View follow-up queue <ArrowUpRight size={14}/></button>}
        </article>
      </div>}
      {!reports&&!followOnly&&<article className="surface report-card"><div className="card-title"><div><h2>Recent activity</h2><p>Latest interactions in this workspace</p></div><Activity size={20}/></div>
        {data.activity.length?<div className="report-list">{data.activity.map(item=><button key={item.id} onClick={()=>navigate("activities",item.id)}>
          <strong>{String(item.summary)}</strong><span className="pill">{labelFor(item.kind)}</span><small>{dateTime(item.occurred_at,workspace.timezone)}</small>
        </button>)}</div>:<Empty title="No activity logged"/>}</article>}
    </>}
  </>;
}
