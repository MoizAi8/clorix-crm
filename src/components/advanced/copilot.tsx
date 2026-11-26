"use client";

import { useState } from "react";
import { MessageSquareText, RefreshCw, Trash2 } from "lucide-react";
import { api, messageOf } from "@/lib/client";
import { Dialog, Empty, ErrorNotice, Loading, Title, useLoad } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";

type Insight={title:string;summary:string;actions:string[];context_refs:string[];draft:string};
type Turn={id:string;conversation_id:string;action:string;status:string;response:Insight|null};
type Dataset={threads:{id:string;fixture:string}[];messages:Turn[];
  fixtures:{id:string;name:string;refs:string[]}[];actions:{id:string;label:string}[]};

export function Copilot(shared:Shared) {
  const {data,error}=useLoad<Dataset>("advanced/copilot",shared.workspace.id,shared.revision,true);
  const [thread,setThread]=useState("");
  const [fixture,setFixture]=useState("orchard");
  const [action,setAction]=useState("strategy");
  const [approved,setApproved]=useState(false);
  const [pending,setPending]=useState(false);
  const [failure,setFailure]=useState("");
  const [deleting,setDeleting]=useState(false);
  const chosen=data?.threads.find(item=>item.id===thread);
  const turns=data?.messages.filter(item=>item.conversation_id===thread)??[];

  async function run(prompt=action){
    setPending(true);setFailure("");
    try {
      const result=await api<Turn>("advanced/copilot-ask",{method:"POST",workspace:shared.workspace.id,
        body:{key:crypto.randomUUID(),fixture:chosen?.fixture??fixture,action:prompt,consent:approved,conversation_id:thread||null}});
      setThread(result.data.conversation_id);
    } catch(error){setFailure(messageOf(error));}
    finally{setPending(false);shared.refresh();}
  }

  async function remove(){
    setPending(true);setFailure("");
    try {
      await api("advanced/copilot-delete",{method:"POST",workspace:shared.workspace.id,body:{id:thread}});
      setDeleting(false);setThread("");shared.refresh();
    }catch(error){setFailure(messageOf(error));}
    finally{setPending(false);}
  }

  return <>
    <Title title="AI Sales Copilot" description="Explore Google Gemini responses for a fixed fictional sales example."/>
    {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:<>
      <div className="details-grid">
        <section className="surface report-card"><div className="card-title"><h2>Fictional lab</h2><MessageSquareText size={20}/></div>
          <form className="editor" onSubmit={event=>{event.preventDefault();void run();}}>
            <label>Conversation<select value={thread} disabled={pending} onChange={event=>setThread(event.target.value)}>
              <option value="">New conversation</option>{data.threads.map((item,i)=><option key={item.id} value={item.id}>
                {data.fixtures.find(row=>row.id===item.fixture)?.name} · Conversation {data.threads.length-i}</option>)}</select></label>
            <label>Example<select value={chosen?.fixture??fixture} disabled={!!thread||pending} onChange={event=>setFixture(event.target.value)}>
              {data.fixtures.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Supported question<select value={action} disabled={pending} onChange={event=>setAction(event.target.value)}>
              {data.actions.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="check"><input type="checkbox" checked={approved} onChange={event=>setApproved(event.target.checked)} required/>
              Send only the approved fictional example to Google Gemini.</label>
            <p className="muted">CRM records and conversation history stay in Clorix. Responses can contain errors.</p>
            {failure&&<ErrorNotice message={failure}/>}
            <button className="button primary" disabled={pending||!approved}>{pending?"Waiting for Gemini…":"Ask Gemini"}</button>
            {thread&&<button type="button" className="button secondary" disabled={pending} onClick={()=>setDeleting(true)}><Trash2 size={16}/>Delete conversation</button>}
          </form>
        </section>
        <section className="surface report-card"><div className="card-title"><h2>Conversation history</h2></div>
          {turns.length?<div className="advanced-list">{turns.map(turn=><article key={turn.id}>
            <strong>{turn.response?.title??(turn.status==="pending"?"Waiting for Gemini":"Gemini request failed")}</strong>
            <p>{data.actions.find(item=>item.id===turn.action)?.label}</p>
            {turn.response?<><p className="billing-copy">{turn.response.summary}</p><ul>{turn.response.actions.map((item,i)=><li key={i}>{item}</li>)}</ul>
              <small>Context {turn.response.context_refs.join(", ")||"—"}</small>
              {turn.response.draft&&<p className="billing-copy"><strong>Draft</strong><br/>{turn.response.draft}</p>}</>:
              turn.status==="failed"&&<button type="button" className="button secondary" disabled={pending||!approved} onClick={()=>void run(turn.action)}>
                <RefreshCw size={16}/>Retry question</button>}
          </article>)}</div>:<Empty title="No Gemini responses yet"/>}
        </section>
      </div>
    </>}
    {deleting&&<Dialog title="Delete this conversation?" onClose={()=>{if(!pending)setDeleting(false);}}>
      <p className="muted">All saved responses in this conversation will be removed.</p>
      <div className="dialog-actions"><button className="button secondary" onClick={()=>setDeleting(false)}>Cancel</button>
        <button className="button primary" disabled={pending} onClick={remove}>Delete conversation</button></div>
    </Dialog>}
  </>;
}
