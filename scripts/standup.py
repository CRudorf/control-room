#!/usr/bin/env python3
"""standup.py - what you did on GitHub (and locally) since the last standup window.

  standup.py              previous workday 12:30pm ET -> today 12:00pm ET
      --since ISO         override the start (e.g. 2026-09-30T12:30-04:00)
      --until ISO         override the end
      --week              this week instead: Monday 12:00am ET -> Friday 11:00am ET
                          (on a weekend, the week just finished)
      --json              as JSON

Sections:
  merged    - your PRs merged in the window (whoever merged them)
  opened    - your PRs opened in the window
  pushed    - your own non-merge commits pushed to a branch whose PR is still open
              (merge-only pushes, i.e. syncing main/plan in, are noise and dropped)
  reviews   - reviews you left on other people's PRs, strongest state per PR
  local     - your unpushed, non-merge commits in git repos under ~/Projects

Sources: the GitHub events feed for the gh user (titles and commit lists are
stripped from it, so PRs and compares are looked up), cross-checked with
`gh search prs`, plus `git log` on local repos. Auth is whatever `gh auth status` shows.
"""
import argparse
import json
import os
import subprocess
from datetime import datetime, time, timedelta, timezone
import re
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
PROJECTS = os.path.expanduser("~/Projects")
REVIEW_RANK = {"approved": 3, "changes_requested": 2, "commented": 1}


def gh(*args):
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def gh_json(*args):
    out = gh(*args)
    return json.loads(out) if out.strip() else None


def gh_lines(*args):
    return [json.loads(l) for l in gh(*args).splitlines() if l.strip()]


def default_window(now):
    today = now.astimezone(ET).date()
    back = {0: 3, 6: 2}.get(today.weekday(), 1)  # Monday/Sunday reach back to Friday
    start = datetime.combine(today - timedelta(days=back), time(12, 30), ET)
    return start, datetime.combine(today, time(12, 0), ET)


def week_window(now):
    today = now.astimezone(ET).date()
    monday = today - timedelta(days=today.weekday())
    return datetime.combine(monday, time(0, 0), ET), datetime.combine(monday + timedelta(days=4), time(11, 0), ET)


