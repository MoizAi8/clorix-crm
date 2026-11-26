"use client";

import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,BarChart3,Bell,BriefcaseBusiness,Building2,Check,CalendarDays,ClipboardCheck,Columns3,FlaskConical,FolderKanban,Headphones,LayoutDashboard,ReceiptText,
  LogOut,Menu,Search,Settings as SettingsIcon,UserRoundPlus,Users,X,
} from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { entities,entityLabels,type Entity,type SearchResult } from "@/lib/crm";
import { dateTime,Dialog,Empty,ErrorNotice,Loading,useLoad } from "@/components/ui/primitives";
import { Copilot } from "@/components/advanced/copilot";
import { useEngineData } from "@/components/advanced/use-engine-data";
import { Productivity } from "@/components/advanced/productivity";
import { Billing } from "@/components/advanced/billing";
import { SalesCalendar,Support,TeamPerformance } from "@/components/advanced/operations";
import { NotificationCenter, Workflows } from "@/components/advanced/workflows";
import { PipelineSettings,SalesIntelligence } from "@/components/advanced/sales";
import { Overview } from "@/components/reports/overview";
import { RecordList } from "@/components/crm/records";
import { RecordDetail } from "@/components/crm/record-detail";
import { Pipeline } from "@/components/pipeline/pipeline";
import { Settings } from "@/components/workspace/settings";
import type { Workspace } from "@/server/workspace/context";
import type { Shared } from "./contracts";

const nav=[
  ["dashboard","Dashboard",LayoutDashboard],["leads","Leads",UserRoundPlus],["contacts","Contacts",Users],
  ["companies","Companies",Building2],["deals","Deals",BriefcaseBusiness],["pipeline","Pipeline",Columns3],
  ["tasks","Tasks",ClipboardCheck],["activities","Activities",Activity],["reports","Reports",BarChart3],
  ["settings","Settings",SettingsIcon],
] as const;

type CommercialResult={id:string;entity:"quotation"|"invoice"|"catalog"|"support";label:string;qualifier:string};
type FinderResult=SearchResult|CommercialResult;
const categories={all:"All records",crm:"Core CRM",commercial:"Billing and catalog",support:"Support tickets"} as const;
const commercialNames={quotation:"Quotations",invoice:"Invoices",catalog:"Catalog",support:"Support"};
function finderLink(result:FinderResult) {
  if("qualifier" in result) return commercialNames[result.entity]+" · "+result.qualifier;
  return entityLabels[result.entity].many;
}

function highlighted(label:string,query:string) {
  const index=label.toLowerCase().indexOf(query.toLowerCase());
  if(index<0||!query)return label;
  return <>{label.slice(0,index)}<mark>{label.slice(index,index+query.length)}</mark>{label.slice(index+query.length)}</>;
}

