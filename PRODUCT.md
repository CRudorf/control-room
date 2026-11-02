# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

A Bun server under launchd that calls the scripts in `scripts/` (prs.py, jira.py) as subprocesses, keeps state in SQLite, and serves a React + Motion PWA over Server-Sent Events. Decisions in `docs/adr/`.

## Users

One user: The user, a software engineer. He runs several Claude Code agents in parallel (up to six herdr tabs at once), ships many PRs across repos (90 in two months), and reviews teammates' PRs. He uses it at his desk on a large screen, all day, glancing between it and his terminal.

## Product Purpose

A local control room that shows all of the user's work in flight in one place and puts the next action one click or keystroke away. It exists because PRs are his bottleneck: shepherding his own through bot and human feedback, rebases, CI and re-requests, and reviewing others'. His most frequent question to agents over two months was some form of "any other feedback?" or "is X mergeable?" (28 times in 17 sessions), and he regularly lost track of what an item was ("wait what was 989?"). Success: he stops asking agents for status, and nothing he owns sits stale because he forgot it.

## Positioning

It joins everything about one piece of work into a single **work item** (Jira issue, Sentry issue, branches, worktrees, herdr agents, PRs across repos) and sorts work items by whose turn it is. GitHub, Jira and herdr each see one slice; this is the only place that sees the whole item and drives all three.

## Operating Context

- Three lanes: **My turn**, **Waiting on others**, **Asked of me**; plus a collapsed **Parked** section and a **Finished today** strip. Vocabulary in `GLOSSARY.md`.
- Data: GitHub via `~/.claude/scripts/prs.py` logic and a cheap change detector; Jira via `jira.py`; herdr's socket for agent state (working / blocked on input / done / idle).
- Actions (everything except merge): hand off to an agent (fix feedback, or draft a multi-persona review), re-request review, reply to and resolve threads, post curated review comments, update branch from base, rerun CI, Jira transitions, mark, park with a note, copy a Slack review ask in the user's voice, focus or message an agent.
- Runs at login under launchd; sends macOS notifications when something moves into My turn.
- The user often focuses on one agent session for a while and wants the rest of the list out of view.

## Capabilities and Constraints

- Anything that notifies a teammate (re-request, reply, post review, Jira transition) asks for confirmation first. Merge is never in the app.
- Built for the user only; not multi-user.
- Must support filtering the work list, and a focus mode that hides the work list entirely.
- Dark mode required, following the system with a manual toggle. Motion is wanted where it shows a state change (lane moves, arrivals, agent and CI state flips).
- Keyboard-first operation is expected; he lives in the terminal.

## Brand Commitments

None. It is a personal tool with its own visual identity, not company-branded. Copy is terse; the user dislikes noise and long summaries.

## Evidence on Hand

- Real queue shape and session evidence summarised in `.scratch/control-room/map.md` and the resolved tickets in `.scratch/control-room/issues/`.
- Round-1 prototype on branch `prototype/layout` (three layouts; the user chose a blend of the keyboard inbox and mission control).
- Prototype data is invented, modelled on his real queue. No real comment text or member data.

## Product Principles

1. Whose turn is it, first. Every surface answers that before anything else.
2. One row per piece of work, however many PRs, repos and agents it spans.
3. The next action is one keystroke away; anything that notifies someone is confirmed.
4. Quiet by default. Status is glanceable; detail is on demand; no noise.
5. Nothing gets lost: parked work carries a reason and wakes when a person acts on it.
