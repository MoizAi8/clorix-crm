"use client";

import { useState,type FormEvent } from "react";
import { FileSpreadsheet } from "lucide-react";
import { importColumns,type ImportEntity } from "@/lib/csv";
import { api,messageOf } from "@/lib/client";
import { Dialog,ErrorNotice } from "@/components/ui/primitives";
import type { Shared } from "@/components/workspace/contracts";

type Preview={token:string;rows:Record<string,string>[];errors:{line:number;message:string}[];skipped:number;count:number};
type Mapping=Record<string,string>;

export function CsvImport({entity,close,workspace,refresh,notify}:{entity:ImportEntity;close:()=>void}&Shared) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [duplicate,setDuplicate]=useState("skip");
  const [columns,setColumns]=useState<string[]|null>(null);
  const [mapping,setMapping]=useState<Mapping>({});
  const [preview,setPreview]=useState<{result:Preview;csv:string;mapping?:Mapping;key:string}|null>(null);
  const targets:readonly string[]=importColumns[entity];
  const titleField=entity==="deals"?"title":"name";
  const duplicateField=entity==="companies"?"domains":"emails";

  async function inspect(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");setPreview(null);
    const selectColumns=((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null)?.value==="map";
    try {
      if(!file)throw new Error("Choose a CSV file.");
      if(file.size>262144)throw new Error("Choose a CSV file no larger than 256 KB.");
      const csv=await file.text();
      if(selectColumns) {
        const {data}=await api<{head:string[]}>("imports/columns",{method:"POST",workspace:workspace.id,body:{entity,csv}});
        setColumns(data.head);
        setMapping(Object.fromEntries(data.head.flatMap(source=>targets.includes(source)?[[source,source]]:[])));
      } else {
        const confirmedMapping=columns?Object.fromEntries(Object.entries(mapping).filter(([,target])=>Boolean(target))):undefined;
        const {data}=await api<Preview>("imports/preview",{method:"POST",workspace:workspace.id,body:{entity,duplicate,csv,mapping:confirmedMapping}});
        setPreview({result:data,csv,mapping:confirmedMapping,key:crypto.randomUUID()});
      }
    } catch(caught){setError(messageOf(caught));}
    finally{setBusy(false);}
  }

  async function submit() {
    if(!preview)return;
    setBusy(true);setError("");
    try {
      const {data}=await api<{created:number;skipped:number}>("imports/commit",{method:"POST",workspace:workspace.id,
        body:{entity,duplicate,csv:preview.csv,mapping:preview.mapping,token:preview.result.token,key:preview.key}});
      notify(data.created+" imported · "+data.skipped+" skipped.");refresh();close();
    } catch(caught){setError(messageOf(caught));setBusy(false);}
  }
  return <Dialog title={"Import "+entity+" from CSV"} onClose={()=>{if(!busy)close();}} wide>
    <form className="editor" onSubmit={inspect}>
      <p className="muted">Up to 200 rows and 256 KB. {workspace.kind==="sandbox"?"Use fictional records only. ":""}The {titleField} column is required.</p>
      <p className="csv-headings">{targets.join(", ")}</p>
      <label>CSV file<input type="file" accept=".csv,text/csv" required disabled={busy}
        onChange={event=>{setFile(event.target.files?.[0]??null);setPreview(null);setColumns(null);setMapping({});}}/></label>
      {entity!=="deals"&&<label>Duplicate {duplicateField}<select value={duplicate} disabled={busy} onChange={event=>{setDuplicate(event.target.value);setPreview(null);}}>
        <option value="skip">Skip duplicates</option><option value="error">Flag them as errors</option></select></label>}
      {columns&&<div className="form-grid">{columns.map(source=><label key={source}>{source}
        <select disabled={busy} value={Object.hasOwn(mapping,source)?mapping[source]:""}
          onChange={event=>{setMapping({...mapping,[source]:event.target.value});setPreview(null);}}>
          <option value="">Ignore column</option>{targets.map(target=><option key={target} value={target}>{target}</option>)}
        </select>
      </label>)}</div>}
      <div className="advanced-row">
        <button className="button secondary" value="preview" disabled={busy}><FileSpreadsheet size={17}/>Preview CSV</button>
        {!columns&&<button className="button secondary" value="map" disabled={busy}>Map columns</button>}
      </div>
    </form>
    {error&&<ErrorNotice message={error}/>}
    {preview&&<div className="import-preview" aria-live="polite">
      <strong>{preview.result.count} ready · {preview.result.skipped} skipped · {preview.result.errors.length} errors</strong>
      {preview.result.errors.length>0&&<ul>{preview.result.errors.map(issue=><li key={issue.line}>Row {issue.line} · {issue.message}</li>)}</ul>}
      {preview.result.rows.length>0&&<div className="table-wrap"><table><thead><tr>{targets.map(heading=><th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{preview.result.rows.map((row,index)=><tr key={index}>{targets.map(heading=><td key={heading}>{row[heading]??"—"}</td>)}</tr>)}</tbody></table></div>}
    </div>}
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button>
      <button type="button" className="button primary" onClick={submit} disabled={busy||!preview?.result.count||!!preview.result.errors.length}>Confirm import</button></div>
  </Dialog>;
}
