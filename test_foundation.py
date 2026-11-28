import unittest

from sector_taxonomy import classify_sector
from institution_identity import participant


class SectorTests(unittest.TestCase):
    def test_robotics_subtree(self):
        for label, direction, branches in (
            ('机器人', '', ('robotics',)),
            ('机器人与自动化', '仓储自动化', ('automation',)),
            ('机器人与自动化', '人形机器人', ('robotics',)),
            ('机器人与自动化', '工业机器人与自动化装备', ('robotics', 'automation')),
            ('机器人与自动化', '电磁执行器', ()),
        ):
            with self.subTest(label=label, direction=direction):
                category = classify_sector(label, direction)
                self.assertEqual(category.id, 'robotics-automation')
                self.assertEqual(category.branches, branches)
                self.assertEqual(category.direction, direction)

    def test_verified_aliases_and_unresolved_labels(self):
        for a, b in (('汽车交通', '汽车与出行'), ('汽车出行', '汽车与出行'),
                     ('消费零售', '消费与零售')):
            self.assertEqual(classify_sector(a), classify_sector(b))
        self.assertEqual(classify_sector('新能源汽车').direction, '新能源汽车')
        self.assertEqual(classify_sector('新能源汽车', '汽车制动与底盘电控').branches, ('new-energy-vehicles',))
        self.assertEqual(classify_sector('机器人与自动化', '机器人').branches, ('robotics',))
        self.assertEqual(classify_sector('汽车与出行', '汽车出行').direction, '汽车出行')
        self.assertEqual(classify_sector('工业制造', '航空航天').direction, '航空航天')
        self.assertNotEqual(classify_sector('消费与服务').id, classify_sector('消费与零售').id)
        self.assertEqual(classify_sector('').id, 'unknown')
        self.assertEqual(classify_sector('新出现的未审标签').id, 'unknown')


class InstitutionTests(unittest.TestCase):
    def test_verified_brand_alias_and_roles(self):
        for name in ('高瓴创投（GL Ventures）', 'GL Ventures', '高瓴创投（联合领投）'):
            self.assertEqual(participant(name).name, '高瓴创投')
        row = participant({'name': '高瓴创投（追加）', 'role': '领投'})
        self.assertEqual(row.roles, ('领投', '追加'))
        self.assertEqual(row.raw_name, '高瓴创投（追加）')

    def test_named_funds_remain_distinct_and_unnamed_are_descriptions(self):
        fund = '北京高瓴裕润股权投资基金合伙企业（有限合伙）'
        self.assertEqual(participant(fund).name, fund)
        self.assertEqual(participant('珠海高瓴私募基金管理有限公司').name, '珠海高瓴私募基金管理有限公司')
        self.assertIsNone(participant('老股东追加').name)
        self.assertIsNone(participant('老股东（未具名）').name)
        self.assertIsNone(participant('老股东星连资本追投').name)
        self.assertIsNone(participant('某头部机构').name)
        self.assertEqual(participant('领投未披露）').roles, ('领投',))
        self.assertEqual(participant('南京精智达清源投资基金', {'南京精智达清源投资基金'}).name,
                         '南京精智达清源创业投资合伙企业（有限合伙）')
        self.assertIsNone(participant('高瓴创投（大米）；高瓴资本（明势）').name)
        self.assertEqual(participant('高瓴（领投）').name, '高瓴')


if __name__ == '__main__':
    unittest.main()
