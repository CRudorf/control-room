// Shapes shared by the server and the UI.

/** A feedback item as prs.py reports it. */
export type Feedback = {
  kind: "thread" | "changes" | "review" | "comment";
  who: string;
  bot: boolean;
  url: string;
  at: string;
  body: string;
  where?: string;
  outdated?: boolean;
  thread_id?: string;
  reply_to?: number;
  opener?: string | null;
  /** An agent checking or fixing this thread, and its verdict once written. */
  task?: FeedbackTask & { result: FeedbackResult | null };
};

/** The newest thing that happened on a work item, and what it was. */
export type LastAction = { at: string; what: string; now?: boolean };

/** A review thread handed to an agent from the board: `check` proves whether it's right, `fix` also fixes it. */
export type FeedbackTask = { mode: "check" | "fix"; agent: string; at: string };
/** What the agent found, with a reply for the user to send. `commit`: the local fix, not pushed. */
export type FeedbackResult = { verdict: "real" | "not-real" | "unclear" | "fixed"; evidence: string; reply: string; commit: string | null; at: string };

/** One PR row from `prs.py --json`, `--mine --json` or `pr REF --json`. */
export type PrRow = {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  updated: string;
  checks: string;
  pending_reviewers: string[];
  branch: string;
  base: string;
  head: string;
  id: string;
  merge_state: string;
  can_merge: string;
  review_decision: string | null;
  last_activity: string;
  /** The latest commit or force push. */
  last_push?: string | null;
  /** When it last landed on its reviewers: latest activity, review request or ready-for-review. */
  waiting_since?: string;
  /** Its place in the repo's merge queue, while it's in one. */
  merge_queue?: { position: number; state: string; since: string } | null;
  /** Someone else's PR the user took over (`prs.py adopt`): whose it was. */
  taken_over?: { from: string; note: string };
  /** Commits on its base it doesn't have yet; looked up only while its CI is failing. */
  behind_by?: number;
  role: "mine" | "requested";
  // role "mine"
  state?: "address" | "re-request" | "handed-off" | "addressed" | "merge" | "waiting" | "draft";
  feedback?: Feedback[];
  rerequest?: string[];
  mark?: { state: string; at: string; note?: string } | null;
  superseded?: { state: string; at: string } | null;
  // role "requested"
  direct?: boolean;
  prior?: string | null;
  pushed_since?: boolean;
  rereview?: boolean;
  /** Latest push or human activity by anyone but the user (review requests). */
  others_activity?: string;
  /** Unresolved review threads, the ones waiting on the user first. */
  threads?: OpenThread[];
  /** Another open PR of the user's this one builds on; `behind`: the parent has commits this one lacks. */
  stack?: { on: string; number: number; branch: string; head: string; behind: boolean };
};

/** An unresolved review thread on someone else's PR. `yours`: The user is in it and someone else has the last word. */
export type OpenThread = { who: string; bot: boolean; last: string; count: number; outdated: boolean; yours: boolean; where: string; url: string; at: string; body: string };

export type Lane = "mine" | "waiting" | "asked" | "parked";

/** A work item set aside on purpose, until a time or until a person does something new on it. */
export type Park = { item: string; setAt: string; until: string | null; note: string };

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** A Claude session in a herdr pane. */
export type Agent = {
  pane: string;
  tab: string;
  workspace: string;
  name: string | null;
  label: string;
  title: string;
  workspaceLabel: string;
  status: AgentStatus;
  cwd: string;
  repo: string | null;
  branch: string | null;
  /** The remote branch the local one tracks, without the remote name. */
  upstream?: string | null;
  /** The commit checked out. */
  head?: string | null;
  session: string | null;
  focused: boolean;
  /** herdr's counter of state changes: a new finish or question has a new value. */
  seq: number;
  /** The seq at which it last went from working to finished, seen or not; null once it works again. */
  finishedSeq: number | null;
  /** When it took its current status; null when the control room first saw it already in it. */
  since?: string | null;
};

/** Waiting on author: a review request handed back until its author acts. */
export type Hold = { ref: string; setAt: string; head: string; since: string; note: string };

export type Reason = { text: string; weight: number; pr?: string; handoff?: HandoffTask["kind"] };

/** Something an agent can be started on, with the prompt it would get. */
export type HandoffTask = { kind: "conflicts" | "ci" | "feedback" | "review" | "selfreview" | "fixreview" | "stack" | "custom"; pr: string | null; label: string; prompt: string };

/** One finding a review agent drafted as an inline comment. */
export type Draft = { id: number; path: string; line: number; start_line: number | null; rank: "blocking" | "important" | "should-do" | "nit"; title: string; body: string };

