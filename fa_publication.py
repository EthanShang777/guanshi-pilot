"""Publish FA client assets and indexes derived from public financing records."""
from collections import defaultdict
from hashlib import sha256
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

from sector_taxonomy import BRANCHES, ROOT_IDS

SCRIPTS = '<script src="fa-store.js?v=1"></script><script src="fa-navigation.js?v=1"></script>'
DETAIL_ASSETS = '<link rel="stylesheet" href="fa-details.css?v=1">' + SCRIPTS
DETAIL_PAGES = ('company.html', 'deal.html', 'institution.html')
ASSETS = ('fa-store.js', 'fa-navigation.js', 'fa-details.css', 'fa-projects.js', 'fa-projects.css', 'fa-match.js')
ID_PATTERN = re.compile(r'[0-9a-f]{24}')
# Small direction buckets avoid downloading a whole sector for one fine direction.
DIRECTION_ROWS_PER_BUCKET = 96


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


def direction_bucket(direction, count):
    # Match the 32-bit Unicode code-point hash in fa-match.js.
    value = 2166136261
    for char in direction:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return value % count


def write_direction_buckets(data, sector_shard, rows):
    count = (len(rows) + DIRECTION_ROWS_PER_BUCKET - 1) // DIRECTION_ROWS_PER_BUCKET
    if count < 2:
        return 0
    buckets = [[] for _ in range(count)]
    for row in rows:
        direction, membership = row[9], row[12]
        if direction:
            labels = [direction] + [BRANCHES[branch] for branch in membership if branch in BRANCHES]
            targets = {direction_bucket(label, count) for label in labels}
        else:
            # Unclassified directions remain eligible in every query within this sector.
            targets = range(count)
        for target in targets:
            buckets[target].append(row)
    suffix = sector_shard.removeprefix('fa-sector-')
    for number, items in enumerate(buckets):
        path = data / f'fa-direction-v1-{suffix}-{number}.json'
        path.write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return count


def write_search_indexes(data, rows):
    by_sector = defaultdict(list)
    for row in rows:
        by_sector[row[4]].append(row)
    index = {}
    directions = {}
    for sector, items in by_sector.items():
        if sector not in ROOT_IDS:
            continue
        # A manifest can reference only the exact snapshot that produced this shard.
        payload = json.dumps(items, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        name = f'fa-sector-{ROOT_IDS[sector]}-{sha256(payload).hexdigest()[:12]}'
        (data / f'{name}.json').write_bytes(payload)
        index[sector] = name
        count = write_direction_buckets(data, name, items)
        if count:
            directions[sector] = count
    return {'faSearchSectors': index, 'faSearchDirectionBuckets': directions}


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
