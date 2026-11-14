#!/usr/bin/env python3
"""Builds a verification page (index.html + media/) from a control room run and a page.json.

usage: build.py <page.json>        writes index.html and media/ next to page.json

The run decides the facts: the checks and their results come from results.json, the commits from run.json.
page.json holds only what a person writes: the headline, the prose sections, the captions. See page.example.json.

page.json:
  run          the run id (a folder in <state>/verify/), or an absolute path to the run folder
  title        the page title, 2 to 4 words, e.g. "ABC-1 Verification"
  eyebrow      the small line above the title
  lede         one paragraph: what the change does and how the run tested it (HTML allowed)
  prs          [{"repo": "owner/name", "number": 1, "what": "...", "commit": "abc1234"}]; commit defaults to the
               run's commit of that repo
  surfaces     {"<surface in results.json>": "<label on the page>"}, optional
  video        {"file": path, "caption": text}, optional
  sections     [{"h2": heading, "html": body, "class": "cols"}], in page order, after the check table; h2 and
               class are optional ("cols" sets the HTML's <div>s side by side, each with its own h2)
  figures      {"h2": heading, "items": [{"file": path, "alt": text, "caption": html}]}, optional
  media        {"<name>": path}: more files for media/, for a section's HTML to show as media/<name>, optional
  evidence     [html list items] for "Where the evidence lives"; the run folder and earlier rounds are added

A path in page.json is absolute, relative to page.json, or "run:<file>" for a file in the run folder.
"""
import html
import json
import pathlib
import shutil
import sys

KIT = pathlib.Path(__file__).resolve().parent
STATE = pathlib.Path.home() / "Library/Application Support/control-room"
PILL = {"pass": "Pass", "fail": "Fail", "not-tested": "Not tested", "not-compared": "Not compared", "pending": "Pending", "testing": "Testing"}
ORDER = ["fail", "not-tested", "not-compared", "pending", "testing", "pass"]
e = html.escape


def run_dir(ref):
    p = pathlib.Path(ref)
    return p if p.is_absolute() else STATE / "verify" / ref


def resolve(path, base, run):
    if path.startswith("run:"):
        return run / path[4:]
    p = pathlib.Path(path).expanduser()
    return p if p.is_absolute() else base / p


def criterion(c):
    """The criterion a check tests; a mockup check shows the last part of its source link."""
    return c.get("criterion") or (c.get("source") or "").rstrip("/").rsplit("/", 1)[-1] or ""


def check_rows(checks, surfaces):
    rows = []
    for c in checks:
        s = c.get("surface") or ""
        rows.append(f"""      <tr>
        <td class="ac">{e(criterion(c))}</td>
        <td><span class="surf">{e(surfaces.get(s, s))}</span></td>
        <td class="item"><details><summary>{e(c['title'])}</summary><p>{e(c.get('note') or 'No note.')}</p></details></td>
        <td><span class="pill {e(c['status'])}">{PILL.get(c['status'], e(c['status']))}</span></td>
      </tr>""")
    return "\n".join(rows)


def tally(checks):
    parts = []
    for s in ["pass", *[x for x in ORDER if x != "pass"]]:
        n = sum(c["status"] == s for c in checks)
        if n:
            parts.append(f'<span class="{s}">{n} {PILL[s].lower()}</span>')
    return "\n      ".join(parts)


def pr_rows(prs, commits):
    rows = []
    for p in prs:
        name = p["repo"].split("/")[-1]
        commit = p.get("commit") or commits.get(name, "")
        rows.append(f'        <tr><td><a href="https://github.com/{e(p["repo"])}/pull/{int(p["number"])}">{e(name)} #{int(p["number"])}</a></td>'
                    f'<td class="mono">{e(commit[:9])}</td><td>{p.get("what", "")}</td></tr>')
    return "\n".join(rows)


