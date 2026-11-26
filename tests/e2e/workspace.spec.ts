import { expect,test,type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir,readFile,writeFile } from "node:fs/promises";

const evidence="artifacts/visual-qa";
const auditRoot="artifacts/private";
const hosted=!!process.env.CLORIX_TEST_ORIGIN;
const owned:string[]=[];
const mark=hosted?"hosted":"local";

async function screenshot(page:Page,name:string) {
  await mkdir(evidence,{recursive:true});
  await page.screenshot({path:evidence+"/"+mark+"-"+name+".png",animations:"disabled"});
}

async function sandbox(page:Page) {
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"From lead to loyalty.",level:1})).toBeVisible();
  await page.getByRole("link",{name:"Try live sandbox"}).first().click();
  await page.getByRole("checkbox",{name:/fictional data only/}).check();
  const response=page.waitForResponse(res=>res.url().endsWith("/api/v1/access/sandbox"));
  await page.getByRole("button",{name:"Start sandbox"}).click();
  const provision=await response;
  expect(provision.status()).toBe(200);
  const cookieHeader=await provision.headerValue("set-cookie")??"";
  expect(/HttpOnly/i.test(cookieHeader)).toBe(true);
  expect(/SameSite=Lax/i.test(cookieHeader)).toBe(true);
  if(hosted)expect(/; Secure/i.test(cookieHeader)).toBe(true);
  await expect(page.getByRole("heading",{name:"Business overview"})).toBeVisible();
  await expect(page.getByText("Synthetic workspace.")).toBeVisible();
  const spaces=await page.request.get("/api/v1/workspaces");
  owned.push((await spaces.json()).data.workspaces[0].id);
}

function nav(page:Page,name:string) {
  return page.getByRole("navigation",{name:"Workspace navigation"}).getByRole("button",{name,exact:true});
}

test.afterAll(async()=>{
  await mkdir(auditRoot,{recursive:true});
  if(owned.length){
    const file=auditRoot+"/"+mark+"-owned-sandboxes.json";
    const previous=JSON.parse(await readFile(file,"utf8").catch(()=>"[]"));
    await writeFile(file,JSON.stringify([...new Set([...previous,...owned])]));
  }
});

test("marketing, browser lifecycle, search, CSV, reports and isolation",async({page,browser})=>{
  await page.goto("/");
  await expect(page.getByRole("link",{name:"Try live sandbox"}).first()).toBeVisible();
  await screenshot(page,"landing");
  await page.getByRole("tab",{name:"Pipeline"}).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab",{name:"Follow-up"})).toHaveAttribute("aria-selected","true");
  await page.goto("/sandbox");
  await screenshot(page,"sandbox");
  await sandbox(page);
  await expect(page.getByText("Current open opportunities")).toBeVisible();
  await screenshot(page,"dashboard");
  const before=await (await page.request.get("/api/v1/reports")).json();
  const seedWon=BigInt(before.data.won_minor);

  await page.getByRole("button",{name:"New lead",exact:true}).click();
  let dialog=page.getByRole("dialog");
  await dialog.getByLabel("Name",{exact:true}).fill("Fictional Browser Prospect");
  await dialog.getByLabel("Email",{exact:true}).fill("fictional-browser@clorix.example");
  await dialog.getByLabel("Company name",{exact:true}).fill("Fictional Browser Studio");
  await dialog.getByLabel("Source",{exact:true}).fill("Referral");
  await dialog.getByRole("button",{name:"Create lead"}).click();
  await expect(page.getByRole("heading",{name:"Fictional Browser Prospect"})).toBeVisible();
  await page.getByRole("button",{name:"Qualify lead"}).click();
  await page.getByRole("button",{name:"Convert lead"}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("Deal title").fill("Fictional Browser Deal");
  await dialog.getByLabel("Deal amount").fill("17.25");
  await dialog.getByRole("button",{name:"Convert lead"}).click();
  await expect(page.getByRole("heading",{name:"Fictional Browser Deal"})).toBeVisible();

  await page.getByRole("button",{name:"Log activity"}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("Activity type").selectOption("call");
  await dialog.getByLabel("Summary").fill("Fictional discovery call logged");
  await dialog.getByRole("button",{name:"Create activity"}).click();
  await expect(page.getByRole("button",{name:/Fictional discovery call logged/})).toBeVisible();

  await page.getByRole("button",{name:"Add linked task"}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Fictional browser follow-up");
  await dialog.getByRole("button",{name:"Create task"}).click();
  await page.getByRole("button",{name:/Fictional browser follow-up/}).click();
  await page.getByRole("button",{name:"Complete task"}).click();
  await expect(page.getByRole("button",{name:"Reopen task"})).toBeVisible();

  await nav(page,"Pipeline").click();
  const card=page.locator(".deal-card").filter({hasText:"Fictional Browser Deal"});
  const proposal=page.locator(".kanban-stage").filter({has:page.getByRole("heading",{name:/^Proposal/})});
  await expect(card).toBeVisible();
  if(!hosted) {
    await page.route("**/api/v1/deals/**/move",route=>route.fulfill({status:409,json:{error:{code:"stale",message:"This record changed. Refresh it before trying again."}}}));
    await card.dragTo(proposal);
    await expect(page.getByRole("alert").filter({hasText:"This record changed."})).toBeVisible();
    await expect(proposal.getByRole("button",{name:"Fictional Browser Deal",exact:true})).toHaveCount(0);
    await page.unroute("**/api/v1/deals/**/move");
  }
  await card.dragTo(proposal);
  await expect(proposal.getByRole("button",{name:"Fictional Browser Deal",exact:true})).toBeVisible();
  await screenshot(page,"pipeline");
  await card.getByRole("button",{name:"Move deal Fictional Browser Deal"}).focus();
  await page.keyboard.press("Enter");
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("New stage").selectOption({label:"Closed Won"});
  await dialog.getByRole("button",{name:"Move deal",exact:true}).click();
  const won=page.locator(".kanban-stage").filter({has:page.getByRole("heading",{name:/^Closed Won/})});
  await expect(won.getByRole("button",{name:"Fictional Browser Deal",exact:true})).toBeVisible();
  await nav(page,"Reports").click();
  await expect(page.getByRole("heading",{name:"Won deal value"})).toBeVisible();
  await screenshot(page,"reports");
  const after=await (await page.request.get("/api/v1/reports")).json();
  expect(BigInt(after.data.won_minor)).toBe(seedWon+1725n);

  await page.reload();
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox",{name:"Search workspace records"}).fill("Fictional Browser Prospect");
  await expect(page.getByRole("button",{name:"Fictional Browser Prospect Leads"})).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"Fictional Browser Prospect"})).toBeVisible();
  await page.locator(".related").filter({has:page.getByRole("heading",{name:"Contacts",exact:true})}).getByRole("button",{name:/Fictional Browser Prospect/}).click();
  await expect(page.getByRole("heading",{name:"Record details"})).toBeVisible();
  await screenshot(page,"contact");
  await nav(page,"Leads").click();
  await expect(page.getByRole("button",{name:"Fictional Browser Prospect",exact:true})).toBeVisible();
  await screenshot(page,"leads");
  await nav(page,"Contacts").click();
  await page.getByRole("button",{name:"Import CSV"}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("CSV file").setInputFiles({name:"sample.csv",mimeType:"text/csv",
    buffer:Buffer.from("name,email\nFictional Browser CSV,csv-browser@clorix.example\n")});
  await dialog.getByRole("button",{name:"Preview CSV"}).click();
  await expect(dialog.getByText("1 ready · 0 skipped · 0 errors")).toBeVisible();
  await dialog.getByRole("button",{name:"Confirm import"}).click();
  await expect(page.getByRole("button",{name:"Fictional Browser CSV",exact:true})).toBeVisible();
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Export CSV"}).click();
  expect((await download).suggestedFilename()).toBe("clorix-contacts.csv");

  const second=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  try{
    const mobile=await second.newPage();
    await sandbox(mobile);
    await expect(mobile.getByText("Current open opportunities")).toBeVisible();
    await screenshot(mobile,"mobile-dashboard");
    expect(await mobile.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await mobile.getByRole("button",{name:"Open navigation"}).click();
    await nav(mobile,"Leads").click();
    await expect(mobile.getByRole("heading",{name:"Leads"})).toBeVisible();
    await expect(mobile.getByRole("button",{name:"Fictional Browser Prospect",exact:true})).toHaveCount(0);
    const results=await mobile.request.get("/api/v1/search?q=Fictional%20Browser");
    expect((await results.json()).data).toEqual([]);
  }finally{await second.close();}
  await page.getByRole("button",{name:"Sign out",exact:true}).filter({visible:true}).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get("/api/v1/leads")).status()).toBe(401);
});

