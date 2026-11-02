#!/usr/bin/env python3
"""verify.py: start and stop a control room verification run from an agent.

  verify.py start --repo REPO --ref SHA [--key ABC-1] [--pr owner/repo#N]   Prints the run as JSON when the app is up.
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


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start"); s.add_argument("--repo", required=True); s.add_argument("--ref", required=True); s.add_argument("--key"); s.add_argument("--pr")
    t = sub.add_parser("stop"); t.add_argument("id")
    sub.add_parser("where")
    a = ap.parse_args()
    global HERE
    HERE = where()
    if a.cmd == "where":
        print(json.dumps(HERE)); return
    if a.cmd == "stop":
        print(json.dumps(call("/api/verify/stop", {"id": a.id}))); return
    r = call("/api/verify/start", {"repo": a.repo, "ref": a.ref, "key": a.key, "pr": a.pr, "cwd": os.getcwd()})
    for _ in range(300):
        v = call(f"/api/verify/one?id={r['id']}")
        if v["state"] != "starting":
            print(json.dumps({**v, "dir": r["dir"]}, indent=1)); sys.exit(0 if v["state"] == "running" else 1)
        time.sleep(3)
    sys.exit("the run did not start in 15 minutes")


main()
