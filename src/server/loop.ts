import { PROJECTS_PATH, repoInProject, repoPath } from "./repos";
// The weekly self-improvement loop: once a week, write a brief of the metrics and what happened in
// the control room, then start an agent that reports on it, files up to three proposals as `loop`
// issues on this repo, and opens a draft PR for the top one. It never merges or deploys.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV, STATE_DIR } from "./config";
import { db, load, save } from "./db";
import { note } from "./runner";
import { snapshot } from "./feed";
import { historySyncedAt, METRICS_FROM, prFacts, syncHistory } from "./history";
import { startAgent } from "./handoff";
import { revertsByRepo, features, friction, historyNotReady, quality, stageTimes, weekly, weekOf, type Event } from "./metrics";
import { allLessons, dueStick, goneLessons, markStick, removeLesson, stickPrompt } from "./lessons";
import { bounces } from "./product";
import { qualityRecords, shipped } from "./shipped";
import { tuning } from "./settings";

export const LOOP_DIR = join(STATE_DIR, "loop");
const CHECK_MS = 3_600_000;
// The loop starts on the first weekday morning of the week, or the next one if the control room was
// off, inside the local hours on the Settings page (9 to 12 by default).

type LastRun = { week: string; at: string; agent: string | null; error: string | null };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Everything the loop agent reads about the week, as one JSON file. */
function brief(week: string) {
  const prs = prFacts();
  const events = db.query<Event, []>("SELECT at, item, kind, lane, step, detail FROM item_events WHERE dry_run = 0 ORDER BY at").all();
  const actions = db.query<{ action: string; trigger: string; result: string; n: number }, [string]>(
    "SELECT action, trigger, result, count(*) AS n FROM action_records WHERE at >= ? AND dry_run = 0 GROUP BY action, trigger, result ORDER BY n DESC").all(daysAgo(14));
  const s = snapshot();
  const lanes: Record<string, number> = {};
  for (const it of s.items) lanes[it.lane] = (lanes[it.lane] ?? 0) + 1;
  return {
    week, metricsFrom: METRICS_FROM,
    notes: [
      "weeks: The user's output by week (Monday start). feedback counts review threads and change requests from people and review bots, plus people's comments; humanFeedback is the people part. rounds: per PR merged that week, how many commits got a human review.",
      "friction: from the control room's event log, which started 2026-10-28. myTurnHours: how long each stretch on My turn lasted before the item moved on.",
      "actions: what the user did through the control room in the last 14 days (action_records).",
      "quality: by week, merged PRs and how many had a commit whose CI failed; agents started (self-reviews among them) and touches, how often the user had to message, type into or press keys in an agent; review loop rounds, those that pushed a fix, and the PRs it handed back (loopStops); and merged PRs by what the week after the merge turned up (shipped: clean, watching, rework, broke). Agent and loop records started 2026-10-28.",
      "stages: median hours per stage of a PR over the last 30 days (coding, waiting for a first review, in review, approval to merge) and each reviewer's response time.",
      "shipped: merged PRs the after-merge watch flagged, with the evidence and the user's verdict. broke: reverted, or a fix commit rewrote lines the PR added; look: CI failed after the merge or new Sentry issues; changed: later commits rewrote its lines. verdict caused/not is the user's (or an agent's he accepted). Dismissed findings show where the watch is wrong: propose changes to src/server/shipped.ts that would have avoided them.",
      "bounces: product testing bounces (GLOSSARY: Product testing): product-question (product asked on an issue in Testing) and failed-testing (product moved it back), with who, their comment, the PRs, branch and agent sessions behind the work. Look for kinds of work product sends back, and propose what the harness or the skills should check before Testing.",
      "reverts: per repo, merged PRs watched and how many were reverted. Compare repos; do not blend them.",
      "pulse: the user's own 1 to 5 answer, by week, to how smooth the week felt (5 is smooth). Perception, not outcome: read it beside quality, and say when the two disagree.",
      "lessons: what would have caught each confirmed break; self-reviews of that repo check PRs against them. files: where the break was. stick: when the user started an agent to make the repo enforce it (a test, lint rule, hook or rules file); a lesson without one is only a reminder to self-review.",
    ],
    weeks: weekly(prs, METRICS_FROM).slice(-12),
    friction: friction(events, METRICS_FROM),
    quality: quality(prs, qualityRecords(METRICS_FROM), shipped(), METRICS_FROM).slice(-12),
    stages: stageTimes(prs, daysAgo(30)),
    shipped: shipped().filter((w) => w.found !== "clean" && w.found !== "watching").slice(0, 30).map((w) => ({
      ref: w.ref, title: w.title, found: w.found, state: w.state, verdict: w.verdict ?? null, agent: w.agent ? { verdict: w.agent.verdict, why: w.agent.why, rootCause: w.agent.rootCause } : null,
      ci: w.ciFailures.map((f) => ({ name: f.name, errors: f.errors.slice(-2), suspect: f.suspect })), reverts: w.reverts.map((r) => r.text),
      rework: w.rework.map((r) => ({ text: r.text, fix: r.fix, lines: r.count })), sentry: w.sentry?.map((r) => r.text) ?? null })),
    lessons: allLessons(),
    reverts: revertsByRepo(shipped()),
    pulse: load<Record<string, number>>("pulse") ?? {},
    bounces: bounces(METRICS_FROM).slice(0, 30),
    features: features(prs, daysAgo(30)),
    actions,
    board: { lanes, next: s.items.filter((i) => i.next).map((i) => ({ key: i.key, step: i.next!.step, action: i.primary.label })), nudges: s.nudges.map((n) => ({ reviewer: n.reviewer, prs: n.prs.length })) },
  };
}

