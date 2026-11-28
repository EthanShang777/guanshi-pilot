"""Reconcile verified public Dots batches through the financing master."""
from collections import Counter
from datetime import date, datetime, timezone
from hashlib import sha256
from itertools import chain
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from urllib.request import urlopen

SCHEMA = "guanshi.dots.financing.v1"
ISSUE = "https://github.com/EthanShang777/guanshi-pilot/issues/1"
SOURCE_USER_ID = 110958536
BATCH_KEYS = {"schema", "batch_id", "scanned_at", "candidates"}
CANDIDATE_KEYS = {
    "candidate_id", "company", "announced_on", "round", "transaction_type",
    "transaction_status", "amount_text", "investors", "sources",
}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def text(value):
    return isinstance(value, str) and bool(value.strip())

def identifier(value):
    return text(value) and not any(char.isspace() for char in value)

def nullable_text(value):
    return value is None or text(value)

def nullable_date(value):
    return value is None or (text(value) and date.fromisoformat(value).isoformat() == value)

def source_link(source):
    if not isinstance(source, dict) or set(source) != {"url", "published_on"} or not text(source["url"]):
        return False
    link = urlsplit(source["url"])
    return link.scheme == "https" and bool(link.hostname) and not link.username and not link.password and nullable_date(source["published_on"])

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def parse_candidate(candidate):
    require(isinstance(candidate, dict) and CANDIDATE_KEYS <= set(candidate) <= CANDIDATE_KEYS | {"existing_event_id", "sector"},
            "unexpected candidate fields")
    company = candidate["company"]
    require(isinstance(company, dict) and set(company) == {"display_name", "legal_name", "country"}
            and text(company["display_name"]) and all(nullable_text(company[key]) for key in ("legal_name","country")),
            "invalid company")
    require(identifier(candidate["candidate_id"]) and nullable_date(candidate["announced_on"]), "invalid candidate identity or date")
    require(all(nullable_text(candidate.get(key)) for key in ("round","transaction_type","transaction_status","amount_text","existing_event_id","sector")),
            "invalid transaction field")
    investors = candidate["investors"]
    require(isinstance(investors, list) and all(isinstance(i, dict) and set(i) == {"name","role"}
            and text(i["name"]) and nullable_text(i["role"]) for i in investors), "invalid investor list")
    sources = candidate["sources"]
    require(isinstance(sources, list) and bool(sources) and all(source_link(s) for s in sources), "invalid public sources")
    normalized = dict(candidate, investors=sorted({canonical(i) for i in investors}),
                      sources=sorted({canonical(s) for s in sources}))
    return candidate["candidate_id"], sha256(canonical(normalized).encode()).hexdigest()

def parse_batch(body):
    match = re.fullmatch(r"```json\s*\n(.*?)\n```", body.strip(), flags=re.S)
    require(match is not None, "expected one JSON code block")
    batch = json.loads(match.group(1))
    require(isinstance(batch, dict) and set(batch) == BATCH_KEYS and batch["schema"] == SCHEMA
            and identifier(batch["batch_id"]) and isinstance(batch["candidates"], list), "invalid batch envelope")
    require(text(batch["scanned_at"]) and datetime.fromisoformat(batch["scanned_at"]).tzinfo is not None,
            "expected timestamp with a time zone")
    for candidate in batch["candidates"]:
        parse_candidate(candidate)
    return batch


SITE = "https://ethanshang777.github.io/guanshi-pilot/"
OWNER = "EthanShang777/guanshi-pilot"
PUBLIC_STATUSES = {"已宣布完成", "已完成", "已宣布", "交割完成"}
PUBLIC_TYPES = {"融资", "股权融资"}


def read_json(url):
    with urlopen(url, timeout=15) as response:
        return json.load(response)


def eligible(comment):
    return (comment.get("user") or {}).get("id") == SOURCE_USER_ID


def read_comment(comment):
    require(comment["created_at"] == comment["updated_at"], "submit revisions as new comments")
    return parse_batch(comment["body"])


def canonical_cv(urls):
    ids = set()
    for url in urls:
        link = urlsplit(url)
        if link.hostname in ("www.chinaventure.com.cn", "chinaventure.com.cn"):
            match = re.fullmatch(r"/flash/\d{8}-(\d+)\.html", link.path)
            if match:
                ids.add("cv:flash:"+match[1])
    return next(iter(ids)) if len(ids) == 1 else None


def amount_key(value):
    from sync_financing import normalize
    result = normalize(value).replace("人民币", "")
    return "" if result in ("", "未披露", "金额未披露", "未公开") else result


