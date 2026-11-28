"""Refresh UI from the current published artifact without changing its financing master."""
import json
import shutil

from fa_publication import write_search_indexes
from investor_evidence import copy_assets as copy_evidence, publish as publish_evidence
from investor_publication import publish_workspace, restore_timeline
from publish_master import DECKS, OUT, dump, filename, link, page, research_pages, search_page
from reader import refresh_library
from sector_taxonomy import public_filter

data = OUT / 'records'
manifest = json.loads((data / 'manifest.json').read_text())
if manifest.get('taxonomyVersion') != 1:
    raise ValueError('The current Pages artifact predates the shared taxonomy. Run the full financing snapshot first.')

rows = [entry for year in manifest['years']
        for entry in json.loads((data / f'search-{year}.json').read_text())]
deals = dict.fromkeys(entry[0] for entry in rows)
manifest.update(write_search_indexes(data, rows))
del rows
directions = {}
bootstrap_evidence = not (data / 'investor-evidence.json').exists()
evidence_deals = []
for path in data.glob('deal-??.json'):
    for key, deal in json.loads(path.read_text()).items():
        if key in deals:
            deals[key] = deal
        if bootstrap_evidence and 'key' in deal:
            evidence_deals.append(deal)
        if deal.get('subId'):
            directions[deal['subId']] = deal['sub']
assert len(deals) == manifest['events'] and all(deals.values())
dump(data / 'manifest.json', manifest)
public_filter(OUT, directions)
for asset in ('master-search.js', 'master-detail.js', 'company-history.js', 'company-browser.js'):
    shutil.copyfile(asset, OUT / asset)
DECKS['融资事件'] = 'records/shelf-financing.html'
restore_timeline(OUT)
search_page()
refresh_library(OUT,page,link,filename,deals.values())
research_pages(deals.values())
if bootstrap_evidence:
    publish_evidence(OUT,evidence_deals)
else:
    copy_evidence(OUT)
publish_workspace(OUT,page)
