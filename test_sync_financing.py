import csv
import json
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

with patch.dict('os.environ', {'ACCOUNT': 'offline-test'}):
    import sync_financing as financing


SOURCE = 'https://example.com/weekly'


def event(event_id, company, stage, *, urls=(SOURCE,), company_id='', day='2025-08-01'):
    row = financing.daily_row(dict(id=event_id, day=day, company=company, round=stage,
                                  investors=['示例基金'], sources=urls))
    row['company_id'] = company_id
    return row


class SyncFinancingTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        columns = [field + ' TEXT' + (' PRIMARY KEY' if field == 'event_id' else '')
                   for field in financing.FIELDS]
        self.db.execute('CREATE TABLE financing_events (' + ','.join(columns) + ')')
        self.db.execute('CREATE INDEX financing_by_date ON financing_events(date_key)')
        mock = patch.object(financing, 'query', self.query)
        mock.start()
        self.addCleanup(mock.stop)

    def query(self, db, sql, params=()):
        return [dict(row) for row in db.execute(sql, params)]

    def test_different_companies_can_share_a_source(self):
        rows = [event('1', '新星科技', 'A轮'), event('2', '前沿材料', 'A轮')]
        self.assertEqual(financing.sync_rows(self.db, rows), (2, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows), (0, 0, 0))

    def test_reviewed_rounds_can_share_a_source_and_investor(self):
        rows = [event('1', '新星科技', 'Pre-A轮', company_id='company-1'),
                event('2', '新星科技', 'Pre-A+轮', company_id='company-1')]
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (2, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (0, 0, 0))
        self.assertEqual(self.query(self.db, 'SELECT round FROM financing_events ORDER BY event_id'),
                         [{'round': 'Pre-A轮'}, {'round': 'Pre-A+轮'}])

    def test_reviewed_pre_seed_and_seed_are_distinct_even_with_same_source(self):
        rows = [event('1', '公司甲', '种子前轮', company_id='company-1'),
                event('2', '公司甲', '种子轮', company_id='company-1')]
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (2, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (0, 0, 0))

    def test_pre_seed_aliases_link_to_the_same_transaction(self):
        original = event('1', '公司甲', 'Pre-Seed轮', company_id='company-1')
        translated = event('2', '公司甲', '种子前轮', company_id='company-1',
                           urls=('https://example.com/another',))
        self.assertEqual(financing.sync_rows(self.db, [original]), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [translated]), (0, 1, 0))

    def test_related_report_appends_to_existing_event(self):
        first = event('1', '北京新星科技有限公司', 'Ａ＋＋轮', company_id='company-1')
        next_url = 'https://example.com/disclosure'
        second = event('2', '新星科技', 'A++轮', urls=(next_url,), day='2025-08-04')
        self.assertEqual(financing.sync_rows(self.db, [first]), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [second]), (0, 1, 0))
        self.assertEqual(financing.sync_rows(self.db, [second]), (0, 0, 0))
        rows = self.query(self.db, 'SELECT event_id, sources_json FROM financing_events')
        self.assertEqual([row['event_id'] for row in rows], [first['event_id']])
        self.assertEqual(json.loads(rows[0]['sources_json']), [SOURCE, next_url])

    def test_unresolved_round_labels_are_held(self):
        first = event('1', '新星科技', 'B1轮')
        second = event('2', '新星科技', 'B+轮')
        self.assertEqual(financing.sync_rows(self.db, [first]), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [second]), (0, 0, 1))

    def test_conflicting_company_ids_are_held(self):
        first = event('1', '北京新星科技有限公司', 'A轮', company_id='company-1')
        second = event('2', '新星科技', 'A轮', company_id='company-2')
        self.assertEqual(financing.sync_rows(self.db, [first]), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [second], reviewed=True), (0, 0, 1))

    def test_reviewed_distinct_company_pair_is_imported_and_other_matches_still_hold(self):
        existing = event('1', 'Kanu', 'A轮', company_id='company-1')
        distinct = event('2', 'Kanurra', 'A轮', company_id='company-2',
                         urls=('https://example.com/kanurra',))
        distinct['investors_json'] = financing.packed([{'name': '另一家基金'}])
        unresolved = event('3', 'Kanurra Laboratory', 'A轮', company_id='company-3',
                           urls=('https://example.com/laboratory',))
        self.assertEqual(financing.sync_rows(self.db, [existing]), (1, 0, 0))
        with TemporaryDirectory() as directory:
            path = Path(directory)
            review = {
                'incoming': {key: distinct[key] for key in ('event_id', 'company_id')},
                'existing': {key: existing[key] for key in ('event_id', 'company_id')},
            }
            (path / 'reviewed-distinct-events.json').write_text(json.dumps([review]))
            with (path / 'batch.csv').open('w', newline='') as handle:
                writer = csv.DictWriter(handle, financing.FIELDS)
                writer.writeheader()
                writer.writerows([distinct, unresolved])
            for _ in range(2):
                with patch.object(financing, 'database', return_value=self.db), \
                     patch('sys.argv', ['sync_financing.py', '--historical-dir', directory]):
                    financing.main()
            rows = self.query(self.db, 'SELECT * FROM financing_events ORDER BY event_id')
            self.assertEqual(rows, [existing, distinct])
            outcome = self.query(self.db, 'SELECT rows_added, rows_held FROM historical_financing_batches')
            self.assertEqual(outcome, [dict(rows_added=1, rows_held=1)])

    def test_replaying_a_partially_written_batch_only_inserts_missing_rows(self):
        rows = [event('1', '新星科技', '种子轮', company_id='company-1'),
                event('2', '新星科技', '天使轮', company_id='company-1')]
        self.assertEqual(financing.sync_rows(self.db, rows[:1], reviewed=True), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (0, 0, 0))


    def test_reviewed_investor_correction_is_exact_and_repeatable(self):
        first = event('1', '新星科技', 'A轮', company_id='company-1')
        kept = {'name': '示例基金', 'role': '领投', 'amount': '1,000万元'}
        first['investors_json'] = financing.packed([kept, {'name': '其他轮基金'}])
        second = event('2', '新星科技', 'A+轮', company_id='company-1')
        second['investors_json'] = financing.packed([{'name': '其他轮基金'}])
        self.assertEqual(financing.sync_rows(self.db, [first, second], reviewed=True), (2, 0, 0))
        correction = dict(event_id=first['event_id'], company_id='company-1', round='A轮',
                          source=SOURCE, expected=['示例基金', '其他轮基金'], remove=['其他轮基金'])
        self.assertEqual(financing.sync_investor_corrections(self.db, [correction]), (1, 0, 0))
        self.assertEqual(financing.sync_investor_corrections(self.db, [correction]), (0, 1, 0))
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events ORDER BY event_id'),
                         [first | {'investors_json': financing.packed([kept])}, second])

    def test_reviewed_investor_correction_holds_drift_and_missing_source(self):
        row = event('1', '新星科技', 'A轮', company_id='company-1')
        self.assertEqual(financing.sync_rows(self.db, [row]), (1, 0, 0))
        correction = dict(event_id=row['event_id'], company_id='company-1', round='A轮', source=SOURCE,
                          expected=['示例基金', '待移除基金'], remove=['示例基金'])
        self.assertEqual(financing.sync_investor_corrections(self.db, [correction]), (0, 0, 1))
        missing_source = correction | {'source': 'https://example.com/other', 'expected': ['示例基金']}
        self.assertEqual(financing.sync_investor_corrections(self.db, [missing_source]), (0, 0, 1))
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events'), [row])


    def apply_amount_correction(self, correction):
        with TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'reviewed-amount-corrections.json').write_text(json.dumps([correction]))
            with patch.object(financing, 'database', return_value=self.db), \
                 patch('sys.argv', ['sync_financing.py', '--historical-dir', directory]):
                financing.main()

    def test_reviewed_amount_correction_preserves_other_fields_and_replays(self):
        original = event('1', '新星科技', 'B轮') | {'amount': '1,700万美元'}
        unrelated = event('2', '新星科技', 'B+轮', day='2025-10-01') | {'amount': '1,700万美元'}
        self.assertEqual(financing.sync_rows(self.db, [original, unrelated]), (2, 0, 0))
        correction = dict(event_id=original['event_id'], company_id='', day='2025-08-01',
                          round='B轮', source=SOURCE, expected='1,700万美元', amount='2,600万美元')
        for _ in range(2):
            self.apply_amount_correction(correction)
            self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events ORDER BY event_id'),
                             [original | {'amount': '2,600万美元'}, unrelated])

    def test_reviewed_amount_correction_holds_wrong_snapshot_or_source(self):
        original = event('1', '新星科技', 'B轮', company_id='company-1') | {'amount': '2,000万美元'}
        self.assertEqual(financing.sync_rows(self.db, [original]), (1, 0, 0))
        correction = dict(event_id=original['event_id'], company_id='company-1', day='2025-08-01',
                          round='B轮', source=SOURCE, expected='1,700万美元', amount='2,600万美元')
        self.apply_amount_correction(correction)
        correction['expected'] = original['amount']
        self.apply_amount_correction(correction | {'source': 'https://example.com/missing'})
        self.apply_amount_correction(correction | {'day': '2025-08-02'})
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events'), [original])


if __name__ == '__main__':
    unittest.main()
