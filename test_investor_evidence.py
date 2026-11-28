import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from dots_intake import reconcile_candidate
from investor_evidence import evidence_snapshot, verified_corrections
with patch.dict('os.environ', {'ACCOUNT':'offline-test'}):
    import sync_financing as financing


STAMP = '2026-11-29T01:30:00+00:00'
OLD = 'https://www.chinaventure.com.cn/flash/20261127-90307.html'
SAME = 'https://www.chinaventure.com.cn/news/111-20261128-394151.html'
OTHER = 'https://example.org/disclosure'
KEY = '0123456789abcdef01234567'


def deal(**fields):
    return dict(key=KEY, company='样本公司', day='2026-11-27', dateKind='投中网报道日期',
                stage='A轮', amount='1000万元', valuation='', country='中国',
                href='deal.html?id='+KEY, companyHref='company.html?id='+'a'*24,
                sectorId='industrial', subId='', sectorBranches=[], parties=[], sources=[OLD]) | fields


def build(item, **kwargs):
    return evidence_snapshot([item], now=STAMP, ledger_through='2026-11-27', **kwargs)


class EvidenceTests(unittest.TestCase):
    def test_reported_date_does_not_become_transaction_or_first_ingest_date(self):
        asset, _ = build(deal())
        self.assertEqual(asset['items'][0]['kind'], 'disclosure')
        self.assertIsNone(asset['items'][0]['eventDate'])
        self.assertEqual(asset['items'][0]['disclosureDate'], '2026-11-27')
        self.assertIsNone(asset['items'][0]['firstSeenAt'])
        self.assertIsNone(asset['items'][0]['correctedAt'])

    def test_reviewed_backfill_keeps_event_date_separate_from_batch(self):
        asset, _ = build(deal(day='2016-04', dateKind='交割日', sources=[OTHER]),
                         historical={KEY:'2026-11-28'})
        row, = asset['items']
        self.assertEqual(row['kind'], 'historical')
        self.assertEqual(row['eventDate'], '2016-04')
        self.assertEqual(row['changeDate'], '2026-11-28')
        self.assertIsNone(row['disclosureDate'])
        self.assertIsNone(row['firstSeenAt'])

    def test_existing_event_with_multiple_sources_counts_as_one_source_addition(self):
        previous, basis = build(deal())
        asset, _ = build(deal(sources=[OLD, SAME, OTHER+'?utm_source=newsletter', OTHER]),
                         prior=previous, basis=basis)
        row, = asset['items']
        self.assertEqual(row['kind'], 'source')
        self.assertEqual([s['relation'] for s in row['sources']],
                         ['同站补充', '补充出处，独立性待核', '原有出处'])
        self.assertEqual(row['sources'][0]['publishedOn'], '2026-11-28')

    def test_original_urls_remain_available_after_duplicate_tracking_links(self):
        asset, _ = build(deal(sources=[OLD, OTHER+'?item=1&utm_source=example']))
        self.assertEqual(asset['items'][0]['sources'][1]['url'], OTHER+'?item=1&utm_source=example')

    def test_different_pages_of_the_same_document_preserve_both_locations(self):
        previous, basis = build(deal(sources=[OTHER+'.pdf#page=4']))
        asset, _ = build(deal(sources=[OTHER+'.pdf#page=4', OTHER+'.pdf#page=8']),
                         prior=previous, basis=basis)
        row, = asset['items']
        self.assertEqual(row['kind'], 'source')
        self.assertEqual([(s['relation'], s['url']) for s in row['sources']], [
            ('同份资料补充定位', OTHER+'.pdf#page=8'), ('原有出处', OTHER+'.pdf#page=4'),
        ])

    def test_original_snapshot_fact_change_is_unreviewed_until_verified(self):
        previous, basis = build(deal())
        asset, _ = build(deal(amount='1800万元'), prior=previous, basis=basis)
        row, = asset['items']
        self.assertEqual(row['kind'], 'review')
        self.assertEqual(row['differences'], [{'field':'金额','before':'1000万元','after':'1800万元'}])

    def test_reviewed_correction_overrides_snapshot_diff(self):
        previous, basis = build(deal())
        corrected = {'differences':[{'field':'金额','before':'1000万元','after':'900万元'}],
                     'sources':[OLD], 'extraInstitutions':[]}
        asset, _ = build(deal(amount='900万元'), prior=previous, basis=basis,
                         corrections={KEY:corrected})
        row, = asset['items']
        self.assertEqual(row['kind'], 'correction')
        self.assertIsNone(row['correctedAt'])
        self.assertEqual(row['differences'], corrected['differences'])

    def test_whitespace_does_not_become_financing_evidence(self):
        previous, basis = build(deal())
        asset, _ = build(deal(amount='1000 万元'), prior=previous, basis=basis)
        row, = asset['items']
        self.assertEqual(row['kind'], 'text')
        self.assertIsNone(row['correctedAt'])

    def test_unresolved_report_amount_is_preserved_as_a_conflict(self):
        receipt = {KEY: {'kind':'conflict', 'recordedAt':STAMP, 'announcedOn':'2026-11-28',
                         'sources':[{'url':OTHER,'published_on':'2026-11-28'}],
                         'reportedAmount':'1800万元'}}
        asset, _ = build(deal(), receipts=receipt)
        row, = asset['items']
        self.assertEqual(row['kind'], 'conflict')
        self.assertEqual(row['differences'][0], {'field':'金额','before':'1000万元','after':'1800万元'})
        self.assertEqual(row['sources'][0]['relation'], '待核出处')
        self.assertEqual(row['disclosureDate'], '2026-11-27')
        self.assertIsNone(row['firstSeenAt'])

    def test_receipts_preserve_actual_first_seen_and_per_source_date(self):
        receipt = {KEY: {'kind':'disclosure', 'recordedAt':STAMP, 'announcedOn':'2026-11-28',
                         'sources':[{'url':OTHER,'published_on':'2026-11-28'}]}}
        asset, _ = build(deal(day='2026-11-28', dateKind='公开披露日期', sources=[OTHER]), receipts=receipt)
        row, = asset['items']
        self.assertEqual(row['firstSeenAt'], STAMP)
        self.assertEqual(row['disclosureDate'], '2026-11-28')
        self.assertEqual(row['sources'][0]['publishedOn'], '2026-11-28')

    def test_reviewed_manifest_requires_published_correction_and_original_source(self):
        event_id = 'existing'
        candidate = dict(event_id=event_id, company_id='company', day='2026-11-27',
                         round='A轮', source=OTHER, expected='1000万元', amount='900万元')
        row = dict(event_id=event_id, company_id='company', date_key='2026-11-27',
                   round='A轮', amount='1000万元', sources_json=json.dumps([OLD]))
        with TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path/'reviewed-amount-corrections.json').write_text(json.dumps([candidate]))
            self.assertFalse(verified_corrections(path,[row]))
            self.assertFalse(verified_corrections(path,[row | {'amount':'900万元'}]))
            accepted, = verified_corrections(path,[row | {
                'amount':'900万元', 'sources_json':json.dumps([OLD, OTHER]),
            }]).values()
            self.assertEqual(accepted['differences'], [{'field':'金额','before':'1000万元','after':'900万元'}])

    def test_old_reviewed_correction_does_not_reappear_after_the_digest_window(self):
        corrected = {'differences':[{'field':'金额','before':'1000万元','after':'900万元'}],
                     'sources':[OLD], 'extraInstitutions':[]}
        previous, basis = build(deal(amount='900万元'), corrections={KEY:corrected})
        item = deal(amount='900万元')
        result, next_basis = evidence_snapshot([item], now='2027-01-10T01:30:00+00:00',
                                                prior=previous, basis=basis, corrections={KEY:corrected})
        self.assertEqual(result['items'], [])
        replay, _ = evidence_snapshot([item], now='2027-01-11T01:30:00+00:00',
                                      prior=result, basis=next_basis, corrections={KEY:corrected})
        self.assertEqual(replay['items'], [])


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        columns = [field+' TEXT'+(' PRIMARY KEY' if field == 'event_id' else '') for field in financing.FIELDS]
        self.db.execute('CREATE TABLE financing_events ('+','.join(columns)+')')
        self.db.execute('CREATE TABLE dots_financing_candidates (candidate_id TEXT PRIMARY KEY, event_id TEXT NOT NULL)')
        def query(db, sql, params=()):
            return [dict(row) for row in db.execute(sql, params)]
        mock = patch.object(financing, 'query', query)
        mock.start()
        self.addCleanup(mock.stop)
        row = financing.daily_row(dict(id='90307', day='2026-11-27', company='示例科技有限公司',
                                      sector='工业制造', round='A轮', investors=['示例资方'],
                                      amount_display='1000万元', sources=[OLD]))
        financing.sync_rows(self.db, [row])

    def candidate(self, urls, amount):
        return {
            'candidate_id':'dots-test:1', 'announced_on':'2026-11-27',
            'company':{'display_name':'示例科技有限公司','legal_name':'示例科技有限公司','country':'中国'},
            'round':'A轮','transaction_type':'融资','transaction_status':'已宣布完成','amount_text':amount,
            'investors':[{'name':'示例资方','role':None}], 'sources':urls, 'existing_event_id':'cv:flash:90307',
        }

    def test_existing_record_receipt_exposes_only_new_sources_and_replay_has_none(self):
        old_link = {'url':OLD,'published_on':'2026-11-27'}
        new_link = {'url':SAME,'published_on':'2026-11-28'}
        record = self.candidate([old_link,new_link],'1000万元')
        first = reconcile_candidate(self.db, record, {})
        self.assertEqual(first['status'],'source_added')
        self.assertEqual(first['evidence_sources'],[new_link])
        self.assertEqual(first['announced_on'],'2026-11-27')
        self.assertTrue(first['recorded_at'].endswith('+00:00'))
        again = reconcile_candidate(self.db, record, {})
        self.assertEqual((again['status'],again['evidence_sources']),('covered',[]))

    def test_conflicting_amount_receipt_keeps_source_out_of_financing_record(self):
        evidence = {'url':OTHER,'published_on':'2026-11-28'}
        record = self.candidate([evidence],'1400万元')
        result = reconcile_candidate(self.db, record, {})
        self.assertEqual(result['status'],'held')
        self.assertNotIn('event_id',result)
        self.assertEqual(result['related_event_id'],'cv:flash:90307')
        self.assertEqual(result['reported_amount'],'1400万元')
        self.assertEqual(result['evidence_sources'],[evidence])
        row = self.db.execute('SELECT amount,sources_json FROM financing_events').fetchone()
        self.assertEqual(row['amount'],'1000万元')
        self.assertEqual(json.loads(row['sources_json']),[OLD])


if __name__ == '__main__':
    unittest.main()
