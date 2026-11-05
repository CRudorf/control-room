import { repoPathText } from "./repos";
// Runs the review loop's steps (cycle.ts decides them) and keeps its state.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { HeldReply, PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { DEV, PRS, STATE_DIR } from "./config";
import { load, save } from "./db";
import { note, read } from "./runner";
import { postReplies, rerequest, rerunCi, restack, updateBranch } from "./actions";
import { sendToAgent } from "./herdr";
import { startAgent, withLookup } from "./handoff";
import { notesFor } from "./notes";
import { brokenFor, brokenPrompt } from "./broken";
import { riskOf } from "./risk";
import { decide, type LoopPr, type Loops, type Report, type Step } from "./cycle";

const DIR = join(STATE_DIR, "loop");
mkdirSync(DIR, { recursive: true });
/** Where a round's agent writes its report. */
export const reportFile = (ref: string) => join(DIR, `${ref.replace(/[/#]/g, "__")}.json`);

let loops: Loops = load<Loops>("loops") ?? {};
let first = load<Loops>("loops") === null;
let busy = false;
export const loopsNow = () => loops;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const loopCtx = (item: string | null) => ({ item, trigger: "loop" });

function readReport(ref: string): Report | null {
  try { return existsSync(reportFile(ref)) ? JSON.parse(readFileSync(reportFile(ref), "utf8")) : null; }
  catch { return null; } // half-written: read it next time
}

const sh = (cmd: string[]) => read(cmd);

function ciPrompt(p: PrRow, file: string) {
  return `PR ${prRef(p)} ("${p.title}"), branch \`${p.branch}\` into \`${p.base}\`. The repo is cloned at ${repoPathText(p.repo)}; work in your worktree.

You are running unattended, started by my review loop; nobody is watching this session. CI is failing on ${p.head.slice(0, 7)} and a rerun didn't fix it. Check out \`${p.branch}\` (\`git fetch origin ${p.branch} && git switch ${p.branch}\`; if it's checked out in another worktree, work from that one). Find the failing jobs with \`gh pr checks ${p.number} -R ${p.repo}\` and their logs, and work out whether it's the change or a flake.

If it's the change, fix it, run the failing check locally, commit, and push (plain push; never force-push, merge, or re-request review). If it's a flake, or you can't fix it, push nothing.

Last, always, write \`${file}\` as JSON and stop:
  {"head": "<sha you pushed, or null>", "flake": false, "ask": null, "summary": "<one sentence: what failed and what you did>",
   "checks": [{"cmd": "<command>", "exit": <its exit code>}]}
Set "flake" true for a flake; set "ask" to one sentence when you need a decision from me. List in "checks" each check command you ran on the final code and its exit code; a push with no check that exited 0 comes back to me.`;
}

async function exec(s: Step, p: PrRow) {
  const ctx = { item: s.item, trigger: "loop" };
  if (s.do === "update") return updateBranch(ctx, p);
  if (s.do === "rerun") return rerunCi(ctx, p);
  if (s.do === "restack") return restack(ctx, p, s.branch, s.on);
  if (s.do === "rerequest") return rerequest(ctx, p, s.who);
  if (s.do !== "round") return;
  const file = reportFile(s.ref);
  rmSync(file, { force: true });
  const prompt = withLookup(s.kind === "ci" ? ciPrompt(p, file) : await sh(["python3", PRS, "prompt", s.ref, "--loop", file, ...(DEV ? ["--no-mark"] : [])]), s.item, notesFor([s.item])) + brokenPrompt(brokenFor(p.repo));
  const l = loops[s.ref];
  if (s.pane) {
    await sendToAgent(s.pane, prompt, s.item, "loop");
    return;
  }
  const r = await startAgent({ item: s.item, repo: p.repo, pr: s.ref, kind: s.kind === "ci" ? "ci" : "feedback", prompt, edited: false });
  if (l.round) { l.round.pane = "pane" in r ? r.pane ?? null : null; l.round.agent = r.name; }
}

