from pathlib import Path
import json
import unittest

from company_research import render_sample, research_topics


class CompanyResearchTest(unittest.TestCase):
    def test_default_sample_keeps_procurement_and_investment_separate(self):
        sample = json.loads(Path('research-api-sample.json').read_text())
        html = render_sample(sample)
        self.assertIn('兴业银行采购', html)
        self.assertIn('https://cg.cib.com.cn/', html)
        self.assertIn('Augment Code', html)
        self.assertIn('https://www.augmentcode.com/', html)
        before_candidates, after_candidates = html.split('<h3>新增潜在机构</h3>')
        self.assertIn('高瓴创投', before_candidates)
        self.assertNotIn('高瓴创投', after_candidates)
        self.assertIn('竞品冲突', after_candidates)
        self.assertIn('证据缺口', html)
        self.assertIn('https://www.aixcoder.com/zh/services', html)

    def test_worker_template_requires_typed_evidence_and_gap(self):
        template = json.loads(Path('research-worker/payload.json').read_text())
        properties = template['text']['format']['schema']['properties']
        sections = properties['sections']['properties']
        self.assertEqual(set(sections), set(properties['sectionGaps']['properties']))
        self.assertEqual(len(sections), 8)
        requirements = {
            '市场规模': {'marketScope', 'geography', 'period', 'measurement'},
            '市场痛点': {'buyer', 'scenario', 'problem'},
            '历史融资情况': {'eventDate', 'investors'},
            '机构类似布局': {'institution', 'portfolioCompany', 'eventDate', 'relevance'},
            '新增潜在机构': {'institution', 'portfolioCompany', 'eventDate', 'relevance', 'checks'},
        }
        for name, fields in requirements.items():
            with self.subTest(section=name):
                self.assertGreaterEqual(set(sections[name]['items']['required']), fields | {'source', 'sourceDate'})
        self.assertIn('followOnGap', properties)

    def test_topics_keep_one_sourced_case_per_company_and_a_usable_round(self):
        def deal(company, stage, source, parties, day):
            return dict(company=company, companyHref='company.html?id='+company,
                        href='deal.html?id='+company+day, sector='人工智能', sub='AI编程',
                        day=day, stage=stage, amount='', sources=source, parties=parties)

        url = ['https://example.org/disclosure']
        parties = [['甲机构', 'institution.html?id=甲']]
        records = research_topics([
            deal('甲公司', '股权转让', url, parties, '2026-08-05'),
            deal('甲公司', 'A轮', [], parties, '2026-08-04'),
            deal('甲公司', 'A轮', url, [], '2026-08-03'),
            deal('甲公司', '天使轮', url, parties, '2026-08-02'),
            deal('甲公司', '种子轮', url, parties, '2026-08-01'),
            deal('乙公司', 'A轮', url, [], '2026-08-01'),
        ])
        rows = list(records[('人工智能', 'AI编程')].values())
        self.assertEqual([r[1] for r in rows], ['甲公司', '乙公司'])
        self.assertEqual(rows[0][3], '天使轮')
        self.assertEqual(rows[0][6], parties)
        self.assertEqual(rows[1][6], [])


if __name__ == '__main__':
    unittest.main()
