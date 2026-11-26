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

    def test_non_active_records_do_not_block_confirmed_financing(self):
        for index, stage in enumerate(('拟增资', '已合并披露')):
            with self.subTest(stage=stage):
                company = f'测试公司{index}'
                company_id = f'company-{index}'
                archived = event(f'{index}-archived', company, stage, company_id=company_id)
                finished = event(f'{index}-finished', company, 'A轮', company_id=company_id)
                self.assertEqual(financing.sync_rows(self.db, [archived]), (1, 0, 0))
                self.assertEqual(financing.sync_rows(self.db, [finished], reviewed=True), (1, 0, 0))
                self.assertEqual(financing.sync_rows(self.db, [finished], reviewed=True), (0, 0, 0))

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


    def test_reviewed_round_correction_validates_current_investors_and_replays(self):
        original = event('1', '新星科技', 'B+轮', company_id='company-1') | {'amount': '未披露'}
        self.assertEqual(financing.sync_rows(self.db, [original]), (1, 0, 0))
        fields = ('round', 'amount', 'investors_json')
        source = 'https://example.com/prospectus'
        correction = dict(event_id=original['event_id'], company_id='company-1',
                          day=original['date_key'], source=source,
                          expected={field: original[field] for field in fields},
                          corrected={'round': 'B++轮', 'amount': '1亿元人民币',
                                     'investors_json': financing.packed([dict(name='某创投', role=None, amount=None)])})
        stale = correction | {'expected': correction['expected'] | {'investors_json': '[]'}}
        self.assertNotEqual(stale['expected'], correction['expected'])
        self.assertEqual(financing.sync_round_corrections(self.db, [stale]), (0, 0, 1))
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events'), [original])
        self.assertEqual(financing.sync_round_corrections(self.db, [correction]), (1, 0, 0))
        self.assertEqual(financing.sync_round_corrections(self.db, [correction]), (0, 1, 0))
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events'),
                         [original | correction['corrected'] |
                          {'sources_json': financing.packed(json.loads(original['sources_json']) + [source])}])


    def test_reviewed_dates_apply_after_round_review_and_replay(self):
        original = event('1', '新星科技', 'D++轮', company_id='company-1') | {'amount': '未披露'}
        self.assertEqual(financing.sync_rows(self.db, [original]), (1, 0, 0))
        round_fields = ('round', 'amount', 'investors_json')
        old_date = {field: original[field] for field in ('date', 'date_key', 'date_kind')}
        new_date = dict(date='2025-07', date_key='2025-07-01', date_kind='转让月份')
        evidence = 'https://example.com/disclosure'
        identity = dict(event_id=original['event_id'], company_id=original['company_id'], source=evidence)
        round_review = dict(identity, day=original['date_key'], final_day=new_date['date_key'],
                            expected={field: original[field] for field in round_fields},
                            corrected=dict(round='股权转让', amount='2000万元', investors_json=original['investors_json']))
        date_review = dict(identity, round='股权转让', expected=old_date, corrected=new_date)
        with TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'reviewed-round-corrections.json').write_text(json.dumps([round_review]))
            (path / 'reviewed-date-corrections.json').write_text(json.dumps([date_review]))
            with patch.object(financing, 'database', return_value=self.db), \
                 patch('sys.argv', ['sync_financing.py', '--historical-dir', directory]):
                financing.main()
                financing.main()
        expected = original | round_review['corrected'] | new_date | {
            'sources_json': financing.packed([SOURCE, evidence])}
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events'), [expected])
        self.assertEqual(financing.sync_round_corrections(self.db, [round_review]), (0, 1, 0))
        self.assertEqual(financing.sync_date_corrections(self.db, [date_review]), (0, 1, 0))

    def test_reviewed_date_holds_unexpected_state_and_rejects_inconsistent_precision(self):
        original = event('1', '新星科技', 'A轮', company_id='company-1')
        self.assertEqual(financing.sync_rows(self.db, [original]), (1, 0, 0))
        expected = {field: original[field] for field in ('date', 'date_key', 'date_kind')}
        corrected = dict(date='2025-07', date_key='2025-07-01', date_kind='融资月份')
        review = dict(event_id=original['event_id'], company_id=original['company_id'],
                      source=SOURCE, round='A轮', expected=expected, corrected=corrected)
        wrong_date = review | {'expected': expected | {'date': '2025-08'}}
        self.assertEqual(financing.sync_date_corrections(self.db, [wrong_date]), (0, 0, 1))
        self.assertEqual(financing.sync_date_corrections(self.db, [review | {'round': 'A+轮'}]), (0, 0, 1))
        with self.assertRaises(ValueError):
            financing.sync_date_corrections(self.db, [review | {'corrected': corrected | {'date_key': '2025-07-20'}}])
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events'), [original])


    def test_reviewed_company_identity_keeps_the_event_and_leaves_other_company_records(self):
        original = event('1', '原始快讯误挂公司', 'C++轮', company_id='wrong-company') | {'amount':'26.5亿元'}
        unrelated = event('2', '原始快讯误挂公司', 'A轮', company_id='wrong-company')
        self.assertEqual(financing.sync_rows(self.db, [original, unrelated], reviewed=True), (2, 0, 0))
        corrected = dict(company_id='verified-company',company_name='核实后的实际融资方',raw_company_key='已核品牌; 核实后的实际融资方',
                         date='2025-07-31',date_key='2025-07-31',date_kind='公开披露日',
                         investors_json=financing.packed([dict(name='实际出资主体',role=None,amount='26.5亿元')]))
        expected = {field:original[field] for field in corrected}
        review = dict(event_id=original['event_id'],round=original['round'],
                      source='https://example.com/issuer',expected=expected,corrected=corrected)
        with TemporaryDirectory() as directory:
            path=Path(directory)
            (path/'reviewed-company-corrections.json').write_text(json.dumps([review]))
            with patch.object(financing,'database',return_value=self.db), \
                 patch('sys.argv',['sync_financing.py','--historical-dir',directory]):
                financing.main()
                financing.main()
        actual=original|corrected|{'sources_json':financing.packed([SOURCE,review['source']])}
        self.assertEqual(self.query(self.db,'SELECT * FROM financing_events ORDER BY event_id'),[actual,unrelated])
        self.assertEqual(financing.sync_company_corrections(self.db,[review]),(0,1,0))
        stale=review|{'corrected':corrected|{'company_name':'其他未核公司'}}
        self.assertEqual(financing.sync_company_corrections(self.db,[stale]),(0,0,1))
        self.assertEqual(self.query(self.db,'SELECT * FROM financing_events ORDER BY event_id'),[actual,unrelated])

    def test_reviewed_distinct_rounds_for_one_company_are_idempotent(self):
        company_id = 'co:cn_uscc:issuer'
        june = event('june', '示例锂电', '战略融资', company_id=company_id,
                     day='2026-06-30', urls=('https://example.com/bank',))
        july = event('july', '示例锂电', '股权融资', company_id=company_id,
                     day='2026-07-13', urls=('https://example.com/fund',))
        july['investors_json'] = financing.packed([{'name': '另一出资方'}])
        reviews = {(financing.event_identity(july), financing.event_identity(june))}
        self.assertEqual(financing.sync_rows(self.db, [june], reviewed=True), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [july], reviewed=True), (0, 0, 1))

        for field in ('sources_json', 'investors_json'):
            with self.subTest(shared=field):
                overlapping = july | {field: june[field]}
                self.assertEqual(
                    financing.match_status(overlapping, june, {july['event_id']}, reviews),
                    'uncertain',
                )

        self.assertEqual(financing.sync_rows(self.db, [july], reviewed=True, distinct_events=reviews), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [june, july], reviewed=True, distinct_events=reviews), (0, 0, 0))
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events ORDER BY event_id'), [july, june])


    def test_reviewed_transfer_and_capital_increase_share_a_source(self):
        company_id = 'co:cn_uscc:issuer'
        increase = event('increase', '示例新能', '增资', company_id=company_id)
        transfer = event('transfer', '示例新能', '股权转让', company_id=company_id)
        reviews = {(financing.event_identity(transfer), financing.event_identity(increase))}
        self.assertEqual(financing.sync_rows(self.db, [increase], reviewed=True), (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [transfer], reviewed=True), (0, 0, 1))
        self.assertEqual(financing.sync_rows(self.db, [transfer], reviewed=True, distinct_events=reviews),
                         (1, 0, 0))
        self.assertEqual(financing.sync_rows(self.db, [increase, transfer], reviewed=True,
                                             distinct_events=reviews), (0, 0, 0))
        self.assertEqual(self.query(self.db, 'SELECT * FROM financing_events ORDER BY event_id'),
                         [increase, transfer])


if __name__ == '__main__':
    unittest.main()