/** A review agent's drafts for one PR, pinned to the commit it reviewed. */
export type ReviewDrafts = { pr: string; sha: string; findings: Draft[]; posted: { at: string; url: string; event: string; count: number } | null; error?: string };

export type Cell = { text: string; tone: "" | "pen" | "ok" | "dim"; proof?: string };

/** The Next queue's steps, in order: unblock agents, start agents, quick acts, check agents' work, the rest. */
export type NextStep = "answer" | "start" | "quick" | "check" | "look" | "pickup";

/** GLOSSARY: Suggestion. a: active sprint, b: container sprints, c: labelled backlog, d: other backlog. */
export type SuggestSource = "a" | "b" | "c" | "d" | "architecture";
export type Verdict = "free" | "wait" | "with" | "duplicate";
export type SuggestLink = { type: string; direction: "inward" | "outward"; key: string; status: string; done?: boolean };
export type Suggestion = {
  key: string; summary: string; source: SuggestSource; status: string; priority: string | null; assignee: "me" | null;
  labels: string[]; parent: { key: string; summary: string | null } | null; links: SuggestLink[]; updated: string | null;
  rank: number; url: string | null;
  /** Set on a GitHub issue, which has no In Progress status to move to. */
  tracker?: "github";
  /** Architecture only: the repo and the candidate as the agent wrote it. */
  repo?: string; arch?: { title: string; strength: string; files: string[]; problem: string; solution: string };
  verdict: Verdict | null; of: string | null; reason: string | null;
  /** For the link check: board work items keyed by the parent or a linked key, and PRs or branches that name the key. */
  facts: { board: string[]; prs: string[] };
  boost: number;
};
export type SuggestionsView = { tracker: "jira" | "github" | null; suggestions: Suggestion[]; error: string | null; judgedAt: string | null; archAt: string | null };

/** ⏎ on a work item: open a URL, or show an agent in herdr. */
export type PrimaryAction = {
  label: string;
  url?: string;
  agent?: string;
  handoff?: HandoffTask["kind"];
  act?: "rerun" | "rerequest" | "update" | "curate" | "replies";
  /** Open the Start box on this signal. */
  start?: string;
  /** What the agent started on `start` should know first, e.g. why product failed it. */
  startContext?: string;
  /** Review the files an unattended signal-to-pr run left, by its work item key. */
  run?: string;
  /** The PR the handoff or act is about. */
  pr?: string;
};

/** What a repo's Stop hook ran when an agent last tried to finish on a branch. */
/** `running`: the hook started at `at` and hasn't written its result yet. */
export type StopCheck = { repo: string; branch: string; sha: string; at: string; ok: boolean; running?: boolean; commands: { command: string; exit: number }[] };

export type WorkItem = {
  id: string;
  key: string;
  keyKind: "jira" | "sentry" | "branch" | "review" | "agent";
  title: string;
  repos: string[];
  prs: PrRow[];
  agents: Agent[];
  lane: Lane;
  why: string;
  urgency: number;
  updated: string;
  /** The newest action on it by anyone, agents and the control room included: the board's Last column. */
  last?: LastAction | null;
  cells: { fb: Cell; ci: Cell; rv: Cell; mg: Cell; ag: Cell };
  primary: PrimaryAction;
  /** Its place in the Next queue, and which step of the ranking put it there. Absent: nothing for the user to do now. */
  next?: { rank: number; step: NextStep };
  related: string[];
  /** Set while the user waits on the author; `woke` says what ended the wait. */
  hold?: Hold & { woke: string | null };
  /** Set while parked, and right after it wakes (`woke` says why) so the wake can notify. */
  park?: Park & { woke: string | null };
  /** Set while the user waits for a comment on the issue, and after one arrives (`woke` says what ended the wait). */
  commentWait?: { setAt: string; woke: string | null };
  /** Dependencies on its PRs; `opened` says what lifted one, so the lift can notify. */
  dependencies?: (Dependency & { opened: string | null })[];
  /** PRs that were moved into or out of it by hand. */
  moved?: string[];
  /** The agents here by the user's choice in the Move sheet. */
  agentsMoved?: string[];
  /** The effort it belongs to, a level above work items (e.g. retiring a tenant), set by hand. */
  effort?: string;
  /** Handoff docs, run folders and recordings named for it, newest first. */
  artifacts?: Artifact[];
  /** Claude tokens spent on it, with the electricity and water estimate. */
  usage?: UsageTotals;
  /** The last Stop check on each of its PR branches. */
  stopChecks?: StopCheck[];
  /** The review loop on each of its PRs the loop looks after. */
  loop?: LoopView[];
  /** Field guides to its requested PRs. */
  guide?: GuideView[];
  /** Remote branches named with its Jira key (GLOSSARY: Branch). */
  branches?: ItemBranch[];
  /** Its Jira issue, when the board has heard from Jira, and a status change to suggest. */
  jira?: { status: string; url: string; summary: string; suggest: Suggested | null; parent?: { key: string; summary: string } | null };
};

