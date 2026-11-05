// Shipped: each of the user's PRs is watched for a week after it merges, for signs it broke something.
// The strongest sign is the code itself: later commits on the base that rewrite lines the PR added.
// A revert, or a fix commit rewriting its lines, counts as broke. A plain rewrite is "changed after".
// CI failing after the merge and new Sentry issues through its files are evidence, not proof: they
// ask for a look, and a failure that looks like infrastructure or passed again on the next commit is
// marked so. The user (or an agent he asks) gives the verdict; a confirmed break becomes a lesson that
// self-reviews of that repo check for.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CiFailure, Shipped, ShippedAgent, ShippedHit, ShippedVerdict } from "../shared/types";
import { DEV, INSTALLED_STATE_DIR } from "./config";
import { db, load, save } from "./db";
import { note, read } from "./runner";
import { prFacts } from "./history";
import { addLesson, allLessons } from "./lessons";
import type { PrFacts } from "./metrics";
import { send } from "./notifier";
import { SETTINGS } from "./settings";

const WINDOW_MS = 7 * 24 * 3600_000;
const BACKFILL_MS = 30 * 24 * 3600_000;
const EVERY_MS = 60 * 60_000;
const FILES = 12;
const sentry = () => SETTINGS.sentryOrg && `https://${SETTINGS.sentryOrg}.sentry.io/api/0/organizations/${SETTINGS.sentryOrg}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// Agents verifying a finding write here, where the installed app reads.
const REPORTS = join(INSTALLED_STATE_DIR, "shipped");
mkdirSync(REPORTS, { recursive: true });
export const reportFile = (ref: string) => join(REPORTS, ref.replace(/[/#]/g, "__") + ".json");

/** Files worth watching: code, not tests, docs or lockfiles. */
export function watchedFiles(files: string[]): string[] {
  return files.filter((f) => !/(^|\/)(tests?|__tests__|spec)\//i.test(f) && !/([._-]test|[._-]spec|^test_)[^/]*$/i.test(f.split("/").pop()!)
    && !/\.(md|txt|lock|json|ya?ml|toml|snap|svg|png)$/i.test(f) && !/(^|\/)(package-lock|yarn\.lock|uv\.lock|poetry\.lock)/.test(f)).slice(0, FILES);
}

// A generic file name says nothing alone, so a stack search keeps its folder.
const GENERIC = /^(index|views?|models?|utils?|__init__|urls|serializers?|admin|apps|forms|helpers?|types|constants|main|app|service|services)\.\w+$/i;
export function stackName(path: string): string {
  const parts = path.split("/");
  const base = parts.pop()!;
  return GENERIC.test(base) && parts.length ? `${parts.pop()}/${base}` : base;
}

const FIX = /\b(fix(es|ed)?|hotfix|revert|bug|regression|broken|crash)\b/i;

/**
 * A diff line as logic to compare: whitespace folded. Blank, comment, import and bracket-only lines are
 * left out, and so are fragments of fewer than three words ("return ResponseEntity"), which match by chance.
 */
export function logicLine(l: string): string | null {
  const t = l.trim().replace(/\s+/g, " ");
  if (t.length < 12 || /^(import |from \S+ import|#|\/\/|\/?\*|--|<!--)/.test(t) || /^[\s{}()[\];,.]*$/.test(t)) return null;
  if ((t.match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? []).length < 3) return null;
  return t;
}

/** A unified diff's added lines (`+`) or removed lines (`-`), as logic lines. */
export function diffLines(patch: string, side: "+" | "-"): Set<string> {
  const out = new Set<string>();
  for (const l of patch.split("\n")) {
    if (l[0] !== side || l.startsWith("+++") || l.startsWith("---")) continue;
    const t = logicLine(l.slice(1));
    if (t) out.add(t);
  }
  return out;
}

// Failures that come from outside the code: outages, registries, runners, timeouts.
const INFRA = /HTTP 5\d\d|\b50[234]\b|Service Unavailable|Bad Gateway|ECONNRESET|ETIMEDOUT|EAI_AGAIN|connection reset|timed out|rate limit|Couldn't find any versions|ERR_PNPM_FETCH|no space left|lost communication with the server|The operation was canceled|runner has received a shutdown/i;

/** Why a CI failure probably isn't the PR's doing, if it looks that way. */
export function suspectOf(f: Pick<CiFailure, "errors" | "next">): string | null {
  // The job's own error lines come last; the one it failed on says the most.
  for (const e of [...f.errors].reverse()) {
    const m = e.match(INFRA);
    if (m) return `looks like infrastructure: "${e.length > 90 ? m[0] : e}"`;
  }
  if (f.next === "passed") return "passed again on the next commit to the base";
  return null;
}

/** Where the week's evidence puts a PR, before anyone's verdict. */
export function verdictOf(w: Pick<Shipped, "reverts" | "rework" | "ciFailures" | "sentry" | "until">, now: number): Shipped["state"] {
  if (w.reverts.length || w.rework.some((r) => r.fix)) return "broke";
  if (w.ciFailures.some((f) => !f.suspect) || w.sentry?.length) return "look";
  if (w.rework.length) return "changed";
  return now >= Date.parse(w.until) ? "clean" : "watching";
}

/** The user's verdict over the evidence: not this PR is clean; caused by it is broke. */
export function effective(w: Shipped, now: number): Shipped["state"] {
  if (w.verdict?.verdict === "not") return now >= Date.parse(w.until) ? "clean" : "watching";
  if (w.verdict?.verdict === "caused") return "broke";
  return w.state;
}

async function gh(path: string, raw = false): Promise<any> {
  const out = await read(["gh", "api", ...(raw ? ["--allow-escape-sequences"] : []), path]);
  return raw ? out : JSON.parse(out);
}

/** With a Sentry org in settings, a token from SENTRY_AUTH_TOKEN or ~/.claude/sentry-config.yaml (`auth_token: ...`), as signal-to-pr reads it. */
function sentryToken(): string | null {
  if (!sentry()) return null;
  if (process.env.SENTRY_AUTH_TOKEN) return process.env.SENTRY_AUTH_TOKEN;
  const f = join(homedir(), ".claude", "sentry-config.yaml");
  if (!existsSync(f)) return null;
  const m = readFileSync(f, "utf8").match(/^\s*auth_token\s*:\s*["']?([^"'\s]+)/m);
  return m?.[1] ?? null;
}

const FAILED = ["failure", "timed_out", "startup_failure"];
type Run = { id?: number; name: string; status: string; conclusion: string | null; html_url?: string };
const runsOn = async (repo: string, sha: string): Promise<Run[]> => (await gh(`repos/${repo}/commits/${sha}/check-runs?per_page=100`)).check_runs ?? [];

// Commits don't change: their files and patches are fetched once.
const commits = new Map<string, any>();
async function commit(repo: string, sha: string) {
  if (!commits.has(sha)) commits.set(sha, await gh(`repos/${repo}/commits/${sha}`));
  return commits.get(sha);
}

/** The checks that passed on the commit before the merge and failed on it. */
export function newlyFailed(on: Run[], before: Run[]): Run[] {
  const passedBefore = new Set(before.filter((c) => c.conclusion === "success").map((c) => c.name));
  const seen = new Set<string>();
  return on.filter((c) => FAILED.includes(c.conclusion ?? "") && passedBefore.has(c.name) && !seen.has(c.name) && seen.add(c.name));
}

/** A failed job's error lines, timestamps and colour codes stripped. */
export function errorLines(log: string): string[] {
  const lines = log.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, "").trimEnd());
  const errors = lines.filter((l) => l.includes("##[error]") && !/Process completed with exit code/.test(l)).map((l) => l.replace(/.*##\[error\]/, ""));
  // Lines that say what went wrong, not the step's script echoed back ("echo "::error::..."").
  const hints = lines.filter((l) => !l.includes("##[") && !/::error::|^\s*(echo|printf|if |fi$|then$|else$)/.test(l) && /\b(error|failed|failure|exception|traceback|denied)\b/i.test(l) && !/Node\.js \d+ is deprecated/.test(l));
  return [...new Set([...hints.slice(-5), ...errors])].slice(-8).map((l) => l.slice(0, 300));
}

async function ciFailures(repo: string, mergeSha: string, after: any[]): Promise<{ ci: Shipped["ci"]; failures: CiFailure[] }> {
  const parent = (await commit(repo, mergeSha)).parents?.[0]?.sha;
  const on = await runsOn(repo, mergeSha);
  if (!on.length) return { ci: "none", failures: [] };
  const failed = newlyFailed(on, parent ? await runsOn(repo, parent) : []);
  if (!failed.length) return { ci: on.some((c) => c.status !== "completed") ? "pending" : "success", failures: [] };
  // The next few commits on the base, oldest first: did the same check pass again without a fix?
  const next = after.filter((c) => c.sha !== mergeSha).reverse().slice(0, 3);
  const failures: CiFailure[] = [];
  for (const r of failed) {
    let errors: string[] = [];
    if (r.id) errors = errorLines(await gh(`repos/${repo}/actions/jobs/${r.id}/logs`, true).catch(() => ""));
    let nextResult: CiFailure["next"] = null;
    for (const c of next) {
      const same = (await runsOn(repo, c.sha).catch(() => [])).find((x) => x.name === r.name && x.status === "completed");
      if (same) { nextResult = same.conclusion === "success" && !FIX.test(c.commit.message.split("\n")[0]) ? "passed" : same.conclusion === "success" ? null : "failed"; break; }
    }
    const f: CiFailure = { name: r.name, url: r.html_url ?? "", errors, next: nextResult, suspect: null };
    f.suspect = suspectOf(f);
    failures.push(f);
  }
  return { ci: "failure", failures };
}

const hit = (repo: string, c: any, over: Partial<ShippedHit> = {}): ShippedHit => ({
  sha: c.sha, at: c.commit.committer?.date ?? c.commit.author?.date, text: c.commit.message.split("\n")[0],
  url: c.html_url ?? `https://github.com/${repo}/commit/${c.sha}`, author: c.author?.login ?? c.commit.author?.name, ...over,
});

