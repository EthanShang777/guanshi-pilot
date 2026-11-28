const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const home = 'http://localhost/guanshi-pilot/index.html';
const companyId = '358f253ec2c56567e7df5a5c';
const originalId = 'ea8b1a03-dd98-4aae-9869-42a29a90c651';

async function open(browser) {
  const context = await browser.newContext();
  await context.route('http://localhost/guanshi-pilot/**', route => route.request().url().endsWith('/fa-store.js')
    ? route.fulfill({path:path.join(__dirname,'fa-store.js'),contentType:'text/javascript'})
    : route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><script src="fa-store.js"></script>'}));
  const page = await context.newPage();
  await page.goto(home);
  return page;
}

(async()=>{
  const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  try {
    const page = await open(browser);
    const check = await page.evaluate(async ({originalId,companyId})=>{
      await new Promise((resolve,reject)=>{
        const request = indexedDB.open('guanshi-pilot-fa-v1',1);
        request.onupgradeneeded = () => {
          const db = request.result, now=new Date().toISOString();
          const projects=db.createObjectStore('projects',{keyPath:'id'});
          projects.put({id:originalId,companyId,companyName:'Dify',title:'旧版项目',notes:'本地旧备注',revision:1,
            createdAt:now,updatedAt:now,activityAt:now,view:{page:2}});
          const candidates=db.createObjectStore('candidates',{keyPath:['projectId','entityType','entityId']});
          candidates.createIndex('project','projectId');
          db.createObjectStore('pending',{keyPath:'key'});
        };
        request.onsuccess=()=>{request.result.close(); resolve();};
        request.onerror=()=>reject(request.error);
      });
      const old=await faStore.getProject(originalId);
      const watch=await faStore.saveResearch('watch',{id:'company:'+companyId,target:{type:'company',id:companyId,name:'Dify'}});
      const comparison=await faStore.saveResearch('comparison',{id:crypto.randomUUID(),name:'比较组合',companies:[{id:companyId,name:'Dify'}],notes:'本地私人意见',projectId:originalId});
      const judgment=await faStore.saveResearch('judgment',{id:crypto.randomUUID(),title:'原判断',opinion:'本地私人依据',targets:[{type:'comparison',id:comparison.id}]});
      let conflict='';
      try{await faStore.saveResearch('judgment',{...judgment,opinion:'过期表单'},0);}catch(error){conflict=error.code;}
      await faStore.removeResearch('watch',watch.id,watch.revision);
      const privateBackup=await faStore.exportBackup();
      const publicBackup=await faStore.exportBackup({includePrivate:false});
      return {old,comparison,judgment,conflict,privateBackup,publicBackup};
    },{originalId,companyId});
    assert.equal(check.old.notes,'本地旧备注');
    assert.equal(check.old.view.page,2);
    assert.equal(check.conflict,'conflict');
    assert.equal(check.privateBackup.research.length,2);
    assert.deepEqual(check.publicBackup.research,[]);
    assert.ok(!JSON.stringify(check.publicBackup).includes('本地私人'));
    await page.reload();
    assert.equal(await page.evaluate(async id=>(await faStore.getResearch('judgment',id)).opinion,check.judgment.id),'本地私人依据');
    const other=await open(browser);
    const restored=await other.evaluate(async ({backup,id})=>{
      const fresh=await faStore.listResearch('judgment');
      const first=await faStore.importBackup(backup);
      const replay=await faStore.importBackup(backup);
      const copy=await faStore.importBackup(backup,{asCopy:true});
      return {fresh,first,replay,copy,judgments:await faStore.listResearch('judgment'),comparisons:await faStore.listResearch('comparison'),original:await faStore.getProject(id)};
    },{backup:check.privateBackup,id:originalId});
    assert.deepEqual(restored.fresh,[]);
    assert.equal(restored.first.research,2);
    assert.equal(restored.replay.research,0);
    assert.equal(restored.copy.research,2);
    assert.equal(restored.comparisons.length,2);
    const copied=restored.judgments.find(row=>row.id!==check.judgment.id);
    assert.equal(copied.opinion,'本地私人依据');
    assert.ok(restored.comparisons.some(row=>row.id===copied.targets[0].id&&row.id!==check.comparison.id));
    assert.equal(restored.original.notes,'本地旧备注');
    console.log('Investor database upgrade, revision conflict, isolated records and backup restoration passed.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