/** A reply to a person's review thread that a loop agent drafted, for the user to send. */
export type HeldReply = { reply_to: number; thread_id: string; who: string; body: string; resolve: boolean };

/** A check a loop agent ran on its final code, and the exit code it got. */
export type LoopCheck = { cmd: string; exit: number };

/** How the review loop stands on one PR. `rerequest`: who to ask again once the drafted replies go out. `checks`: the last round's. */
export type LoopView = {
  ref: string; state: "watching" | "running" | "held" | "stopped" | "off"; why: string; rounds: number;
  risk?: boolean; replies?: HeldReply[]; rerequest?: string[]; checks?: LoopCheck[];
};

/** A field guide to a PR the user was asked to review. `stale`: written for an older head. `url`: its claude.ai artifact, once promoted. */
/** `mine`: a self-review of the user's own PR; `linked`: its shared link is in the PR body. */
export type GuideView = { ref: string; path: string; sha: string; at: string; stale: boolean; url: string | null; mine?: boolean; linked?: boolean };

/** A Jira issue on the board: its status, and the transitions it offers. */
export type Issue = {
  key: string; summary: string; status: string; category: "new" | "indeterminate" | "done"; mine: boolean; updated: string; url: string;
  /** The parent issue or epic, when it has one: usually the feature this issue is part of. */
  parent?: { key: string; summary: string } | null;
  transitions: { id: string; name: string; to: string }[];
  /** Acceptance facts, for the user's issues in or just out of the project's acceptance step. */
  testing?: AcceptanceFacts;
  /** The comment facts of a Jira issue. A wait for a comment reads them. */
  comments?: { lastMyCommentAt: string | null; lastOtherComment: JiraComment | null };
};

/** A comment's first line, who wrote it and when. */
export type JiraComment = { id: string; author: string | null; isMe: boolean; at: string; firstLine: string };

/** What jira.py's board says about an issue in product testing. `questionSince`: the first comment by someone else newer than the user's last comment and the move into Testing. */
export type AcceptanceFacts = {
  enteredAt: string | null;
  failed: { id: string; by: string | null; at: string; from: string; to: string; comment: { id: string; at: string; firstLine: string } | null } | null;
  lastComment: JiraComment | null;
  lastMyCommentAt: string | null;
  questionSince: string | null;
};

/** A remote branch named with a work item's key, and whether it is in each stage of the project's flow. Null: the repo has no such branch. */
export type BranchStage = { name: string; in: boolean | null };
export type ItemBranch = { repo: string; name: string; stages: BranchStage[]; lastCommitAt: string; readAt?: string };

/** A status change the board suggests for a work item's Jira issue. */
export type Suggested = { key: string; from: string; to: string; id: string; why: string };

/** Assumptions behind the electricity and water estimates. */
export type UsageCoeffs = { whPerMTok: number; litersPerKwh: number };

/** Claude tokens spent, and the estimated electricity and water behind them. `cache` is cache reads and writes. */
export type UsageTotals = { input: number; output: number; cache: number; weighted: number; kwh: number; liters: number; usd: number; sessions: number };

/** The AI usage view: per work item, per week, and the assumptions used. */
export type Usage = {
  coeffs: UsageCoeffs; weights: Record<string, number>; scannedAt: string | null; from: string; pricesAsOf: string;
  items: (UsageTotals & { key: string; repos: string[]; first: string; last: string })[];
  weeks: (UsageTotals & { week: string })[];
};

/** A file a work item left outside git: a handoff doc, a run folder, a demo recording. */
export type Artifact = { kind: "handoff" | "run" | "media"; name: string; path: string; at: string };

/** An unattended signal-to-pr run the control room started, until the user dismisses it. */
export type Run = { key: string; at: string; agent: string };

/** A PR of the user's held back until another PR merges (`on`) or a named step is done. */
export type Dependency = { ref: string; on: string | null; step: string; setAt: string };

/** Where a PR moved by hand goes: into another work item, or null for a work item of its own. */
export type Move = { id: string; key: string; kind: WorkItem["keyKind"] } | null;

