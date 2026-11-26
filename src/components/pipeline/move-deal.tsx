"use client";

import { useState,type FormEvent } from "react";
import { api,messageOf } from "@/lib/client";
import type { RecordRow,Stage } from "@/lib/crm";
import { Dialog,ErrorNotice } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";

export function MoveDeal({deal,stages,target,before,close,workspace,refresh,notify}:{deal:RecordRow;stages:Stage[];target?:string;before?:string;close:()=>void}&Shared) {
  const [selected,setSelected]=useState(target ?? "");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const lost=stages.some(stage=>stage.id===selected&&stage.kind==="lost");
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");
    const reason=String(new FormData(event.currentTarget).get("reason")??"").trim();
    try {
      await api("deals/"+deal.id+"/move",{method:"POST",workspace:workspace.id,
        body:{stage_id:selected,expected_version:deal.version,...(lost?{reason}:{}),...(before&&selected===target?{before_id:before}:{})}});
      notify("Deal moved.");refresh();close();
    } catch(caught) {setError(messageOf(caught));setBusy(false);}
  }
  return <Dialog title="Move deal" onClose={()=>{if(!busy) close();}}>
    <form className="editor" onSubmit={submit}>
      <p className="muted">{deal.title}</p>
      <label>New stage<select autoFocus value={selected} onChange={event=>setSelected(event.target.value)} required>
        <option value="">Choose a stage</option>{stages.filter(stage=>stage.id!==deal.stage_id || stage.id===target).map(stage=>
          <option key={stage.id} value={stage.id}>{stage.name}</option>)}
      </select></label>
      {lost&&<label>Lost reason<textarea name="reason" maxLength={500} rows={3} required/></label>}
      {error&&<ErrorNotice message={error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy?"Moving…":"Move deal"}</button></div>
    </form>
  </Dialog>;
}
