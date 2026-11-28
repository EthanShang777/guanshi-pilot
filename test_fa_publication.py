import unittest

from fa_publication import fund_index


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


if __name__ == '__main__':
    unittest.main()
