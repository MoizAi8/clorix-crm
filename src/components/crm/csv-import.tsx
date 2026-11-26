"use client";

import { useState,type FormEvent } from "react";
import { FileSpreadsheet } from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { Dialog,ErrorNotice } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";

type Preview={token:string;rows:Record<string,string>[];errors:{line:number;message:string}[];skipped:number;count:number};

export function CsvImport({entity,close,workspace,refresh,notify}:{entity:"leads"|"contacts";close:()=>void}&Shared) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [duplicate,setDuplicate]=useState("skip");
  const [preview,setPreview]=useState<{result:Preview;csv:string;key:string}|null>(null);
  async function inspect(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");setPreview(null);
    try {
      if(!file)throw new Error("Choose a CSV file.");
      if(file.size>262144)throw new Error("Choose a CSV file no larger than 256 KB.");
      const csv=await file.text();
      const {data}=await api<Preview>("imports/preview",{method:"POST",workspace:workspace.id,body:{entity,duplicate,csv}});
      setPreview({result:data,csv,key:crypto.randomUUID()});
    } catch(caught){setError(messageOf(caught));}
    finally{setBusy(false);}
  }
  async function submit() {
    if(!preview)return;
    setBusy(true);setError("");
    try {
      const {data}=await api<{created:number;skipped:number}>("imports/commit",{method:"POST",workspace:workspace.id,
        body:{entity,duplicate,csv:preview.csv,token:preview.result.token,key:preview.key}});
      notify(data.created+" imported · "+data.skipped+" skipped.");refresh();close();
    } catch(caught){setError(messageOf(caught));setBusy(false);}
  }
  const headings=entity==="leads"?"name, email, phone, company_name, source, status":"name, email, phone, title";
  return <Dialog title={"Import "+entity+" from CSV"} onClose={()=>{if(!busy)close();}} wide>
    <form className="editor" onSubmit={inspect}>
      <p className="muted">Up to 200 rows and 256 KB. Use fictional records only. The name column is required.</p>
      <p className="csv-headings">{headings}</p>
      <label>CSV file<input type="file" accept=".csv,text/csv" required disabled={busy}
        onChange={event=>{setFile(event.target.files?.[0]??null);setPreview(null);}}/></label>
      <label>Duplicate emails<select value={duplicate} disabled={busy} onChange={event=>{setDuplicate(event.target.value);setPreview(null);}}>
        <option value="skip">Skip duplicates</option><option value="error">Flag them as errors</option></select></label>
      <button className="button secondary" disabled={busy}><FileSpreadsheet size={17}/>Preview CSV</button>
    </form>
    {error&&<ErrorNotice message={error}/>}
    {preview&&<div className="import-preview" aria-live="polite">
      <strong>{preview.result.count} ready · {preview.result.skipped} skipped · {preview.result.errors.length} errors</strong>
      {preview.result.errors.length>0&&<ul>{preview.result.errors.map(issue=><li key={issue.line}>Row {issue.line} · {issue.message}</li>)}</ul>}
      {preview.result.rows.length>0&&<div className="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Email</th></tr></thead>
        <tbody>{preview.result.rows.map((row,index)=><tr key={index}><td>{row.name}</td><td>{row.email??"—"}</td></tr>)}</tbody></table></div>}
    </div>}
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
      <button type="button" className="button primary" onClick={submit} disabled={busy||!preview?.result.count||!!preview.result.errors.length}>Confirm import</button></div>
  </Dialog>;
}
