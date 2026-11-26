import { test } from "node:test";
import assert from "node:assert/strict";
import { majorUnits,minorUnits,money } from "../../src/lib/crm";
import { csvCell } from "../../src/server/imports";
import { escapeLike } from "../../src/server/crm/records";
import { moveInput,schemas,timeZone } from "../../src/server/crm/validation";

for (const [value,expected] of [["0","0"],["12","1200"],["12.3","1230"],["12.03","1203"],["0.09","9"],["99999999999.99","9999999999999"]]) {
  test("exact minor units for "+value,()=>assert.equal(minorUnits(value),expected));
}
for (const value of ["-1","1e2","1.001","", " 1", "100000000000"]) {
  test("rejects amount "+JSON.stringify(value),()=>assert.throws(()=>minorUnits(value)));
}
test("formats large amounts without rounding",()=>assert.equal(money("9999999999999"),"$99,999,999,999.99"));
test("formats three or fewer minor digits",()=>assert.equal(majorUnits("9"),"0.09"));
test("formats supported currency",()=>assert.equal(money("560","EUR"),"€5.60"));
for (const value of ["=1+1"," +4","  -3","@note","\tmalicious","\nline","  \rstart"]) {
  test("escapes CSV spreadsheet interpretation for "+JSON.stringify(value),()=>assert.equal(csvCell(value),'"\''+value+'"'));
}
test("escapes CSV quotes",()=>assert.equal(csvCell('A "quote"'),'"A ""quote"""'));
test("preserves typed numeric columns",()=>assert.equal(csvCell("-4",true),'"-4"'));
test("quotes plain names",()=>assert.equal(csvCell("Anne Example"),'"Anne Example"'));
test("escapes wildcard input",()=>assert.equal(escapeLike("ab%_\\cd"),"ab\\%\\_\\\\cd"));
test("normalizes email addresses",()=>assert.equal(schemas.leads.parse({name:"  Example  ",email:"E@EXAMPLE.COM"}).email,"e@example.com"));
test("disallows unexpected owner-controlled attributes",()=>assert.equal(schemas.leads.safeParse({name:"Example",archived_at:null}).success,false));
test("disallows converted on lead creation",()=>assert.equal(schemas.leads.safeParse({name:"Example",status:"converted"}).success,false));
test("disallows blank names",()=>assert.equal(schemas.companies.safeParse({name:" "}).success,false));
test("allows optional phone",()=>assert.equal(schemas.contacts.safeParse({name:"Example"}).success,true));
test("rejects invalid phone",()=>assert.equal(schemas.leads.safeParse({name:"Example",phone:"hello"}).success,false));
test("rejects non-web URL protocol",()=>assert.equal(schemas.companies.safeParse({name:"Example",website:"javascript:alert(1)"}).success,false));
test("validates leap date",()=>assert.equal(schemas.deals.safeParse({title:"Example",expected_close_date:"2024-02-29"}).success,true));
test("rejects invalid date",()=>assert.equal(schemas.deals.safeParse({title:"Example",expected_close_date:"2025-02-29"}).success,false));
test("validates IANA timezone",()=>assert.equal(timeZone.safeParse("America/New_York").success,true));
test("rejects invalid zone",()=>assert.equal(timeZone.safeParse("Moon/North").success,false));
test("requires positive expected version for moves",()=>assert.equal(moveInput.safeParse({stage_id:crypto.randomUUID(),expected_version:0}).success,false));
test("rejects forged system activity",()=>assert.equal(schemas.activities.safeParse({kind:"system",summary:"Example"}).success,false));
