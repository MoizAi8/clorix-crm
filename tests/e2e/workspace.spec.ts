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
  const moved=page.waitForResponse(res=>res.request().method()==="POST" && /\/api\/v1\/deals\/[^/]+\/move$/.test(res.url()));
  await card.dragTo(proposal);
  expect((await moved).status()).toBe(200);
  await expect(proposal.getByRole("button",{name:"Fictional Browser Deal",exact:true})).toBeVisible();
  await screenshot(page,"pipeline");
  const moveButton=proposal.getByRole("button",{name:"Move deal Fictional Browser Deal"});
  await expect(moveButton).toBeEnabled();
  await moveButton.press("Enter");
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
  if(process.env.CLORIX_ENGINE_BROWSER_TEST==="1") {
    await page.getByRole("button",{name:"Synthetic Private Record",exact:true}).click();
    await page.getByRole("button",{name:"Add attachment"}).click();
    await dialog.getByLabel("Attachment file").setInputFiles({name:"verification.txt",mimeType:"text/plain",
      buffer:Buffer.from("Synthetic verification bytes.")});
    await dialog.getByRole("button",{name:"Upload attachment"}).click();
    await expect(page.getByText("verification.txt",{exact:true})).toBeVisible();
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download",exact:true}).click();
    const file=await download;
    expect(file.suggestedFilename()).toBe("verification.txt");
    expect(await readFile((await file.path())!,"utf8")).toBe("Synthetic verification bytes.");
    await page.getByRole("button",{name:"Delete attachment",exact:true}).click();
    await dialog.getByRole("button",{name:"Delete file"}).click();
    await expect(page.getByText("verification.txt",{exact:true})).toHaveCount(0);
  }
});