def iso_z(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def in_window(ts, start, end):
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return start <= t < end


_pr_cache = {}


def pr_info(repo, number):
    key = (repo, number)
    if key not in _pr_cache:
        p = gh_json("api", f"repos/{repo}/pulls/{number}")
        _pr_cache[key] = {
            "repo": repo.split("/")[1], "number": number, "title": p["title"],
            "author": p["user"]["login"], "state": p["state"], "merged": p["merged"],
            "url": p["html_url"], "branch": p["head"]["ref"],
        }
    return _pr_cache[key]


def search_prs(window, qualifier):
    rows = gh_json("search", "prs", "--author=@me", f"--{qualifier}={window}",
                   "--limit", "100", "--json", "repository,number,title,url")
    return [{"repo": r["repository"]["name"], "number": r["number"], "title": r["title"],
             "url": r["url"]} for r in rows or []]


def own_commits(repo, before, head, me, start, end):
    if set(before) == {"0"}:  # new branch: no base to compare against
        rows = gh_json("api", f"repos/{repo}/commits?sha={head}&author={me}"
                              f"&since={iso_z(start)}&until={iso_z(end)}&per_page=100")
    else:
        rows = gh_lines("api", f"repos/{repo}/compare/{before}...{head}", "--paginate",
                        "--jq", ".commits[]")
    return [c for c in rows or []
            if (c.get("author") or {}).get("login") == me
            and len(c["parents"]) == 1
            and in_window(c["commit"]["committer"]["date"], start, end)]


def branch_pr(repo, branch):
    rows = gh_json("pr", "list", "-R", repo, "--head", branch, "--state", "all",
                   "--json", "number,title,state,url", "--limit", "1")
    return rows[0] if rows else None


def local_commits(start, end):
    email = subprocess.run(["git", "config", "--global", "user.email"],
                           capture_output=True, text=True).stdout.strip()
    found = []
    # A control room serves one project: keep to the clones of this project's owners and listed repos.
    project_map = {}
    try:
        with open(os.path.expanduser("~/.config/control-room/projects.json")) as f:
            project_map = json.load(f)
    except (OSError, ValueError):
        pass
    project = os.environ.get("CR_PROJECT") or project_map.get("default")

    def in_project(top):
        name = os.path.basename(top)
        if name in project_map.get("repos", {}):
            return project_map["repos"][name] == project
        r = subprocess.run(["git", "-C", top, "remote", "get-url", "origin"], capture_output=True, text=True)
        m = re.search(r"[:/]([^/:]+)/[^/]+$", r.stdout.strip())
        return bool(m) and project_map.get("owners", {}).get(m.group(1)) == project

    for root, dirs, files in os.walk(PROJECTS):
        depth = root[len(PROJECTS):].count(os.sep)
        if depth == 1 and not in_project(root):
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git") and depth < 3]
        if not os.path.exists(os.path.join(root, ".git")):
            continue
        out = subprocess.run(
            ["git", "-C", root, "log", "--branches", "--not", "--remotes", "--no-merges",
             f"--author={email}", f"--since={start.isoformat()}", f"--until={end.isoformat()}",
             "--format=%h%x09%S%x09%s", "--source"],
            capture_output=True, text=True).stdout
        for line in out.splitlines():
            sha, ref, subject = line.split("\t", 2)
            found.append({"repo": os.path.relpath(root, PROJECTS), "sha": sha,
                          "branch": ref.removeprefix("refs/heads/"), "subject": subject})
    return found


def collect(start, end):
    me = gh("api", "user", "--jq", ".login").strip()
    window = f"{iso_z(start)}..{iso_z(end)}"
    events = [e for e in gh_lines("api", f"users/{me}/events?per_page=100", "--paginate",
                                  "--jq", ".[]")
              if in_window(e["created_at"], start, end)]

    merged = search_prs(window, "merged-at")
    opened = search_prs(window, "created")
    merged_keys = {(p["repo"], p["number"]) for p in merged}

    reviews = {}
    for e in events:
        if e["type"] not in ("PullRequestReviewEvent", "PullRequestReviewCommentEvent"):
            continue
        repo, number = e["repo"]["name"], e["payload"]["pull_request"]["number"]
        info = pr_info(repo, number)
        if info["author"] == me:
            continue
        state = (e["payload"].get("review") or {}).get("state", "commented").lower()
        prev = reviews.get((repo, number))
        if not prev or REVIEW_RANK.get(state, 0) > REVIEW_RANK.get(prev["review"], 0):
            reviews[(repo, number)] = {**info, "review": state}

    pushed = {}
    for e in events:
        if e["type"] != "PushEvent":
            continue
        repo, p = e["repo"]["name"], e["payload"]
        branch = p["ref"].removeprefix("refs/heads/")
        commits = own_commits(repo, p["before"], p["head"], me, start, end)
        if not commits:
            continue
        pr = branch_pr(repo, branch)
        short = repo.split("/")[1]
        if pr and (pr["state"] != "OPEN" or (short, pr["number"]) in merged_keys):
            continue  # shipped: the merged section already covers it
        if not pr:
            # direct push, e.g. to the default branch: keep commits no merged PR carries
            commits = [c for c in commits
                       if not any((short, q["number"]) in merged_keys for q in
                                  gh_json("api", f"repos/{repo}/commits/{c['sha']}/pulls") or [])]
            if not commits:
                continue
        entry = pushed.setdefault((repo, branch), {
            "repo": short, "branch": branch, "pr": pr, "commits": {}})
        for c in commits:
            entry["commits"][c["sha"]] = c["commit"]["message"].split("\n")[0]

    return {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "merged": merged,
        "opened": [p for p in opened if (p["repo"], p["number"]) not in merged_keys],
        "pushed": [{**v, "commits": [{"sha": s[:8], "subject": m}
                                      for s, m in v["commits"].items()]}
                   for v in pushed.values()],
        "reviews": list(reviews.values()),
        "local": local_commits(start, end),
    }


def render(d):
    fmt = "%a %b %-d %-I:%M%p"
    s = datetime.fromisoformat(d["window"]["start"]).strftime(fmt)
    e = datetime.fromisoformat(d["window"]["end"]).strftime(fmt)
    print(f"window: {s} -> {e} ET\n")
    print("merged:")
    for p in d["merged"]:
        print(f"  {p['repo']}#{p['number']} {p['title']}")
    print("opened (still open):")
    for p in d["opened"]:
        print(f"  {p['repo']}#{p['number']} {p['title']}")
    print("pushed:")
    for b in d["pushed"]:
        pr = b["pr"]
        head = f"{b['repo']}#{pr['number']} {pr['title']}" if pr else f"{b['repo']} {b['branch']} (no PR)"
        print(f"  {head}")
        for c in b["commits"]:
            print(f"    {c['sha']} {c['subject']}")
    print("reviews:")
    for r in d["reviews"]:
        print(f"  {r['review']}: {r['repo']}#{r['number']} [{r['author']}] {r['title']}")
    print("local (unpushed):")
    for c in d["local"]:
        print(f"  {c['repo']} {c['branch']} {c['sha']} {c['subject']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--week", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    now = datetime.now(ET)
    start, end = (week_window if a.week else default_window)(now)
    if a.since:
        start = datetime.fromisoformat(a.since).astimezone(ET)
    if a.until:
        end = datetime.fromisoformat(a.until).astimezone(ET)
    d = collect(start, end)
    print(json.dumps(d, indent=2, default=str)) if a.json else render(d)


if __name__ == "__main__":
    main()
