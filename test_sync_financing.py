import json
import sqlite3
import unittest
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

    def test_replaying_a_partially_written_batch_only_inserts_missing_rows(self):
        rows = [event('1', '新星科技', '种子轮', company_id='company-1'),
                event('2', '新星科技', '天使轮', company_id='company-1')]
        self.assertEqual(financing.sync_rows(self.db, rows[:1], reviewed=True), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, rows, reviewed=True), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
