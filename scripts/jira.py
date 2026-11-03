#!/usr/bin/env python3
"""jira.py - read/write JIRA from Claude Code using a local API token.

Config: ~/.claude/jira-config.yaml  (site, email, api_token), chmod 600.
Override the path with $JIRA_CONFIG.

Uses REST API v2 for reads: v2 returns descriptions/comments as wiki markup
(plain text), whereas v3 returns Atlassian Document Format JSON that has to be
walked to be readable. v2 is fully supported on Jira Cloud.
"""
import base64
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG = os.environ.get("JIRA_CONFIG", os.path.expanduser("~/.claude/jira-config.yaml"))


def load_config():
    if not os.path.exists(CONFIG):
        die(f"no config at {CONFIG}\nCreate it with: site / email / api_token (chmod 600).", 2)
    cfg = {}
    with open(CONFIG, encoding="utf-8") as fh:
        for line in fh:
            # .strip() also removes the trailing \r of a CRLF file. The original
            # token file had CRLF endings, which silently caused 401s.
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            k, v = line.split(":", 1)
            cfg[k.strip()] = v.strip().strip("\"'")
    for key in ("site", "email", "api_token"):
        if not cfg.get(key):
            die(f"config {CONFIG} is missing '{key}'", 2)
    cfg["site"] = cfg["site"].rstrip("/")
    return cfg


CFG = None


def die(msg, code=1):
    print(f"jira: {msg}", file=sys.stderr)
    sys.exit(code)


def request(path, method="GET", params=None, body=None, version=2, raw=False):
    url = f"{CFG['site']}/rest/api/{version}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    token = base64.b64encode(f"{CFG['email']}:{CFG['api_token']}".encode()).decode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Basic {token}")
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:600]
        if err.code == 401:
            detail += "\n(401: check email/api_token in " + CONFIG + ")"
        die(f"HTTP {err.code} on {method} {path}\n{detail}")
    except urllib.error.URLError as err:
        die(f"cannot reach {CFG['site']}: {err.reason}")
    if raw:
        return payload
    return json.loads(payload) if payload else {}


def download(url, dest):
    token = base64.b64encode(f"{CFG['email']}:{CFG['api_token']}".encode()).decode()
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Basic {token}")
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as fh:
        fh.write(resp.read())


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------

def name_of(obj, key="name", default="—"):
    return (obj or {}).get(key) or default


def field_names():
    try:
        return {f["id"]: f["name"] for f in request("/field")}
    except SystemExit:
        return {}


def show_issue(key, with_comments=True):
    issue = request(f"/issue/{key}")
    f = issue["fields"]
    names = field_names()
    out = []

    out.append(f"# {issue['key']}  {f['summary']}")
    out.append(
        f"{name_of(f.get('issuetype'))} · {name_of(f.get('status'))} · "
        f"{name_of(f.get('priority'))}"
    )
    out.append(
        f"Assignee: {name_of(f.get('assignee'), 'displayName', 'unassigned')}"
        f"   Reporter: {name_of(f.get('reporter'), 'displayName')}"
    )
    if f.get("parent"):
        p = f["parent"]
        out.append(f"Parent:   {p['key']} — {p['fields']['summary']}")
    if f.get("labels"):
        out.append("Labels:   " + ", ".join(f["labels"]))
    if f.get("components"):
        out.append("Components: " + ", ".join(c["name"] for c in f["components"]))
    if f.get("fixVersions"):
        out.append("Fix versions: " + ", ".join(v["name"] for v in f["fixVersions"]))
    out.append(f"Created:  {(f.get('created') or '')[:19]}   Updated: {(f.get('updated') or '')[:19]}")
    out.append(f"URL:      {CFG['site']}/browse/{issue['key']}")

    out.append("\n## Description\n")
    out.append(f.get("description") or "(empty)")

    # Rich-text custom fields (acceptance criteria, design notes, ...). Skips
    # the Development field, whose value is a serialized dev-status blob rather
    # than prose.
    for fid, value in sorted(f.items()):
        if not (fid.startswith("customfield_") and isinstance(value, str)):
            continue
        value = value.strip()
        if len(value) <= 40 or "dataType=" in value[:200]:
            continue
        out.append(f"\n## {names.get(fid, fid)}\n")
        out.append(value)

    if f.get("subtasks"):
        out.append("\n## Subtasks")
        for s in f["subtasks"]:
            out.append(f"- {s['key']} [{s['fields']['status']['name']}] {s['fields']['summary']}")

    if f.get("issuelinks"):
        out.append("\n## Linked issues")
        for link in f["issuelinks"]:
            other = link.get("outwardIssue") or link.get("inwardIssue")
            if not other:
                continue
            rel = link["type"].get("outward" if "outwardIssue" in link else "inward", "relates to")
            out.append(
                f"- {rel}: {other['key']} [{other['fields']['status']['name']}] "
                f"{other['fields']['summary']}"
            )

    if f.get("attachment"):
        out.append("\n## Attachments")
        for a in f["attachment"]:
            size = (a.get("size") or 0) // 1024
            out.append(f"- {a['filename']}  ({a.get('mimeType', '?')}, {size}KB)")
        out.append(f"  Download with: jira.py attachments {issue['key']} <outdir>")

    if with_comments:
        comments = (f.get("comment") or {}).get("comments") or []
        if comments:
            out.append(f"\n## Comments ({len(comments)})")
            for c in comments:
                out.append(f"\n--- {c['author']['displayName']} · {(c.get('created') or '')[:19]}")
                out.append(c.get("body") or "")

    print("\n".join(out))


