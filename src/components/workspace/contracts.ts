import type { Entity, RecordRow, Stage } from "@/lib/crm";
import type { Workspace } from "@/server/workspace/context";

export type Options=Record<string,{id:string;label:string}[]>;
export type Detail={record:RecordRow;related:Partial<Record<Entity,RecordRow[]>>;history:{event_at:string;stage_name:string;actor:string;reason?:string;amount_minor:string}[]};
export type Board={stages:Stage[];deals:RecordRow[]};
export type Navigate=(view:string,id?:string,create?:boolean)=>void;
export type Shared={workspace:Workspace;revision:number;refresh:()=>void;navigate:Navigate;notify:(message:string)=>void};
