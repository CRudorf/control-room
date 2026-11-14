#!/usr/bin/env python3
"""pr-replies.py: post approved replies to a PR's review threads, one per thread.

  pr-replies.py OWNER/REPO PR REPLIES.json [--post]

REPLIES.json is a list of {"comment": <review comment id>, "body": <reply>}. Without --post it prints what it
would post and changes nothing. Write the file when the user approves the drafts; the user (or an agent the user
allowed) runs it with --post. A thread that already has this exact reply is skipped, so a rerun posts nothing twice.
"""
import json, subprocess, sys


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"gh {' '.join(args[:3])}... failed: {r.stderr.strip()}")
    return r.stdout


def main():
    args = [a for a in sys.argv[1:] if a != "--post"]
    post = "--post" in sys.argv
    if len(args) != 3:
        sys.exit(__doc__)
    repo, pr, path = args
    replies = json.load(open(path))
    comments = json.loads(gh("api", "--paginate", "--slurp", f"repos/{repo}/pulls/{pr}/comments"))
    comments = [c for page in comments for c in page]
    by_id = {c["id"]: c for c in comments}
    for r in replies:
        cid, body = int(r["comment"]), r["body"].strip()
        if cid not in by_id:
            print(f"SKIP {cid}: no such review comment on {repo}#{pr}"); continue
        root = by_id[cid].get("in_reply_to_id") or cid
        if any((c.get("in_reply_to_id") == root or c["id"] == root) and c["body"].strip() == body for c in comments):
            print(f"SKIP {cid}: already has this reply"); continue
        if not post:
            print(f"WOULD POST to {cid} ({by_id[cid]['path']}):\n  {body}\n"); continue
        out = json.loads(gh("api", "-X", "POST", f"repos/{repo}/pulls/{pr}/comments/{root}/replies", "-f", f"body={body}"))
        print(f"POSTED {cid}: {out['html_url']}")


main()