def show_list(jql, max_results=50):
    data = request(
        "/search/jql",
        params={"jql": jql, "maxResults": max_results, "fields": "summary,status,assignee"},
    )
    issues = data.get("issues", [])
    if not issues:
        print("(no matching issues)")
        return
    for i in issues:
        f = i["fields"]
        assignee = name_of(f.get("assignee"), "displayName", "unassigned")
        print(f"{i['key']:<12} {f['status']['name']:<18} {assignee:<20} {f['summary']}")
    print(f"\n{len(issues)} shown of {data.get('total', len(issues))}")


def suggest(project, sprints, label, max_results):
    """JSON for the control room's Suggestions: To Do issues that are the user's or nobody's, by source.

    Sources, in order: a = the active sprint, b = the named container sprints, c = backlog with the
    label, d = the rest of the backlog. An issue shows once, under its first source. The server
    decides whether to show source d.
    """
    me = request("/myself")["accountId"]
    base = f'project = "{project}" AND statusCategory = "To Do" AND (assignee = currentUser() OR assignee is EMPTY)'
    names = ", ".join(json.dumps(s) for s in sprints)
    queries = [("a", "sprint in openSprints()")]
    if names:
        queries.append(("b", f"sprint in ({names})"))
    if label:
        queries.append(("c", f"sprint is EMPTY AND labels = {json.dumps(label)}"))
    queries.append(("d", "sprint is EMPTY"))
    fields = "summary,status,priority,assignee,labels,parent,issuelinks,updated"
    seen, out = set(), []
    for source, clause in queries:
        jql = f"{base} AND {clause} ORDER BY Rank ASC"
        try:
            data = request("/search/jql", params={"jql": jql, "maxResults": max_results, "fields": fields}, version=3)
        except SystemExit:
            # A sprint name that doesn't exist fails its query; the other sources still count.
            continue
        for pos, i in enumerate(data.get("issues", [])):
            if i["key"] in seen:
                continue
            seen.add(i["key"])
            f = i["fields"]
            parent = f.get("parent")
            links = []
            for link in f.get("issuelinks") or []:
                outward = "outwardIssue" in link
                other = link.get("outwardIssue") or link.get("inwardIssue")
                if not other:
                    continue
                links.append({
                    "type": link["type"].get("outward" if outward else "inward") or link["type"].get("name"),
                    "direction": "outward" if outward else "inward",
                    "key": other["key"], "status": other["fields"]["status"]["name"],
                    "done": (other["fields"]["status"].get("statusCategory") or {}).get("key") == "done",
                })
            out.append({
                "key": i["key"], "summary": f["summary"], "status": f["status"]["name"],
                "priority": name_of(f.get("priority"), default=None),
                "assignee": "me" if (f.get("assignee") or {}).get("accountId") == me else None,
                "labels": f.get("labels") or [],
                "parent": {"key": parent["key"], "summary": parent["fields"].get("summary")} if parent else None,
                "links": links, "updated": f.get("updated"), "source": source, "rank": pos,
                "url": f"{CFG['site']}/browse/{i['key']}",
            })
    print(json.dumps({"issues": out}))



