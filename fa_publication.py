"""Publish FA client assets and indexes derived from public financing records."""
from collections import defaultdict
from hashlib import sha256
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

from sector_taxonomy import ROOT_IDS

SCRIPTS = '<script src="fa-store.js?v=1"></script><script src="fa-navigation.js?v=1"></script>'
DETAIL_ASSETS = '<link rel="stylesheet" href="fa-details.css?v=1">' + SCRIPTS
DETAIL_PAGES = ('company.html', 'deal.html', 'institution.html')
ASSETS = ('fa-store.js', 'fa-navigation.js', 'fa-details.css', 'fa-projects.js', 'fa-projects.css', 'fa-match.js')
ID_PATTERN = re.compile(r'[0-9a-f]{24}')


def fund_index(funds):
    records = {}
    for fund in funds:
        identifier = fund['fundId']
        source = fund['source']['url']
        if not ID_PATTERN.fullmatch(identifier) or urlsplit(source).scheme != 'https':
            continue
        manager = fund['managerId'] or ''
        manager_name = fund['managerName'] or ''
        if (not ID_PATTERN.fullmatch(manager) or not manager_name.strip()
                or re.search(r'未披露|待核|不详', manager_name)):
            manager = manager_name = ''
        records[identifier] = {
            'name': fund['fundName'], 'managerId': manager, 'managerName': manager_name, 'source': source,
        }
    return records


def write_fund_index(out, funds):
    (out / 'records' / 'fa-funds.json').write_text(json.dumps(
        fund_index(funds), ensure_ascii=False, sort_keys=True, separators=(',', ':'),
    ))


def write_sector_search(data, rows):
    by_sector = defaultdict(list)
    for row in rows:
        by_sector[row[4]].append(row)
    index = {}
    for sector, items in by_sector.items():
        if sector not in ROOT_IDS:
            continue
        # A manifest can reference only the exact snapshot that produced this shard.
        payload = json.dumps(items, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        name = f'fa-sector-{ROOT_IDS[sector]}-{sha256(payload).hexdigest()[:12]}'
        (data / f'{name}.json').write_bytes(payload)
        index[sector] = name
    return index


def publish_assets(out):
    for asset in ASSETS:
        shutil.copyfile(asset, out / asset)
    # Older public snapshots retain fund disclosures in the existing institution shards.
    if not (out / 'records' / 'fa-funds.json').exists():
        funds = {}
        for path in (out / 'records').glob('institution-??.json'):
            for key, profile in json.loads(path.read_text()).items():
                for fund in profile.get('fundDisclosures', ()):
                    if fund['fundId'] == key:
                        funds[key] = fund
        write_fund_index(out, funds.values())
    for name in DETAIL_PAGES:
        page = out / name
        html = page.read_text()
        if DETAIL_ASSETS not in html:
            html = html.replace('</style><header', '</style>' + DETAIL_ASSETS + '<header', 1)
        html = re.sub(r'master-detail\.js\?v=[^"]+', 'master-detail.js?v=fa-projects1', html)
        page.write_text(html)