/** A work item whose PRs all merged or closed today, with no agent left on it. */
export type FinishedItem = { key: string; title: string; repos: string[]; at: string; why?: string; url?: string; startedAt?: string; suggest?: Suggested | null; prs: { ref: string; url: string; title: string; state: "merged" | "closed" }[] };

/** A reviewer sitting on the user's PRs past the stale threshold, and the Slack DM that nudges them. */
export type Nudge = {
  reviewer: string;
  prs: { ref: string; url: string; title: string; item: string; since: string }[];
  text: string;
};

export type Snapshot = {
  /** What the board needs of the project's flow. */
  flow?: { stages?: string[]; copySuffix?: string };
  /** The project this control room serves. */
  project?: string | null;
  user: string;
  items: WorkItem[];
  nudges: Nudge[];
  finished: FinishedItem[];
  jiraError: string | null;
  /** Total memory and how much is free; `low` when macOS is short. */
  machine: { totalGb: number; freePct: number | null; low: boolean } | null;
  polledAt: string | null;
  reconciledAt: string | null;
  error: string | null;
  herdr: { up: boolean; error: string | null };
  dev: boolean;
  /** Changes with every server start; a page from an older one reloads itself. */
  build: string;
};

/** A herdr tab, as the Tidy view lists it. */
export type TidyTab = {
  tab: string;
  label: string;
  workspace: string;
  focused: boolean;
  lastActive: string | null;
  suggest: boolean;
  /** Memory of everything running in the tab, MB. */
  mb: number;
  panes: {
    pane: string;
    mb: number;
    kind: "claude" | "shell" | "other";
    status: string;
    title: string;
    cwd: string;
    session: string | null;
    lastActive: string | null;
    item: { id: string; key: string; openPrs: number } | null;
  }[];
};

export const prRef = (p: { repo: string; number: number }) => `${p.repo}#${p.number}`;

/** One week of the user's output (Metrics view); activity counts in the week it happened. */
export type Week = {
  week: string; opened: number; merged: number; closed: number;
  feedback: number; humanFeedback: number; rounds: number[]; commits: number;
  /** Lines changed per PR merged that week. */
  sizes: number[];
  repos: string[]; features: string[];
};

/** A work item's PRs since the metrics start. */
export type Feature = { key: string; repos: string[]; prs: number; merged: number; commits: number; first: string; last: string };

/** One week of friction, from the control room's event log. */
export type Friction = {
  week: string;
  /** Hours each stretch on My turn lasted before the item moved on, for stretches that ended this week. */
  myTurnHours: number[];
  nextDone: number; nextSkipped: number; nudges: number;
};

export type Metrics = { from: string; syncedAt: string | null; weeks: Week[]; features: Feature[]; friction: Friction[]; stages: { d30: StageTimes; all: StageTimes }; quality?: Quality[] };

/** Where merged PRs' time went (median hours per stage), how fast each reviewer answers, and who's being waited on now. */
export type StageTimes = {
  from: string; prs: number;
  medians: { coding: number | null; waitFirst: number | null; inReview: number | null; toMerge: number | null; total: number | null };
  reviewers: { who: string; asks: number; answered: number; median: number | null; open: number }[];
  waiting: { ref: string; url: string; title: string; who: string; since: string; hours: number }[];
};

export type Span = "today" | "24h" | "7d" | "30d";

/** What the user got done over one span. */
export type Accomplished = {
  span: Span; from: string;
  merged: { ref: string; url: string; title: string; feature: string }[];
  opened: { ref: string; url: string; title: string; feature: string }[];
  closed: { ref: string; url: string; title: string; feature: string }[];
  /** Others' PRs he reviewed: his latest approval or change request, and how many comment reviews. */
  reviewed: { ref: string; url: string; title: string; author: string; verdict: "approved" | "changes requested" | "commented"; comments: number }[];
  commits: number; repos: string[]; features: string[];
  /** Writes through the control room: reviews posted and their inline comments, thread replies and resolves, re-requests, review loop rounds, Jira moves ("KEY → Status"). */
  reviewsPosted: number; commentsPosted: number; replies: number; resolved: number; rerequests: number; loopRounds: number; jira: string[];
  usage: { usd: number; kwh: number; liters: number; sessions: number } | null;
};

/** The weekly self-improvement loop: its last run and the newest report its agent wrote. */
export type LoopState = {
  pulse?: number | null;
  last: { week: string; at: string; agent: string | null; error: string | null } | null;
  report: { week: string; text: string } | null;
};

/** A Claude session herdr is running; `item` is null when it belongs to no work item. */
export type Session = {
  pane: string; workspace: string; label: string; title: string;
  status: "blocked" | "finished" | "working" | "idle";
  repo: string | null; branch: string | null; cwd: string; session: string | null;
  item: { id: string; key: string; title: string } | null;
  lastActive: string | null;
  spend: { tokens: number; usd: number; since: string } | null;
};

