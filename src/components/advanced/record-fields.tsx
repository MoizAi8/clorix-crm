"use client";

import { useState } from "react";
import { Dialog,ErrorNotice } from "@/components/ui/primitives";
import { useEngineData } from "./use-engine-data";
import { useEngineMutation } from "./sales";
import type { Shared } from "@/components/workspace/contracts";

export type FieldEntity="leads"|"contacts"|"companies"|"deals";
export function hasCustomFields(entity:string):entity is FieldEntity {
  return entity==="leads"||entity==="contacts"||entity==="companies"||entity==="deals";
}
type Value=string|boolean|string[]|null;
type Field={id:string;name:string;data_type:string;options:string[];active:boolean;value:Value;version:number};

function display(value:Value) {
  if(value===null||value==="")return "—";
  if(typeof value==="boolean")return value?"Yes":"No";
  return Array.isArray(value)?value.join(", ")||"—":value;
}

export function RecordFields({entity,id,archived,...shared}:{entity:FieldEntity;id:string;archived:boolean}&Shared) {
  const result=useEngineData<Field[]>("record-fields",{entity,record_id:id},shared);
  const editor=useEngineMutation(shared);
  const [editing,setEditing]=useState<Field|null>(null);
  const [value,setValue]=useState<Value>(null);
  if(result?.error)return <ErrorNotice message={result.error} action={shared.refresh}/>;
  if(!result?.data?.length)return null;
  return <section className="surface report-card">
    <div className="card-title"><h2>Custom fields</h2></div>
    <dl className="detail-fields">{result.data.map(field=><div key={field.id}>
      <dt>{field.name}{field.active?"":" (archived)"}</dt>
      <dd>{field.active&&!archived?<button className="plain-button" onClick={()=>{setEditing(field);setValue(field.value);}}>
        {field.value===null?"Set "+field.name:display(field.value)}</button>:display(field.value)}</dd>
    </div>)}</dl>
    {editing&&<Dialog title={"Edit "+editing.name} onClose={()=>setEditing(null)}>
      <form className="form-stack" onSubmit={event=>{
        event.preventDefault();
        void editor.save("record-field",{version:editing.version,record_id:id,definition_id:editing.id,entity,value:value===""?null:value},
          "Custom field updated.",()=>setEditing(null));
      }}>
        {editing.data_type==="multi_select"?<fieldset className="field-options"><legend>{editing.name}</legend>{editing.options.map(option=>{
          const values=Array.isArray(value)?value:[];
          return <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={event=>
            setValue(event.target.checked?[...values,option]:values.filter(item=>item!==option))}/>{option}</label>;
        })}</fieldset>:editing.data_type==="boolean"||editing.data_type==="single_select"?<label>{editing.name}
          <select value={value===null?"":String(value)} onChange={event=>{
            const next=event.target.value;
            setValue(next===""?null:editing.data_type==="boolean"?next==="true":next);
          }}><option value="">Empty</option>
            {editing.data_type==="boolean"?<><option value="true">Yes</option><option value="false">No</option></>:
              editing.options.map(option=><option key={option} value={option}>{option}</option>)}
          </select></label>:<label>{editing.name}<input type={editing.data_type==="date"?"date":"text"}
            inputMode={editing.data_type==="number"?"decimal":undefined} value={typeof value==="string"?value:""}
            maxLength={editing.data_type==="text"?1000:20} onChange={event=>setValue(event.target.value)}/></label>}
        {editor.error&&<ErrorNotice message={editor.error}/>}
        <div className="dialog-actions">
          {editing.data_type==="multi_select"&&<button type="button" className="button secondary" onClick={()=>setValue(null)}>Clear choices</button>}
          <button className="button primary" disabled={editor.busy}>Save value</button>
        </div>
      </form>
    </Dialog>}
  </section>;
}
