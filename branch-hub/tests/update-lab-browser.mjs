// Browser verification for the standalone presentation-update experiment.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLab } from '../update-lab/server.mjs';
const dataDir=await mkdtemp(join(tmpdir(),'johnas-ui-update-'));
let lab,browser;
try{
  lab=await startLab({dataDir,port:0,feedPort:0,pollMs:200});
  browser=await chromium.launch({headless:true,...(process.env.JOHNAS_LAB_BROWSER?{executablePath:process.env.JOHNAS_LAB_BROWSER}:{}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1100,height:850}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.goto(`http://127.0.0.1:${lab.port}`);
  await page.locator('#version').filter({hasText:'الإصدار الأول'}).waitFor();
  await page.locator('#draft').fill('طلب وهمي — طاولة ٥ بدون بصل');
  await page.locator('#saved').filter({hasText:'تم حفظ'}).waitFor();
  await page.locator('#publish').click();await page.locator('#newScreen').waitFor({state:'visible'});
  assert.equal(await page.locator('#draft').inputValue(),'طلب وهمي — طاولة ٥ بدون بصل');assert.equal(navigations,1);
  await page.locator('#offline').click();await page.locator('#publish').click();await lab.poll();
  assert.equal(lab.view().sequence,2);assert.equal(lab.view().draft,'طلب وهمي — طاولة ٥ بدون بصل');
  await page.locator('#offline').filter({hasText:'إعادة'}).click();
  await page.waitForFunction(()=>document.querySelector('#version').textContent.includes('3'));
  await page.locator('#corrupt').click();
  await page.locator('#status').filter({hasText:'حزمة مرفوضة'}).waitFor();assert.equal(lab.view().sequence,3);
  await page.locator('#payment').click();
  while(!lab.view().busy)await new Promise(r=>setTimeout(r,10));
  await page.locator('#publish').click();await lab.poll();assert.equal(lab.view().sequence,3);
  await page.waitForFunction(()=>document.querySelector('#version').textContent.includes('5'));
  assert.equal(await page.locator('#draft').inputValue(),'طلب وهمي — طاولة ٥ بدون بصل');assert.equal(navigations,1);
  assert.deepEqual(errors,[]);
  if(process.env.JOHNAS_LAB_SCREENSHOT)await page.screenshot({path:process.env.JOHNAS_LAB_SCREENSHOT,fullPage:true});
  console.log('PASS: browser automatic activation, preserved draft, simulated outage/reconnect, corrupt rejection and payment barrier; no page reload.');
}finally{if(browser)await browser.close();if(lab)await lab.close();await rm(dataDir,{recursive:true,force:true});}
