"""Publish FA client assets and a read-only index of disclosed legal fund managers."""
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

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
