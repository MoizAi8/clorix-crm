"use client";

import { useState } from "react";
import { ArrowDownToLine,Paperclip } from "lucide-react";
import { messageOf } from "@/lib/client";
import { dateTime,Dialog,Empty,ErrorNotice,Loading } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";
import type { FieldEntity } from "./record-fields";
import { useEngineData } from "./use-engine-data";
import { useEngineMutation } from "./sales";

type Attachment={id:string;filename:string;media_type:string;size_bytes:number;created_at:string;can_delete:boolean};
const mediaType:Record<string,string>={pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",txt:"text/plain"};
const fileLimit=262_144;

function encode(file:File) {
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(Error("Could not read the selected file."));
    reader.onload=()=>{
      const contents=String(reader.result??"").split(",")[1];
      if(contents)resolve(contents);
      else reject(Error("Choose a file with content."));
    };
    reader.readAsDataURL(file);
  });
}

export function Attachments({entity,id,archived,...shared}:{entity:FieldEntity;id:string;archived:boolean}&Shared) {
  const result=useEngineData<Attachment[]>("attachments-list",{entity,record_id:id},shared);
  const editor=useEngineMutation(shared);
  const [adding,setAdding]=useState(false);
  const [pending,setPending]=useState(false);
  const [deleting,setDeleting]=useState<Attachment|null>(null);
  const [error,setError]=useState("");

  async function upload(file:File|null) {
    if(!file)return;
    setPending(true);setError("");
    try {
      const type=mediaType[file.name.split(".").pop()?.toLowerCase()??""];
      if(!type||file.size>fileLimit||!file.size)throw Error("Choose a PDF, PNG, JPEG or TXT file between 1 byte and 256 KB.");
      const contents=await encode(file);
      await editor.save("attachment-upload",{entity,record_id:id,filename:file.name,media_type:type,contents},
        "Attachment uploaded.",()=>setAdding(false));
    } catch(caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  async function download(item:Attachment) {
    setError("");
    try {
      const response=await fetch("/api/advanced/attachment-download",{method:"POST",
        headers:{"Content-Type":"application/json","X-Clorix-Workspace":shared.workspace.id},
        body:JSON.stringify({id:item.id}),cache:"no-store"});
      if(!response.ok)throw Error((await response.json().catch(()=>null))?.error?.message??"The attachment is unavailable.");
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement("a");link.href=url;link.download=item.filename;link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(caught){setError(messageOf(caught));}
  }

  return <section className="surface report-card">
    <div className="card-title"><h2>Attachments</h2>{!archived&&<button className="button secondary"
      onClick={()=>{setError("");setAdding(true);}}><Paperclip size={16}/>Add attachment</button>}</div>
    {(result?.error||error&&!adding)&&<ErrorNotice message={result?.error||error}/>}
    {!result?<Loading label="Loading attachments…"/>:result.data?.length?<div className="advanced-list">
      {result.data.map(item=><article key={item.id}>
        <div className="advanced-row"><strong className="audit-id">{item.filename}</strong>
          <button className="button secondary" onClick={()=>void download(item)}><ArrowDownToLine size={16}/>Download</button>
          {item.can_delete&&<button className="button secondary" onClick={()=>setDeleting(item)}>Delete attachment</button>}</div>
        <small>{Math.max(1,Math.ceil(item.size_bytes/1024))} KB · {dateTime(item.created_at,shared.workspace.timezone,true)}</small>
      </article>)}
    </div>:!result.error&&<Empty title="No attachments yet"/>}
    {adding&&<Dialog title="Add attachment" onClose={()=>{if(!pending)setAdding(false);}}>
      <form className="form-stack" onSubmit={event=>{
        event.preventDefault();
        const file=new FormData(event.currentTarget).get("attachment");
        if(file instanceof File)void upload(file);
      }}>
        <label>Attachment file<input type="file" name="attachment" accept=".pdf,.png,.jpg,.jpeg,.txt" disabled={pending} required/></label>
        <p className="muted">PDF, PNG, JPEG or TXT. Up to 256 KB per file and 2 MB per workspace.</p>
        {(error||editor.error)&&<ErrorNotice message={error||editor.error}/>}
        <div className="dialog-actions"><button className="button primary" disabled={pending}>Upload attachment</button></div>
      </form>
    </Dialog>}
    {deleting&&<Dialog title="Delete attachment" onClose={()=>{if(!editor.busy)setDeleting(null);}}>
      <p>Delete {deleting.filename} permanently?</p>
      {editor.error&&<ErrorNotice message={editor.error}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={()=>setDeleting(null)} disabled={editor.busy}>Cancel</button>
        <button type="button" className="button danger" disabled={editor.busy} onClick={()=>void editor.save("attachment-delete",{id:deleting.id},
          "Attachment deleted.",()=>setDeleting(null))}>Delete file</button></div>
    </Dialog>}
  </section>;
}
