# Glossary

**Control room**: The one place that shows all of the user's work in flight and puts the next action one click away.

**Lane**: A grouping of in-flight work by whose turn it is. There are three:

- **My turn**: the next move is the user's (feedback to address, a PR to rebase, an approved PR to merge).
- **Waiting on others**: the next move belongs to a reviewer, CI, or a running agent.
- **Asked of me**: someone else's PR awaits the user's review.

**Ball**: Whose turn it is on a piece of work. Its holder decides the lane.

**Work item**: One piece of the user's work, however many artifacts it spans: its issue, its branches and worktrees, the agents working on it, its PRs (possibly stacked or across repos), and its artifacts. Appears exactly once on the board, in the most urgent lane any of its PRs puts it in. The user can attach a PR to a work item or split one out by hand.

**Work item key**: What a work item is grouped by: the id of the issue it came from, in whichever system holds that issue, else its branch. Keys are never mistaken for each other across systems. When a tracker issue and an error report name the same work, the items merge under the tracker issue.

**Dependency**: Something a PR waits on that isn't a review: another PR merging and deploying, or a named step like "prod apply". A PR with a dependency is Waiting on others, whatever GitHub says.

**Guardrail**: What stops an agent whatever auto mode's classifier decides: a deny rule, the sandbox failing closed, branch protection. The control room only reports missing ones, in Tidy.

**Finished**: A work item with no work left: its PRs are all merged or closed, and no agent is running. It leaves the board, whatever status its issue shows. A park rule can also finish an issue. The Finished page lists finished work day by day.

**Review request**: Someone else's PR awaiting the user's review, in **Asked of me**. Always keyed by the PR itself, never merged into the user's own work item, even when they share an issue.

**Investigation**: An agent working one error report to its root cause, in a tab labelled `rca <short id>`. It is that report's work item, and a fix PR naming the report joins it. A routine's triage can start one per pick.

**Routine**: A prompt the control room starts on its own in each of its repos, daily or weekly: at a set time, or when the user starts work (the first time that day they're at the machine). With no prompt it runs `/signal-to-pr` bare, a triage of the repo's live errors. Set on the Routines page.

**Friction review**: The routine every control room starts with, weekly on Friday when the user starts work. Its agent reads every session tied to a work item, with how each item moved on the board, and reports candidates that would take friction out of a work item's workflow, one card each the way an architecture review does. It changes nothing; the user picks one to explore. Avoid: retro.

**Complexity points**: A deterministic score of how hard a PR is to review, from its size, spread, sensitive paths, commits and files that broke before (ADR 0006). The points set its **review tier**.

**Review tier**: Light, standard, deep or critical: how thoroughly to check a review request. Each tier names its **treatments**.

**Treatment**: A check a review tier calls for beyond reading: a field guide, a browser test, a flow chart, a video explainer. A change to UI, config, schema or dependencies always calls for a browser test.

**Effort**: How much of the user's own work an item needs to ship, in points: a review request's complexity points, or what's left on one of the user's PRs (threads, failing CI, conflicts). Summed over the item's PRs into a size: Small, Medium, Large or Extra large. Not minutes.

**Agent**: A Claude session running in a herdr tab. It belongs to the work item of its worktree's branch, else the one whose key is in its tab label, else it is a work item of its own, named by the tab label. An agent waiting for input puts its work item in My turn.

**Signal**: What a new piece of work starts from. It is anything that points at a problem or a request: an issue in a tracker, an error report, a session replay, a log line. A project chooses its sources. Starting from a signal opens an agent on it. A signal with no key of its own gets a work item named by its tab label, until an issue or a branch claims it.

**Suggestion**: Work the control room proposes to the user. It is not a work item until the user picks it up. A project sets its sources and their order. The last source is Architecture findings. A pickup takes it out of the list and makes it a work item, and it comes back only when the issue is unassigned and not started 14 days later.

**Handoff**: Giving a work item's next step to an agent: fixing feedback on the user's PR, or drafting a review of someone else's.

**Primary action**: The one move a work item offers on ⏎, chosen by what's most urgent on it.

**Action record**: What the control room keeps about every write it makes for the user: why, what was drafted versus sent, and what happened next.

**Mark**: A local note that GitHub can't express: `handed-off` (an agent has it) or `addressed` (the reviewer knows). Cleared when newer feedback arrives.

**Issue**: A tracked unit of work in whichever system the project uses, with its own id.

**Parked**: A work item or review request the user has set aside on purpose, with a note saying why and optionally an until-date. Sits in a collapsed Parked section under the lanes and never notifies. Wakes on its own when a person does something new on it (feedback, a review re-request, a mention), when one of its agents waits for input (its question is the why, in My turn), or the date passes; bot comments, CI and pushes don't wake it.

**Wait for a comment**: The user marks a Jira work item as waiting for a comment. It sits in Waiting on others until a person other than the user comments on the ticket, then shows in My turn. App comments don't count. The user's reply puts it back in Waiting on others. It stays until the user stops it or the issue is done. A failed Testing step, feedback on its PRs or an agent waiting for input also ends the wait.

**Park rule**: A project setting that parks an issue when it reaches a status, and names what takes it off Parked: a finish condition, a number of days, or a move to another status. The user can also unpark it by hand. An open PR or a running agent keeps the item in its lane.

**Waiting on author**: A review request the user has handed back to its author until they act, with an optional note. It sits in Waiting on others and wakes back into Asked of me, with a notification, when the author or anyone but the user pushes, comments, replies or mentions the user.

**Ignored repo**: A repo whose PRs never appear at all. Unlike Parked, it's about the repo, not a piece of work.

**Branch**: A work item's branches are the remote branches whose names carry its key. A project's tuning can name its branch convention. The board looks for them in each clone of this project, and shows how far each one has reached in the project's delivery flow. A work item with a branch and no PR never says "no PR yet".

**Verification run**: One commit of a repo running locally on a free port with seeded data, tested in a browser against its issue and mockups. Its folder keeps the evidence and every log. A check counts as passed only when the user confirms it. A newer commit makes the run out of date.

**Cleanup**: Removing what work left behind. The control room reaps what it owns: dead verification worktrees and chart folders with no result. A self-review session closes once its PR's own session has taken its findings: the tell is in that session's transcript with a reply after it. Other worktrees go only when the user asks, and only when no process is in them, they have no uncommitted files, each commit is on a remote, and they were quiet for a day.

**Working session**: The one session that owns a work item's branch and worktree. Each work item also has at most one **helper** session for read-only work: charts, verification rounds and reviews. A start goes to the free session with that role, and is refused when it is busy. Only the user's "New tab" choice opens another.
