"""Resolve legal jurisdictions using exact entity names and auditable registry evidence."""
import csv
import io
import json
import os
import re
import tempfile
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen, urlretrieve
from d1 import database, query

def normalize(name):
    return ' '.join(unicodedata.normalize('NFKC',name).casefold().split())

def run():
    db=database()
    records=[];last=''
    while True:
        batch=query(db,'SELECT event_id,company_id,company_name FROM financing_events WHERE country=? AND event_id>? ORDER BY event_id LIMIT 1500',['',last])
        if not batch:break
        records.extend(batch);last=batch[-1]['event_id']
    wanted={normalize(r['company_name']) for r in records}
    evidence=defaultdict(set)
    for name,country,source in json.loads(Path('country-evidence.json').read_text()):
        evidence[normalize(name)].add((country,source))
    if os.getenv('GLEIF')=='yes':
        meta=json.load(urlopen('https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest',timeout=60))['data']['file']['csv']
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'leis.zip'
            urlretrieve(meta['url'],path)
            locales=json.loads(Path('country-labels.json').read_text())
            with zipfile.ZipFile(path) as z, z.open(next(n for n in z.namelist() if n.endswith('.csv'))) as stream:
                reader=csv.DictReader(io.TextIOWrapper(stream,encoding='utf-8-sig',newline=''))
                assert {'LEI','Entity.LegalName','Entity.LegalJurisdiction','Registration.ValidationSources'}<=set(reader.fieldnames)
                for r in reader:
                    key=normalize(r['Entity.LegalName'])
                    if key not in wanted or len(key)<7:continue
                    if not r['Entity.RegistrationAuthority.RegistrationAuthorityEntityID'] or r['Registration.ValidationSources']!='FULLY_CORROBORATED':continue
                    if r.get('Entity.EntityCategory')=='BRANCH' or r['Registration.RegistrationStatus'] in ('DUPLICATE','ANNULLED'):continue
                    if not re.search(r'公司|合伙企业|\b(inc|incorporated|limited|ltd|corporation|gmbh|llc|plc|ag|oy|ab|sas|sa|bv)\b',key):continue
                    code=r['Entity.LegalJurisdiction'].split('-')[0]
                    if code in locales:evidence[key].add((locales[code],'https://search.gleif.org/#/record/'+r['LEI']))
    patches=[]
    for r in records:
        refs=evidence.get(normalize(r['company_name']),set())
        if len({country for country,_ in refs})==1:
            country,source=sorted(refs)[0]
            patches.append([r['event_id'],r['company_name'],country,source])
    if 'country_source' not in {r['name'] for r in query(db,'PRAGMA table_info(financing_events)')}:
        query(db,"ALTER TABLE financing_events ADD COLUMN country_source TEXT NOT NULL DEFAULT ''")
    for i in range(0,len(patches),100):
        query(db,"""UPDATE financing_events AS f SET country=json_extract(j.value,'$[2]'),country_source=json_extract(j.value,'$[3]')
            FROM json_each(?) AS j WHERE f.event_id=json_extract(j.value,'$[0]') AND f.company_name=json_extract(j.value,'$[1]') AND f.country=''""",
            [json.dumps(patches[i:i+100],ensure_ascii=False)])
    print('Investigated',len(records),'matched',len(patches),'verified coverage',query(db,"SELECT COUNT(*) AS events,SUM(country!='') AS covered FROM financing_events"),flush=True)

if __name__=='__main__':run()
