"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, Download, FileText, Plus, Printer, X } from "lucide-react";
import { api, messageOf } from "@/lib/client";
import { labelFor, majorUnits, minorUnits, money, type RecordRow } from "@/lib/crm";
import type { Options, Shared } from "@/components/workspace/contracts";
import { Dialog, Empty, ErrorNotice, Loading, Title, dateTime, useLoad } from "@/components/ui/primitives";
import { useEngineMutation } from "./sales";
import { useEngineData } from "./use-engine-data";

type Mode="catalog"|"quotation"|"invoice";
type Item={id:string;version:number;sku:string;name:string;kind:"product"|"service";category:string;description:string;
  price_minor:string;cost_minor:string|null;tax_bps:number;active:boolean};
type Document={id:string;version:number;kind:"quotation"|"invoice";state:string;status:string;number:string;currency:string;
  subject:string;company_name:string;company_id:string;contact_id:string|null;deal_id:string|null;due_on:string;
  terms:string;notes:string;total_minor:string;paid_minor:string;balance_minor:string;subtotal_minor:string;
  discount_minor:string;tax_minor:string};
type Line={catalog_id:string|null;label:string;unit_minor:string;qty_milli:number;discount_bps:number;tax_bps:number;total_minor:string};
type Detail={document:Document;lines:Line[];payments:{id:string;amount_minor:string;received_on:string;method:string;reference:string}[];
  history:{version:number;action:string;created_at:string}[]};
type BillingOverview={catalog:Item[];documents:Document[];today:string;more_documents:boolean;currency:string;
  totals:{invoiced_minor:string;collected_minor:string;outstanding_minor:string;overdue_minor:string}};

function showPercent(bps:number){return String(bps/100);}
function bps(text:string){
  if(!text)return 0;
  const result=Number(minorUnits(text));
  if(result>10000)throw new Error("Discount and tax must be between 0 and 100 percent.");
  return result;
}
function values(form:HTMLFormElement){
  const source=new FormData(form);
  return (key:string)=>String(source.get(key)??"").trim();
}

function CatalogEditor({item,shared,close}:{item?:Item;shared:Shared;close:()=>void}){
  const {save,busy,error}=useEngineMutation(shared);
  const [validation,setValidation]=useState("");
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setValidation("");
    const read=values(event.currentTarget);
    try {
      void save("catalog",{key:crypto.randomUUID(),id:item?.id??null,version:item?.version??0,sku:read("sku"),name:read("name"),
        kind:read("kind"),category:read("category"),description:read("description"),price_minor:minorUnits(read("price")),
        cost_minor:read("cost")?minorUnits(read("cost")):null,tax_bps:bps(read("tax")),active:read("active")==="on"},"Catalog item saved.",close);
    } catch(error){setValidation(messageOf(error));}
  }
  return <Dialog title={item?"Edit catalog item":"New catalog item"} onClose={()=>{if(!busy)close();}} wide>
    <form className="editor" onSubmit={submit}>
      <div className="field-grid">
        <label>Name<input name="name" required maxLength={120} defaultValue={item?.name}/></label>
        <label>SKU or code<input name="sku" required maxLength={50} defaultValue={item?.sku}/></label>
        <label>Type<select name="kind" defaultValue={item?.kind??"service"}><option value="product">Product</option><option value="service">Service</option></select></label>
        <label>Category<input name="category" maxLength={80} defaultValue={item?.category}/></label>
        <label>Unit price ({shared.workspace.currency})<input name="price" inputMode="decimal" required defaultValue={item?majorUnits(item.price_minor):""}/></label>
        <label>Unit cost, optional<input name="cost" inputMode="decimal" defaultValue={item?.cost_minor?majorUnits(item.cost_minor):""}/></label>
        <label>Default tax %<input name="tax" inputMode="decimal" defaultValue={item?showPercent(item.tax_bps):"0"}/></label>
        <label className="check"><input type="checkbox" name="active" defaultChecked={item?.active??true}/>Active</label>
      </div>
      <label>Description<textarea name="description" defaultValue={item?.description} rows={3} maxLength={1000}/></label>
      {(error||validation)&&<ErrorNotice message={error||validation}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>Save item</button></div>
    </form>
  </Dialog>;
}

