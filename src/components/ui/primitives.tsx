"use client";

import { useEffect,useRef,useState,type ReactNode } from "react";
import { AlertCircle,Inbox,X } from "lucide-react";
import { api,messageOf } from "@/lib/client";

export function Dialog({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=ref.current;
    element?.showModal();
    return ()=>element?.close();
  },[]);
  return <dialog ref={ref} className={"dialog"+(wide?" dialog-wide":"")} aria-label={title}
    onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if (event.target===event.currentTarget) onClose();}}>
    <div className="dialog-inner"><header className="dialog-title"><h2>{title}</h2>
      <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button>
    </header>{children}</div>
  </dialog>;
}

export function ErrorNotice({message,action}:{message:string;action?:()=>void}) {
  return <div className="error-notice" role="alert"><AlertCircle size={18}/><span>{message}</span>
    {action&&<button type="button" className="plain-button" onClick={action}>Retry</button>}</div>;
}

export function Empty({title,children}:{title:string;children?:ReactNode}) {
  return <div className="empty"><Inbox size={23}/><strong>{title}</strong>{children&&<p>{children}</p>}</div>;
}

export function Loading({label="Loading workspace…"}:{label?:string}) {
  return <div className="loading" role="status"><span className="spinner"/>{label}</div>;
}

export function useLoad<T>(path:string|null,workspace?:string,revision=0, retain=false) {
  const [state,setState]=useState<{key:string;base?:string;data?:T;after?:string|null;error?:string}>({key:""});
  const base=JSON.stringify([path,workspace]);
  const key=base+"|"+revision;
  useEffect(()=>{
    if (!path) return;
    const controller=new AbortController();
    api<T>(path,{workspace,signal:controller.signal}).then(result=>{
      if (!controller.signal.aborted) setState({key,base,data:result.data,after:result.meta?.after});
    }).catch(error=>{
      if (!controller.signal.aborted) setState({key,base,error:messageOf(error)});
    });
    return ()=>controller.abort();
  },[path,workspace,key,base]);
  return state.key===key||(retain&&state.base===base&&state.data!==undefined)?state:{key};
}

export function dateTime(value:unknown,zone:string,includeTime=false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en",{month:"short",day:"numeric",year:"numeric",
    ...(includeTime?{hour:"numeric",minute:"2-digit"}:{}),timeZone:zone}).format(new Date(String(value)));
}

export function Title({title,description,actions}:{title:string;description:string;actions?:ReactNode}) {
  return <div className="view-title"><div><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="actions">{actions}</div>}</div>;
}
