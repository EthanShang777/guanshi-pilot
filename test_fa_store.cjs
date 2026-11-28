const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const origin = 'http://localhost/guanshi-pilot/';
const company = '0f203736ffe56115d8d68a6d';
const canonical = '5da9cd481b0364fbff453caf';
const legacy = 'bfac30061b58fac50eeab57f';

async function start(profile) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
  });
  await context.route(origin + '**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/fa-store.js')) {
      await route.fulfill({path: path.join(__dirname, 'fa-store.js'), contentType:'text/javascript'});
    } else {
      await route.fulfill({contentType:'text/html', body:'<!doctype html><meta charset="utf-8"><script src="fa-store.js"></script>'});
    }
  });
  return context;
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'guanshi-fa-test-'));
  const restored = await fs.mkdtemp(path.join(os.tmpdir(), 'guanshi-fa-restore-test-'));
  let context, targetContext;
  try {
    context = await start(profile);
    let page = await context.newPage();
    await page.goto(origin+'projects.html');
    const data = await page.evaluate(async ids=>{
      const {company,canonical,legacy}=ids;
      const setup = {companyId:company,companyName:'广州大衍信息科技有限公司',sector:'机器人与自动化'};
      const one = await faStore.createProject({...setup,title:'本轮 Pre-A',stage:'Pre-A轮',amount:'5000万',ticket:'1200万',currency:'CNY'});
      const two = await faStore.createProject({...setup,title:'下一轮 A',stage:'A轮',notes:'仅当前设备'});
      await faStore.saveView(one.id,{filters:{sector:setup.sector,cohort:'new',excludeUnknown:true},page:2,scrollY:810});
      const old = {id:'f0b2b66bf2db62bf6fada9e9',title:'具身相关案例',date:'2026-11-27',dateKind:'公开披露日期',
        href:'deal.html?id=f0b2b66bf2db62bf6fada9e9',sources:['https://example.test/old'],stage:'Pre-A轮'};
      const seed = {entityType:'institution',entityId:canonical,name:'高瓴创投',systemReason:'据原披露入选',
        evidence:[old],funds:[{id:'0dd09899e7c27bd1f18f07e5',name:'已知出资基金',source:'https://example.test/registry'}],
        selection:{sector:setup.sector,stage:'Pre-A轮'}};
      await faStore.saveCandidate(one.id,seed);
      await faStore.saveCandidate(one.id,{...seed,href:'institution.html?id='+canonical+'&sector=x',
        systemReason:'换一组条件重复点击',evidence:[{...old,sources:['https://example.test/different']}]});
      const initial = (await faStore.listCandidates(one.id))[0];
      const changed = await faStore.updateCandidate(one.id,'institution',canonical,
        {userReason:'=SUM(1,2)\n用户理由',feedback:'对方需要客户续费数据',status:'暂缓',nextAction:'整理材料'},initial.revision);
      const handled = await faStore.updateCandidate(one.id,'institution',canonical,
        {evidence:[{...old,sources:['https://example.test/new']}]},changed.revision);
      await faStore.removeCandidate(one.id,'institution',canonical);
      const afterRemove = (await faStore.listCandidates(one.id)).length;
      await faStore.saveCandidate(one.id,seed);
      const afterRepeat = (await faStore.listCandidates(one.id)).length;
      const explicitRestore = await faStore.restoreCandidate(one.id,'institution',canonical);
      const removed = await faStore.removeCandidate(one.id,'institution',canonical);
      sessionStorage.setItem('guanshi-shortlist',JSON.stringify([
        {href:'institution.html?id='+legacy+'&sector=a',name:'高瓴创投（联合领投）',reason:'来自试用清单'},
        {href:'institution.html?id='+legacy+'&sector=b',name:'同一旧身份'},
        {href:'company.html?id='+company,name:'曾经收藏的同行'},
        {href:'javascript:void(0)',name:'未知来源'},
      ]));
      await faStore.captureLegacy();
      await faStore.captureLegacy();
      const beforePending=await faStore.listPending();
      const migrated = await faStore.assignPending(one.id,beforePending.find(x=>x.entityId===legacy).key,{
        ...seed, funds:[{id:'2a9ca607076be4fb2b23011b',name:'旧清单里另一只已核基金',
          source:'https://example.test/second-fund'}],
      });
      await faStore.captureLegacy();
      const candidates=await faStore.listCandidates(one.id);
      const view=await faStore.getProject(one.id);
      const csv=faStore.csv(view,candidates);
      const csvPrivate=faStore.csv(view,candidates,{includePrivate:true});
      return {one,two,view,candidates,handled,explicitRestore,removed,migrated,afterRemove,afterRepeat,beforePending,afterPending:await faStore.listPending(),
        twoCandidates:await faStore.listCandidates(two.id),backup:await faStore.exportBackup(),csv,csvPrivate,copy:faStore.clipboard(view,candidates)};
    },{company,canonical,legacy});
    assert.notEqual(data.one.id,data.two.id);
    assert.equal(data.twoCandidates.length,0);
    assert.equal(data.candidates.length,1);
    assert.equal(data.explicitRestore.removedAt,'');
    assert.ok(data.removed.removedAt);
    assert.equal(data.migrated.removedAt,'');
    assert.equal(data.migrated.revision,data.removed.revision+1);
    assert.deepEqual(data.migrated.funds.map(fund=>fund.source),['https://example.test/registry','https://example.test/second-fund']);
    assert.equal(data.migrated.priorEvidence.at(-1).funds.length,1);
    assert.equal(data.migrated.updatedAt,data.view.activityAt);
    assert.equal(data.afterRemove,0);
    assert.equal(data.afterRepeat,0);
    assert.equal(data.candidates[0].status,'暂缓');
    assert.equal(data.candidates[0].feedback,'对方需要客户续费数据');
    assert.ok(data.candidates[0].feedbackUpdatedAt);
    assert.equal(data.candidates[0].systemReason,'据原披露入选');
    assert.equal(data.candidates[0].priorEvidence[0].evidence[0].sources[0],'https://example.test/old');
    assert.equal(data.candidates[0].evidence[0].sources[0],'https://example.test/new');
    assert.equal(data.candidates[0].evidence[0].dateKind,'公开披露日期');
    assert.equal(data.candidates[0].funds[0].source,'https://example.test/registry');
    assert.deepEqual(data.view.view,{filters:{sector:'机器人与自动化',cohort:'new',excludeUnknown:true},page:2,scrollY:810});
    assert.equal(data.view.amount,'5000万');
    assert.equal(data.view.ticket,'1200万');
    assert.equal(data.beforePending.length,3);
    assert.equal(data.afterPending.length,2);
    assert.equal(data.afterPending.find(x=>x.name==='未知来源').href,'');
    assert.ok(data.csv.startsWith('\uFEFF'));
    assert.ok(data.csv.includes("'=SUM(1,2)\n用户理由"));
    assert.ok(data.csv.includes('https://example.test/new'));
    assert.ok(data.csv.includes('https://example.test/registry'));
    assert.ok(data.copy.includes('高瓴创投'));
    assert.ok(!data.csv.includes('对方需要客户续费数据'));
    assert.ok(data.csvPrivate.includes('对方需要客户续费数据'));

    const peer = await context.newPage();
    await peer.goto(origin+'projects.html');
    const stale = await peer.evaluate(id=>faStore.getProject(id),data.one.id);
    await page.evaluate(({id,revision})=>faStore.updateProject(id,{notes:'同一浏览器标签甲新增'},revision),stale);
    const conflict = await peer.evaluate(async ({id,revision})=>{
      try { await faStore.updateProject(id,{notes:'标签乙不可覆盖'},revision); }
      catch(error) { return error.code; }
    },stale);
    assert.equal(conflict,'conflict');
    const failed=await page.evaluate(async ({id,canonical})=>{
      const prior=(await faStore.listCandidates(id))[0];
      const original=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function (...args) {
        if (this.name==='candidates') throw new DOMException('fixture quota', 'QuotaExceededError');
        return original.apply(this,args);
      };
      let code;
      try { await faStore.updateCandidate(id,'institution',canonical,{feedback:'输入不得丢失'},prior.revision); }
      catch(error){ code=error.code; }
      finally { IDBObjectStore.prototype.put=original; }
      return {code,unchanged:(await faStore.listCandidates(id))[0].feedback===prior.feedback};
    },{id:data.one.id,canonical});
    assert.deepEqual(failed,{code:'storage',unchanged:true});

    await context.close();
    context=await start(profile);
    page=await context.newPage();
    await page.goto(origin+'projects.html');
    const reopened=await page.evaluate(async id=>({project:await faStore.getProject(id),cards:await faStore.listCandidates(id)}),data.one.id);
    assert.equal(reopened.project.notes,'同一浏览器标签甲新增');
    assert.equal(reopened.project.view.page,2);
    assert.equal(reopened.cards[0].feedback,'对方需要客户续费数据');

    targetContext=await start(restored);
    const target=await targetContext.newPage();
    await target.goto(origin+'projects.html');
    const imported=await target.evaluate(async ({backup,id})=>{
      const first=await faStore.importBackup(JSON.stringify(backup));
      const second=await faStore.importBackup(backup);
      const original=await faStore.getProject(id);
      const altered=structuredClone(backup);
      altered.projects.find(p=>p.id===id).notes='冲突覆盖测试';
      const conflict=await faStore.importBackup(altered);
      const local=await faStore.getProject(id);
      const copy=await faStore.importBackup(altered,{asCopy:true});
      const badCompany=structuredClone(backup);
      badCompany.projects.find(p=>p.id===id).companyId='000000000000000000000000';
      badCompany.candidates[0].entityId='111111111111111111111111';
      const companyConflict=await faStore.importBackup(badCompany);
      let invalid;
      try{await faStore.importBackup({...backup,candidates:[{...backup.candidates[0],status:'任意状态'}]});}
      catch(error){ invalid=error.code; }
      return {first,second,conflict,copy,companyConflict,invalid,original,local,
        cards:await faStore.listCandidates(id),pending:await faStore.listPending()};
    },{backup:data.backup,id:data.one.id});
    assert.equal(imported.first.projects,2);
    assert.equal(imported.first.candidates,1);
    assert.equal(imported.second.projects,0);
    assert.equal(imported.second.candidates,0);
    assert.equal(imported.second.pending,0);
    assert.equal(imported.conflict.conflicts,1);
    assert.deepEqual(imported.original,imported.local);
    assert.equal(imported.copy.projects,2);
    assert.equal(imported.companyConflict.conflicts,1);
    assert.equal(imported.companyConflict.candidates,0);
    assert.equal(imported.cards.length,1);
    assert.equal(imported.invalid,'invalid');
    assert.equal(imported.cards[0].feedback,'对方需要客户续费数据');
    assert.equal(imported.pending.length,2);
    console.log('FA IndexedDB isolation, evidence history, concurrent edit conflict, browser reopen, backups, legacy assignment, and exports passed.');
  } finally {
    await Promise.all([context?.close(),targetContext?.close()]);
    await Promise.all([profile,restored].map(dir=>fs.rm(dir,{recursive:true,force:true})));
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });
