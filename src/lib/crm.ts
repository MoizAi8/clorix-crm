export const entities = ["leads","contacts","companies","deals","tasks","activities"] as const;
export type Entity = typeof entities[number];
export const leadStatuses=["new","contacted","qualified","disqualified"] as const;
export const priorities=["low","normal","high"] as const;
export const activityKinds=["call","meeting","email","note"] as const;

export const entityLabels:Record<Entity,{one:string;many:string;title:string}> = {
  leads:{one:"lead",many:"Leads",title:"name"}, contacts:{one:"contact",many:"Contacts",title:"name"},
  companies:{one:"company",many:"Companies",title:"name"}, deals:{one:"deal",many:"Deals",title:"title"},
  tasks:{one:"task",many:"Tasks",title:"title"}, activities:{one:"activity",many:"Activities",title:"summary"},
};

export type RecordRow = {
  id:string; version:number; name?:string; title?:string; summary?:string; status?:string;
  stage_id?:string; stage_name?:string; stage_kind?:string; company_name?:string; company_id?:string; contact_id?:string;
  amount_minor?:string; due_at?:string; occurred_at?:string; updated_at?:string; archived_at?:string;
} & Record<string,unknown>;

export type Stage={id:string;name:string;kind:"open"|"won"|"lost";sort_order:number;probability:number;count:number;amount_minor:string};
export type SearchResult={id:string;entity:Entity;label:string};

export function money(value:string|undefined,currency="USD") {
  const exact=BigInt(value ?? "0");
  const format=new Intl.NumberFormat("en-US",{style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:2});
  const fraction=(exact%100n).toString().padStart(2,"0");
  return format.formatToParts(exact/100n).map(part => part.type==="fraction" ? fraction : part.value).join("");
}

export function minorUnits(input:string) {
  const [whole,fraction=""]=input.split(".");
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(input)) throw new Error("Enter a nonnegative amount with up to two decimal places.");
  return (BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"))).toString();
}

export function majorUnits(minor:string|undefined) {
  const value=(minor ?? "0").padStart(3,"0");
  return value.slice(0,-2)+"."+value.slice(-2);
}

export function labelFor(value:unknown) {
  return typeof value==="string" ? value.replaceAll("_"," ").replace(/^./,first=>first.toUpperCase()) : "—";
}

export function recordLabel(row:RecordRow, entity:Entity) {
  return String(row[entityLabels[entity].title] ?? "Untitled");
}