/** Where loop issues go: the public repo, never the private origin. */
const ISSUES = (() => {
  try { return JSON.parse(readFileSync(PROJECTS_PATH, "utf8")).public?.repo ?? "this repo"; } catch { return "this repo"; }
})();

function prompt(week: string, briefPath: string, reportPath: string) {
  return `This is the control room's weekly self-improvement loop, for the week of ${week}. The goal is to make the user's work as smooth, fast and low-effort as possible, and what he ships hold up after it merges, measured by the control room's own metrics.

Read first:
- The brief at "${briefPath}": output metrics by week, friction from the control room's event log, quality by week (CI failures, how often he had to step in on agents, how often the review loop finished alone, merged PRs that broke something or got reworked), where PR time goes, what the user did through the control room, and the board right now.
- The user's Claude Code transcripts from the last 7 days (\`find ~/.claude/projects -name '*.jsonl' -mtime -7\`). Look at his own messages for friction: asking agents for status ("any other feedback?", "is X mergeable?"), repeating the same instructions, correcting agents, doing by hand something the control room could do. Count occurrences; don't quote at length.
- Earlier reports in "${LOOP_DIR}" and every issue labelled \`loop\` on ${ISSUES} (\`gh issue list -R ${ISSUES} --label loop --state all\`), so you don't re-propose something already proposed or rejected, and can check whether the last change that shipped moved the number it targeted.
- PRODUCT.md, GLOSSARY.md and docs/adr, for what the control room is and the decisions already made.

Then:
1. Write the report to "${reportPath}": what moved this week against the typical week, where the friction was (with numbers), and whether the last shipped change helped. Keep it short.
   End it with a "Memory" section. Group the user's corrections of agents by kind; for each kind seen in two or more sessions, propose the exact line to add and where it belongs (\`~/.claude/CLAUDE.md\`, the repo's \`CLAUDE.md\`, or a path-scoped \`.claude/rules/<topic>.md\`), with how many sessions it came up in. Check the line isn't there already. Then list lines in those files that are stale, contradicted by another, or that agents followed nowhere this week, as cuts. Proposals only: don't edit any CLAUDE.md or rules file.
2. Propose at most 3 changes to the control room, each tied to a number it should move. File each as a GitHub issue on ${ISSUES} with \`-R ${ISSUES}\`, labelled \`loop\` (create the label if it's missing), following docs/agents/issue-tracker.md. The repo is public: name no employer, org, customer or work project, and describe numbers without their source. Body: the problem and its evidence, the change, and the metric it should move and by roughly how much.
3. Build the top proposal: a branch \`loop/<short-slug>\` from main in your worktree, written the way the surrounding code is, with tests. Run \`bun test\` and \`bunx tsc --noEmit -p .\`. Open a draft PR with \`gh pr create --draft\` whose body says what it changes and \`Closes #<issue>\`. Never merge, never run \`bun run deploy\`, never push to main.
4. End with a short summary: the report path, the issue links and the PR link.

If the data is too thin to support a proposal (friction has only been recorded since 2026-10-28), say so in the report and propose fewer changes rather than guessing.`;
}


