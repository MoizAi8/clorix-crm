"use client";

import { useEffect,useState } from "react";
import { api,messageOf } from "@/lib/client";
import type { Shared } from "@/components/workspace/contracts";

export function useEngineData<T>(path:string,body:object|null,{workspace,revision}:Shared){
  const encoded=body?JSON.stringify(body):null;
  const key=JSON.stringify([path,workspace.id,revision,encoded]);
  const [state,setState]=useState<{key:string;data?:T;error?:string}>({key:""});
  useEffect(()=>{
    if(!encoded)return;
    const controller=new AbortController();
    api<T>("advanced/"+path,{workspace:workspace.id,method:"POST",body:JSON.parse(encoded),signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setState({key,data:result.data});})
      .catch(error=>{if(!controller.signal.aborted)setState({key,error:messageOf(error)});});
    return ()=>controller.abort();
  },[key,encoded,path,workspace.id]);
  return state.key===key?state:null;
}
