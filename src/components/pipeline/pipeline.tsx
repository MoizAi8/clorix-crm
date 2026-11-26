"use client";

import { useState,type DragEvent } from "react";
import { GripVertical,MoveRight,Plus } from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { money,type RecordRow } from "@/lib/crm";
import { Empty,ErrorNotice,Loading,Title,useLoad } from "@/components/ui/primitives";
import type { Board,Shared } from "@/components/workspace/contracts";
import { MoveDeal } from "./move-deal";

type Drop={deal:RecordRow;target?:string;before?:string};

export function Pipeline(shared:Shared) {
  const {workspace,revision,refresh,notify,navigate}=shared;
  const {data,error}=useLoad<Board>("pipeline",workspace.id,revision);
  const [moving,setMoving]=useState<Drop|null>(null);
  const [dragging,setDragging]=useState<string|null>(null);
  const [over,setOver]=useState<string|null>(null);
  const [pending,setPending]=useState<Drop|null>(null);
  const [failure,setFailure]=useState("");

  async function drop(event:DragEvent,stageId:string,before?:string) {
    event.preventDefault();event.stopPropagation();setOver(null);
    const id=event.dataTransfer.getData("text/plain")||dragging;
    setDragging(null);
    if (!data||pending||!id||id===before)return;
    const deal=data.deals.find(item=>item.id===id);
    if (!deal)return;
    const target=data.stages.find(stage=>stage.id===stageId);
    if (!target)return;
    setFailure("");
    if(target.kind==="lost"&&deal.stage_id!==stageId){setMoving({deal,target:stageId,before});return;}
    setPending({deal,target:stageId,before});
    try {
      await api("deals/"+id+"/move",{method:"POST",workspace:workspace.id,body:{stage_id:stageId,before_id:before??null,expected_version:deal.version}});
      notify("Deal moved.");refresh();
    } catch(caught){
      setFailure(messageOf(caught));refresh();
    } finally{setPending(null);}
  }

  function visible(stageId:string) {
    const cards=data?.deals.filter(row=>row.stage_id===stageId&&row.id!==pending?.deal.id)??[];
    if (pending?.target===stageId) {
      const at=pending.before?cards.findIndex(card=>card.id===pending.before):-1;
      cards.splice(at<0?cards.length:at,0,pending.deal);
    }
    return cards;
  }

  return <>
    <Title title="Pipeline" description="Move deals between stages and review current deal value."
      actions={<button className="button primary" onClick={()=>navigate("deals",undefined,true)}><Plus size={18}/>New deal</button>}/>
    {failure&&<ErrorNotice message={failure} action={refresh}/>}
    {error?<ErrorNotice message={error} action={refresh}/>:!data?<Loading label="Loading pipeline…"/>:
      <div className="kanban" aria-label="Sales pipeline" aria-busy={!!pending}>
        {data.stages.map(stage=>{
          const cards=visible(stage.id);
          const delta=pending&&pending.deal.stage_id!==pending.target?pending.target===stage.id?1:pending.deal.stage_id===stage.id?-1:0:0;
          const total=BigInt(stage.amount_minor)+BigInt(delta)*BigInt(pending?.deal.amount_minor??"0");
          return <section key={stage.id} className={"kanban-stage "+stage.kind+(over===stage.id?" drop-target":"")}
            onDragOver={event=>{if(dragging){event.preventDefault();event.dataTransfer.dropEffect="move";setOver(stage.id);}}}
            onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOver(null);}}
            onDrop={event=>{void drop(event,stage.id);}}>
            <header><h2>{stage.name} <span>{stage.count+delta}</span></h2><strong>{money(total.toString(),workspace.currency)}</strong></header>
            <div className="kanban-cards">{cards.length?cards.map(deal=><article key={deal.id} className={"deal-card"+(dragging===deal.id?" dragging":"")}
              draggable={!pending} onDragStart={event=>{
                event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",deal.id);setDragging(deal.id);
              }} onDragEnd={()=>{setDragging(null);setOver(null);}}
              onDragOver={event=>{if(dragging)event.preventDefault();}} onDrop={event=>{void drop(event,stage.id,deal.id);}}>
                <div className="deal-head"><button className="row-link" onClick={()=>navigate("deals",deal.id)}>{deal.title}</button><GripVertical size={16} aria-hidden="true"/></div>
                {deal.company_name&&<small>{deal.company_name}</small>}
                <div className="deal-foot"><strong>{money(deal.amount_minor,workspace.currency)}</strong>
                  <button type="button" className="icon-button" aria-label={"Move deal "+deal.title} disabled={!!pending} onClick={()=>setMoving({deal})}><MoveRight size={17}/></button></div>
              </article>):<Empty title="No deals in this stage"/>}</div>
          </section>;
        })}
      </div>}
    {moving&&data&&<MoveDeal {...shared} deal={moving.deal} target={moving.target} before={moving.before} stages={data.stages} close={()=>setMoving(null)}/>}
  </>;
}