# Statuses an issue goes back to when product fails it in Testing (GLOSSARY: Product testing).
PRE_TESTING = {"to do", "in progress", "code review"}
def _flow():
    try:
        with open(os.environ.get("CR_SETTINGS", "")) as f:
            return json.load(f).get("flow") or {}
    except (OSError, ValueError):
        return {}


FLOW = _flow()
TESTING, READY = (FLOW.get("testingStatus") or "").lower(), (FLOW.get("approvedStatus") or "").lower()
FAIL_DAYS = 30


def epoch(at):
    """Seconds since 1970 for a Jira timestamp ("2026-10-28T09:17:07.355-0700"), 0 for none."""
    if not at:
        return 0
    at = at.replace("Z", "+00:00")
    if len(at) > 5 and at[-5] in "+-" and at[-3] != ":":
        at = at[:-2] + ":" + at[-2:]
    return datetime.datetime.fromisoformat(at).timestamp()


USER_NAMES = {}


def user_name(account_id):
    """A person's display name, or "someone" when Jira can't say."""
    if account_id not in USER_NAMES:
        try:
            USER_NAMES[account_id] = request("/user", params={"accountId": account_id}).get("displayName") or "someone"
        except SystemExit:
            USER_NAMES[account_id] = "someone"
    return USER_NAMES[account_id]


def plain_mentions(text):
    """Jira stores a mention as [~accountid:ID]. A reader wants @Name."""
    return re.sub(r"\[~accountid:([^\]]+)\]", lambda m: "@" + user_name(m.group(1)), text)


def first_line(text):
    for line in (text or "").splitlines():
        line = line.strip()
        if line:
            return plain_mentions(line)[:300]
    return ""


def comments_of(i):
    """Every comment on an issue, oldest first: the search result's, else the comments endpoint."""
    c = (i["fields"].get("comment") or {})
    got = c.get("comments") or []
    if c.get("total", len(got)) > len(got):
        got = request(f"/issue/{i['key']}/comment", params={"maxResults": 500}).get("comments", [])
    return sorted(got, key=lambda x: epoch(x.get("created")))


def histories_of(i):
    """Status changes, oldest first: the search result's changelog, else the changelog endpoint."""
    cl = i.get("changelog") or {}
    hs = cl.get("histories") or []
    if cl.get("total", len(hs)) > len(hs):
        hs, start = [], 0
        while True:
            page = request(f"/issue/{i['key']}/changelog", params={"startAt": start, "maxResults": 100}, version=3)
            hs += page.get("values", [])
            start += len(page.get("values", []))
            if page.get("isLast", True) or not page.get("values"):
                break
    out = []
    for h in hs:
        for it in h.get("items", []):
            if it.get("field") == "status":
                out.append({"id": h.get("id"), "at": h.get("created"), "by": name_of(h.get("author"), "displayName", None),
                            "from": it.get("fromString"), "to": it.get("toString")})
    return sorted(out, key=lambda x: epoch(x["at"]))


def testing_block(i, me, now):
    """Product testing facts for one of the user's issues, or None when it is not in or just out of Testing."""
    f = i["fields"]
    status = f["status"]["name"]
    category = f["status"]["statusCategory"]["key"]
    changes = histories_of(i)
    entered = next((c["at"] for c in reversed(changes) if (c["to"] or "").lower() == TESTING), None)
    failed = None
    last = changes[-1] if changes else None
    if last and (last["from"] or "").lower() == TESTING and last["to"] == status and \
            (status.lower() in PRE_TESTING or category == "new"):
        age = now - epoch(last["at"])
        if age <= FAIL_DAYS * 86400:
            failed = {"id": last["id"], "by": last["by"], "at": last["at"], "from": last["from"], "to": last["to"]}
    if status.lower() not in (TESTING, READY) and not failed:
        return None
    comments = comments_of(i)
    mine = [c for c in comments if (c.get("author") or {}).get("accountId") == me]
    last_c = comments[-1] if comments else None
    my_at = mine[-1]["created"] if mine else None
    since = None
    if status.lower() == TESTING:
        floor = max(epoch(my_at), epoch(entered))
        since = next((c["created"] for c in comments
                      if (c.get("author") or {}).get("accountId") != me and epoch(c.get("created")) > floor), None)
    if failed:
        by = [c for c in comments if name_of(c.get("author"), "displayName", None) == failed["by"]]
        failed["comment"] = ({"id": by[-1]["id"], "at": by[-1]["created"], "firstLine": first_line(by[-1].get("body"))}
                             if by else None)
    return {
        "enteredAt": entered, "failed": failed,
        "lastComment": ({"id": last_c["id"], "author": name_of(last_c.get("author"), "displayName", None),
                         "isMe": (last_c.get("author") or {}).get("accountId") == me, "at": last_c["created"],
                         "firstLine": first_line(last_c.get("body"))} if last_c else None),
        "lastMyCommentAt": my_at, "questionSince": since,
    }


