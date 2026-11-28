"""The public financing taxonomy. Raw master labels and source evidence stay intact."""

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import re
from unicodedata import normalize

ROOTS = {
    'ai': '人工智能', 'health': '医疗健康', 'robotics-automation': '机器人与自动化',
    'chips-computing': '芯片与算力', 'software-enterprise': '软件与企业服务',
    'finance': '金融', 'consumer-retail': '消费与零售', 'agriculture-food': '农业与食品',
    'industrial': '工业制造', 'energy-environment': '能源与环境', 'logistics': '物流与供应链',
    'aerospace': '航空航天', 'tourism-hospitality': '旅游与酒店', 'materials': '材料与化工',
    'media': '文娱传媒', 'education-talent': '教育与人才', 'property-construction': '房地产与建筑',
    'auto-mobility': '汽车与出行', 'communications-electronics': '通信与电子',
    'internet-it': '互联网与信息技术', 'transport': '交通与出行',
    'frontier': '前沿科技', 'consumer': '消费',
    'consumer-lifestyle': '消费与生活', 'consumer-services': '消费与服务',
    'energy-materials': '能源与新材料', 'other': '其他行业', 'unknown': '待归类',
}
ALIASES = {
    '汽车交通': 'auto-mobility', '汽车出行': 'auto-mobility', '消费零售': 'consumer-retail',
    '交通出行': 'transport', '农业食品': 'agriculture-food', '能源与环保': 'energy-environment',
    '文娱与内容': 'media',
}
# Child classes retain their old names as compatible query labels.
CHILDREN = {
    'robotics': ('robotics-automation', '机器人'), 'automation': ('robotics-automation', '自动化'),
    'education': ('education-talent', '教育'), 'training': ('education-talent', '教育与培训'),
    'enterprise-services': ('software-enterprise', '企业服务'),
    'fintech': ('finance', '金融科技'), 'financial-services': ('finance', '金融服务'),
    'logistics-services': ('logistics', '物流'), 'it': ('internet-it', '信息技术'),
    'advanced-manufacturing': ('industrial', '先进制造'),
    'new-energy': ('energy-environment', '新能源'),
    'energy-storage': ('energy-environment', '新能源与储能'),
    'energy-carbon-neutrality': ('energy-environment', '新能源与碳中和'),
    'energy-dual-carbon': ('energy-environment', '能源与双碳'),
    'new-materials': ('materials', '新材料'),
    'new-energy-vehicles': ('auto-mobility', '新能源汽车'),
}
BRANCHES = {key: label for key, (_, label) in CHILDREN.items()}
DIRECTION_ALIASES = {
    'body': '机器人本体', 'brain': '具身决策', 'dexterous-hand': '灵巧手',
    '协作/工业机器人': '工业机器人', '人形本体': '人形机器人',
}
ROOT_IDS = {label: key for key, label in ROOTS.items()}
BRANCH_IDS = {label: key for key, label in BRANCHES.items()}
ROBOTICS = re.compile(r'机器人|具身(?:智能|操作|控制|感知|世界模型|决策)|灵巧手|^人形本体$')
NON_PHYSICAL = re.compile(r'RPA|流程机器人|软件机器人|聊天机器人|对话机器人', re.I)


@dataclass(frozen=True)
class Sector:
    id: str
    name: str
    direction: str
    direction_id: str
    branches: tuple[str, ...]


def classify_sector(primary, secondary=''):
    raw = normalize('NFKC', primary or '').strip()
    direction = normalize('NFKC', secondary or '').strip()
    branch = BRANCH_IDS.get(raw) or (raw if raw in BRANCHES else '')
    root = (CHILDREN[branch][0] if branch else
            ROOT_IDS.get(raw) or (raw if raw in ROOTS else '') or ALIASES.get(raw) or 'unknown')
    direction = DIRECTION_ALIASES.get(direction, direction)
    stated_branch = BRANCH_IDS.get(direction)
    branches = {branch} if branch else set()
    if stated_branch and CHILDREN[stated_branch][0] == root:
        branches.add(stated_branch)
    if stated_branch in {'robotics', 'automation'} and CHILDREN[stated_branch][0] == root:
        direction = ''
    if not direction and branch and branch not in {'robotics', 'automation'}:
        direction = BRANCHES[branch]
    if root == 'robotics-automation':
        if ROBOTICS.search(direction) and not NON_PHYSICAL.search(direction):
            branches.add('robotics')
        if '自动化' in direction:
            branches.add('automation')
    direction_id = 'direction-' + sha256((root + '\n' + direction).encode()).hexdigest()[:16] if direction else ''
    return Sector(root, ROOTS[root], direction, direction_id, tuple(key for key in BRANCHES if key in branches))


def has_fine_direction(sector, direction):
    if not direction or direction in BRANCH_IDS:
        return False
    return direction != sector and ROOTS.get(ALIASES.get(direction)) != sector


def public_filter(out, directions):
    data = {
        'roots': ROOTS, 'aliases': ALIASES, 'parents': {key: root for key, (root, _) in CHILDREN.items()},
        'branches': BRANCHES, 'directionAliases': DIRECTION_ALIASES, 'directions': directions,
    }
    source = Path('sector-filter.js').read_text().replace('/* TAXONOMY */ null', json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True))
    (out / 'sector-filter.js').write_text(source)
