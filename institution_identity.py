"""Resolve disclosed participants without inferring legal or fund identity from name similarity."""

from dataclasses import dataclass
import re

# The brand explicitly identifies itself as 高瓴创投（GL Ventures） in its recruitment
# material published by Xidian University. Hillhouse funds and managers keep their own IDs.
REVIEWED_ALIASES = {
    '高瓴创投': {
        'aliases': ('GL Ventures', '高瓴创投（GL Ventures）', '高瓴创投(GL Ventures)'),
        'source': 'https://job.xidian.edu.cn/company/view/id/816512',
    },
    '南京精智达清源创业投资合伙企业（有限合伙）': {
        'aliases': ('南京精智达清源投资基金',),
        'source': 'https://static.cninfo.com.cn/finalpage/2026-07-18/1225430330.PDF#page=2',
    },
    '深创投': {
        'aliases': ('深圳市创新投资集团有限公司', 'SCGC'),
        'source': 'https://www.szvc.com.cn/',
    },
    'IDG资本': {
        'aliases': ('IDG Capital',),
        'source': 'https://www.idgcapital.com/',
    },
    '毅达资本': {
        'aliases': ('Addor Capital',),
        'source': 'https://www.addorcapital.com/',
    },
    '红杉中国': {
        'aliases': ('HongShan',),
        'source': 'https://www.hongshan.com/',
    },
    '清流资本': {
        'aliases': ('Crystal Stream Capital',),
        'source': 'https://www.crystalstreamcap.com/',
    },
}
REVIEWED_FUND_SHORT_NAMES = {'南京精智达清源投资基金'}
ALIAS_TO_NAME = {alias.casefold(): name
                 for name, entry in REVIEWED_ALIASES.items() for alias in entry['aliases']}
ROLES = r'独家领投|共同领投|联合领投|领投|跟投|参投|参与投资|追加投资|追加|追投|续投'
ROLE_SUFFIX = re.compile(r'\s*[（(]\s*(' + ROLES + r')\s*[）)]$')
ROLE_PREFIX = re.compile(r'^(' + ROLES + r')\s*[:：]\s*')
UNNAMED = re.compile(
    r'^(?:(?:部分|其他|原有|原|老|既有|现有|未披露|未具名|某|数家|多家|多位|若干)*'
    r'(?:投资机构|产业投资方|产业资本|投资人|投资方|机构投资者|股东|财务投资者|机构|资方|个人投资者|个人|战略投资者)'
    r'(?:共同|继续|联合)?(?:' + ROLES + r'|参与|增资)?|未披露|未公开|未具名|未透露|不详|暂无|未知)$'
)


@dataclass(frozen=True)
class Participant:
    name: str | None
    raw_name: str
    roles: tuple[str, ...]
    status: str


def participant(item, protected_names=()):
    raw = (item.get('name') if isinstance(item, dict) else item) or ''
    if not isinstance(raw, str):
        return Participant(None, '', (), '未识别')
    name = raw.strip()
    explicit_role = item.get('role') if isinstance(item, dict) else None
    roles = [explicit_role.strip()] if isinstance(explicit_role, str) and explicit_role.strip() else []
    for pattern in (ROLE_PREFIX, ROLE_SUFFIX):
        if match := pattern.search(name):
            roles.append(match.group(1))
            name = pattern.sub('', name).strip()
    role_only = re.fullmatch(r'(' + ROLES + r')(?:身份未披露|未披露|见公司原稿)?[）)]?', name)
    if not name or role_only or UNNAMED.fullmatch(name) or name in {'创始团队', '管理团队'}:
        if role_only:
            roles.append(role_only.group(1))
        if not roles and (match := re.search(r'(' + ROLES + r')$', name)):
            roles.append(match.group())
        return Participant(None, raw, tuple(dict.fromkeys(roles)), '未具名')
    if re.match(r'^(?:老股东|原股东|现有股东|未具名|某(?:头部|知名|产业|战略|财务|大型|国内|海外))', name):
        return Participant(None, raw, tuple(dict.fromkeys(roles)), '身份待核')
    if re.search(r'[；;]', name):
        return Participant(None, raw, tuple(dict.fromkeys(roles)), '身份待核')
    if name not in protected_names or name in REVIEWED_FUND_SHORT_NAMES:
        name = ALIAS_TO_NAME.get(name.casefold(), name)
    return Participant(name, raw, tuple(dict.fromkeys(roles)), '具名')