def comment_facts(i, me):
    """The last comment by another person (not the user, not an app), and when the user last commented."""
    comments = comments_of(i)
    who = lambda c: c.get("author") or {}
    mine = [c for c in comments if who(c).get("accountId") == me]
    others = [c for c in comments if who(c).get("accountId") != me and who(c).get("accountType") != "app"]
    last = others[-1] if others else None
    return {
        "lastMyCommentAt": mine[-1]["created"] if mine else None,
        "lastOtherComment": ({"id": last["id"], "author": name_of(last.get("author"), "displayName", None), "isMe": False,
                              "at": last["created"], "firstLine": first_line(last.get("body"))} if last else None),
    }


def board(keys):
    """JSON for the control room: the keys given, the user's In Progress issues, and his product testing issues."""
    mine = 'assignee = currentUser() AND statusCategory = "In Progress"'
    testing = None
    if TESTING and READY:
        t, r = FLOW["testingStatus"], FLOW["approvedStatus"]
        testing = (f'assignee = currentUser() AND (status in ("{t}", "{r}") OR '
                   f'(status changed from "{t}" after -{FAIL_DAYS}d AND statusCategory != Done))')
    fields = "summary,status,assignee,updated,parent,comment"
    tries = [f"({mine}) OR ({testing})", mine] if testing else [mine]
    if keys:
        tries = [f"{t} OR key in ({','.join(keys)})" for t in tries] + tries
    data = None
    for n, jql in enumerate(tries):
        try:
            data = request("/search/jql", params={"jql": jql, "maxResults": 100, "fields": fields, "expand": "changelog"})
            break
        except SystemExit:
            # A key that does not exist, or a status this site does not have, fails the whole query.
            if n == len(tries) - 1:
                raise
    me = request("/myself")["accountId"]
    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    out = []
    for i in data.get("issues", []):
        f = i["fields"]
        is_mine = (f.get("assignee") or {}).get("accountId") == me
        ts = request(f"/issue/{i['key']}/transitions")["transitions"]
        row = {
            "key": i["key"], "summary": f["summary"], "status": f["status"]["name"],
            "category": f["status"]["statusCategory"]["key"], "mine": is_mine,
            "updated": f.get("updated"), "url": f"{CFG['site']}/browse/{i['key']}",
            "parent": ({"key": f["parent"]["key"], "summary": f["parent"]["fields"]["summary"]} if f.get("parent") else None),
            "transitions": [{"id": t["id"], "name": t["name"], "to": t["to"]["name"]} for t in ts],
        }
        row["comments"] = comment_facts(i, me)
        t = testing_block(i, me, now) if is_mine else None
        if t:
            row["testing"] = t
        out.append(row)
    print(json.dumps({"issues": out}))

# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

USAGE = """jira.py — JIRA from the command line

READ
  jira.py issue KEY                 Full ticket: fields, description, subtasks, links, comments
  jira.py search 'JQL' [max]        Run a JQL query
  jira.py mine [max]                Your open, assigned tickets
  jira.py sprint PROJ [max]         Open tickets in PROJ's active sprint
  jira.py comments KEY              Just the comment thread
  jira.py attachments KEY [outdir]  Download attachments (screenshots) to outdir
  jira.py transitions KEY           Available status transitions
  jira.py raw /issue/KEY [version]  Raw JSON from any REST path (default v2)
  jira.py whoami                    Verify credentials
  jira.py board [KEY,KEY...]        JSON for the control room: these issues plus your In Progress ones
                                    and product testing ones, with status, transitions and testing facts
  jira.py suggest --project P [--sprints "A,B"] [--label L] [--max N]
                                    JSON for the control room: To Do issues, yours or unassigned,
                                    from the active sprint, the named sprints, labelled backlog, backlog

WRITE
  jira.py comment KEY 'text'        Add a comment
  jira.py transition KEY 'Name'     Move to a status
  jira.py assign KEY me|none|accountId  Assign a ticket (none unassigns)
"""