/** A commit or Sentry issue that counts against a shipped PR. */
export type ShippedHit = {
  sha: string; at: string; text: string; url: string; author?: string;
  /** A later commit: the file where it rewrote the PR's lines, a few of those lines, how many, and whether it says it fixes something. */
  file?: string; lines?: string[]; count?: number; fix?: boolean;
};

/** A check that passed before the merge and failed on it: its job, error lines, the next commit's result, and why it may not be the PR. */
export type CiFailure = { name: string; url: string; errors: string[]; next: "passed" | "failed" | null; suspect: string | null };

/** The user's call on a shipped PR's findings. */
export type ShippedVerdict = { verdict: "caused" | "not"; why: string; by: "you" | "agent"; at: string };

/** What an agent asked to verify the findings concluded. */
export type ShippedAgent = {
  verdict: "caused" | "not" | "unsure"; confidence: "high" | "medium" | "low"; why: string;
  findings?: { finding: string; caused: boolean | null; why: string }[];
  rootCause?: string | null; prevention?: string | null; at?: string;
};

/**
 * A merged PR of the user's, watched for a week. broke: reverted, or a fix commit rewrote its lines.
 * look: CI failed after the merge (not obviously infra) or new Sentry issues. changed: later commits
 * rewrote its lines. `state` takes the user's verdict into account; `found` is the watch's own call.
 */
export type Shipped = {
  ref: string; repo?: string; url: string; title: string; feature: string; merged: string; until: string; mergeSha?: string | null;
  state: "watching" | "clean" | "changed" | "look" | "broke";
  found?: Shipped["state"];
  /** Checks on the merge commit; "none" when the base runs none. */
  ci: "success" | "failure" | "pending" | "none" | null;
  ciFailures: CiFailure[];
  reverts: ShippedHit[]; rework: ShippedHit[];
  /** New Sentry issues through its files; null when Sentry isn't connected. */
  sentry: ShippedHit[] | null;
  files: string[]; checkedAt: string;
  verdict?: ShippedVerdict | null; agent?: ShippedAgent | null;
  /** Its lesson, if the user confirmed it broke something, and the agent making it stick in the repo. */
  lesson?: { text: string; files: string[]; stick: { agent: string; at: string } | null } | null;
};

/** One week of how well the work went: CI, agents, the review loop, and what merged PRs did after. */
export type Quality = {
  week: string;
  /** PRs merged that week, and how many of them had a commit whose CI failed. */
  merged: number; ciFailedPrs: number;
  /** Agents started (self-reviews among them), and how often the user stepped in: messages, typed lines and keypresses. */
  agents: number; selfReviews: number; touches: number;
  /** Review loop rounds reported, those that pushed a fix, and the PRs it handed back. */
  loopRounds: number; loopPushed: number; loopStops: number;
  /** PRs merged that week by what the week after their merge came to, the user's verdicts included. */
  shipped: Record<Shipped["state"], number>;
  /** Findings the user (or an agent he accepted) ruled on: caused by the PR, or not. */
  confirmed: number; dismissed: number;
  /** Product testing bounces that week: questions product asked, and issues product failed. */
  productQuestions?: number; failedTesting?: number;
};

/** The user's verdict on a glossary term or an ADR (the Docs page). */
export type DocVerdict = "reviewed" | "needs-change";
/** `stale`: the text changed since the review. `needsReview`: no review yet, or a stale one. */
export type DocReview = { verdict: DocVerdict | null; comment: string; at: string | null; stale: boolean; needsReview: boolean };
export type DocsView = {
  terms: { id: string; term: string; text: string; hash: string; review: DocReview }[];
  adrs: { id: string; file: string; title: string; text: string; hash: string; review: DocReview }[];
  charts: { name: string; title: string; svg: string; report: string }[];
};

/** A visual in the store (STATE_DIR/visuals/<id>/meta.json), or a flow in docs/statecharts. */
export type VisualMeta = {
  /** When this visual went into its PR body, if it is the one there. */
  inPrAt?: string;
  id: string; kind: "flow" | "chart" | "architecture" | "change" | "video"; title: string;
  /** The work item key, and the PR as owner/repo#n. */
  key: string | null; pr: string | null; createdAt: string;
  /** Whether all rules hold: null when no rule was checked. */
  rulesHold: boolean | null; files: string[];
  /** Why a change has no chart ("No flow change"). */
  reason?: string;
};
export type VisualDetail = { meta: VisualMeta; text: Record<string, string> };
