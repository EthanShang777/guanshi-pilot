const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const test = require('node:test');
const project = '28df6051-6a02-46b2-8f10-e9112274aa10';
const a = 'a'.repeat(24), b = 'b'.repeat(24), c = 'c'.repeat(24);
const href = 'https://example.org/guanshi-pilot/company.html';
const api = vm.runInNewContext(
  fs.readFileSync('fa-navigation.js','utf8')+'\nfaNavigation',
  {URL, URLSearchParams, location:{href,search:''}},
);
test('managed funds share one outreach identity but retain separate legal fund IDs',()=>{
  const data={
    [a]:{name:'一期',managerId:b,managerName:'管理人',source:'https://example.org/1'},
    [c]:{name:'二期',managerId:b,managerName:'管理人',source:'https://example.org/2'},
  };
  assert.equal(api.resolveInvestor(a,'一期',data).entityId,b);
  assert.equal(api.resolveInvestor(c,'二期',data).entityId,api.resolveInvestor(b,'管理人',data).entityId);
  assert.equal(api.resolveInvestor(a,'一期',data).funds[0].id,a);
  assert.equal(api.resolveInvestor(c,'二期',data).funds[0].id,c);
  assert.equal(api.resolveInvestor(c,'二期',{[c]:{name:'二期',managerId:''}}).entityType,'fund');
});
test('only same-site archive links carry opaque project context',()=>{
  const result=new URL(api.contextHref('deal.html?id='+a,project,'saved',b));
  assert.equal(result.searchParams.get('project'),project);
  assert.equal(result.searchParams.get('candidate'),b);
  assert.equal(result.searchParams.get('from'),'saved');
  assert.equal(api.contextHref('https://example.org/disclosure',project),'https://example.org/disclosure');
  assert.equal(api.contextHref('https://another.example/guanshi-pilot/deal.html',project),'https://another.example/guanshi-pilot/deal.html');
  assert.equal(api.contextHref('deal.html?id='+a,'私有内容'),'deal.html?id='+a);
});