def main():
    global CFG
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(USAGE)
        return
    cmd, rest = args[0], args[1:]
    CFG = load_config()

    def need(n):
        if len(rest) < n:
            die(f"'{cmd}' needs {n} argument(s)\n\n{USAGE}", 2)

    if cmd == "issue":
        need(1)
        show_issue(rest[0])

    elif cmd == "search":
        need(1)
        show_list(rest[0], int(rest[1]) if len(rest) > 1 else 50)

    elif cmd == "mine":
        show_list(
            "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
            int(rest[0]) if rest else 50,
        )

    elif cmd == "sprint":
        need(1)
        show_list(
            f"project = {rest[0]} AND sprint in openSprints() AND statusCategory != Done "
            "ORDER BY status, updated DESC",
            int(rest[1]) if len(rest) > 1 else 50,
        )

    elif cmd == "comments":
        need(1)
        comments = request(f"/issue/{rest[0]}/comment").get("comments", [])
        if not comments:
            print("(no comments)")
        for c in comments:
            print(f"--- {c['author']['displayName']} · {(c.get('created') or '')[:19]}")
            print(c.get("body") or "")
            print()

    elif cmd == "attachments":
        need(1)
        key = rest[0]
        outdir = rest[1] if len(rest) > 1 else f"./jira-{key}"
        os.makedirs(outdir, exist_ok=True)
        atts = request(f"/issue/{key}", params={"fields": "attachment"})["fields"].get("attachment") or []
        if not atts:
            print("(no attachments)")
            return
        for a in atts:
            dest = os.path.join(outdir, a["filename"])
            download(a["content"], dest)
            print(dest)

    elif cmd == "transitions":
        need(1)
        for t in request(f"/issue/{rest[0]}/transitions")["transitions"]:
            print(f"{t['id']:<6} {t['to']['name']}")

    elif cmd == "comment":
        need(2)
        request(f"/issue/{rest[0]}/comment", method="POST", body={"body": rest[1]})
        print(f"commented on {rest[0]}")

    elif cmd == "transition":
        need(2)
        want = rest[1].lower()
        match = next(
            (
                t["id"]
                for t in request(f"/issue/{rest[0]}/transitions")["transitions"]
                if want in (t["to"]["name"].lower(), t["name"].lower())
            ),
            None,
        )
        if not match:
            die(f"no transition to '{rest[1]}' (see: jira.py transitions {rest[0]})")
        request(f"/issue/{rest[0]}/transitions", method="POST", body={"transition": {"id": match}})
        print(f"{rest[0]} -> {rest[1]}")

    elif cmd == "assign":
        need(2)
        account = request("/myself")["accountId"] if rest[1] == "me" else None if rest[1] == "none" else rest[1]
        request(f"/issue/{rest[0]}/assignee", method="PUT", body={"accountId": account})
        print(f"unassigned {rest[0]}" if account is None else f"assigned {rest[0]}")

    elif cmd == "raw":
        need(1)
        version = int(rest[1]) if len(rest) > 1 else 2
        print(json.dumps(request(rest[0], version=version), indent=2))

    elif cmd == "board":
        board([k for k in (rest[0].split(",") if rest else []) if k])

    elif cmd == "suggest":
        opts = {"--project": None, "--sprints": "", "--label": "", "--max": "20"}
        it = iter(rest)
        for a in it:
            if a not in opts:
                die(f"suggest: unknown option {a}", 2)
            opts[a] = next(it, "")
        if not opts["--project"]:
            die("suggest needs --project", 2)
        sprints = [s.strip() for s in opts["--sprints"].split(",") if s.strip()]
        suggest(opts["--project"], sprints, opts["--label"], int(opts["--max"]))

    elif cmd == "whoami":
        me = request("/myself")
        print(f"{me['displayName']} <{me.get('emailAddress', '?')}>")
        print(f"accountId: {me['accountId']}")
        print(f"site: {CFG['site']}")

    else:
        die(f"unknown command '{cmd}'\n\n{USAGE}", 2)


if __name__ == "__main__":
    main()