test("keyboard, layout and accessibility at five viewport sizes @local",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  for(const width of [375,390,768,1280,1440]){
    await page.setViewportSize({width,height:950});
    await page.goto("/");
    await expect(page.getByRole("heading",{level:1})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  const landing=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
  expect(landing.violations.map(issue=>({id:issue.id,targets:issue.nodes.map(node=>node.target)}))).toEqual([]);
  await page.setViewportSize({width:768,height:900});
  await sandbox(page);
  await expect(page.getByText("Current open opportunities")).toBeVisible();
  const workspace=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
  expect(workspace.violations.map(issue=>({id:issue.id,targets:issue.nodes.map(node=>node.target)}))).toEqual([]);
  await page.getByRole("button",{name:"Open navigation"}).focus();
  await page.keyboard.press("Enter");
  await expect(nav(page,"Dashboard")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav(page,"Dashboard")).toBeHidden();
});

test("private invited registration and reload persistence",async({page})=>{
  const invite=process.env.CLORIX_TEST_PRIVATE_INVITE;
  const email=process.env.CLORIX_TEST_PRIVATE_EMAIL;
  const password=process.env.CLORIX_TEST_PRIVATE_PASSWORD;
  test.skip(!invite||!email||!password,"Dedicated synthetic private fixture required.");
  await page.goto(String(invite));
  await page.getByLabel("Name",{exact:true}).fill("Private evaluator");
  await page.getByLabel("Email",{exact:true}).fill(String(email));
  await page.getByLabel("Password",{exact:true}).fill(String(password));
  await page.getByRole("button",{name:"Create account"}).click();
  await expect(page.getByRole("heading",{name:"Business overview"})).toBeVisible();
  const workspace=(await (await page.request.get("/api/v1/workspaces")).json()).data.workspaces[0];
  expect(workspace.kind).toBe("private");
  await mkdir(auditRoot,{recursive:true});
  await writeFile(auditRoot+"/"+mark+"-owned-private.json",JSON.stringify({id:workspace.id,email}));
  await page.getByRole("button",{name:"New lead",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Name",{exact:true}).fill("Synthetic Private Record");
  await dialog.getByRole("button",{name:"Create lead"}).click();
  await expect(page.getByRole("heading",{name:"Synthetic Private Record"})).toBeVisible();
  await page.getByRole("button",{name:"Sign out",exact:true}).filter({visible:true}).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/sign-in");
  await page.getByLabel("Email",{exact:true}).fill(String(email));
  await page.getByLabel("Password",{exact:true}).fill(String(password));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Business overview"})).toBeVisible();
  await nav(page,"Leads").click();
  await expect(page.getByRole("button",{name:"Synthetic Private Record",exact:true})).toBeVisible();
});
