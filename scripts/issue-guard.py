#!/usr/bin/env python3
"""A Claude Code PreToolUse hook: stops an issue write that names private work.

It blocks when the command, a body file or the repo it targets has a private word. The words are
the lines of ~/.config/control-room/public-blocklist.txt, plus the owners, repos and names of every
project in projects.json other than the public one. With no word list it blocks every issue write.
It can't see text that a shell variable holds, so the variable case stays a rule for agents.
"""
import json
import os
import re
import shlex
import subprocess
import sys

CONFIG = os.environ.get("CR_CONFIG_DIR", os.path.expanduser("~/.config/control-room"))
WRITE = re.compile(r"\bgh\b[^\n|;&]*\b(issue\s+(create|new|edit|comment|close|reopen|transfer|pin|develop)\b|api\b[^\n|;&]*\bissues\b)")


def words():
    out = []
    try:
        with open(os.path.join(CONFIG, "public-blocklist.txt"), encoding="utf-8") as fh:
            out = [l.strip().lower() for l in fh if l.strip() and not l.startswith("#")]
    except OSError:
        return []
    try:
        with open(os.path.join(CONFIG, "projects.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        public = (m.get("public") or {}).get("project")
        if public:
            for group in ("owners", "repos"):
                out += [k.lower() for k, p in (m.get(group) or {}).items() if p != public]
            out += [k.lower() for k in (m.get("projects") or {}) if k != public]
    except (OSError, ValueError):
        pass
    return out


def project_map():
    try:
        with open(os.path.join(CONFIG, "projects.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def target(text, tool, cwd):
    """The owner/name an issue write goes to: -R, a repos/ path, an MCP tool's owner and repo, else this clone's origin."""
    m = re.search(r"(?:\s-R\s+|--repo[\s=]+)(?:https?://github\.com/)?([\w.-]+)/([\w.-]+)", text) or re.search(r"repos/([\w.-]+)/([\w.-]+)", text)
    if m:
        return m.group(1), m.group(2)
    if tool.get("owner") and tool.get("repo"):
        return str(tool["owner"]), str(tool["repo"])
    m = re.search(r"[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?\s*$", origin(cwd))
    return (m.group(1), m.group(2)) if m else (None, None)


def project_of(m, owner, name):
    if not owner:
        return None
    return {k.lower(): p for k, p in (m.get("repos") or {}).items()}.get((name or "").lower()) \
        or {k.lower(): p for k, p in (m.get("owners") or {}).items()}.get(owner.lower())


def private_target(target_repo, cwd):
    """
    True when the write goes to a repo of a project other than the public one, from outside the public
    project: those issues aren't public. A session in the public project still can't write there.
    """
    m = project_map()
    public = (m.get("public") or {}).get("project")
    project = project_of(m, *target_repo)
    if not public or not project or project == public:
        return False
    here = re.search(r"[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?\s*$", origin(cwd))
    return not (here and project_of(m, here.group(1), here.group(2)) == public)


def body_files(cmd):
    try:
        parts = shlex.split(cmd)
    except ValueError:
        parts = cmd.split()
    found = []
    for i, p in enumerate(parts):
        if p in ("--body-file", "-F") and i + 1 < len(parts):
            found.append(parts[i + 1])
        elif p.startswith("--body-file="):
            found.append(p.split("=", 1)[1])
    return [f for f in found if f != "-" and "=" not in f]


def origin(cwd):
    try:
        return subprocess.run(["git", "-C", cwd, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def block(why):
    print(f"Blocked: {why} Issues in this project must not name private or work projects. Rewrite it without them.", file=sys.stderr)
    sys.exit(2)


def main():
    try:
        e = json.load(sys.stdin)
    except ValueError:
        sys.exit(0)
    name, tool = e.get("tool_name", ""), e.get("tool_input") or {}
    cwd = e.get("cwd") or os.getcwd()
    if name == "Bash":
        text = tool.get("command", "")
        if not WRITE.search(text):
            sys.exit(0)
    elif name.startswith("mcp__") and re.search(r"issue", name, re.I):
        text = json.dumps(tool)
    else:
        sys.exit(0)
    if private_target(target(text, tool, cwd), cwd):
        sys.exit(0)
    list_ = words()
    if not list_:
        block(f"no word list at {CONFIG}/public-blocklist.txt.")
    scan = text
    if name == "Bash":
        for f in body_files(text):
            try:
                with open(os.path.join(cwd, f), encoding="utf-8", errors="replace") as fh:
                    scan += "\n" + fh.read()
            except OSError:
                block(f"can't read the body file {f}.")
        # With no -R, gh targets this clone's origin.
        if not re.search(r"(\s-R\s|--repo[\s=])", text) and "repos/" not in text:
            scan += "\n" + origin(cwd)
    if any(w in scan.lower() for w in list_):
        # The word itself stays out of the message: agents repeat what they read.
        block("this issue write, or the repo it targets, has a private word.")


main()
