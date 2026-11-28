const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const code=readFileSync('fa-match.js','utf8');
const {analyze,loadMatchingRows,parseQuery}=runInNewContext(code+'\nfaMatching');
const sectorFilter={
  matches({sector,sub},s,d){return (!sector||s===sector)&&(!sub||sub===d);}
};
const id='a'.repeat(24), home='company.html?id='+id, robot='机器人与自动化', fine='触觉传感';
const event=(k, name, day, sector, sub, stage, companies, target='company.html?id='+k.repeat(24))=>
  [k.repeat(24),name,[],day,sector,stage,null,companies,null,sub,null,target,[]];
const rows=[
  event('b','历史企业', '2026-07-01',robot,fine,'A轮',['某管理人'],home),
  event('c','触觉公司', '2026-06-01',robot,fine,'A轮',['机构一','某管理人','某实证基金']),
  event('d','案例方向未知', '2026-08-01',robot,'','',['未知机构']),
  event('e','触觉项目', '2026-05-01',robot,fine,'B轮',['轮次不同']),
  event('f','自动化', '2026-07-01',robot,'工厂控制','A轮',['无关机构']),
  event('9','案例分类未知', '2026-07-01','待归类','','A轮',['无依据']),
];
const fundIndex={['4'.repeat(24)]:{name:'某实证基金',managerId:'5'.repeat(24),managerName:'某管理人',source:'https://example.com/fund'}};
const input=(filters={})=>({rows,historyRows:[rows[0]],filters:{sector:robot,sub:fine,stage:'A轮',cohort:'new',...filters},project:{companyId:id},fundIndex,sectorFilter});
const names=result=>Array.from(result.groups,g=>g.name);
test('scope keeps unknown from relevant sectors, and separately explains actual nonmatching rounds',()=>{
  const result=analyze(input());
  assert.deepEqual(names(result),['机构一','轮次不同','未知机构']);
  const unknown=result.groups.find(g=>g.name==='未知机构');
  assert.equal(unknown.unknown,true);
  assert.ok(result.groups.find(g=>g.name==='轮次不同').checks.some(c=>c.state==='different'));
  assert.deepEqual(names(analyze(input({excludeUnknown:true}))),['机构一','轮次不同']);
});
test('known fund shares one outreach identity with manager and retains both routes and cases',()=>{
  const {groups}=analyze(input({cohort:'follow'}));
  assert.deepEqual(Array.from(groups,g=>g.name),['某管理人']);
  assert.equal(groups[0].funds[0].id,'4'.repeat(24));
  assert.equal(groups[0].caseCount,2);
});
test('historical evidence remains available when an exploration year filters out its own case',()=>{
  const {groups}=analyze({...input({cohort:'all',year:'2026'}),rows:rows.slice(1)});
  assert.ok(groups.find(g=>g.name==='某管理人').historical);
});
test('no accidental whole site candidates when the company has no known industry or keyword',()=>{
  assert.deepEqual(names(analyze(input({sector:'',sub:'',keyword:'',stage:''}))),[]);
});
test('natural language reports unverified requirements and does not apply them',()=>{
  const parsed=parseQuery('找2026年机器人与自动化赛道的A轮资方，要求华东落地，单家3000万元',
    {years:['2026'],sectors:[robot],subs:{[robot]:[fine,'机器人','自动化']}},{});
  assert.equal(parsed.filters.sector,robot);
  assert.equal(parsed.filters.sub,'');
  assert.equal(parsed.filters.stage,'A轮');
  assert.equal(parsed.filters.year,'2026');
  assert.match(parsed.unresolved,/华东落地/);
  assert.equal(parsed.filters.region,undefined);
});

test('explicit adjacent scope stays in the parent and uses only other identified directions',()=>{
  const request=input({sub:'',adjacent:true});
  request.project={...request.project,sector:robot,sub:fine};
  assert.deepEqual(names(analyze(request)),['无关机构']);
});

const sectorFile='fa-sector-robotics-automation-abcdef123456';
const meta={years:['2026','2025'],faSearchSectors:{[robot]:sectorFile}};
test('scoped queries reuse one canonical sector shard and preserve the full analysis',async()=>{
  const calls=[];
  const load=async name=>{
    calls.push(name);
    return rows.filter(row=>row[4]===robot);
  };
  const cache=new Map();
  for(const cohort of ['new','follow','all']){
    const request=input({cohort});
    const scoped=await loadMatchingRows(request.filters,meta,load,cache,()=>true);
    assert.deepEqual(analyze({...request,rows:scoped}),analyze(request));
  }
  assert.deepEqual(calls,[sectorFile]);
});

test('missing shards fall back to the full annual input and errors stay retryable',async()=>{
  const calls=[];
  let missing=true;
  const load=async name=>{
    calls.push(name);
    if(name===sectorFile&&missing)throw Error('missing shard');
    return name===sectorFile?rows.filter(row=>row[4]===robot):rows.filter(row=>row[3].startsWith(name.slice(-4)));
  };
  const {filters}=input();
  const cache=new Map();
  const fallback=await loadMatchingRows(filters,meta,load,cache,()=>true);
  assert.deepEqual(Array.from(fallback),rows);
  missing=false;
  await loadMatchingRows(filters,meta,load,cache,()=>true);
  await loadMatchingRows({...filters,year:'2025'},meta,load,cache,()=>true);
  assert.deepEqual(calls,[sectorFile,'search-2026','search-2025',sectorFile]);
});