export async function check(f: PrFacts, prev: Shipped | undefined, now: number): Promise<Shipped> {
  const until = new Date(Date.parse(f.merged!) + WINDOW_MS).toISOString();
  const end = new Date(Math.min(now, Date.parse(until))).toISOString();
  const base = f.base ?? "main";
  const w: Shipped = {
    ref: f.ref, repo: f.repo, url: f.url, title: f.title, feature: f.feature, merged: f.merged!, until, mergeSha: f.mergeSha ?? null, state: "watching",
    ci: null, ciFailures: [], reverts: [], rework: [], sentry: null, checkedAt: new Date(now).toISOString(), files: watchedFiles(f.files ?? []),
  };
  if (f.mergeSha) {
    const after: any[] = await gh(`repos/${f.repo}/commits?sha=${encodeURIComponent(base)}&since=${f.merged}&until=${end}&per_page=100`).catch(() => []);
    const settled = prev && (prev.ci === "success" || prev.ci === "failure" || prev.ci === "none") && prev.ciFailures;
    const c = settled ? { ci: prev.ci, failures: prev.ciFailures } : await ciFailures(f.repo, f.mergeSha, after).catch(() => null);
    w.ci = c?.ci ?? null;
    w.ciFailures = c?.failures ?? [];
    const title = f.title.replace(/\s*\(#\d+\)$/, "");
    w.reverts = after.filter((c) => c.sha !== f.mergeSha && (c.commit.message.includes(`This reverts commit ${f.mergeSha}`) || c.commit.message.includes(`Revert "${title}`)))
      .map((c) => hit(f.repo, c));

    // The PR's own logic lines, per file, from its merge commit's diff.
    const mine = new Map<string, Set<string>>();
    for (const file of (await commit(f.repo, f.mergeSha)).files ?? []) if (w.files.includes(file.filename) && file.patch) mine.set(file.filename, diffLines(file.patch, "+"));
    // Later commits that rewrite or remove those lines.
    const seen = new Set([f.mergeSha, ...w.reverts.map((r) => r.sha)]);
    for (const [file, lines] of mine) {
      if (!lines.size) continue;
      const cs: any[] = await gh(`repos/${f.repo}/commits?sha=${encodeURIComponent(base)}&since=${f.merged}&until=${end}&path=${encodeURIComponent(file)}&per_page=30`).catch(() => []);
      for (const c of cs) {
        if (seen.has(c.sha) || (c.parents?.length ?? 1) > 1) continue; // merge commits carry other work
        const d = await commit(f.repo, c.sha).catch(() => null);
        const patch = d?.files?.find((x: any) => x.filename === file)?.patch;
        if (!patch) continue;
        const touched = [...diffLines(patch, "-")].filter((l) => lines.has(l));
        if (!touched.length) continue;
        seen.add(c.sha);
        w.rework.push(hit(f.repo, c, { fix: FIX.test(c.commit.message.split("\n")[0]), file, lines: touched.slice(0, 6), count: touched.length }));
      }
    }
  }
  const token = sentryToken();
  if (token && w.files.length) {
    w.sentry = [];
    const ids = new Set<string>();
    for (const file of w.files) {
      const q = `is:unresolved firstSeen:>=${f.merged!.slice(0, 19)} firstSeen:<=${end.slice(0, 19)} stack.filename:"*${stackName(file)}"`;
      const r = await fetch(`${sentry()}/issues/?project=-1&environment=production&statsPeriod=14d&limit=10&query=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { log(`shipped: sentry ${r.status} for ${f.ref}`); w.sentry = null; break; }
      for (const i of (await r.json()) as any[]) if (!ids.has(i.id)) { ids.add(i.id); w.sentry.push({ sha: i.shortId, at: i.firstSeen, text: i.title, url: i.permalink, file }); }
    }
  }
  w.state = verdictOf(w, now);
  return w;
}

let store: Record<string, Shipped> = load<Record<string, Shipped>>("shipped") ?? {};
let verdicts: Record<string, ShippedVerdict> = load<Record<string, ShippedVerdict>>("shipped_verdicts") ?? {};
let busy = false;

/** The records quality() reads: agents, the user stepping in, and the review loop. */
export const qualityRecords = (from: string) => db.query<{ at: string; action: string; sent: string | null; result: string | null }, [string]>(
  `SELECT at, action, sent, result FROM action_records WHERE dry_run = ${DEV ? 1 : 0} AND at >= ? AND action IN ('start-agent', 'message-agent', 'type-agent', 'keys-agent', 'loop-report', 'loop-stop', 'product-question', 'failed-testing')`).all(from);

function agentReport(ref: string): ShippedAgent | null {
  const f = reportFile(ref);
  if (!existsSync(f)) return null;
  try {
    const r = JSON.parse(readFileSync(f, "utf8"));
    return ["caused", "not", "unsure"].includes(r.verdict) ? r : null;
  } catch { return null; } // half-written
}

/** Every watched PR, newest merge first: the evidence, any verdict and agent report, and the state they come to. */
export function shipped(now = Date.now()): Shipped[] {
  return Object.values(store).map((w) => {
    const l = allLessons().find((x) => x.ref === w.ref);
    const v: Shipped = { ...w, rework: w.rework ?? [], ciFailures: w.ciFailures ?? [], verdict: verdicts[w.ref] ?? null, agent: agentReport(w.ref),
      lesson: l ? { text: l.text, files: l.files ?? [], stick: l.stick ?? null } : null };
    return { ...v, found: w.state, state: effective(v, now) };
  }).sort((a, b) => b.merged.localeCompare(a.merged));
}


/** Where a break was: the files later commits rewrote the PR's lines in, else the PR's watched files. */
export function lessonFiles(w: Pick<Shipped, "rework" | "files">): string[] {
  const hit = [...new Set(w.rework.flatMap((r) => r.file ? [r.file] : []))];
  return (hit.length ? hit : w.files).slice(0, 5);
}

/** The user's call on a PR's findings; a confirmed break with a lesson teaches that repo's self-reviews. */
export function setVerdict(ref: string, v: { verdict: "caused" | "not" | null; why: string; by: "you" | "agent"; lesson?: string | null }) {
  const w = store[ref];
  if (!w) throw new Error("that PR isn't watched");
  if (v.verdict === null) delete verdicts[ref];
  else verdicts[ref] = { verdict: v.verdict, why: v.why, by: v.by, at: new Date().toISOString() };
  save("shipped_verdicts", verdicts);
  if (v.verdict === "caused" && v.lesson?.trim()) addLesson(w.repo ?? ref.split("#")[0], ref, v.lesson.trim(), lessonFiles(w));
  note({ item: w.feature, trigger: v.by }, "shipped-verdict", ref, v.verdict ?? "cleared", { detail: v });
}

/** The prompt for an agent that checks whether a PR really caused what the watch found. */
export function verifyPrompt(w: Shipped): string {
  const n = w.ref.split("#")[1];
  const ev = [
    ...w.ciFailures.map((f) => `- CI check "${f.name}" passed on the commit before the merge and failed on the merge commit ${w.mergeSha}: ${f.url}${f.errors.length ? `\n  errors: ${f.errors.slice(-3).join(" | ")}` : ""}${f.suspect ? `\n  the watch suspects: ${f.suspect}` : ""}`),
    ...w.reverts.map((r) => `- reverted by ${r.sha.slice(0, 7)}: ${r.text} ${r.url}`),
    ...w.rework.map((r) => `- ${r.sha.slice(0, 7)} by ${r.author ?? "?"} rewrote ${r.count} line(s) this PR added in ${r.file}: "${r.text}" ${r.url}`),
    ...(w.sentry ?? []).map((s) => `- new Sentry issue ${s.sha} through ${s.file}: ${s.text} ${s.url}`),
  ].join("\n");
  return `Verify whether my merged PR ${w.ref} ("${w.title}") broke something. The control room's watch found this in the week after it merged (${w.merged}):

${ev}

For each finding, establish whether this PR caused it, by evidence, not guesswork: read the PR's diff (\`gh pr diff ${n} -R ${w.repo}\`), the failing job's log (\`gh run view <run id> -R ${w.repo} --log-failed\`), and each later commit's diff (\`gh api repos/${w.repo}/commits/<sha>\`). A later commit that rewrote my lines may be a fix of my bug, a refactor, or a planned follow-up; say which. Run code if it settles a question. Make no code changes, push nothing and post nothing.

Then write \`${reportFile(w.ref)}\` as JSON and stop:
  {"verdict": "caused" | "not" | "unsure", "confidence": "high" | "medium" | "low", "why": "<two sentences on the deciding evidence>",
   "findings": [{"finding": "<which one>", "caused": true | false | null, "why": "<one sentence>"}],
   "rootCause": "<if caused: what in the PR was wrong, one sentence; else null>",
   "prevention": "<if caused: the concrete check that would have caught it before merge (a test, a CI step, a review question), one sentence; else null>",
   "at": "<now, ISO 8601>"}`;
}

function alert(w: Shipped) {
  const why = [w.reverts.length && "reverted", w.rework.some((r) => r.fix) && "a fix commit rewrote its lines", w.ciFailures.some((f) => !f.suspect) && `${w.ciFailures.filter((f) => !f.suspect).map((f) => f.name).join(", ")} failed after the merge`, w.sentry?.length && `${w.sentry.length} new error report${w.sentry.length > 1 ? "s" : ""}`].filter(Boolean).join(", ");
  const short = w.ref.split("/").pop()!;
  note({ item: w.feature, trigger: "watch" }, "shipped-alert", short, w.state, { detail: w });
  send({ title: `Shipped ${short}: ${w.state === "broke" ? "may have broken something" : "worth a look"}`, body: `${why} · ${w.title}`, url: `http://127.0.0.1:4777/?shipped=${encodeURIComponent(w.ref)}`, loud: w.state === "broke", thread: `shipped-${w.ref}` });
}

/** Re-checks every PR still inside its week, and any merged in the last 30 days not yet seen. */
export async function watchShipped(now = Date.now()) {
  if (busy) return;
  busy = true;
  try {
    // Inside its week (and one check past it, to close it out), never checked, or checked by an older watch.
    const due = prFacts().filter((f) => f.merged && now - Date.parse(f.merged) < BACKFILL_MS
      && (!store[f.ref] || now - Date.parse(f.merged) < WINDOW_MS + EVERY_MS || store[f.ref].state === "watching"
        || !store[f.ref].ciFailures || (store[f.ref].ci === null && !!f.mergeSha)));
    for (const f of due) {
      const prev = store[f.ref]?.ciFailures ? store[f.ref] : undefined;
      try {
        const w = await check(f, prev, now);
        store[f.ref] = w;
        // Alerts only for news inside the week; a backfill finding old trouble just records it.
        if (prev && w.state !== prev.state && (w.state === "broke" || w.state === "look") && !verdicts[f.ref]) alert(w);
      } catch (e) {
        log(`shipped: checking ${f.ref} failed:`, (e as Error).message);
      }
    }
    save("shipped", store);
    if (due.length) log(`shipped: checked ${due.length} merged PR${due.length > 1 ? "s" : ""}`);
  } finally {
    busy = false;
  }
}

export function startShipped() {
  setTimeout(() => void watchShipped(), 2 * 60_000);
  setInterval(() => void watchShipped(), EVERY_MS);
}
