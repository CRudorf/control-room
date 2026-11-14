#!/usr/bin/env python3
"""verify.py: start and stop a control room verification run from an agent.

  verify.py start --repo REPO --ref SHA [--also REPO=REF ...] [--key ABC-1] [--pr owner/repo#N]
      Prints the run as JSON when the app is up. --also names the other repos of a change that spans repos.
  verify.py rerun ID [--repo REPO] --ref SHA [--also REPO=REF ...]
      A new round of run ID's work item at new commits. It starts from ID's scripts, data and checks (all
      pending again); the repos not named keep ID's commits. ID's evidence stays in ID's folder.
  verify.py result ID CHECK STATUS [--note TEXT] [--evidence FILE ...]
      Writes one check's result to ID's results.json, for a result that no test script writes itself.
  verify.py stop ID
  verify.py where   The project, repo, port and state folder of the current repo.
"""
import argparse, json, os, pathlib, re, subprocess, sys, time, urllib.request

HOME = pathlib.Path.home()
MAP = json.loads((HOME / ".config/control-room/projects.json").read_text())


def git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def where():
    """The project of the current repo. The repo decides, so a session cannot reach another project's control room."""
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    if not common:
        sys.exit(f"{os.getcwd()} is not in a git repo")
    repo = pathlib.Path(common).parent.name
    url = git("remote", "get-url", "origin") or ""
    m = re.search(r"[:/]([^/:]+)/[^/]+$", url)
    project = MAP.get("repos", {}).get(repo) or (MAP.get("owners", {}).get(m.group(1)) if m else None)
    if not project:
        sys.exit(f"{repo} is in no project. Add it to ~/.config/control-room/projects.json.")
    c = MAP["projects"][project]
    return {"project": project, "repo": repo, "port": c.get("port", 4777), "state": str(HOME / "Library/Application Support" / c.get("stateDir", "control-room"))}


HERE = None


def call(path, body=None):
    token = (pathlib.Path(HERE["state"]) / "token").read_text().strip()
    req = urllib.request.Request(f"http://127.0.0.1:{HERE['port']}" + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Cookie": f"cr={token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


STATUSES = ("pending", "testing", "pass", "fail", "not-tested", "not-compared")


def run_dir(run_id):
    if not re.fullmatch(r"[A-Za-z0-9._-]+", run_id):
        sys.exit(f"bad run id {run_id}")
    d = pathlib.Path(HERE["state"]) / "verify" / run_id
    if not (d / "run.json").exists():
        sys.exit(f"no run {run_id} in {d.parent}")
    return d


def set_result(run_id, check, status, note=None, evidence=None):
    """One check's result in results.json. The file is replaced in one step, so the control room never reads half of it."""
    d = run_dir(run_id)
    f = d / "results.json"
    data = json.loads(f.read_text()) if f.exists() else {"checks": []}
    found = [c for c in data.get("checks", []) if c.get("id") == check]
    if not found:
        sys.exit(f"{check} is not a check in {f}. Add it to the list first.")
    for e in evidence or []:
        if not (d / e).exists():
            sys.exit(f"evidence {e} is not in {d}")
    c = found[0]
    c["status"] = status
    if note is not None:
        c["note"] = note
    if evidence:
        c["evidence"] = list(dict.fromkeys([*c.get("evidence", []), *evidence]))
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(f)
    return c


def parse_also(items):
    out = []
    for x in items or []:
        repo, sep, ref = x.partition("=")
        if not sep or not repo or not ref:
            sys.exit(f"--also takes REPO=REF, not {x}")
        out.append({"repo": repo, "ref": ref})
    return out


def wait(r):
    for _ in range(300):
        v = call(f"/api/verify/one?id={r['id']}")
        if v["state"] != "starting":
            print(json.dumps({**v, "dir": r["dir"]}, indent=1)); sys.exit(0 if v["state"] == "running" else 1)
        time.sleep(3)
    sys.exit("the run did not start in 15 minutes")


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start"); s.add_argument("--repo", required=True); s.add_argument("--ref", required=True); s.add_argument("--key"); s.add_argument("--pr")
    s.add_argument("--also", action="append", metavar="REPO=REF")
    rr = sub.add_parser("rerun"); rr.add_argument("id"); rr.add_argument("--repo"); rr.add_argument("--ref", required=True); rr.add_argument("--also", action="append", metavar="REPO=REF")
    rs = sub.add_parser("result"); rs.add_argument("id"); rs.add_argument("check"); rs.add_argument("status", choices=STATUSES)
    rs.add_argument("--note"); rs.add_argument("--evidence", nargs="+")
    t = sub.add_parser("stop"); t.add_argument("id")
    sub.add_parser("where")
    a = ap.parse_args()
    global HERE
    HERE = where()
    if a.cmd == "where":
        print(json.dumps(HERE)); return
    if a.cmd == "stop":
        print(json.dumps(call("/api/verify/stop", {"id": a.id}))); return
    if a.cmd == "result":
        print(json.dumps(set_result(a.id, a.check, a.status, a.note, a.evidence))); return
    if a.cmd == "rerun":
        old = json.loads((run_dir(a.id) / "run.json").read_text())
        if not old.get("key"):
            sys.exit(f"{a.id} has no work item key, so a new round can't find it. Use start.")
        r = call("/api/verify/start", {"repo": a.repo or old["repo"], "ref": a.ref, "also": parse_also(a.also), "key": old["key"], "pr": old.get("pr"), "cwd": os.getcwd()})
    else:
        r = call("/api/verify/start", {"repo": a.repo, "ref": a.ref, "also": parse_also(a.also), "key": a.key, "pr": a.pr, "cwd": os.getcwd()})
    if r.get("error"):
        sys.exit(r["error"])
    wait(r)


main()
