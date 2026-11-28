import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fa_publication import fund_index, write_sector_search


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
            names = write_sector_search(data, iter([robotics, unknown_sector, unknown_direction]))
            self.assertRegex(names['机器人与自动化'], r'^fa-sector-robotics-automation-[a-f0-9]{12}$')
            self.assertEqual(json.loads((data / f"{names['机器人与自动化']}.json").read_text()),
                             [robotics, unknown_direction])
            self.assertEqual(json.loads((data / f"{names['待归类']}.json").read_text()), [unknown_sector])
            self.assertEqual(write_sector_search(data, [robotics, unknown_sector, unknown_direction]), names)
            new_names = write_sector_search(data, [robotics, unknown_sector])
            self.assertNotEqual(new_names['机器人与自动化'], names['机器人与自动化'])
            self.assertEqual(new_names['待归类'], names['待归类'])


if __name__ == '__main__':
    unittest.main()