test("advanced pipeline, explainable lead score, workflow execution and inbox @advanced",async({page})=>{
  test.skip(process.env.CLORIX_ENGINE_BROWSER_TEST!=="1","The advanced service is not configured for this browser run.");
  await sandbox(page);
  await nav(page,"Pipeline settings").click();
  await page.getByLabel("Pipeline name",{exact:true}).first().fill("Evaluation expansion");
  await page.getByRole("button",{name:"Create pipeline",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Evaluation expansion",exact:true})).toBeVisible();
  await nav(page,"Workflow studio").click();
  await page.getByRole("button",{name:"New workflow",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Name",{exact:true}).fill("Create a fictional follow-up");
  await dialog.getByLabel("Active",{exact:true}).check();
  await dialog.getByLabel("Action value",{exact:true}).fill("Advanced browser follow-up");
  await dialog.getByRole("button",{name:"Add action",exact:true}).click();
  await dialog.getByRole("combobox",{name:"Action 2",exact:true}).selectOption("notification");
  await dialog.getByLabel("Action value",{exact:true}).last().fill("Advanced browser notification");
  await dialog.getByRole("button",{name:"Save workflow",exact:true}).click();
  await expect(page.getByText("Create a fictional follow-up",{exact:true})).toBeVisible();
  await nav(page,"Leads").click();
  await page.getByRole("button",{name:"New lead",exact:true}).click();
  await dialog.getByLabel("Name",{exact:true}).fill("Advanced Browser Example");
  await dialog.getByRole("button",{name:"Create lead",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Advanced Browser Example",exact:true})).toBeVisible();
  await nav(page,"Sales intelligence").click();
  await page.getByRole("button",{name:"Lead scores",exact:true}).click();
  await page.getByLabel("Find leads",{exact:true}).fill("Advanced Browser Example");
  await expect(page.getByRole("button",{name:"Advanced Browser Example",exact:true})).toBeVisible();
  await page.getByText("Scoring explanation",{exact:true}).click();
  await expect(page.getByText("No recorded outreach · Missing input",{exact:true})).toBeVisible();
  await screenshot(page,"advanced-intelligence");
  await nav(page,"Workflow studio").click();
  await page.getByRole("button",{name:"Evaluate now",exact:true}).click();
  await expect(page.getByText("2 action(s) completed.",{exact:true})).toBeVisible();
  await screenshot(page,"advanced-workflows");
  await nav(page,"Notifications").click();
  await expect(page.getByText("Advanced browser notification",{exact:true})).toBeVisible();
  await nav(page,"Tasks").click();
  await expect(page.getByRole("button",{name:"Advanced browser follow-up",exact:true})).toBeVisible();
});

test("quotation, invoice, partial payment and downloadable PDF @advanced",async({page})=>{
  test.skip(process.env.CLORIX_ENGINE_BROWSER_TEST!=="1","The advanced service is not configured for this browser run.");
  await sandbox(page);
  await nav(page,"Billing").click();
  await page.getByRole("button",{name:"Catalog",exact:true}).click();
  await page.getByRole("button",{name:"New catalog item",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Name",{exact:true}).fill("Browser evaluation package");
  await dialog.getByLabel("SKU or code",{exact:true}).fill("BROWSER-01");
  await dialog.getByLabel("Unit price",{exact:false}).fill("25.01");
  await dialog.getByLabel("Default tax %",{exact:true}).fill("5");
  await dialog.getByRole("button",{name:"Save item",exact:true}).click();
  await expect(page.getByText("Browser evaluation package",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Quotations",exact:true}).click();
  await page.getByRole("button",{name:"New quotation",exact:true}).click();
  await dialog.getByLabel("Subject",{exact:true}).fill("Fixture browser quotation");
  await dialog.getByRole("combobox",{name:"Company",exact:true}).selectOption({label:"Northwind Atelier"});
  await dialog.getByRole("combobox",{name:"Catalog item 1",exact:true}).selectOption({label:"Browser evaluation package · BROWSER-01"});
  await dialog.getByLabel("Quantity 1",{exact:true}).fill("1.25");
  await dialog.getByLabel("Discount 1",{exact:true}).fill("10");
  await dialog.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Fixture browser quotation/,level:1})).toBeVisible();
  await expect(page.getByText("$29.54",{exact:true}).first()).toBeVisible();
  await page.getByRole("button",{name:"Record as sent",exact:true}).click();
  await page.getByRole("button",{name:"Record acceptance",exact:true}).click();
  await page.getByRole("button",{name:"Create invoice",exact:true}).click();
  await expect(page.getByRole("heading",{name:/INV-.*Fixture browser quotation/,level:1})).toBeVisible();
  await page.getByRole("button",{name:"Issue invoice",exact:true}).click();
  await page.getByRole("button",{name:"Record payment",exact:true}).click();
  await dialog.getByLabel("Amount",{exact:false}).fill("15.00");
  await dialog.getByRole("button",{name:"Record payment",exact:true}).click();
  await expect(page.getByText("$14.54",{exact:true})).toBeVisible();
  await screenshot(page,"advanced-billing");
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download PDF",exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/^clorix-inv-\d{5}\.pdf$/);
});

test("support ticket resolution, calendar and recorded team goal @advanced",async({page})=>{
  test.skip(process.env.CLORIX_ENGINE_BROWSER_TEST!=="1","The advanced service is not configured for this browser run.");
  await sandbox(page);
  await nav(page,"Support").click();
  await page.getByRole("button",{name:"New ticket",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Subject",{exact:true}).fill("Fictional browser support request");
  await dialog.getByRole("combobox",{name:"Company",exact:true}).selectOption({label:"Northwind Atelier"});
  await dialog.getByLabel("Description",{exact:true}).fill("This is a fictional support request.");
  await dialog.getByRole("button",{name:"Open ticket",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Fictional browser support request/,level:1})).toBeVisible();
  await page.getByLabel("New note",{exact:true}).fill("Fictional backstage check completed.");
  await page.getByRole("button",{name:"Add internal note",exact:true}).click();
  await expect(page.getByText("Fictional backstage check completed.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Edit ticket",exact:true}).click();
  await dialog.getByRole("combobox",{name:"Status",exact:true}).selectOption("resolved");
  await dialog.getByLabel("Resolution note",{exact:true}).fill("Fictional resolution saved.");
  await dialog.getByRole("button",{name:"Save ticket",exact:true}).click();
  await expect(page.getByText("Fictional resolution saved.",{exact:true})).toBeVisible();
  await page.keyboard.press("Control+k");
  const finder=page.getByRole("dialog",{name:"Search workspace"});
  await finder.getByLabel("Record category").selectOption("support");
  await finder.getByRole("textbox",{name:"Search workspace records"}).fill("Fictional browser support");
  await finder.getByRole("button",{name:/Fictional browser support request/}).click();
  await expect(page.getByRole("heading",{name:/Fictional browser support request/,level:1})).toBeVisible();
  await screenshot(page,"advanced-support");
  await nav(page,"Calendar").click();
  await page.getByRole("button",{name:"New event",exact:true}).click();
  await dialog.getByLabel("Title",{exact:true}).fill("Fictional browser meeting");
  await dialog.getByRole("button",{name:"Save event",exact:true}).click();
  await expect(page.getByRole("button",{name:"Fictional browser meeting",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"View",exact:true}).selectOption("agenda");
  await expect(page.getByRole("button",{name:"Fictional browser meeting",exact:true})).toBeVisible();
  await nav(page,"Team performance").click();
  await page.getByRole("button",{name:"Set target",exact:true}).click();
  await dialog.getByLabel("Target",{exact:false}).fill("120000.00");
  await dialog.getByRole("button",{name:"Save target",exact:true}).click();
  await expect(page.getByText(/\$120,000.00/)).toBeVisible();
});


test("campaigns, email drafts, reports, custom fields and saved views @advanced",async({page})=>{
  test.skip(process.env.CLORIX_ENGINE_BROWSER_TEST!=="1","The advanced service is not configured for this browser run.");
  await sandbox(page);
  await nav(page,"Productivity").click();
  const dialog=page.getByRole("dialog");
  await page.getByRole("button",{name:"New campaign",exact:true}).click();
  await dialog.getByLabel("Campaign name").fill("Fictional partner campaign");
  await dialog.getByLabel("Channel",{exact:true}).fill("Partner");
  await dialog.getByLabel("Actual cost").fill("125.50");
  await dialog.getByRole("button",{name:"Save campaign"}).click();
  await page.getByRole("button",{name:"Fictional partner campaign",exact:true}).click();
  const lead=page.getByRole("combobox",{name:"Lead",exact:true});
  await lead.locator("option").nth(1).waitFor({state:"attached"});
  const leadName=(await lead.locator("option").nth(1).textContent())!;
  await lead.selectOption({index:1});
  await page.getByRole("button",{name:"Attribute lead"}).click();
  await expect(page.getByRole("button",{name:"Remove attribution"})).toBeVisible();
  await expect(page.getByText(/Cost per lead \$125.50/)).toBeVisible();

  await page.getByRole("button",{name:"Email templates",exact:true}).click();
  await page.getByRole("button",{name:"New template"}).click();
  await dialog.getByLabel("Template name").fill("Partner follow-up");
  await dialog.getByLabel("Category").fill("Follow-up");
  await dialog.getByLabel("Subject").fill("Hello {{first_name}}");
  await dialog.getByLabel("Body").fill("Fictional conversation with {{contact_name}}.");
  await dialog.getByRole("button",{name:"Save template"}).click();
  const contact=page.getByRole("combobox",{name:"Contact",exact:true});
  await contact.locator("option").nth(1).waitFor({state:"attached"});
  await contact.selectOption({index:1});
  await page.getByRole("button",{name:"Preview draft",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Hello /})).toBeVisible();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Recent drafts"})).toBeVisible();

  await page.getByRole("button",{name:"Custom fields",exact:true}).click();
  await page.getByRole("button",{name:"New custom field"}).click();
  await dialog.getByLabel("Field name").fill("Renewal context");
  await dialog.getByRole("button",{name:"Save custom field"}).click();
  await expect(page.getByRole("button",{name:"Renewal context",exact:true})).toBeVisible();
  await nav(page,"Leads").click();
  await page.getByRole("textbox",{name:"Search leads"}).fill(leadName);
  await page.getByRole("button",{name:"Apply filters"}).click();
  await page.getByRole("button",{name:"Save current filters"}).click();
  await dialog.getByLabel("View name").fill("Partner leads");
  await dialog.getByRole("button",{name:"Save view",exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button",{name:leadName,exact:true}).click();
  await page.getByRole("button",{name:"Set Renewal context",exact:true}).click();
  await dialog.getByLabel("Renewal context").fill("Fictional account renewal");
  await dialog.getByRole("button",{name:"Save value"}).click();
  await expect(page.getByRole("button",{name:"Fictional account renewal",exact:true})).toBeVisible();

  await nav(page,"Productivity").click();
  await page.getByRole("button",{name:"Report builder",exact:true}).click();
  await page.getByRole("button",{name:"Run report"}).click();
  await page.getByRole("textbox",{name:"Report name"}).fill("Lead sources this month");
  await page.getByRole("button",{name:"Save report",exact:true}).click();
  await expect(page.getByRole("option",{name:"Lead sources this month",exact:true})).toBeAttached();
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Export report CSV"}).click();
  expect((await download).suggestedFilename()).toMatch(/^clorix-lead_source-.*\.csv$/);
  await screenshot(page,"advanced-productivity");
  await page.getByRole("table").getByRole("button").first().click();
  await expect(page.getByRole("dialog",{name:/Records for /}).getByRole("button").nth(1)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Audit log",exact:true}).click();
  await page.getByLabel("Resource type").fill("campaigns");
  await page.getByRole("button",{name:"Filter audit log"}).click();
  await expect(page.getByText("Campaigns",{exact:true}).last()).toBeVisible();

  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"Open navigation"}).click();
  await expect(nav(page,"Productivity")).toBeVisible();
  await nav(page,"Productivity").click();
  await expect(page.getByRole("heading",{name:"Productivity",level:1})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screenshot(page,"advanced-productivity-mobile");
});
