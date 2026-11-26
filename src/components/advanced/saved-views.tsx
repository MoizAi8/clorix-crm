"use client";

import { useState } from "react";
import { Dialog,ErrorNotice,useLoad } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";
import { useEngineMutation } from "./sales";
import type { SavedPreset } from "./productivity";

type Filters={entity:string;query:string;status:string;source:string;owner:string|null;sort:string;archived:boolean};
export function SavedViews({entity,filters,apply,...shared}:{entity:string;filters:string;apply:(filters:string)=>void}&Shared) {
  const {data,error}=useLoad<SavedPreset<Filters>[]>("advanced/saved-presets",shared.workspace.id,shared.revision);
  const editor=useEngineMutation(shared);
  const [selected,setSelected]=useState("");
  const [editing,setEditing]=useState(false);
  const views=data?.filter(item=>item.kind==="view"&&item.specification.entity===entity)??[];
  const current=views.find(item=>item.id===selected);
  function open(id:string) {
    setSelected(id);
    const saved=views.find(item=>item.id===id)?.specification;
    if(!saved)return;
    const params=new URLSearchParams();
    for(const [name,value] of Object.entries({q:saved.query,status:saved.status,source:saved.source,owner:saved.owner,
      sort:saved.sort==="recent"?"":saved.sort,archived:saved.archived?"true":""})) {
      if(value)params.set(name,value);
    }
    apply(params.toString());
  }
  return <>
    <div className="advanced-filters saved-views">
      <label>Saved view<select value={selected} onChange={event=>open(event.target.value)}><option value="">Choose a view</option>
        {views.map(view=><option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
      <button className="button secondary" onClick={()=>setEditing(true)}>{current?"Update saved view":"Save current filters"}</button>
    </div>
    {error&&<ErrorNotice message={error}/>}
    {editing&&<Dialog title={current?"Update saved view":"Save current filters"} onClose={()=>setEditing(false)}>
      <form className="form-stack" onSubmit={event=>{
        event.preventDefault();
        const name=new FormData(event.currentTarget).get("name");
        const selection=new URLSearchParams(filters);
        const specification={entity,query:selection.get("q")??"",status:selection.get("status")??"",
          source:selection.get("source")??"",owner:selection.get("owner"),sort:selection.get("sort")??"recent",
          archived:selection.get("archived")==="true"};
        void editor.save<{id:string}>("saved-presets",{id:current?.id??null,version:current?.version??0,kind:"view",name,specification},
          "View saved.",data=>{setSelected(data.id);setEditing(false);});
      }}>
        <label>View name<input name="name" maxLength={80} required defaultValue={current?.name}/></label>
        <p className="muted">This view uses the filters currently applied to the record list.</p>
        {editor.error&&<ErrorNotice message={editor.error}/>}
        <div className="dialog-actions"><button className="button primary" disabled={editor.busy}>Save view</button></div>
      </form>
    </Dialog>}
  </>;
}
