export const importColumns={
  leads:["name","email","phone","company_name","source","status"],
  contacts:["name","email","phone","title"],
  companies:["name","domain","industry","website","notes"],
  deals:["title","amount_minor","expected_close_date"],
} as const;

export type ImportEntity=keyof typeof importColumns;

export function csvCell(raw:unknown,numeric=false):string {
  let value=raw===null||raw===undefined?"":raw instanceof Date?raw.toISOString():String(raw);
  if(!numeric&&(/^[\t\r\n]/.test(value)||/^\s*[=+\-@\t\r\n]/u.test(value))) value="'"+value;
  return '"'+value.replaceAll('"','""')+'"';
}