type LineDraft={key:string;catalog:string;label:string;quantity:string;unit:string;discount:string;tax:string};
const newLine=():LineDraft=>({key:crypto.randomUUID(),catalog:"",label:"",quantity:"1",unit:"",discount:"0",tax:"0"});

function DocumentEditor({kind,detail,overview,shared,close,selected}:{kind:Document["kind"];detail?:Detail;overview:BillingOverview;
  shared:Shared;close:()=>void;selected:(id:string)=>void}){
  const doc=detail?.document;
  const [lines,setLines]=useState<LineDraft[]>(()=>detail?detail.lines.map(item=>({
    key:crypto.randomUUID(),catalog:item.catalog_id??"",label:item.label,quantity:String(item.qty_milli/1000),unit:majorUnits(item.unit_minor),
    discount:showPercent(item.discount_bps),tax:showPercent(item.tax_bps),
  })):[newLine()]);
  const {data:options,error:loadError}=useLoad<Options>("options",shared.workspace.id);
  const {save,busy,error}=useEngineMutation(shared);
  const [validation,setValidation]=useState("");
  function update(index:number,patch:Partial<LineDraft>){
    setLines(previous=>previous.map((line,i)=>i===index?{...line,...patch}:line));
  }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setValidation("");
    const read=values(event.currentTarget);
    try{
      void save<{id:string}>("billing-document",{key:crypto.randomUUID(),id:doc?.id??null,version:doc?.version??0,kind,
        company_id:read("company"),contact_id:read("contact")||null,deal_id:read("deal")||null,
        subject:read("subject"),due_on:read("date"),terms:read("terms"),notes:read("notes"),
        lines:lines.map(line=>({catalog_id:line.catalog||null,label:line.label.trim(),quantity:line.quantity.trim(),
          unit_minor:minorUnits(line.unit.trim()),discount_bps:bps(line.discount),tax_bps:bps(line.tax)}))},
        "Draft saved.",result=>{close();selected(result.id);});
    }catch(error){setValidation(messageOf(error));}
  }
  return <Dialog title={doc?"Edit draft":"New "+kind} onClose={()=>{if(!busy)close();}} wide>
    {loadError?<ErrorNotice message={loadError}/>:!options?<Loading/>:<form className="editor" onSubmit={submit}>
      <label>Subject<input name="subject" required maxLength={120} defaultValue={doc?.subject}/></label>
      <div className="field-grid">
        <label>Company<select name="company" required defaultValue={doc?.company_id??""}><option value="">Choose company</option>
          {options.companies?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{kind==="quotation"?"Valid through":"Due on"}<input type="date" name="date" min={overview.today} required defaultValue={doc?.due_on??overview.today}/></label>
        {(["contacts","deals"] as const).map(type=><label key={type}>{type==="contacts"?"Contact":"Linked deal"}
          <select name={type==="contacts"?"contact":"deal"} defaultValue={(type==="contacts"?doc?.contact_id:doc?.deal_id)??""}>
            <option value="">None</option>{options[type]?.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>)}
      </div>
      <fieldset><legend>Line items</legend><div className="editor">{lines.map((line,index)=><div className="billing-line-editor" key={line.key}>
        <div className="advanced-row"><strong>Line {index+1}</strong>{lines.length>1&&<button className="icon-button" type="button" aria-label={"Remove line "+(index+1)}
          onClick={()=>setLines(list=>list.filter(item=>item.key!==line.key))}><X size={18}/></button>}</div>
        <div className="field-grid">
          <label>Catalog item<select aria-label={"Catalog item "+(index+1)} value={line.catalog} onChange={event=>{
            const item=overview.catalog.find(row=>row.id===event.target.value);
            update(index,item?{catalog:item.id,label:item.name,unit:majorUnits(item.price_minor),tax:showPercent(item.tax_bps)}:{catalog:""});
          }}><option value="">Custom line</option>{overview.catalog.filter(item=>item.active||item.id===line.catalog).map(item=>
            <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
          <label>Description<input aria-label={"Description "+(index+1)} value={line.label} maxLength={120} required
            onChange={event=>update(index,{label:event.target.value})}/></label>
          <label>Quantity<input aria-label={"Quantity "+(index+1)} inputMode="decimal" value={line.quantity} required
            onChange={event=>update(index,{quantity:event.target.value})}/></label>
          <label>Unit price<input aria-label={"Unit price "+(index+1)} inputMode="decimal" value={line.unit} required
            onChange={event=>update(index,{unit:event.target.value})}/></label>
          <label>Discount %<input aria-label={"Discount "+(index+1)} inputMode="decimal" value={line.discount} onChange={event=>update(index,{discount:event.target.value})}/></label>
          <label>Tax %<input aria-label={"Tax "+(index+1)} inputMode="decimal" value={line.tax} onChange={event=>update(index,{tax:event.target.value})}/></label>
        </div>
      </div>)}<button type="button" className="button secondary" disabled={lines.length>=25} onClick={()=>setLines(rows=>[...rows,newLine()])}>
        <Plus size={16}/>Add line</button></div></fieldset>
      <label>Terms<textarea name="terms" rows={2} maxLength={2000} defaultValue={doc?.terms}/></label>
      <label>Notes<textarea name="notes" rows={2} maxLength={2000} defaultValue={doc?.notes}/></label>
      {(error||validation)&&<ErrorNotice message={error||validation}/>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy}>Save draft</button></div>
    </form>}
  </Dialog>;
}

function PaymentEditor({doc,today,shared,close}:{doc:Document;today:string;shared:Shared;close:()=>void}){
  const {save,busy,error}=useEngineMutation(shared);
  const [validation,setValidation]=useState("");
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setValidation("");
    const read=values(event.currentTarget);
    try{
      void save("billing-payment",{key:crypto.randomUUID(),id:doc.id,version:doc.version,amount_minor:minorUnits(read("amount")),
        received_on:read("date"),method:read("method"),reference:read("reference"),notes:read("notes")},"Payment recorded.",close);
    }catch(error){setValidation(messageOf(error));}
  }
  return <Dialog title={"Record payment for "+doc.number} onClose={()=>{if(!busy)close();}}>
    <form className="editor" onSubmit={submit}>
      <p className="muted">Record money already received. {money(doc.balance_minor,doc.currency)} remains outstanding.</p>
      <label>Amount ({doc.currency})<input name="amount" inputMode="decimal" required/></label>
      <label>Received date<input name="date" type="date" max={today} defaultValue={today} required/></label>
      <label>Method<select name="method"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option>
        <option value="card">Card</option><option value="other">Other</option></select></label>
      <label>Reference<input name="reference" maxLength={100}/></label>
      <label>Notes<textarea name="notes" maxLength={500} rows={2}/></label>
      {(error||validation)&&<ErrorNotice message={error||validation}/>}
      <button className="button primary" disabled={busy}>Record payment</button>
    </form>
  </Dialog>;
}

function DealInvoice({shared,close,selected}:{shared:Shared;close:()=>void;selected:(id:string)=>void}){
  const {data}=useLoad<Options>("options",shared.workspace.id);
  const {save,busy,error}=useEngineMutation(shared);
  const [failure,setFailure]=useState("");
  const [checking,setChecking]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setFailure("");setChecking(true);
    const id=values(event.currentTarget)("deal");
    try{
      const {data}=await api<{record:RecordRow}>("deals/"+id,{workspace:shared.workspace.id});
      await save<{id:string}>("billing-generate",{key:crypto.randomUUID(),id,version:data.record.version,source:"deal"},
        "Invoice draft opened.",item=>{close();selected(item.id);});
    }catch(error){setFailure(messageOf(error));}
    finally{setChecking(false);}
  }
  return <Dialog title="Invoice from won deal" onClose={()=>{if(!busy&&!checking)close();}}>
    <form className="editor" onSubmit={submit}>
      <p className="muted">Create a draft using the booked amount from a won deal linked to a company.</p>
      <label>Deal<select name="deal" required><option value="">Choose a deal</option>{data?.deals?.map(deal=><option key={deal.id} value={deal.id}>{deal.label}</option>)}</select></label>
      {(error||failure)&&<ErrorNotice message={error||failure}/>}
      <button className="button primary" disabled={busy||checking}>Create draft</button>
    </form>
  </Dialog>;
}

function DocumentPreview({detail,shared,back,edit,payment,selected}:{detail:Detail;shared:Shared;back:()=>void;edit:()=>void;payment:()=>void;selected:(id:string)=>void}){
  const doc=detail.document;
  const {save,busy,error}=useEngineMutation(shared);
  const [pdfError,setPdfError]=useState("");
  const [downloading,setDownloading]=useState(false);
  async function download(){
    setPdfError("");setDownloading(true);
    try{
      const response=await fetch("/api/advanced/billing-pdf",{method:"POST",headers:{"Content-Type":"application/json","x-clorix-workspace":shared.workspace.id},
        body:JSON.stringify({id:doc.id}),cache:"no-store"});
      if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error?.message??"The PDF could not be downloaded.");
      const url=URL.createObjectURL(await response.blob());
      const anchor=document.createElement("a");anchor.href=url;anchor.download="clorix-"+doc.number.toLowerCase()+".pdf";anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setPdfError(messageOf(error));}
    finally{setDownloading(false);}
  }
  const status=(status:string)=>void save("billing-status",{key:crypto.randomUUID(),id:doc.id,version:doc.version,status},"Document updated.");
  const generate=(source:"duplicate"|"quotation")=>void save<{id:string}>("billing-generate",
    {key:crypto.randomUUID(),id:doc.id,version:doc.version,source},"Draft opened.",item=>selected(item.id));
  return <>
    <button className="plain-button back-link" onClick={back}><ArrowLeft size={16}/>Back to billing</button>
    <Title title={doc.number+" · "+doc.subject} description={labelFor(doc.kind)+" · "+labelFor(doc.state)}
      actions={<><button className="button secondary" onClick={download} disabled={downloading}><Download size={16}/>Download PDF</button>
        <button className="button secondary" onClick={()=>window.print()}><Printer size={16}/>Print</button></>}/>
    {(error||pdfError)&&<ErrorNotice message={error||pdfError}/>}
    <div className="actions">
      {doc.state==="draft"&&<><button className="button secondary" onClick={edit}>Edit draft</button>
        <button className="button primary" disabled={busy} onClick={()=>status(doc.kind==="quotation"?"sent":"issued")}>
          {doc.kind==="quotation"?"Record as sent":"Issue invoice"}</button></>}
      {doc.state==="sent"&&<><button className="button primary" disabled={busy} onClick={()=>status("accepted")}>Record acceptance</button>
        <button className="button secondary" disabled={busy} onClick={()=>status("rejected")}>Record rejection</button></>}
      {doc.state==="accepted"&&<button className="button primary" disabled={busy} onClick={()=>generate("quotation")}>Create invoice</button>}
      {doc.kind==="invoice"&&doc.status==="issued"&&doc.balance_minor!=="0"&&<button className="button primary" onClick={payment}>Record payment</button>}
      <button className="button secondary" disabled={busy} onClick={()=>generate("duplicate")}>Duplicate</button>
    </div>
    <section className="surface report-card billing-document"><div className="card-title"><div><h2>{doc.number} · {doc.subject}</h2>
      <p>{doc.company_name} · {doc.kind==="quotation"?"Valid through":"Due on"} {doc.due_on}</p></div><FileText size={20}/></div>
      <div className="table-wrap"><table><thead><tr>{["Item","Quantity","Unit price","Discount","Tax","Line total"].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{detail.lines.map((line,index)=><tr key={index}><th scope="row">{line.label}</th><td>{line.qty_milli/1000}</td>
          <td>{money(line.unit_minor,doc.currency)}</td><td>{showPercent(line.discount_bps)}%</td><td>{showPercent(line.tax_bps)}%</td>
          <td>{money(line.total_minor,doc.currency)}</td></tr>)}</tbody></table></div>
      <dl className="detail-fields billing-totals">
        {([["Subtotal",doc.subtotal_minor],["Discounts",doc.discount_minor],["Tax",doc.tax_minor],["Total",doc.total_minor],
          ...(doc.kind==="invoice"?[["Recorded payments",doc.paid_minor],["Outstanding balance",doc.balance_minor]]:[])]).map(([label,total])=>
            <div key={label}><dt>{label}</dt><dd>{money(total,doc.currency)}</dd></div>)}
      </dl>
      {doc.terms&&<><h3>Terms</h3><p className="billing-copy">{doc.terms}</p></>}
      {doc.notes&&<><h3>Notes</h3><p className="billing-copy">{doc.notes}</p></>}
    </section>
    {doc.kind==="invoice"&&<section className="surface report-card"><h2>Payment history</h2>{detail.payments.length?<div className="advanced-list">
      {detail.payments.map(item=><article key={item.id}><strong>{money(item.amount_minor,doc.currency)}</strong>
        <p>{item.received_on} · {labelFor(item.method)}{item.reference?" · "+item.reference:""}</p></article>)}</div>:<Empty title="No payments recorded"/>}</section>}
    <section className="surface report-card"><h2>Revision history</h2><ol>{detail.history.map(item=>
      <li key={item.version+item.action}>{labelFor(item.action)} · {dateTime(item.created_at,shared.workspace.timezone,true)}</li>)}</ol></section>
  </>;
}

export function Billing({recordId,catalogOnly=false,...shared}:Shared&{recordId?:string;catalogOnly?:boolean}){
  const [mode,setMode]=useState<Mode>(catalogOnly?"catalog":"quotation");
  const id=catalogOnly?null:recordId??null;
  const setId=(value:string|null)=>shared.navigate("billing",value??undefined);
  const [editor,setEditor]=useState<"catalog"|"draft"|"payment"|"deal"|null>(null);
  const [item,setItem]=useState<Item|undefined>();
  const [query,setQuery]=useState("");
  const {data,error}=useLoad<BillingOverview>("advanced/billing",shared.workspace.id,shared.revision,true);
  const current=useEngineData<Detail>("billing-detail",id?{id}:null,shared);
  const close=()=>setEditor(null);
  const detail=current?.data;
  const matches=(text:string)=>text.toLowerCase().includes(query.trim().toLowerCase());
  return <>
    {id?current?.error?<><button className="plain-button" onClick={()=>setId(null)}>Back to billing</button><ErrorNotice message={current.error}/></>:
      detail?<DocumentPreview detail={detail} shared={shared} back={()=>setId(null)} edit={()=>setEditor("draft")}
        payment={()=>setEditor("payment")} selected={setId}/>:<Loading label="Loading document…"/>:<>
      <Title title={catalogOnly?"Catalog item":"Billing"} description="Manage your catalog, quotations, invoices and recorded payments."
        actions={<>
          {mode==="invoice"&&<button className="button secondary" onClick={()=>setEditor("deal")}>Invoice from deal</button>}
          <button className="button primary" disabled={!data} onClick={()=>{setItem(undefined);setEditor(mode==="catalog"?"catalog":"draft");}}>
            <Plus size={18}/>{mode==="catalog"?"New catalog item":"New "+mode}</button>
        </>}/>
      {catalogOnly?<button className="plain-button back-link" onClick={()=>shared.navigate("billing")}>Back to billing</button>:<nav className="advanced-tabs" aria-label="Billing views">{(["quotation","invoice","catalog"] as const).map(tab=>
        <button type="button" className="button secondary" aria-pressed={mode===tab} key={tab}
          onClick={()=>{setMode(tab);setQuery("");}}>{tab==="catalog"?"Catalog":tab==="invoice"?"Invoices":"Quotations"}</button>)}</nav>}
      {error?<ErrorNotice message={error} action={shared.refresh}/>:!data?<Loading/>:<>
        {mode==="invoice"&&<div className="kpis">{([["Invoiced",data.totals.invoiced_minor],["Collected",data.totals.collected_minor],
          ["Outstanding",data.totals.outstanding_minor],["Overdue balances",data.totals.overdue_minor]]).map(([name,value])=>
          <article className="surface kpi" key={name}><div><span>{name}</span></div><strong>{money(value,data.currency)}</strong></article>)}</div>}
        <section className="surface report-card"><div className="advanced-filters">
          <label>Search {mode==="catalog"?"catalog":mode+"s"}<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={100}/></label>
        </div>{mode==="catalog"?data.catalog.filter(row=>(!catalogOnly||!recordId||recordId===row.id)&&matches(row.name+" "+row.sku+" "+row.category)).length?
          <div className="advanced-list">{data.catalog.filter(row=>(!catalogOnly||!recordId||recordId===row.id)&&matches(row.name+" "+row.sku+" "+row.category)).map(row=><article key={row.id}>
            <div className="advanced-row"><strong>{row.name}</strong><span className="pill">{row.active?"Active":"Inactive"}</span>
              <span>{money(row.price_minor,data.currency)}</span><button className="button secondary" onClick={()=>{setItem(row);setEditor("catalog");}}>Edit</button></div>
            <p>{row.sku} · {labelFor(row.kind)}{row.category?" · "+row.category:""}</p></article>)}</div>:<Empty title="No catalog items"/>:
          data.documents.filter(row=>row.kind===mode&&matches(row.number+" "+row.subject+" "+row.company_name)).length?
            <div className="table-wrap"><table><thead><tr>{["Number","Subject","Customer","Status","Total"].map(title=><th scope="col" key={title}>{title}</th>)}</tr></thead>
              <tbody>{data.documents.filter(row=>row.kind===mode&&matches(row.number+" "+row.subject+" "+row.company_name)).map(row=><tr key={row.id}>
                <th scope="row"><button className="row-link" onClick={()=>setId(row.id)}>{row.number}</button></th>
                <td>{row.subject}</td><td>{row.company_name}</td><td><span className="pill">{labelFor(row.state)}</span></td><td>{money(row.total_minor,data.currency)}</td></tr>)}</tbody></table></div>:
            <Empty title={"No "+mode+"s match"}/>}
          {mode!=="catalog"&&data.more_documents&&<p className="muted">Showing the most recently changed 250 documents.</p>}
        </section>
      </>}
    </>}
    {editor==="catalog"&&<CatalogEditor item={item} shared={shared} close={close}/>}
    {editor==="draft"&&data&&(detail||mode!=="catalog")&&<DocumentEditor kind={detail?.document.kind??mode as Document["kind"]} detail={detail}
      overview={data} shared={shared} close={close} selected={setId}/>}
    {editor==="payment"&&detail&&data&&<PaymentEditor doc={detail.document} today={data.today} shared={shared} close={close}/>}
    {editor==="deal"&&<DealInvoice shared={shared} close={close} selected={setId}/>}
  </>;
}
