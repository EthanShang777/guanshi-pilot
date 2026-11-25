"""Refresh interface indexes from an existing Pages artifact, preserving event identities."""
import json
import shutil
from collections import defaultdict
from pathlib import Path
from publish_master import DECKS, OUT, dump, search_page, research_pages

data = OUT / 'records'
read = lambda path: json.loads(path.read_text())
manifest = read(data / 'manifest.json')
deals = {}
subs = defaultdict(set)
names = defaultdict(set)
for path in data.glob('deal-*.json'):
    for d in read(path).values():
        deals[d['href']] = d
        names[d['company']].add(d['companyHref'])
        if d['sub']:
            subs[d['sector']].add(d['sub'])
assert len(deals) == manifest['events']
manifest['subs'] = {s: sorted(items) for s, items in subs.items()}
dump(data / 'manifest.json', manifest)
profiles = {p['name']: p for p in read(Path('research-library.json'))['profiles']}
for kind in ('company', 'institution'):
    for path in data.glob(kind + '-??.json'):
        rows = read(path)
        for row in rows.values():
            for event in row['events']:
                d = deals[event[0]]
                offset = 6 if kind == 'company' else 5
                event[offset:] = [d['sector'], d['sub']]
                if kind == 'institution':
                    event.append(d['companyHref'])
            if kind == 'company':
                first = deals[row['events'][0][0]]
                row.update(primary=first['sector'], sub=first['sub'],
                           profile=profiles.get(row['name']) if len(names[row['name']]) == 1 else None)
        dump(path, rows)
total = 0
for year in manifest['years']:
    path = data / f'search-{year}.json'
    rows = read(path)
    for row in rows:
        row[11:] = [deals['deal.html?id=' + row[0]]['companyHref']]
    total += len(rows)
    dump(path, rows)
assert total == len(deals)
for asset in ('master-search.js', 'master-detail.js', 'company-history.js'):
    shutil.copyfile(asset, OUT / asset)
DECKS['融资事件'] = 'records/shelf-financing.html'
search_page()
research_pages(deals.values())