/** The user's answer for this week: how smooth did it feel? */
export function setPulse(score: number) {
  save("pulse", { ...(load<Record<string, number>>("pulse") ?? {}), [weekOf(new Date().toISOString())]: score });
}

/** Whether a repo's default branch still has a file; null when git can't tell. */
function fileExists(repo: string, file: string): boolean | null {
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repoPath(repo), ...a], { stdout: "ignore", stderr: "ignore" }).exitCode;
  try {
    if (git("rev-parse", "--verify", "-q", "origin/HEAD") !== 0) return null;
    return git("cat-file", "-e", `origin/HEAD:${file}`) === 0;
  } catch { return null; }
}

/** Upkeep that must not stop the loop: drop lessons whose code is gone, and start one agent on making a lesson stick. */
async function tendLessons() {
  for (const l of goneLessons(allLessons(), fileExists)) removeLesson(l.ref);
  const due = dueStick(allLessons().filter((l) => repoInProject(l.repo.split("/").pop()!)), shipped());
  if (!due) return;
  const r = await startAgent({ item: `lesson-${due.watched.feature}`, repo: due.lesson.repo, pr: null, kind: "custom", prompt: stickPrompt(due.lesson, due.watched.url), edited: false, bare: true });
  if (!("dryRun" in r)) markStick(due.lesson.ref, r.name);
}

/** Writes the brief and starts the loop agent in a control-room tab. */
export async function runLoop(trigger: "schedule" | "metrics view") {
  const week = weekOf(new Date().toISOString());
  mkdirSync(LOOP_DIR, { recursive: true });
  const briefPath = join(LOOP_DIR, `${week}-brief.json`);
  const reportPath = join(LOOP_DIR, `${week}-report.md`);
  const at = new Date().toISOString();
  try {
    // The loop works on control-room's own repo, which only its own project can start agents in.
    if (!repoInProject("control-room")) return null;
    // Without the PR history the brief has no output metrics; failing here retries on the next check.
    await syncHistory();
    const notReady = historyNotReady(historySyncedAt());
    if (notReady) throw new Error(notReady);
    writeFileSync(briefPath, JSON.stringify(brief(week), null, 2));
    const r = await startAgent({ item: `loop-${week}`, repo: "control-room", pr: null, kind: "custom", prompt: prompt(week, briefPath, reportPath), edited: false, bare: true });
    save("loop_last", { week, at, agent: r.name, error: null } satisfies LastRun);
    note({ item: null, trigger }, "loop", r.name, "dryRun" in r ? "dry run" : "started", { at });
    await tendLessons().catch((e) => console.error(new Date().toISOString(), "lesson upkeep failed:", (e as Error).message));
    return { week, agent: r.name };
  } catch (e) {
    const error = (e as Error).message;
    save("loop_last", { week, at, agent: null, error } satisfies LastRun);
    note({ item: null, trigger }, "loop", "", `failed: ${error}`, { at });
    throw e;
  }
}

/** The last run, and the newest report the loop agent wrote. */
export function loopState() {
  const last = load<LastRun>("loop_last");
  const reports = existsSync(LOOP_DIR) ? readdirSync(LOOP_DIR).filter((f) => f.endsWith("-report.md")).sort() : [];
  const newest = reports.at(-1);
  return { last, pulse: load<Record<string, number>>("pulse")?.[weekOf(new Date().toISOString())] ?? null, report: newest ? { week: newest.slice(0, 10), text: readFileSync(join(LOOP_DIR, newest), "utf8") } : null };
}

/** Runs the loop once a week, on the first weekday morning check inside the Settings page's window. */
export function startLoop() {
  if (DEV) return;
  const check = () => {
    const now = new Date();
    if (!tuning.scheduled()) return;
    if (now.getDay() % 6 === 0 || now.getHours() < tuning.loopFrom() || now.getHours() >= tuning.loopUntil()) return;
    // A failed start retries on the next check; a started one waits for next week.
    const last = load<LastRun>("loop_last");
    if (last?.week === weekOf(now.toISOString()) && !last.error) return;
    void runLoop("schedule").catch((e) => console.error(new Date().toISOString(), "loop failed:", (e as Error).message));
  };
  check();
  setInterval(check, CHECK_MS);
}
