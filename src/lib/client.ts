export class RequestError extends Error {
  constructor(message:string,public status:number,public code:string) { super(message); }
}

export async function api<T>(path:string,options:{method?:string;body?:unknown;workspace?:string;signal?:AbortSignal}={}):Promise<{data:T;meta?:{after:string|null}}> {
  const headers=new Headers();
  if (options.workspace) headers.set("x-clorix-workspace",options.workspace);
  if (options.body!==undefined) headers.set("Content-Type","application/json");
  const response=await fetch("/api/v1/"+path,{method:options.method,headers,body:options.body===undefined?undefined:JSON.stringify(options.body),
    signal:options.signal,cache:"no-store"});
  const result=await response.json().catch(()=>null);
  if (!response.ok || !result) throw new RequestError(result?.error?.message ?? "The request failed. Please try again.",response.status,result?.error?.code ?? "request");
  return result;
}

export const messageOf=(error:unknown)=>error instanceof Error ? error.message : "Something went wrong. Please try again.";
