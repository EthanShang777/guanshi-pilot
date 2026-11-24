"""Apply new ChinaVenture disclosures to the D1 master before publishing."""
import json
from pathlib import Path
from d1 import database, query

def packed(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'))

def sync(events):
    db=database()
    if 'country' not in {c['name'] for c in query(db,'PRAGMA table_info(financing_events)')}:
        query(db,"ALTER TABLE financing_events ADD COLUMN country TEXT NOT NULL DEFAULT ''")
    # Registry identifiers establish jurisdiction; exchange listings alone do not.
    registries={'cn_uscc':'中国','jp_corporate_number':'日本','gb_companies_house':'英国',
                'fr_siren':'法国','sg_uen':'新加坡','se_orgnr':'瑞典','se_org_number':'瑞典',
                'fi_business_id':'芬兰','be_kbo':'比利时'}
    cases=' '.join('WHEN company_id GLOB ? THEN ?' for _ in registries)
    params=[v for registry,country in registries.items() for v in ('co:'+registry+':*',country)]
    query(db,"UPDATE financing_events SET country=CASE "+cases+" ELSE country END WHERE country='' AND ("+
          ' OR '.join('company_id GLOB ?' for _ in registries)+')',params+params[::2])
    locations=json.loads(Path('country-locations.json').read_text())
    for key,place in locations.items():
        if key.startswith('cv:flash:'):
            query(db,"UPDATE financing_events SET country=? WHERE event_id=? AND country=''",[place[0],key])
    query(db,'CREATE INDEX IF NOT EXISTS financing_by_date ON financing_events(date_key)')
    additions=linked=held=0
    for e in events:
        urls=e['sources']
        if not urls: raise ValueError('Missing disclosure URL')
        matches=query(db,'''SELECT event_id,sources_json FROM financing_events
            WHERE EXISTS (SELECT 1 FROM json_each(financing_events.sources_json)
                          WHERE value IN (SELECT value FROM json_each(?)))''',[packed(urls)])
        nearby=[]
        if not matches:
            nearby=query(db,'''SELECT event_id,sources_json,round,investors_json FROM financing_events
                WHERE date_key BETWEEN date(?,'-14 days') AND date(?,'+14 days')
                AND (instr(company_name,?)>0 OR instr(?,company_name)>0)''',
                [e['day'],e['day'],e['company'],e['company']])
            if len(nearby)==1 and e['round'] and nearby[0]['round']==e['round']:
                names={i['name'] for i in json.loads(nearby[0]['investors_json']) if isinstance(i,dict)}
                if names.intersection(e['investors']):
                    matches=nearby
        if len(matches)==1:
            row=matches[0]
            old=json.loads(row['sources_json'])
            merged=list(dict.fromkeys(old+urls))
            if merged!=old:
                query(db,'UPDATE financing_events SET sources_json=? WHERE event_id=? AND sources_json=? RETURNING event_id',
                      [packed(merged),row['event_id'],row['sources_json']])
                linked+=1
            continue
        if matches or nearby:
            held+=1
            print('Possible existing transaction, preserved for reconciliation:',e['id'])
            continue
        sector=e.get('sector') or '待归类'
        params=[e['day'],e['company'],sector,'',e['round'],packed([{'name':i,'role':None,'amount':None} for i in e['investors']]),
                e.get('amount_display',''),'','投中网报道日期',packed(urls),'cv:flash:'+e['id'],'',e['company'],e['day'],sector,'投中网快讯分类']
        inserted=query(db,'''INSERT INTO financing_events
            (date,company_name,primary_sector,secondary_sector,round,investors_json,amount,valuation,date_kind,sources_json,
            event_id,company_id,raw_company_key,date_key,sector,sector_source)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id''',params)
        additions+=len(inserted)
    total=query(db,'SELECT COUNT(*) AS total FROM financing_events')[0]['total']
    print(f'D1 master rows={total}')
    print(f'D1 additions={additions} source_updates={linked} possible_duplicates={held}')

if __name__=='__main__':
    import sys
    current=json.loads(Path('ledger.json').read_text())['events']
    old={e['id']:e for e in json.loads(Path(sys.argv[1]).read_text())['events']} if sys.argv[1:] else {}
    sync([e for e in current if old.get(e['id'])!=e])
