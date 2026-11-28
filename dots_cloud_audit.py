"""Read-only audit of one Dots batch and the existing production workflow."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlencode

from dots_intake import (
    ISSUE, OWNER, eligible, parse_candidate, read_comment, verify_pages,
)

BEIJING = timezone(timedelta(hours=8))
BASELINE_DAY = "2026-11-28"
AUDIT_DAY = "2026-11-29"


def api(path, query, *, paginate=False):
    args = ["gh", "api"]
    if paginate:
        args.extend(("--paginate", "--slurp"))
    return json.loads(subprocess.check_output(
        [*args, f"repos/{OWNER}/{path}?{urlencode(query)}"], timeout=45))


def deliveries(day, start):
    found = []
    pages = api("issues/1/comments", {"since": start, "per_page": 100}, paginate=True)
    for page in pages:
        for comment in page:
            if not eligible(comment):
                continue
            if day == BASELINE_DAY and comment["id"] != 7234047684:
                continue
            if datetime.fromisoformat(comment["created_at"]).astimezone(BEIJING).date().isoformat() != day:
                continue
            if comment["created_at"] < start:
                continue
            try:
                batch = read_comment(comment)
            except (TypeError, ValueError):
                continue
            if batch["batch_id"] == f"dots-{day}-0830":
                scanned = datetime.fromisoformat(batch["scanned_at"]).astimezone(BEIJING)
                if scanned.date().isoformat() == day and (scanned.hour, scanned.minute) >= (8, 30):
                    found.append((comment, batch))
    return found


def read_receipts(run):
    run_id = str(run["id"])
    with TemporaryDirectory() as directory:
        subprocess.run(["gh", "run", "download", run_id, "--repo", OWNER,
                        "--name", "dots-receipt", "--dir", directory], check=True, timeout=60)
        return json.loads((Path(directory) / "dots-receipt.json").read_text())


def check_receipt(ack, comment, batch):
    expected = dict(map(parse_candidate, batch["candidates"]))
    measured = {r["candidate_id"]:r["payload_sha256"] for r in ack["candidates"]}
    if (ack["comment_id"], ack["batch_id"], ack["scanned_at"]) != (
            comment["id"], batch["batch_id"], batch["scanned_at"]):
        raise ValueError("The production receipt does not match the delivery")
    if measured != expected or len(measured) != len(batch["candidates"]):
        raise ValueError("The candidate IDs and digests do not match")
    if ack["counts"] != dict(Counter(r["status"] for r in ack["candidates"])):
        raise ValueError("The candidate totals do not match the receipt rows")
    replay = ack["replay_counts"]
    if set(replay) - {"covered", "held"} or sum(replay.values()) != len(expected):
        raise ValueError("Repeat import did not prove zero additions and zero new sources")
    if not ack["pages_verified"]:
        raise ValueError("Production Pages readback did not pass")
    verify_pages([ack])
    return {
        "counts": ack["counts"],
        "replay_counts": replay,
        "company_backlinks": sum("company_url" in r for r in ack["candidates"]),
        "institution_backlinks": sum(r.get("institution_backlinks", 0) for r in ack["candidates"]),
    }


def audit(day, report):
    start = f"{day}T00:30:00Z"
    matches = deliveries(day, start)
    report["deliveries"] = [{
        "id": comment["id"],
        "url": f'{ISSUE}#issuecomment-{comment["id"]}',
        "received_at": comment["created_at"],
        "scanned_at": batch["scanned_at"],
        "github_app": (comment.get("performed_via_github_app") or {}).get("slug"),
        "candidates": len(batch["candidates"]),
    } for comment, batch in matches]
    if len(matches) != 1:
        return "no_delivery" if not matches else "multiple_deliveries"
    comment, batch = matches[0]
    if not batch["candidates"]:
        return "empty_delivery"
    response = api("actions/workflows/daily.yml/runs",
                   {"event": "issue_comment", "created": ">=" + comment["created_at"], "per_page": 20})
    candidates = response["workflow_runs"]
    report["runs_near_delivery"] = [
        {k:run[k] for k in ("id","status","conclusion","html_url")} for run in candidates]
    for run in candidates:
        if run["conclusion"] != "success":
            continue
        try:
            receipts = read_receipts(run)
        except subprocess.CalledProcessError:
            continue
        for ack in receipts:
            if ack["comment_id"] != comment["id"]:
                continue
            report["matched_run"] = run["html_url"]
            report["checks"] = check_receipt(ack, comment, batch)
            return "verified" if report["checks"]["company_backlinks"] else "no_published_records"
    return "receipt_pending" if any(run["status"] != "completed" for run in candidates) else "no_successful_receipt"


MESSAGES = {
    "no_delivery": "收件箱未见对应的当日批次",
    "multiple_deliveries": "发现多条同批投递，待核来源与回执",
    "empty_delivery": "收到当日空批次，本次没有交易可用于验收发布",
    "verified": "GitHub 收件、原工作流查重及 Pages 回读通过",
    "no_published_records": "D1 已核对批次，全部候选待核，需要有可发布交易的真实批次验证 Pages",
    "receipt_pending": "已收到批次，核对时发布回执尚未产生",
    "no_successful_receipt": "已收到批次，未查到与该评论匹配的成功发布回执",
    "check_error": "核对遇到错误，详见运行日志和审计文件",
}


def main(day):
    if day not in (BASELINE_DAY, AUDIT_DAY):
        raise ValueError("Unexpected audit day")
    report = {
        "day_beijing": day,
        "mode": "baseline_self_test" if day == BASELINE_DAY else "scheduled_audit",
        "audit_run_id": os.environ.get("GITHUB_RUN_ID"),
        "checked_at": datetime.now(BEIJING).isoformat(timespec="seconds"),
        "source_evidence": "GitHub 评论可证明收到的批次、作者和时间。Dots 调度执行凭证需从原任务回读。",
    }
    try:
        outcome = audit(day, report)
    except (KeyError, ValueError, OSError, subprocess.SubprocessError) as error:
        outcome = "check_error"
        report["error"] = str(error)
    report["outcome"] = outcome
    summary = [
        f"## {day} Dots 批次核对",
        "11 月 28 日基线测试" if day == BASELINE_DAY else "11 月 29 日云端验收",
        MESSAGES[outcome],
        report["source_evidence"],
    ]
    for delivered in report.get("deliveries", []):
        summary.append(f"- [收件凭证]({delivered['url']})，{delivered['candidates']} 组候选")
    if "matched_run" in report:
        summary.append(f"- [原发布回执]({report['matched_run']})")
    if "checks" in report:
        checks = report["checks"]
        counts = checks["counts"]
        summary.extend((
            f"- 新增 {counts.get('added', 0)}、补源 {counts.get('source_added', 0)}、"
            f"已覆盖 {counts.get('covered', 0)}、待核 {counts.get('held', 0)}",
            f"- 同批重放零新增、零补源。回读 {checks['company_backlinks']} 条公司回链，"
            f"{checks['institution_backlinks']} 条机构回链。",
        ))
    for run in report.get("runs_near_delivery", []):
        summary.append(f"- [同时间窗口的工作流]({run['html_url']})，{run['status']} {run['conclusion'] or ''}")
    Path("dots-cloud-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if path := os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(path).write_text("\n\n".join(summary) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if outcome == "verified" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
