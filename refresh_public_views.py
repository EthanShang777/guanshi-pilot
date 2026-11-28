"""Refresh UI from the current published artifact without changing its financing master."""
import json
import shutil

from publish_master import DECKS, OUT, research_pages, search_page
from sector_taxonomy import public_filter

data = OUT / 'records'
manifest = json.loads((data / 'manifest.json').read_text())
if manifest.get('taxonomyVersion') != 1:
    raise ValueError('The current Pages artifact predates the shared taxonomy. Run the full financing snapshot first.')

deals = {}
for year in manifest['years']:
    path = data / f'search-{year}.json'
    for entry in json.loads(path.read_text()):
        deals[entry[0]] = None
directions = {}
for path in data.glob('deal-??.json'):
    for key, deal in json.loads(path.read_text()).items():
        if key in deals:
            deals[key] = deal
        if deal.get('subId'):
            directions[deal['subId']] = deal['sub']
assert len(deals) == manifest['events'] and all(deals.values())
public_filter(OUT, directions)
for asset in ('master-search.js', 'master-detail.js', 'company-history.js', 'company-browser.js'):
    shutil.copyfile(asset, OUT / asset)
DECKS['融资事件'] = 'records/shelf-financing.html'
search_page()
research_pages(deals.values())
