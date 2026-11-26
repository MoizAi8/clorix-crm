import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const url=process.argv[2]??"http://localhost:3000";
const browser=await chromium.launch({channel:process.env.CI?"chromium":"chrome"});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    window.clorixPaint={lcp:0,cls:0,lastShift:0,windowStart:0,session:0};
    new PerformanceObserver(list=>{
      for(const entry of list.getEntries())window.clorixPaint.lcp=entry.startTime;
    }).observe({type:"largest-contentful-paint",buffered:true});
    new PerformanceObserver(list=>{
      for(const entry of list.getEntries()){
        if(entry.hadRecentInput)continue;
        const p=window.clorixPaint;
        const time=entry.startTime;
        if(!p.lastShift||time-p.lastShift>1000||time-p.windowStart>5000){p.windowStart=time;p.session=0;}
        p.session+=entry.value;
        p.lastShift=time;
        p.cls=Math.max(p.cls,p.session);
      }
    }).observe({type:"layout-shift",buffered:true});
  });
  const samples=[];
  for(let index=0;index<4;index++){
    await page.goto(url,{waitUntil:"load"});
    await page.evaluate(()=>document.fonts.ready.then(()=>null));
    await page.waitForFunction(()=>window.clorixPaint.lcp>0);
    await page.waitForTimeout(700);
    samples.push(await page.evaluate(()=>({lcpMs:Math.round(window.clorixPaint.lcp),cls:Number(window.clorixPaint.cls.toFixed(4))})));
  }
  const result={mode:"Chrome desktop process with 390×844 mobile emulation, unthrottled",url,firstNavigation:samples[0],warmNavigations:samples.slice(1)};
  const name=new URL(url).hostname==="localhost"?"local":"hosted";
  await writeFile("artifacts/visual-qa/"+name+"-landing-performance.json",JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result));
} finally {await browser.close();}
