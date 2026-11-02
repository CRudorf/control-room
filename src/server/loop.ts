import { repoInProject } from "./repos";
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
import { features, friction, historyNotReady, quality, stageTimes, weekly, weekOf, type Event } from "./metrics";
import { allLessons } from "./lessons";
import { bounces } from "./product";
import { qualityRecords, shipped } from "./shipped";

export const LOOP_DIR = join(STATE_DIR, "loop");
const CHECK_MS = 3_600_000;
// Local hours the loop may start in: the first weekday morning of the week, or the next one if
// the control room was off.
const FROM_HOUR = 9, UNTIL_HOUR = 12;

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
    bounces: bounces(METRICS_FROM).slice(0, 30),
    features: features(prs, daysAgo(30)),
    actions,
    board: { lanes, next: s.items.filter((i) => i.next).map((i) => ({ key: i.key, step: i.next!.step, action: i.primary.label })), nudges: s.nudges.map((n) => ({ reviewer: n.reviewer, prs: n.prs.length })) },
  };
}

function prompt(week: string, briefPath: string, reportPath: string) {
  return `This is the control room's weekly self-improvement loop, for the week of ${week}. The goal is to make the user's work as smooth, fast and low-effort as possible, and what he ships hold up after it merges, measured by the control room's own metrics.

Read first:
- The brief at "${briefPath}": output metrics by week, friction from the control room's event log, quality by week (CI failures, how often he had to step in on agents, how often the review loop finished alone, merged PRs that broke something or got reworked), where PR time goes, what the user did through the control room, and the board right now.
- The user's Claude Code transcripts from the last 7 days (\`find ~/.claude/projects -name '*.jsonl' -mtime -7\`). Look at his own messages for friction: asking agents for status ("any other feedback?", "is X mergeable?"), repeating the same instructions, correcting agents, doing by hand something the control room could do. Count occurrences; don't quote at length.
- Earlier reports in "${LOOP_DIR}" and every issue labelled \`loop\` on this repo (\`gh issue list --label loop --state all\`), so you don't re-propose something already proposed or rejected, and can check whether the last change that shipped moved the number it targeted.
- PRODUCT.md, GLOSSARY.md and docs/adr, for what the control room is and the decisions already made.

Then:
1. Write the report to "${reportPath}": what moved this week against the typical week, where the friction was (with numbers), and whether the last shipped change helped. Keep it short.
   End it with a "Memory" section. Group the user's corrections of agents by kind; for each kind seen in two or more sessions, propose the exact line to add and where it belongs (\`~/.claude/CLAUDE.md\`, the repo's \`CLAUDE.md\`, or a path-scoped \`.claude/rules/<topic>.md\`), with how many sessions it came up in. Check the line isn't there already. Then list lines in those files that are stale, contradicted by another, or that agents followed nowhere this week, as cuts. Proposals only: don't edit any CLAUDE.md or rules file.
2. Propose at most 3 changes to the control room, each tied to a number it should move. File each as a GitHub issue on this repo labelled \`loop\` (create the label if it's missing), following docs/agents/issue-tracker.md. Body: the problem and its evidence, the change, and the metric it should move and by roughly how much.
3. Build the top proposal: a branch \`loop/<short-slug>\` from main in your worktree, written the way the surrounding code is, with tests. Run \`bun test\` and \`bunx tsc --noEmit -p .\`. Open a draft PR with \`gh pr create --draft\` whose body says what it changes and \`Closes #<issue>\`. Never merge, never run \`bun run deploy\`, never push to main.
4. End with a short summary: the report path, the issue links and the PR link.

If the data is too thin to support a proposal (friction has only been recorded since 2026-10-28), say so in the report and propose fewer changes rather than guessing.`;
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
  return { last, report: newest ? { week: newest.slice(0, 10), text: readFileSync(join(LOOP_DIR, newest), "utf8") } : null };
}

/** Runs the loop once a week, on the first weekday morning check between FROM_HOUR and UNTIL_HOUR. */
export function startLoop() {
  if (DEV) return;
  const check = () => {
    const now = new Date();
    if (now.getDay() % 6 === 0 || now.getHours() < FROM_HOUR || now.getHours() >= UNTIL_HOUR) return;
    // A failed start retries on the next check; a started one waits for next week.
    const last = load<LastRun>("loop_last");
    if (last?.week === weekOf(now.toISOString()) && !last.error) return;
    void runLoop("schedule").catch((e) => console.error(new Date().toISOString(), "loop failed:", (e as Error).message));
  };
  check();
  setInterval(check, CHECK_MS);
}
