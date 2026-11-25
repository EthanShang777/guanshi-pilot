"""D1 baseline transfer and verification for the financing master."""
import hashlib
import json
import os
import subprocess
import time
import urllib.request
from urllib.error import HTTPError
from pathlib import Path

BASE = 'https://api.cloudflare.com/client/v4/accounts/'+os.environ['ACCOUNT']+'/d1/database'
NAME = 'guanshi-financing'
MD5 = '8e117ed792c8d68c29b6d893283e6aec'
DIGEST = '35ae70491436ec6a9df1c0a7b0d59e70f0423effd89af93f6364c9418ea10996'

FIELDS = 'date company_name primary_sector secondary_sector round investors_json amount valuation date_kind sources_json event_id company_id raw_company_key date_key sector sector_source'.split()

_last_request_started = float('-inf')


def pace_request():
    global _last_request_started
    interval = float(os.environ.get('D1_MIN_REQUEST_INTERVAL_SECONDS', '0'))
    remaining = interval - (time.monotonic() - _last_request_started)
    if remaining > 0:
        time.sleep(remaining)
    _last_request_started = time.monotonic()


def api(path='', body=None):
    req=urllib.request.Request(BASE+path, data=json.dumps(body).encode() if body is not None else None,
                               headers={'Authorization':'Bearer '+os.environ['CF_TOKEN'],'Content-Type':'application/json'})
    for attempt in range(2):
        pace_request()
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                obj = json.load(res)
            break
        except HTTPError as err:
            with err:
                if err.code != 429 or attempt:
                    raise RuntimeError(f'D1 HTTP {err.code}: ' + err.read().decode()[:500]) from None
                value = err.headers.get('Retry-After', '')
                delay = int(value) if value.isdecimal() else 300
            print(f'D1 API rate limited; retrying in {delay}s', flush=True)
            time.sleep(delay)
    if not obj['success']: raise RuntimeError(obj['errors'])
    return obj['result']

def database(create=False):
    found=[db for db in api('?name='+NAME) if db['name']==NAME]
    if not found and create: found=[api('',{'name':NAME})]
    if len(found)!=1: raise RuntimeError('Expected one financing database')
    return '/'+found[0]['uuid']

def query(db,sql,params=()):
    return api(db+'/query',{'sql':sql,'params':params})[0]['results']

def baseline():
    mode=os.environ['MODE']
    db=database(create=mode=='prepare')
    if mode=='prepare':
        if query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='financing_events'"):
            raise RuntimeError('Existing master; inspect before importing')
        transfer=api(db+'/import',{'action':'init','etag':MD5})
        Path('recipient.pem').write_text(os.environ['RECIPIENT'])
        subprocess.run(['openssl','cms','-encrypt','-aes256','-binary','-outform','DER','-out','transfer.bin','recipient.pem'],
                       input=json.dumps(transfer).encode(),check=True)
        return
    if mode=='import':
        result=api(db+'/import',{'action':'ingest','etag':MD5,'filename':os.environ['FILENAME']})
        while result['status']!='complete':
            if not result.get('success',True) or result['status']=='error': raise RuntimeError(result.get('error'))
            time.sleep(3)
            result=api(db+'/import',{'action':'poll','current_bookmark':result['at_bookmark']})
    digest=hashlib.sha256()
    last=''; count=0
    while True:
        rows=query(db,'SELECT * FROM financing_events WHERE event_id>? ORDER BY event_id LIMIT 500',[last])
        if not rows: break
        for row in rows:
            digest.update((json.dumps([row[k] for k in FIELDS],ensure_ascii=False,separators=(',',':'))+'\n').encode())
        count+=len(rows); last=rows[-1]['event_id']
    print('Verified cloud rows:',count,'SHA-256:',digest.hexdigest(),flush=True)
    assert count==54059 and digest.hexdigest()==DIGEST

if __name__=='__main__': baseline()
