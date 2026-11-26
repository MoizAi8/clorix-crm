"use client";

import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,BarChart3,Bell,BriefcaseBusiness,Building2,Check,ClipboardCheck,Columns3,FlaskConical,LayoutDashboard,
  LogOut,Menu,Search,Settings as SettingsIcon,UserRoundPlus,Users,X,
} from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { entities,entityLabels,type Entity,type SearchResult } from "@/lib/crm";
import { dateTime,Dialog,Empty,ErrorNotice,Loading,useLoad } from "@/components/ui/primitives";
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

function finderLink(result:SearchResult) { return entityLabels[result.entity].many; }

function SearchDialog({workspace,onClose,navigate}:{workspace:string;onClose:()=>void;navigate:Shared["navigate"]}) {
  const [text,setText]=useState("");
  const [query,setQuery]=useState("");
  const [active,setActive]=useState(0);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{setQuery(text.trim());setActive(0);},180);
    return ()=>window.clearTimeout(timer);
  },[text]);
  const {data,error}=useLoad<SearchResult[]>(query.length>=2?"search?q="+encodeURIComponent(query):null,workspace);
  const results=data??[];
  const open=(result:SearchResult)=>{onClose();navigate(result.entity,result.id);};
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
      {error?<ErrorNotice message={error}/>:query.length<2?<p className="muted">Enter at least two characters.</p>:!data?<Loading label="Searching…"/>:
        results.length?<div className="search-results">{results.map((item,index)=><button key={item.id} type="button"
          className={index===active?"selected":undefined} onFocus={()=>setActive(index)} onClick={()=>open(item)}>
          <strong>{item.label}</strong><small>{finderLink(item)}</small></button>)}</div>:<Empty title="No matching records"/>}
    </form>
  </Dialog>;
}

const advancedNav=[
  ["intelligence","Sales intelligence",BarChart3],["pipeline-settings","Pipeline settings",Columns3],
  ["workflows","Workflow studio",Activity],["notifications","Notifications",Bell],
] as const;

export function WorkspaceApp({advanced=false}:{advanced?:boolean}) {
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
    advanced&&advancedNav.some(entry=>entry[0]===selected)?selected:"dashboard";
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
      <nav aria-label="Workspace navigation">{[...nav,...(advanced?advancedNav:[])].map(([key,label,Icon])=><button type="button" key={key}
        aria-current={(view===key||(view==="follow-up"&&key==="tasks"))?"page":undefined}
        className={view===key||(view==="follow-up"&&key==="tasks")?"active":undefined} onClick={()=>navigate(key)}><Icon size={18}/><span>{label}</span>
      </button>)}</nav>
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
          view==="settings"?<Settings key={shared.workspace.id} {...shared}/>:
          entity&&id?<RecordDetail key={shared.workspace.id+entity+id} {...shared} entity={entity} id={id}/>:
          entity?<RecordList key={shared.workspace.id+entity} {...shared} entity={entity} create={create}/>:null}
      </main>
    </div>
    {search&&workspace&&<SearchDialog workspace={workspace.id} onClose={()=>setSearch(false)} navigate={navigate}/>}
    {notification&&<div className="toast" role="status"><Check size={19}/>{notification}<button type="button" className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotification("")}><X size={17}/></button></div>}
  </div>;
}