function SearchDialog({shared,onClose,advanced}:{shared:Shared;onClose:()=>void;advanced:boolean}) {
  const {workspace,navigate}=shared;
  const [text,setText]=useState("");
  const [query,setQuery]=useState("");
  const [active,setActive]=useState(0);
  const [category,setCategory]=useState<keyof typeof categories>("all");
  useEffect(()=>{
    const timer=window.setTimeout(()=>{setQuery(text.trim());setActive(0);},180);
    return ()=>window.clearTimeout(timer);
  },[text]);
  const base=useLoad<SearchResult[]>(query.length>=2&&(category==="all"||category==="crm")?"search?q="+encodeURIComponent(query):null,workspace.id);
  const commercial=useEngineData<CommercialResult[]>("commercial-search",
    advanced&&query.length>=2&&category!=="crm"?{query,category}:null,shared);
  const searchPending=category==="crm"||!advanced?!base.data&&!base.error:
    category==="all"?(!base.data&&!base.error)||!commercial:!commercial;
  const term=query.toLowerCase();
  const rank=(result:FinderResult)=>{
    const fields=[result.label,...("qualifier" in result?[result.qualifier]:[])].map(value=>value.toLowerCase());
    return fields.includes(term)?0:fields.some(value=>value.startsWith(term))?1:2;
  };
  const results:FinderResult[]=[...(category==="all"||category==="crm"?base.data??[]:[]),...(category!=="crm"?commercial?.data??[]:[])]
    .sort((first,second)=>rank(first)-rank(second)).slice(0,24);
  const open=(result:FinderResult)=>{
    onClose();
    const route=result.entity==="quotation"||result.entity==="invoice"?"billing":result.entity;
    navigate(route,result.id);
  };
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(results[active])open(results[active]);}
  return <Dialog title="Search workspace" onClose={onClose} wide>
    <form className="search-dialog" onSubmit={submit}>
      <label><span className="sr-only">Search workspace records</span><span className="input-icon"><Search size={20}/>
        <input autoFocus value={text} onChange={event=>setText(event.target.value)} maxLength={100} placeholder="Find leads, contacts, deals and more"
          onKeyDown={event=>{
            if(!results.length)return;
            if(event.key==="ArrowDown"){event.preventDefault();setActive((active+1)%results.length);}
            if(event.key==="ArrowUp"){event.preventDefault();setActive((active+results.length-1)%results.length);}
          }}/></span></label>
      {advanced&&<label>Record category<select value={category} onChange={event=>{setCategory(event.target.value as keyof typeof categories);setActive(0);}}>
        {Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      {(base.error||commercial?.error)&&<ErrorNotice message={base.error||commercial?.error||""}/>}
      {query.length<2?<p className="muted">Enter at least two characters.</p>:
        results.length?<div className="search-results">{results.map((item,index)=><button key={item.entity+item.id} type="button"
          className={index===active?"selected":undefined} onFocus={()=>setActive(index)} onClick={()=>open(item)}>
          <strong>{highlighted(item.label,query)}</strong><small>{highlighted(finderLink(item),query)}</small></button>)}</div>:
          searchPending?<Loading label="Searching…"/>:<Empty title="No matching records"/>}
    </form>
  </Dialog>;
}

const advancedNav=[
  ["intelligence","Sales intelligence",BarChart3],["pipeline-settings","Pipeline settings",Columns3],
  ["workflows","Workflow studio",Activity],["notifications","Notifications",Bell],["billing","Billing",ReceiptText],
  ["support","Support",Headphones],["calendar","Calendar",CalendarDays],["team-performance","Team performance",Users],["productivity","Productivity",FolderKanban],
] as const;

export function WorkspaceApp({advanced=false,copilot=false}:{advanced?:boolean;copilot?:boolean}) {
  const params=useSearchParams();
  const [revision,setRevision]=useState(0);
  const [menu,setMenu]=useState(false);
  const [search,setSearch]=useState(false);
  const [notification,setNotification]=useState("");
  const [failure,setFailure]=useState("");
  const [leaving,setLeaving]=useState(false);
  const {data,error}=useLoad<{workspaces:Workspace[];name:string}>("workspaces",undefined,revision,true);
  const workspace=data?.workspaces.find(space=>space.id===params.get("space"))??data?.workspaces[0];
  const selected=params.get("view")??"dashboard";
  const view=nav.some(entry=>entry[0]===selected)||selected==="follow-up"||
    advanced&&(advancedNav.some(entry=>entry[0]===selected)||selected==="catalog"||(copilot&&selected==="copilot"))?selected:"dashboard";
  const id=params.get("id");
  const create=params.get("new")==="1";
  const entity=entities.includes(view as Entity)?view as Entity:null;

  useEffect(()=>{
    const keyboard=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setSearch(previous=>!previous);}
      if(event.key==="Escape")setMenu(false);
    };
    window.addEventListener("keydown",keyboard);
    return ()=>window.removeEventListener("keydown",keyboard);
  },[]);
  useEffect(()=>{
    if(!notification)return;
    const timer=window.setTimeout(()=>setNotification(""),5000);
    return ()=>window.clearTimeout(timer);
  },[notification]);

  function navigate(screen:string,record?:string,creating?:boolean) {
    const target=new URLSearchParams();
    if(workspace && params.get("space"))target.set("space",workspace.id);
    if(screen!=="dashboard") target.set("view",screen);
    if(record)target.set("id",record);
    if(creating)target.set("new","1");
    window.history.pushState(null,"","/workspace"+(target.size?"?"+target:""));
    setMenu(false);window.scrollTo(0,0);
  }

  function refresh(){setRevision(previous=>previous+1);}
  async function logout() {
    setLeaving(true);setFailure("");
    try{await api("access/logout",{method:"POST",body:{}});window.location.replace("/");}
    catch(caught){setFailure(messageOf(caught));setLeaving(false);}
  }
  const shared=workspace?{workspace,revision,refresh,navigate,notify:setNotification}:null;
  return <div className="app-shell">
    <a href="#workspace-content" className="skip-link">Skip to workspace content</a>
    {menu&&<button className="nav-screen" type="button" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}
    <aside className={"sidebar"+(menu?" open":"")} id="workspace-nav">
      <Link className="brand" href="/" aria-label="Clorix home"><span className="brand-mark"/><span>Clorix<span>.</span></span></Link>
      <button className="icon-button close-nav" aria-label="Close navigation" onClick={()=>setMenu(false)}><X size={20}/></button>
      <div className="side-workspace">{workspace?.name??"Workspace"}</div>
      <nav aria-label="Workspace navigation">{[...nav,...(advanced?advancedNav:[]),...(advanced&&copilot?([["copilot","AI Sales Copilot",Activity]] as const):[])].map(([key,label,Icon])=><div className="nav-item" key={key}>{key==="intelligence"&&<span className="nav-group-label">Intelligence and operations</span>}<button type="button" key={key}
        aria-current={(view===key||(view==="follow-up"&&key==="tasks"))?"page":undefined}
        className={view===key||(view==="follow-up"&&key==="tasks")?"active":undefined} onClick={()=>navigate(key)}><Icon size={18}/><span>{label}</span>
      </button></div>)}</nav>
      <div className="side-footer"><div className="avatar">{data?.name?.split(" ").slice(0,2).map(part=>part[0]).join("")??"C"}</div>
        <div><strong>{data?.name??"Clorix"}</strong><small>{workspace?workspace.role==="owner"?"Workspace owner":"Workspace member":""}</small></div>
        <button aria-label="Sign out" title="Sign out" className="icon-button" disabled={leaving} onClick={logout}><LogOut size={18}/></button>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={menu} aria-controls="workspace-nav" onClick={()=>setMenu(!menu)}><Menu size={23}/></button>
        <button className="global-search" onClick={()=>setSearch(true)} disabled={!workspace}><Search size={18}/><span>Search workspace</span><kbd>Ctrl K</kbd></button>
        {data&&data.workspaces.length>1&&<label className="workspace-picker"><span className="sr-only">Select workspace</span><select value={workspace?.id??""}
          onChange={event=>window.history.pushState(null,"","/workspace?space="+encodeURIComponent(event.target.value))}>
            {data.workspaces.map(space=><option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}
        {workspace?.kind==="sandbox"&&<span className="sandbox-pill"><FlaskConical size={16}/><span>Live sandbox</span></span>}
        <button className="icon-button mobile-logout" aria-label="Sign out" disabled={leaving} onClick={logout}><LogOut size={19}/></button>
      </header>
      <main id="workspace-content" className="workspace-content" tabIndex={-1}>
        {failure&&<ErrorNotice message={failure}/>}
        {workspace?.expires_at&&<div className="sandbox-banner"><FlaskConical size={17}/><span><strong>Synthetic workspace.</strong> Use fictional data only. Expires {dateTime(workspace.expires_at,workspace.timezone,true)} ({workspace.timezone}).</span></div>}
        {error?<ErrorNotice message={error} action={refresh}/>:!data?<Loading/>:!shared?<div className="surface report-card">
          <Empty title="No active workspace">Your sandbox may have expired or your workspace access changed.</Empty>
          <button className="button secondary" onClick={logout} disabled={leaving}>Sign out</button></div>:
          view==="dashboard"||view==="reports"||view==="follow-up"?<Overview key={shared.workspace.id+view} {...shared} reports={view==="reports"} followOnly={view==="follow-up"}/>:
          view==="pipeline"?<Pipeline key={shared.workspace.id} {...shared} advanced={advanced}/>:
          view==="intelligence"?<SalesIntelligence key={shared.workspace.id} {...shared}/>:
          view==="pipeline-settings"?<PipelineSettings key={shared.workspace.id} {...shared}/>:
          view==="workflows"?<Workflows key={shared.workspace.id} {...shared}/>:
          view==="notifications"?<NotificationCenter key={shared.workspace.id} {...shared}/>:
          view==="productivity"?<Productivity key={shared.workspace.id} {...shared}/>:
          view==="catalog"?<Billing key={shared.workspace.id+(id??"")+"catalog"} {...shared} recordId={id??undefined} catalogOnly/>:
          view==="billing"?<Billing key={shared.workspace.id} {...shared} recordId={id??undefined}/>:
          view==="copilot"?<Copilot key={shared.workspace.id} {...shared}/>:
          view==="support"?<Support key={shared.workspace.id+(id??"")} {...shared} recordId={id??undefined}/>:
          view==="calendar"?<SalesCalendar key={shared.workspace.id} {...shared}/>:
          view==="team-performance"?<TeamPerformance key={shared.workspace.id} {...shared}/>:
          view==="settings"?<Settings key={shared.workspace.id} {...shared}/>:
          entity&&id?<RecordDetail key={shared.workspace.id+entity+id} {...shared} entity={entity} id={id} advanced={advanced}/>:
          entity?<RecordList key={shared.workspace.id+entity} {...shared} entity={entity} create={create} advanced={advanced}/>:null}
      </main>
    </div>
    {search&&shared&&<SearchDialog shared={shared} onClose={()=>setSearch(false)} advanced={advanced}/>}
    {notification&&<div className="toast" role="status"><Check size={19}/>{notification}<button type="button" className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotification("")}><X size={17}/></button></div>}
  </div>;
}
