import copy,hashlib,importlib.util,json,sqlite3,unittest
from pathlib import Path
P=Path(__file__).parent
import textwrap,types
if (P/'readback.py').exists():
 source=(P/'readback.py').read_text()
else:
 workflow=((P.parent if P.name=='tests' else P)/'.github/workflows/d1-check.yml').read_text()
 source=textwrap.dedent(workflow.split("          python3 - <<'PY'\n",1)[1].rsplit('          PY\n',1)[0])
m=types.ModuleType('readback');exec(compile(source,'readback','exec'),m.__dict__)
BASE='4a57b59e527b4a14eb2b939ad38161a36506616e';HEAD='1'*40
FUND='6cd5acf687ea471c9d6da2a4'

def request(**changes):
 d=dict(version=1,batch=231,base_main_sha=BASE,candidate_sha256='9c1473910388371d3576d91c9aacd4b9905a0e2173fee04f53d77e7069e6c5f6',batch_digests=[],fund_ids=[FUND],event_ids=[],company_windows=[])
 d.update(changes);d['scope_sha256']=hashlib.sha256(json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest();return json.dumps(d)

class ReadbackTests(unittest.TestCase):
 # Catches skipping strict input validation before network access.
 def test_231_fixed_fund_query(self):
  s=m.parse_request(request(),BASE);qs=m.queries(s)
  self.assertEqual(len(qs),1);self.assertEqual(qs[0]['params'],[FUND]);self.assertIn('WHERE fund_id=?',qs[0]['sql'])
 def test_rejects_unknown_sql_and_injection(self):
  for raw in [request(sql='DELETE FROM fund_master_facts'),request(fund_ids=[FUND+"' OR 1=1 --"]),request(event_ids=['cv:flash:1;DELETE']),request(version=True),request(batch=0),request(fund_ids='abc'),request(company_windows=[{'company_id':'x','day':'2025-02-30'}])]:
   with self.subTest(raw=raw),self.assertRaises(ValueError):m.parse_request(raw,BASE)
 def test_rejects_duplicate_keys_hash_drift_and_size(self):
  for raw in [request().replace('"version": 1','"version": 1, "version": 1'),request().replace(FUND,'0'*24),' '*8193,request(fund_ids=['%024x'%i for i in range(5)]),request(fund_ids=[]),request(fund_ids=[FUND,FUND])]:
   with self.subTest(raw=raw),self.assertRaises(ValueError):m.parse_request(raw,BASE)
 def test_base_drift_rejected(self):
  with self.assertRaises(ValueError):m.parse_request(request(),'2'*40)
 # Uses actual SQLite with query_only, catching accidental mutation and wrong predicates.
 def test_exact_keys_windows_and_no_mutation(self):
  db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
  db.executescript('CREATE TABLE fund_master_facts(record_id,kind,fund_id,subject_id,as_of,source,payload);CREATE TABLE historical_financing_batches(digest,filename,rows_added,sources_linked,rows_held,processed_at);CREATE TABLE financing_events(event_id,company_id,company_name,date,date_key,round,amount,valuation,investors_json,sources_json);')
  co='co:full_legal_name:'+'a'*32;eid='public:historical-disclosure:'+'b'*22
  db.executemany('INSERT INTO financing_events VALUES (?,?,?,?,?,?,?,?,?,?)',[(eid,co,'private','2025-01-15','2025-01-15','A','100','','[]','[]'),('other',co,'private','2025-02-15','2025-02-15','B','200','','[]','[]')]);db.commit();before=db.total_changes;db.execute('PRAGMA query_only=ON')
  s=m.parse_request(request(batch_digests=['c'*64],event_ids=[eid],company_windows=[{'company_id':co,'day':'2025-01-15'}]),BASE)
  counts=[]
  for q in m.queries(s):
   rows=[dict(r) for r in db.execute(q['sql'],q['params'])];counts.append(len(rows));self.assertTrue(q['sql'].lstrip().startswith('SELECT'));self.assertNotIn(';',q['sql'])
  self.assertEqual(counts,[0,0,1,1]);self.assertEqual(db.total_changes,before)
 def test_partial_date_in_window_is_not_missed(self):
  db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
  db.execute('CREATE TABLE financing_events(event_id,company_id,company_name,date,date_key,round,amount,valuation,investors_json,sources_json)')
  co='co:full_legal_name:'+'a'*32
  db.executemany('INSERT INTO financing_events VALUES (?,?,?,?,?,?,?,?,?,?)',[(str(i),co,'x',day,day,'A','100','','[]','[]') for i,day in enumerate(['2024','2024-12','2025','2025-01','2025-02'])])
  scope=m.parse_request(request(fund_ids=[],company_windows=[{'company_id':co,'day':'2025-01-03'}]),BASE)
  q=m.queries(scope)[0];rows=list(db.execute(q['sql'],q['params']))
  self.assertEqual(len(rows),4)
 def test_minimal_receipt_and_no_private_payload(self):
  s=m.parse_request(request(),BASE)
  def select(q):return {'success':True,'results':[{'kind':'fund','payload':'DO_NOT_PRINT_PRIVATE'}],'meta':{'rows_read':1,'rows_written':0,'changed_db':False}}
  r=m.verify(s,HEAD,lambda:HEAD,select)
  self.assertEqual(r['checks'][0]['count'],1);self.assertEqual(r['checks'][0]['kinds'],{'fund':1});self.assertNotIn('DO_NOT_PRINT',json.dumps(r));self.assertEqual(r['checks'][0]['rows_written'],0)
 def test_metrics_fail_closed(self):
  s=m.parse_request(request(),BASE)
  for meta in [{},{'rows_read':0},{'rows_read':0,'rows_written':1},{'rows_read':0,'rows_written':False},{'rows_read':0,'rows_written':0,'changed_db':True},{'rows_read':0,'rows_written':0},{'rows_read':0,'rows_written':0,'changed_db':1}]:
   with self.subTest(meta=meta),self.assertRaises(ValueError):m.verify(s,HEAD,lambda:HEAD,lambda q:{'success':True,'results':[],'meta':meta})
 def test_manual_dispatch_reads_event_not_step_env(self):
  import contextlib,io,os,tempfile
  from unittest.mock import patch
  env={'GITHUB_REPOSITORY':'EthanShang777/guanshi-pilot','GITHUB_REF':'refs/heads/main','GITHUB_ACTOR_ID':'110958536','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_SHA':BASE,'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','ACCOUNT':'a'*32,'CF_TOKEN':'NEVER_LOG_THIS_TOKEN'}
  def urlopen(req,timeout):
   url=req.full_url
   if url.endswith('/git/ref/heads/main'):obj={'object':{'sha':BASE}}
   elif url.endswith('/user/tokens/verify'):obj={'success':True,'result':{'status':'active'}}
   elif '?name=guanshi-financing' in url:obj={'success':True,'result':[{'name':'guanshi-financing','uuid':'12345678-1234-1234-1234-123456789012'}]}
   elif url.endswith('/query'):
    body=json.loads(req.data);self.assertEqual(body['params'],[FUND]);self.assertIn('WHERE fund_id=?',body['sql'])
    obj={'success':True,'result':[{'success':True,'results':[],'meta':{'rows_read':0,'rows_written':0,'changed_db':False}}]}
   else:self.fail('Unexpected endpoint')
   return io.BytesIO(json.dumps(obj).encode())
  with tempfile.TemporaryDirectory() as t:
   path=Path(t)/'event.json';path.write_text(json.dumps({'inputs':{'request':request()}}));env['GITHUB_EVENT_PATH']=str(path)
   out=io.StringIO()
   with patch.dict(os.environ,env,clear=True),patch.object(m.urllib.request,'urlopen',side_effect=urlopen),contextlib.redirect_stdout(out):m.main()
   self.assertIn('verified_read_only',out.getvalue());self.assertNotIn('NEVER_LOG',out.getvalue());self.assertNotIn(FUND,out.getvalue())
 def test_query_failure_and_overflow_rejected(self):
  s=m.parse_request(request(),BASE)
  for obj in [{'success':False,'results':[],'meta':{'rows_read':0,'rows_written':0,'changed_db':False}},{'success':True,'results':[{}]*201,'meta':{'rows_read':201,'rows_written':0}}]:
   with self.subTest(),self.assertRaises(ValueError):m.verify(s,HEAD,lambda:HEAD,lambda q:obj)
 def test_main_drift_before_and_after_rejected(self):
  s=m.parse_request(request(),BASE)
  for seq in [['2'*40], [HEAD,'2'*40]]:
   it=iter(seq)
   with self.subTest(seq=seq),self.assertRaises(ValueError):m.verify(s,HEAD,lambda:next(it),lambda q:{'success':True,'results':[],'meta':{'rows_read':0,'rows_written':0,'changed_db':False}})

if __name__=='__main__':unittest.main()
