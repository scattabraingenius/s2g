#!/usr/bin/env python3
"""Publish CodexBar usage to the gist the Dashboard page reads.

Runs every few minutes from a LaunchAgent (see install.sh). Each run asks the CodexBar CLI for
Claude and Codex usage, keeps only the numbers the page shows (no emails, account names or IDs),
adds a history sample when anything moved, and updates the gist. To keep the gist's revision list
short it only pushes when the numbers changed or HEARTBEAT has passed since the last push.

  push_usage.py            fetch, record and push
  push_usage.py --dry-run  fetch and print the payload, change nothing
"""
import json, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path(os.environ.get("GRIND_USAGE_HOME", Path.home() / "Library/Application Support/GrindUsage"))
CONFIG = STATE_DIR / "config.json"    # {"gist_id": "..."}
STATE = STATE_DIR / "state.json"      # history and the last pushed payload
CODEXBAR = os.environ.get("CODEXBAR", "/opt/homebrew/bin/codexbar")
GH = os.environ.get("GH", "/opt/homebrew/bin/gh")
PROVIDERS = ("claude", "codex")
NAMES = {"claude": "Claude", "codex": "Codex"}
HISTORY_DAYS = 8                      # a little over the weekly window
HEARTBEAT = 15 * 60                   # push at least this often so the page can show it is live
FILE_NAME = "usage.json"


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def window_label(key, minutes, labels):
    if labels.get(key):
        return labels[key]
    if minutes == 300:
        return "Session"
    if minutes == 10080:
        return "Weekly"
    return f"{round(minutes / 60)}h" if minutes else key.title()


def fetch():
    out = subprocess.run([CODEXBAR, "usage", "--provider", "both", "--format", "json"],
                         capture_output=True, text=True, timeout=120)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f"codexbar gave no JSON (exit {out.returncode}): {out.stderr.strip()[:300]}")


def slim(entry):
    """Keep what the page draws. Anything that identifies the account is dropped."""
    pid = entry.get("provider")
    item = {"id": pid, "name": NAMES.get(pid, pid), "source": entry.get("source")}
    if entry.get("error"):
        item["error"] = entry["error"].get("message", "Fetch failed")[:200]
        return item
    usage = entry.get("usage") or {}
    labels = entry.get("rateWindowLabels") or {}
    pace = entry.get("pace") or {}
    item["plan"] = usage.get("loginMethod")
    item["updatedAt"] = usage.get("updatedAt")
    item["windows"] = []
    for key in ("primary", "secondary", "tertiary"):
        w = usage.get(key)
        if not w:
            continue
        win = {"key": key, "label": window_label(key, w.get("windowMinutes"), labels),
               "usedPercent": w.get("usedPercent"), "windowMinutes": w.get("windowMinutes"),
               "resetsAt": w.get("resetsAt")}
        p = pace.get(key)
        if p:
            win["pace"] = {k: p.get(k) for k in ("stage", "deltaPercent", "expectedUsedPercent", "willLastToReset")}
        item["windows"].append(win)
    cost = usage.get("providerCost")
    if cost and cost.get("limit"):
        item["extra"] = {k: cost.get(k) for k in ("used", "limit", "currencyCode", "period")}
    resets = (usage.get("codexResetCredits") or {}).get("credits") or []
    live = sorted(c["expires_at"] for c in resets if c.get("status") == "available" and c.get("expires_at"))
    if live:
        item["resetCredits"] = {"available": len(live), "nextExpiresAt": live[0]}
    return item


def fetch_costs():
    """Only aggregate daily totals leave the Mac; projects, paths and models are excluded."""
    try:
        out = subprocess.run([CODEXBAR, "cost", "--provider", "both", "--format", "json"],
                             capture_output=True, text=True, timeout=120)
        rows = json.loads(out.stdout)
    except (ValueError, subprocess.TimeoutExpired, OSError):
        return {}
    result = {}
    for row in rows:
        pid = row.get("provider")
        if pid not in PROVIDERS or row.get("error"):
            continue
        daily = [{"date": d.get("date"), "costUSD": d.get("totalCost"), "tokens": d.get("totalTokens")}
                 for d in row.get("daily", []) if d.get("date")]
        result[pid] = {"updatedAt": row.get("updatedAt"), "currencyCode": "USD",
                       "todayCostUSD": row.get("sessionCostUSD"), "todayTokens": row.get("sessionTokens"),
                       "totalCostUSD": row.get("last30DaysCostUSD"), "totalTokens": row.get("last30DaysTokens"),
                       "daily": daily[-30:], "provenance": "listPriceEstimate"}
    return result


def sample_of(providers):
    return {p["id"]: {w["key"]: w["usedPercent"] for w in p.get("windows", [])}
            for p in providers if p.get("windows")}


def main():
    dry = "--dry-run" in sys.argv
    raw = fetch()
    providers = [slim(e) for e in raw if e.get("provider") in PROVIDERS]
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    config = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    costs = fetch_costs() if config.get("include_cost_history") is True else {}
    for p in providers:
        if p["id"] in costs:
            p["cost"] = costs[p["id"]]
    history = state.get("history", [])
    now = time.time()
    cutoff = now - HISTORY_DAYS * 86400
    history = [h for h in history if parse_iso(h["t"]) >= cutoff]
    sample = sample_of(providers)
    # One sample whenever a number moves, plus one an hour so flat stretches still draw a line.
    last = history[-1] if history else None
    if sample and (not last or last["u"] != sample or now - parse_iso(last["t"]) >= 3600):
        history.append({"t": now_iso(), "u": sample,
                        "r": {p["id"]: {w["key"]: w.get("resetsAt") for w in p.get("windows", [])}
                              for p in providers}})

    payload = {"v": 2, "checkedAt": now_iso(), "providers": providers, "history": history}
    if dry:
        print(json.dumps(payload, indent=1))
        return

    changed = state.get("lastProviders") != providers or state.get("lastHistoryLen") != len(history)
    due = now - state.get("lastPushAt", 0) >= HEARTBEAT
    if changed or due:
        gist_id = json.loads(CONFIG.read_text())["gist_id"]
        body = json.dumps({"files": {FILE_NAME: {"content": json.dumps(payload, separators=(",", ":"))}}})
        res = subprocess.run([GH, "api", "-X", "PATCH", f"/gists/{gist_id}", "--input", "-", "--silent"],
                             input=body, capture_output=True, text=True, timeout=60)
        if res.returncode:
            raise SystemExit(f"gist update failed: {res.stderr.strip()[:300]}")
        state["lastPushAt"] = now
    state.update(history=history, lastProviders=providers, lastHistoryLen=len(history))
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state))
    print(f"{now_iso()} {'pushed' if changed or due else 'unchanged'}: "
          + ", ".join(f"{p['id']} " + ("error" if p.get("error") else
                      "/".join(f"{w['label']} {w['usedPercent']}%" for w in p["windows"])) for p in providers))


if __name__ == "__main__":
    main()
