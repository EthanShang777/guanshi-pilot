import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fa_publication import direction_bucket, fund_index, write_search_indexes


class FundIndexTests(unittest.TestCase):
    def test_only_public_disclosed_fund_relations_are_exported(self):
        source = dict(url='https://example.org/filing', lpScope='irrelevant')
        fund = dict(fundId='a'*24, fundName='一期基金', managerId='b'*24,
                    managerName='管理人', source=source, sizeCny=42, partners=[{'name':'LP'}])
        self.assertEqual(fund_index([fund]), {'a'*24: {
            'name':'一期基金','managerId':'b'*24,'managerName':'管理人','source':source['url']
        }})

    def test_imprecise_manager_remains_a_fund(self):
        fund = dict(fundId='a'*24,fundName='二期基金',managerId='b'*24,
                    managerName='管理人未披露',source={'url':'https://example.org/filing'})
        self.assertEqual(fund_index([fund])['a'*24]['managerId'], '')


class SectorSearchTests(unittest.TestCase):
    def test_publishes_ordered_rows_with_branches_and_unknown_directions(self):
        robotics = ['a', '甲', [], '2026', '机器人与自动化', 'A轮', None, ['投资方'], None,
                    '机器人本体', '', 'company.html?id=甲', ['robotics']]
        unknown_direction = ['b', '乙', [], '', '机器人与自动化', '', None, [], None,
                             '', '', 'company.html?id=乙', []]
        unknown_sector = ['c', '丙', [], '2025', '待归类', '', None, [], None,
                          '', '', 'company.html?id=丙', []]
        with TemporaryDirectory() as folder:
            data = Path(folder)
            names = write_search_indexes(data, iter([robotics, unknown_sector, unknown_direction]))['faSearchSectors']
            self.assertRegex(names['机器人与自动化'], r'^fa-sector-robotics-automation-[a-f0-9]{12}$')
            self.assertEqual(json.loads((data / f"{names['机器人与自动化']}.json").read_text()),
                             [robotics, unknown_direction])
            self.assertEqual(json.loads((data / f"{names['待归类']}.json").read_text()), [unknown_sector])
            self.assertEqual(write_search_indexes(data, [robotics, unknown_sector, unknown_direction])['faSearchSectors'], names)
            new_names = write_search_indexes(data, [robotics, unknown_sector])['faSearchSectors']
            self.assertNotEqual(new_names['机器人与自动化'], names['机器人与自动化'])
            self.assertEqual(new_names['待归类'], names['待归类'])

    def test_direction_buckets_preserve_branch_membership_unknowns_and_case_order(self):
        sector = '机器人与自动化'

        def row(key, direction, branches=()):
            return [key, str(key), [], '2026', sector, 'A轮', None, [], None,
                    direction, '', 'company.html', list(branches)]

        own_branch = row(0, '机器人本体', ['robotics'])
        unknown = row(1, '')
        overlapping = row(2, '自动化控制', ['robotics', 'automation'])
        rows = [own_branch, unknown, overlapping] + [row(i, f'方向{i}') for i in range(3, 100)]
        with TemporaryDirectory() as folder:
            data = Path(folder)
            index = write_search_indexes(data, rows)
            count = index['faSearchDirectionBuckets'][sector]
            self.assertEqual(count, 2)
            suffix = index['faSearchSectors'][sector].removeprefix('fa-sector-')
            for direction, expected in [('机器人', [0, 1, 2]), ('机器人本体', [0, 1]), ('自动化', [1, 2])]:
                bucket = direction_bucket(direction, count)
                path = data / f'fa-direction-v1-{suffix}-{bucket}.json'
                records = json.loads(path.read_text())
                scoped = [r[0] for r in records if not r[9] or r[9] == direction
                          or direction == '机器人' and 'robotics' in r[12]
                          or direction == '自动化' and 'automation' in r[12]]
                self.assertEqual(scoped, expected)
                self.assertEqual(len({r[0] for r in records}), len(records))
                self.assertTrue(set(expected).issubset({r[0] for r in records}))
            self.assertEqual(direction_bucket('企业智能体与应用开发平台', 63), 47)


if __name__ == '__main__':
    unittest.main()
