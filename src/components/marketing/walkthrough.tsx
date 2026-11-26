"use client";

import { useEffect,useRef,useState } from "react";
import { ChartNoAxesCombined,ClipboardCheck,Columns3 } from "lucide-react";

const features=[
  {title:"Pipeline",icon:Columns3,heading:"See what’s ready to move.",description:"Move deals between stages, track what changed, and keep lost reasons alongside the deal history.",
    rows:[["Qualified","Riverglass discovery"],["Proposal","Juniper project"],["Negotiation","Cedar expansion"]]},
  {title:"Follow-up",icon:ClipboardCheck,heading:"See who needs a follow-up.",description:"Overdue tasks come first, then upcoming work and leads or deals without a recent logged interaction.",
    rows:[["Overdue","Review project timeline"],["Due this week","Send scope notes"],["No recent activity","Check in with Northwind"]]},
  {title:"Reporting",icon:ChartNoAxesCombined,heading:"Know what your pipeline is worth.",description:"Review open pipeline, booked deal value and weighted forecast. Filter closed deals by the workspace’s date range.",
    rows:[["Pipeline","Current open deal value"],["Won deal value","Closed wins in range"],["Weighted forecast","Open amount × probability"]]},
];

export function RevealJourney({children}:{children:React.ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const container=ref.current;
    if (!container || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries) if(entry.isIntersecting){entry.target.classList.add("arrived");observer.unobserve(entry.target);}
    },{threshold:.25});
    for(const child of container.children) observer.observe(child);
    return ()=>observer.disconnect();
  },[]);
  return <div ref={ref} className="journey-grid">{children}</div>;
}

export function Walkthrough() {
  const [active,setActive]=useState(0);
  const feature=features[active];
  return <div className="walkthrough">
    <div className="showcase-copy">
      <h2>{feature.heading}</h2><p>{feature.description}</p>
      <div className="showcase-tabs" role="tablist" aria-label="Workspace features" onKeyDown={event=>{
        const index=event.key==="ArrowRight"?(active+1)%features.length:event.key==="ArrowLeft"?(active+features.length-1)%features.length:
          event.key==="Home"?0:event.key==="End"?features.length-1:null;
        if(index===null)return;
        event.preventDefault();setActive(index);document.getElementById("feature-tab-"+index)?.focus();
      }}>{features.map(({title,icon:Icon},index)=><button key={title} type="button" role="tab" id={"feature-tab-"+index}
        aria-selected={index===active} aria-controls="feature-panel" tabIndex={index===active?0:-1} onClick={()=>setActive(index)}><Icon size={17}/>{title}</button>)}</div>
    </div>
    <div id="feature-panel" className="showcase-panel" role="tabpanel" aria-labelledby={"feature-tab-"+active}>
      <div className="showcase-bar"><feature.icon size={21}/><strong>{feature.title}</strong><span>Illustrative records</span></div>
      {feature.rows.map(([label,name])=><div className="showcase-row" key={label}><span>{label}</span><strong>{name}</strong></div>)}
    </div>
  </div>;
}
