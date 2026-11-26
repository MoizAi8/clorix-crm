"use client";

import { useState,type FormEvent } from "react";
import { api,messageOf } from "@/lib/client";
import { minorUnits,type RecordRow } from "@/lib/crm";
import { Dialog,ErrorNotice,Loading,useLoad } from "@/components/ui/primitives";
import type { Options,Shared } from "@/components/workspace/contracts";

export function ConvertLead({lead,close,workspace,revision,refresh,notify,navigate}:{lead:RecordRow;close:()=>void}&Shared) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [key]=useState(()=>crypto.randomUUID());
  const options=useLoad<Options>("options",workspace.id,revision);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");
    const form=new FormData(event.currentTarget);
    try {
      const {data}=await api<{deal_id:string}>("leads/"+lead.id+"/convert",{method:"POST",workspace:workspace.id,body:{
        expected_version:lead.version,key,title:String(form.get("title")).trim(),amount_minor:minorUnits(String(form.get("amount")).trim()),
        contact_id:form.get("contact")||null,company_id:form.get("company")||null,create_contact_if_duplicate:form.has("separate"),
      }});
      notify("Lead converted. The contact and deal are linked.");refresh();close();navigate("deals",data.deal_id);
    } catch(caught){setError(messageOf(caught));setBusy(false);}
  }
  return <Dialog title="Convert qualified lead" onClose={()=>{if(!busy) close();}}>
    {options.error?<ErrorNotice message={options.error} action={refresh}/>:!options.data?<Loading/>:<form className="editor" onSubmit={submit}>
      <p className="muted">Create a deal for {lead.name} and link it to a contact and, when available, a company.</p>
      <label>Deal title<input required name="title" maxLength={120} defaultValue={String(lead.company_name||lead.name)+" opportunity"}/></label>
      <label>Deal amount ({workspace.currency})<input required name="amount" inputMode="decimal" maxLength={14} defaultValue="0.00"/></label>
      <label>Contact<select name="contact"><option value="">Create a contact from this lead</option>
        {options.data.contacts?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Company<select name="company"><option value="">{lead.company_name?"Use company from lead or contact":"Use company from contact"}</option>
        {options.data.companies?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="check"><input name="separate" type="checkbox"/>Allow a separate contact if the email matches</label>
      {error&&<ErrorNotice message={error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy?"Converting…":"Convert lead"}</button></div>
    </form>}
  </Dialog>;
}