/** One pass of the loop over the board; publishes again when its state changed. */
export async function cycle(items: WorkItem[], lowMemory: boolean, publish: () => void) {
  if (busy) return;
  busy = true;
  const before = JSON.stringify(loops);
  try {
    const reports = new Map<string, Report>();
    for (const [ref, l] of Object.entries(loops)) if (l.round) { const r = readReport(ref); if (r) reports.set(ref, r); }
    const d = decide(items, loops, { now: Date.now(), reports, risk: (p) => riskOf(p, publish), first, lowMemory });
    // A new stop is the loop handing a PR back to the user: recorded, for how often the loop finishes alone.
    for (const [ref, l] of Object.entries(d.loops)) if (l.stop && l.stop.at !== loops[ref]?.stop?.at) note(loopCtx(null), "loop-stop", ref, l.stop.why, { at: l.stop.at });
    loops = d.loops;
    first = false;
    for (const ref of reports.keys()) if (!loops[ref]?.round) {
      note(loopCtx(null), "loop-report", ref, JSON.stringify(reports.get(ref)));
      rmSync(reportFile(ref), { force: true });
    }
    const prs = new Map(items.flatMap((it) => it.prs.map((p) => [prRef(p), p] as const)));
    for (const s of d.steps) {
      const p = prs.get(s.ref)!;
      try { await exec(s, p); }
      catch (e) {
        const msg = (e as Error).message;
        log(`loop ${s.do} on ${s.ref} failed:`, msg);
        // A rerun or update that can't happen just moves the loop on to an agent.
        if (s.do === "round" || s.do === "rerequest" || s.do === "restack") {
          delete loops[s.ref].round;
          const what = s.do === "round" ? "start the round" : s.do === "restack" ? `bring in ${s.on}'s latest` : "re-request";
          loops[s.ref].stop = { why: `couldn't ${what}: ${/409|conflict/i.test(msg) ? "it conflicts" : msg}`, at: new Date().toISOString() };
          note(loopCtx(null), "loop-stop", s.ref, loops[s.ref].stop!.why, { at: loops[s.ref].stop!.at });
        }
      }
    }
  } catch (e) {
    log("loop failed:", (e as Error).message);
  } finally {
    busy = false;
  }
  if (JSON.stringify(loops) !== before) { save("loops", loops); publish(); }
}

const touch = (ref: string, f: (l: LoopPr) => void) => {
  const l = loops[ref];
  if (!l) throw new Error(`the loop hasn't seen ${ref}`);
  f(l);
  save("loops", loops);
};

/** The user's say on one PR: run the loop now (past a stop or a risk flag), turn it off, or on again. */
export function setLoop(ref: string, what: "run" | "off" | "on", p: PrRow | undefined, item: string | null) {
  touch(ref, (l) => {
    if (what === "off") { l.off = true; delete l.round; }
    else if (what === "on") delete l.off;
    else {
      delete l.off;
      if (l.stop?.risk && p) l.approved.push(...(riskOf(p, () => {}) ?? []).map((f) => f.file));
      delete l.stop;
      delete l.round;
      l.rounds = 0;
      l.changesFrom = [];
      l.seen = []; // existing feedback too
      l.ciSeen = [];
    }
  });
  note(loopCtx(item), `loop-${what}`, ref, what === "run" ? "loop running" : `loop ${what}`);
}

/** Sends the drafted replies (as the user edited them), then asks their reviewers again. */
export async function sendHeld(item: string, p: PrRow, replies: HeldReply[]) {
  const ref = prRef(p);
  const l = loops[ref];
  const ctx = { item, trigger: "loop" };
  const out = await postReplies(ctx, p, replies);
  const who = [...new Set([...(l?.held?.who ?? []), ...replies.map((r) => r.who)])];
  if (who.length) out.push(await rerequest(ctx, p, who));
  if (l) { delete l.held; save("loops", loops); }
  return out.join("; ");
}