def build(page_json):
    page_json = pathlib.Path(page_json).resolve()
    base = page_json.parent
    cfg = json.loads(page_json.read_text())
    run = run_dir(cfg["run"])
    meta = json.loads((run / "run.json").read_text())
    checks = json.loads((run / "results.json").read_text())["checks"]
    commits = {meta["repo"]: meta["commit"], **(meta.get("commits") or {})}
    rounds = sorted(p.name for p in run.iterdir() if p.is_dir() and (p / "results.json").exists())

    media = base / "media"
    if media.exists():
        shutil.rmtree(media)
    media.mkdir()
    copied = {}

    def take(path):
        src = resolve(path, base, run)
        if not src.is_file():
            sys.exit(f"missing media: {path} ({src})")
        name = src.name
        if name in copied and copied[name] != src:
            name = f"{len(copied)}-{name}"
        copied[name] = src
        shutil.copyfile(src, media / name)
        return f"media/{name}"

    for name, path in cfg.get("media", {}).items():
        src = resolve(path, base, run)
        if not src.is_file():
            sys.exit(f"missing media: {path} ({src})")
        copied[name] = src
        shutil.copyfile(src, media / name)

    video = ""
    if cfg.get("video"):
        v = cfg["video"]
        video = f"""  <section>
    <h2>Walkthrough</h2>
    <video src="{take(v['file'])}" controls muted playsinline preload="metadata"></video>
    <p style="color:var(--muted)">{v.get('caption', '')}</p>
  </section>
"""
    prs = ""
    if cfg.get("prs"):
        prs = f"""  <section>
    <h2>{'The PR' if len(cfg['prs']) == 1 else f"The {len(cfg['prs'])} PRs"}</h2>
    <div class="panel scroll">
      <table class="prs">
        <tr><th>PR</th><th>Commit tested</th><th>What it does</th></tr>
{pr_rows(cfg['prs'], commits)}
      </table>
    </div>
  </section>
"""
    sections = "".join(f"""  <section{f' class="{e(s["class"])}"' if s.get("class") else ""}>
    {f"<h2>{e(s['h2'])}</h2>" if s.get("h2") else ""}
    {s['html']}
  </section>
""" for s in cfg.get("sections", []))
    figures = ""
    if cfg.get("figures"):
        f = cfg["figures"]
        items = "\n      ".join(f'<figure><img src="{take(i["file"])}" alt="{e(i["alt"])}"><figcaption>{i["caption"]}</figcaption></figure>' for i in f["items"])
        figures = f"""  <section>
    <h2>{e(f.get('h2', 'Screens from the run'))}</h2>
    <div class="grid2">
      {items}
    </div>
  </section>
"""
    evidence = [f"Control room run <code>{e(meta['id'])}</code>: results, a video and screenshot per check, logs, test data and the scripts that made them."]
    if rounds:
        evidence.append("Earlier rounds kept in the run folder: " + ", ".join(f"<code>{e(r)}/</code>" for r in rounds) + ".")
    evidence += cfg.get("evidence", [])

    out = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(cfg['title'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Public+Sans:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
{(KIT / 'page.css').read_text()}</style>
</head>
<body>
<main class="wrap">

  <header class="lede">
    <span class="eyebrow">{e(cfg.get('eyebrow', ''))}</span>
    <h1>{e(cfg['title'])}</h1>
    <p>{cfg.get('lede', '')}</p>
    <div class="tally">
      {tally(checks)}
    </div>
    <p class="mono" style="font-size:0.85rem">Agent results. Reviewer verdicts are given in the control room.</p>
  </header>

{prs}{video}  <section>
    <h2>Every check</h2>
    <p style="color:var(--muted)">Open a row for what was seen.</p>
    <div class="panel scroll">
      <table>
        <tr><th>Criterion</th><th>Surface</th><th>Check</th><th>Result</th></tr>
{check_rows(checks, cfg.get('surfaces', {}))}
      </table>
    </div>
  </section>

{sections}{figures}  <section>
    <h2>Where the evidence lives</h2>
    <ul class="plain">
      {''.join(f'<li>{x}</li>' for x in evidence)}
    </ul>
  </section>

</main>
</body>
</html>
"""
    (base / "index.html").write_text(out)
    print(f"wrote {base / 'index.html'}: {len(checks)} checks, {len(copied)} media files")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(sys.argv[1])