def reconcile_candidate(db, candidate, company_ids):
    from sync_financing import (append_sources, company_relation, normalize, packed, query,
                                round_key, sync_rows)

    ident, digest = parse_candidate(candidate)
    result = {"candidate_id": ident, "payload_sha256": digest}
    company = candidate["company"]
    stage = candidate["round"]
    day = candidate["announced_on"]
    if candidate["transaction_status"] not in PUBLIC_STATUSES or candidate["transaction_type"] not in PUBLIC_TYPES:
        return result | {"status": "held", "reason": "completion_or_transaction_type"}
    if not day or not stage or not round_key(stage):
        return result | {"status": "held", "reason": "missing_date_or_round"}
    name = company["legal_name"] or company["display_name"]
    aliases = ";".join(dict.fromkeys((name, company["display_name"])))
    urls = list(dict.fromkeys(s["url"] for s in candidate["sources"]))
    evidence = {s["url"]:s for s in candidate["sources"]}
    cv_id = canonical_cv(urls)
    incoming_id = cv_id or "dots:daily:"+sha256(ident.encode()).hexdigest()[:24]
    investors = [party | {"amount": None} for party in candidate["investors"]
                 if not re.search(r"FA|财务顾问|融资顾问|财顾", party["role"] or "", re.I)]
    sector = candidate.get("sector") or "待归类"
    row = dict(date=day, company_name=name, primary_sector=sector, secondary_sector="", round=stage,
               investors_json=packed(investors), amount=candidate["amount_text"] or "未披露", valuation="",
               date_kind="公开披露日期", sources_json=packed(urls), event_id=incoming_id, company_id="",
               raw_company_key=aliases, date_key=day, sector=sector, sector_source=urls[0])
    recorded = query(db,"SELECT event_id FROM dots_financing_candidates WHERE candidate_id=?", [ident])
    anchor = recorded[0]["event_id"] if recorded else candidate.get("existing_event_id")
    keys = dict.fromkeys(filter(None,(anchor, incoming_id)))
    fixed = {}
    for key in keys:
        for existing in query(db,"SELECT * FROM financing_events WHERE event_id=?", [key]):
            fixed[key] = existing
    if anchor and anchor not in fixed:
        return result | {"status": "held", "reason": "existing_event_id_not_found"}
    if len(fixed) > 1:
        return result | {"status": "held", "reason": "multiple_stable_event_ids"}
    nearby = query(db, '''SELECT * FROM financing_events
          WHERE date_key BETWEEN date(?,'-14 days') AND date(?,'+14 days')
          AND round NOT IN ('拟增资','已合并披露')''', [day,day])
    related = [old for old in nearby if company_relation(row,old) != "different"]
    exact = [old for old in related if company_relation(row,old) == "same"]
    matches = [old for old in exact if round_key(old["round"]) == round_key(stage)
               and (set(urls) & set(json.loads(old["sources_json"] or "[]")) or old["date_key"] == day)]
    chosen = next(iter(fixed.values()),None)
    if not chosen and len(matches) == 1:
        chosen = matches[0]
    if chosen:
        if (company_relation(row,chosen) != "same" or round_key(chosen["round"]) != round_key(stage)
                or abs((date.fromisoformat(chosen["date_key"])-date.fromisoformat(day)).days) > 14):
            return result | {"status": "held", "reason": "existing_event_identity_disagrees"}
        both = amount_key(row["amount"]), amount_key(chosen["amount"])
        if all(both) and both[0] != both[1] and not set(urls) & set(json.loads(chosen["sources_json"] or "[]")):
            return result | {"status": "held", "reason": "reported_amount_disagrees",
                             "related_event_id": chosen["event_id"], "reported_amount": row["amount"],
                             "announced_on": day, "evidence_sources": list(evidence.values()),
                             "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if any(old["event_id"]!=chosen["event_id"] for old in matches):
            return result | {"status": "held", "reason": "duplicate_live_matches"}
        event_id = chosen["event_id"]
        old_urls = set(json.loads(chosen["sources_json"] or "[]"))
        status = "source_added" if append_sources(db,event_id,row["sources_json"]) else "covered"
        changed_urls = [url for url in urls if url not in old_urls] if status == "source_added" else []
    else:
        if related:
            return result | {"status": "held", "reason": "ambiguous_nearby_financing"}
        if not company["legal_name"] and not cv_id:
            return result | {"status": "held", "reason": "company_legal_name_missing"}
        known_ids = company_ids.get(name, set()) | company_ids.get(company["display_name"], set())
        if len(known_ids) > 1:
            return result | {"status": "held", "reason": "multiple_company_ids"}
        if known_ids:
            row["company_id"] = next(iter(known_ids))
        elif company["legal_name"]:
            row["company_id"] = "co:full_legal_name:"+sha256(normalize(name).encode()).hexdigest()[:32]
        added, linked, held = sync_rows(db,[row],reviewed=True)
        require((added,linked,held) == (1,0,0), "unexpected result during serial D1 write")
        event_id, status = incoming_id,"added"
        changed_urls = urls
    inserted = query(db,'''INSERT INTO dots_financing_candidates (candidate_id, event_id)
                      VALUES (?,?) ON CONFLICT(candidate_id) DO NOTHING RETURNING event_id''', [ident,event_id])
    if not inserted:
        require(bool(recorded) and recorded[0]["event_id"] == event_id, "candidate ownership changed")
    event = query(db,"SELECT * FROM financing_events WHERE event_id=?", [event_id])[0]
    require(set(urls).issubset(json.loads(event["sources_json"])), "sources absent after D1 write")
    return result | {"status": status, "event_id": event_id, "sources": urls,
                     "candidate_mapping_added": bool(inserted), "announced_on": day,
                     "evidence_sources": [evidence[url] for url in changed_urls],
                     "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def apply_batches(batches):
    from d1 import database, query
    db = database()
    query(db,"""CREATE TABLE IF NOT EXISTS dots_financing_candidates (
        candidate_id TEXT PRIMARY KEY, event_id TEXT NOT NULL)""")
    result=[]
    for comment, batch in batches:
        names = sorted(set(filter(None,chain.from_iterable(
            (c["company"]["legal_name"],c["company"]["display_name"]) for c in batch["candidates"]))))
        company_ids = {}
        for start in range(0,len(names),80):
            chunk = names[start:start+80]
            marks = ",".join("?" for _ in chunk)
            for old in query(db,"SELECT DISTINCT company_name, company_id FROM financing_events "
                             f"WHERE company_id <> '' AND company_name IN ({marks})",chunk):
                company_ids.setdefault(old["company_name"],set()).add(old["company_id"])
        rows = [reconcile_candidate(db, candidate, company_ids) for candidate in batch["candidates"]]
        replay = [reconcile_candidate(db, candidate, company_ids) for candidate in batch["candidates"]]
        require(all(r["status"] in ("covered","held") and not r.get("candidate_mapping_added") for r in replay),
                "repeat import changed D1")
        result.append({"comment_id":comment["id"],"comment_url":ISSUE+"#issuecomment-"+str(comment["id"]),
                       "batch_id":batch["batch_id"],"scanned_at":batch["scanned_at"],
                       "counts":dict(Counter(x["status"] for x in rows)),
                       "replay_counts":dict(Counter(x["status"] for x in replay)),
                       "candidates":rows})
    return result


def verify_pages(result):
    cache={}
    def record(kind, key):
        name=f"{kind}-{key[:2]}.json"
        if name not in cache:
            cache[name]=read_json(SITE+"records/"+name)
        return cache[name][key]

    for batch in result:
        for row in batch["candidates"]:
            if "event_id" not in row:
                continue
            event_key=sha256(("event"+row["event_id"]).encode()).hexdigest()[:24]
            deal=record("deal",event_key)
            require(set(row["sources"]).issubset(deal["sources"]), "published sources missing")
            company=record("company",deal["companyHref"].split("=")[-1])
            require(sum(e[0]==deal["href"] for e in company["events"])==1, "company back-link missing")
            for name,href in deal["parties"]:
                actor=record("institution",href.split("=")[-1])
                require(actor["name"]==name and sum(e[0]==deal["href"] for e in actor["events"])==1,
                        "institution back-link missing")
            row.update(site_url=SITE+deal["href"],company_url=SITE+deal["companyHref"],
                       institution_backlinks=len(deal["parties"]))
        batch["pages_verified"]=True


def main(argv):
    mode, path = argv
    path=Path(path)
    if mode=="verify":
        result=json.loads(path.read_text())
        verify_pages(result)
        path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
        summary=os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary,"a") as f:
                for batch in result:
                    print("### "+batch["batch_id"],file=f)
                    print(batch["counts"],file=f)
                    print("同批重放 "+str(batch["replay_counts"]),file=f)
                    print("[收件评论]("+batch["comment_url"]+")",file=f)
                    for row in batch["candidates"]:
                        if "site_url" in row:
                            print("- ["+row["candidate_id"]+"]("+row["site_url"]+") "+row["status"],file=f)
        return
    require(mode=="apply","expected apply or verify")
    event=json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    if os.environ["GITHUB_EVENT_NAME"]=="issue_comment":
        require(event["issue"]["number"]==1 and not event["issue"].get("pull_request"),"unexpected issue")
        comment=event["comment"]
    else:
        comment_id=event.get("inputs",{}).get("dots_comment_id","")
        require(comment_id.isdecimal(),"expected receipt comment ID")
        comment=read_json(f"https://api.github.com/repos/{OWNER}/issues/comments/{comment_id}")
        require(comment["issue_url"]==f"https://api.github.com/repos/{OWNER}/issues/1","unexpected issue")
    require(eligible(comment), "unexpected submitter")
    batch=read_comment(comment)
    result=apply_batches([(comment,batch)]) if batch["candidates"] else [{
        "comment_id":comment["id"],"comment_url":ISSUE+"#issuecomment-"+str(comment["id"]),
        "batch_id":batch["batch_id"],"scanned_at":batch["scanned_at"],"counts":{},
        "replay_counts":{},"candidates":[],
    }]
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    with open(os.environ["GITHUB_OUTPUT"],"a") as f:
        print("has_records="+str(any("event_id" in r for b in result for r in b["candidates"])).lower(),file=f)


if __name__=="__main__":
    main(sys.argv[1:])
