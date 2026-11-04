import { read } from "./runner";
// Starting an agent on a work item: a new herdr tab in the repo's workspace, Claude in a fresh
// worktree, and the user's prompt; or the same prompt in a session already open on the item, with its
// context kept or cleared first. Mirrors scripts/review-handoff.sh (herdr control surface research).
import { agentEnv, agentEnvLine, assertInProject, repoPath, repoPathText } from "./repos";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HandoffTask, WorkItem } from "../shared/types";
import { DEV, ROOT } from "./config";
import { db } from "./db";
import { note } from "./runner";
import { herdrState, promptedByBoard, request, unprompted } from "./herdr";
import { draftsFile, openFindings, personasFor, readDrafts, reviewPrompt } from "./review";
import { finishLine, rememberTask, taskForStart } from "./tasks";

const short = (repo: string) => repo.split("/").pop()!;
const slug = (s: string, n = 20) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, n).replace(/-$/, "");

/** The tasks a PR offers, most pressing first, each with a prompt the user can edit before starting. */
export function tasksFor(it: WorkItem): HandoffTask[] {
  const out: HandoffTask[] = [];
  for (const p of it.prs.filter((p) => p.role === "mine")) {
    const ref = `${p.repo}#${p.number}`;
    const where = `PR ${ref} ("${p.title}"), branch \`${p.branch}\` into \`${p.base}\`. The repo is cloned at ${repoPathText(p.repo)}; work in your worktree.`;
    const branch = `Check out \`${p.branch}\` in your worktree (\`git fetch origin ${p.branch} && git switch ${p.branch}\`; if it's checked out in another worktree, work from that one instead).`;
    if (p.merge_state === "DIRTY")
      out.push({ kind: "conflicts", pr: ref, label: `Fix conflicts on #${p.number}`, prompt:
        `${where}\n\nIt conflicts with \`${p.base}\`. ${branch} Merge \`origin/${p.base}\` into it (merge, not rebase), resolve the conflicts keeping both sides' intent, and run the checks that cover the files you touched.\n\nCommit locally and don't push. Then show me each conflict and how you resolved it, and wait for my go-ahead to push.` });
    if (p.checks === "failure" || p.checks === "error")
      out.push({ kind: "ci", pr: ref, label: `Fix CI on #${p.number}`, prompt:
        `${where}\n\nCI is failing. Find the failing jobs with \`gh pr checks ${p.number} -R ${p.repo}\` and their logs, and work out whether it's the change or a flake. ${branch} If it's the change, fix it and run the failing check locally.\n\nCommit locally and don't push. Tell me what failed, why, and what you changed, and wait for my go-ahead to push. If it's a flake, say so and change nothing.` });
    const d = readDrafts(ref);
    const open = d ? openFindings(d) : [];
    const skip = d?.findings.filter((f) => f.dismissed) ?? [];
    if (d && !d.posted && open.length && (p.head.startsWith(d.sha) || d.sha.startsWith(p.head)))
      out.push({ kind: "fixreview", pr: ref, label: `Fix ${open.length} self-review finding${open.length > 1 ? "s" : ""} on #${p.number}`, prompt:
        `${where}\n\nMy self-review of this PR left findings in \`${draftsFile(ref)}\`; read it. ${branch} Fix each blocking, important and should-do finding, and the nits that are quick.${skip.length ? ` Leave these alone, I dismissed them:\n${skip.map((f) => `- ${f.title} (${f.path}): ${f.dismissed!.reason}`).join("\n")}\n` : ""} Verify each fix by running the code, then run the checks that cover what you touched.\n\nCommit locally and don't push. Then show me what you fixed, what you left and why, and wait for my go-ahead to push.` });
    if (p.feedback?.length)
      out.push({ kind: "feedback", pr: ref, label: `Address feedback on #${p.number}`, prompt:
        `Run \`~/.claude/scripts/prs.py prompt ${ref}\` and follow the prompt it prints.` });
    out.push({ kind: "selfreview", pr: ref, label: `Self-review #${p.number}`, prompt: reviewPrompt(p, 2, true) });
    out.push({ kind: "stack", pr: ref, label: `Stack new work on #${p.number}`, prompt:
      `Start the next piece of work on top of PR ${ref} ("${p.title}"), which is still in review. In your worktree, branch off its head: \`git fetch origin ${p.branch} && git switch -c <a branch named for the new work> origin/${p.branch}\`.\n\nThe work: \n\nWhen it's done and checked, push the branch and draft a PR against \`${p.base}\` (not against \`${p.branch}\`, so CI runs on it). Its body starts with "Includes #${p.number}, so merge that first; this PR's own changes are <where they live>." Show me the PR body before opening it.` });
  }
  for (const p of it.prs.filter((p) => p.role === "requested")) {
    const ref = `${p.repo}#${p.number}`;
    out.push({ kind: "review", pr: ref, label: `Review #${p.number}, ${personasFor(p)} personas`, prompt: reviewPrompt(p, personasFor(p)) });
    out.push({ kind: "review", pr: ref, label: `${personasFor(p) + 1} personas`, prompt: reviewPrompt(p, personasFor(p) + 1) });
  }
  const first = it.prs[0];
  out.push({ kind: "custom", pr: first ? `${first.repo}#${first.number}` : null, label: "Something else",
    prompt: first ? `PR ${first.repo}#${first.number} ("${first.title}"), branch \`${first.branch}\`.\n\n` : "" });
  return out;
}

/**
 * The workspace for a repo. herdr only knows the repo of some workspaces, so: its repo info,
 * else a workspace labelled with the repo's name, else the one whose panes are mostly in it.
 */
export async function workspaceFor(repo: string): Promise<string | null> {
  const { snapshot: s } = await request("session.snapshot");
  const root = repoPath(repo);
  const byInfo = s.workspaces.filter((w: any) => w.worktree?.repo_name === repo);
  const hit = byInfo.find((w: any) => w.worktree?.repo_root === root) ?? byInfo[0]
    ?? s.workspaces.find((w: any) => (w.label ?? "").toLowerCase() === repo.toLowerCase());
  if (hit) return hit.workspace_id;
  const inRepo = (p: any) => (p.foreground_cwd || p.cwd || "").startsWith(root + "/") || (p.foreground_cwd || p.cwd) === root;
  const scored = s.workspaces.map((w: any) => {
    const panes = s.panes.filter((p: any) => p.workspace_id === w.workspace_id);
    return { id: w.workspace_id, share: panes.length ? panes.filter(inRepo).length / panes.length : 0 };
  }).sort((a: any, b: any) => b.share - a.share);
  return scored[0]?.share > 0.5 ? scored[0].id : null;
}


export type StartRequest = {
  item: string; repo: string; pr: string | null; kind: HandoffTask["kind"]; prompt: string; edited: boolean;
  /** An open session to give the task to instead of a new tab; `fresh` clears its context first. */
  reuse?: { pane: string; fresh: boolean } | null;
  /** Not a work item on the board (a verify or weekly loop agent): no lookup line. */
  bare?: boolean;
  /** What the session is for, in place of "agent": it names the tab and the session, such as "chart". */
  verb?: string;
  /** The user chose "New tab" in the start sheet. Nothing else opens a second session on a work item. */
  newSession?: boolean;
};

const NEEDS_SETUP = /trust this folder|Let's get started|Press Enter to continue|Enter to confirm/;

type SessionLite = { pane: string; label: string; name: string | null; status: string };
export type StartPlan = { reuse: { pane: string; fresh: boolean } } | { refuse: string } | { open: true };
const HELPER_VERB = /^(chart|verify|selfreview|review)\b/;
const isHelper = (r: Pick<StartRequest, "kind" | "verb">) => !!r.verb || r.kind === "selfreview" || r.kind === "review";
const words = (s: string) => s.toLowerCase().replace(/^[ab]-/, "");

/**
 * One work item has one working session and at most one helper. The working session owns the branch
 * and the worktree. The helper does read-only work: charts, verification rounds and reviews. A start
 * goes to the session that has the role when it is free, and is refused when it is busy.
 */
export function planStart(req: Pick<StartRequest, "item" | "pr" | "kind" | "verb" | "newSession">, agents: SessionLite[]): StartPlan {
  if (req.newSession) return { open: true };
  const item = words(req.item), ref = req.pr?.split("/").pop()?.toLowerCase();
  const mine = agents.filter((a) => { const l = a.label.toLowerCase(); return l.split(/\s+/).includes(item) || (!!ref && l.split(/\s+/).includes(ref)); });
  const helper = isHelper(req);
  const same = mine.filter((a) => HELPER_VERB.test(a.label) === helper);
  const free = same.find((a) => a.status !== "working" && a.status !== "blocked");
  if (free) return { reuse: { pane: free.pane, fresh: helper } };
  if (same[0]) return { refuse: `${same[0].name ?? same[0].label} is working on this. Wait for it, or send it a message.` };
  return { open: true };
}

/** Ends a prompt with how to look the work item up. A slash command takes the whole prompt as its arguments, so it goes without. */
export function withLookup(prompt: string, item: string) {
  const line = `\`bun run --cwd "${ROOT}" item ${item}\` shows this work item's PRs, open feedback, failing checks and lessons.`;
  // The user works across many sessions at once: every summary has to say what this one is on.
  const name = "When you sum up or finish a turn, name the work item (its key and what it's for) and each PR by repo, number and title, then what changed. Never a bare PR number.";
  if (prompt.startsWith("/") || prompt.includes(line)) return prompt;
  return prompt.trim() ? `${prompt}\n\n${line}\n${name}` : `${line}\n${name}`;
}

const labelFor = (req: StartRequest, repo: string) => {
  const num = req.pr?.split("#")[1];
  // The tab label names the PR, so the agent joins this work item on the board.
  return num ? `${req.verb ?? (req.kind === "custom" ? "agent" : req.kind)} ${repo}#${num}` : `agent ${req.item}`;
};

/** Gives the task to a session that's already open: same tab, same worktree, context kept or cleared. */
async function reuseAgent(req: StartRequest, reuse: { pane: string; fresh: boolean }) {
  const a = herdrState().agents.find((x) => x.pane === reuse.pane);
  if (!a) throw new Error("that session isn't open any more");
  if (a.status === "working" || a.status === "blocked") throw new Error(`${a.name ?? a.label} is ${a.status === "working" ? "working" : "waiting on a dialog"}; start a new tab or wait`);
  const label = labelFor(req, short(req.repo));
  const name = a.name ?? a.label;
  const detail = { label, name, pane: a.pane, fresh: reuse.fresh, prompt: req.prompt, edited: req.edited };
  if (DEV) {
    note({ item: req.item, trigger: req.kind }, "start-agent", label, "dry run", { detail: detail });
    return { name, label, pane: a.pane, reused: true, fresh: reuse.fresh, dryRun: true };
  }
  if (reuse.fresh) {
    await request("agent.prompt", { target: a.pane, text: "/clear" });
    // /clear is quick, but the prompt has to land after it, on an empty context.
    await Bun.sleep(1500);
    for (let i = 0; i < 20; i++) {
      const g = await request("agent.get", { target: a.pane }).catch(() => null);
      if (g?.agent?.interactive_ready && g.agent.agent_status !== "working") break;
      await Bun.sleep(500);
    }
  }
  promptedByBoard(a.pane);
  await request("agent.prompt", { target: a.pane, text: req.prompt }).catch((e) => { unprompted(a.pane); throw e; });
  await request("tab.rename", { tab_id: a.tab, label }).catch(() => {});
  rememberTask(reuse.pane, taskForStart(req));
  note({ item: req.item, trigger: req.kind }, "start-agent", label, reuse.fresh ? "started in a cleared session" : "started in the same session", { detail: detail });
  return { name, label, pane: a.pane, reused: true, fresh: reuse.fresh };
}

/** Opens the tab, starts Claude and sends the prompt, or hands it to an open session. Returns the agent's name. */
export async function startAgent(req: StartRequest) {
  if (!req.bare) req = { ...req, prompt: withLookup(req.prompt, req.item) };
  // Every session knows when it's done and says so, so the control room can close it then.
  if (req.prompt.trim() && !req.prompt.startsWith("/")) req = { ...req, prompt: `${req.prompt.trim()}\n\n${finishLine(taskForStart(req))}` };
  assertInProject(req.repo);
  if (req.reuse) return reuseAgent(req, req.reuse);
  const plan = planStart(req, herdrState().agents);
  if ("refuse" in plan) throw new Error(plan.refuse);
  if ("reuse" in plan) return reuseAgent(req, plan.reuse);
  const repo = short(req.repo);
  const cwd = repoPath(repo);
  if (!existsSync(join(cwd, ".git"))) throw new Error(`no clone at ${repoPathText(repo)}`);
  const num = req.pr?.split("#")[1];
  const label = labelFor(req, repo);
  const { agents } = (await request("agent.list")) as { agents: { name?: string }[] };
  const taken = new Set(agents.map((a) => a.name).filter(Boolean));
  const base = `cr-${req.verb ? `${req.verb}-` : ""}${slug(repo, 14)}-${num ?? slug(req.item, 8)}`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;

  const detail = { repo, label, name, prompt: req.prompt, edited: req.edited };
  if (DEV) {
    note({ item: req.item, trigger: req.kind }, "start-agent", label, "dry run", { detail: detail });
    return { name, label, dryRun: true };
  }

  const workspace = (await workspaceFor(repo)) ?? (await request("workspace.create", { cwd, label: repo, focus: false })).workspace?.workspace_id;
  const tab = await request("tab.create", { workspace_id: workspace, cwd, label, focus: false });
  const pane = tab.root_pane?.pane_id ?? tab.pane?.pane_id;
  if (!pane) throw new Error("herdr didn't return the new tab's pane");
  rememberTask(pane, taskForStart(req));
  // The shell has to be at its prompt before agent.start.
  await request("pane.wait_for_output", { pane_id: pane, source: "recent", match: { type: "regex", value: "(?m)[%$#❯>] ?$" }, timeout_ms: 15_000 }, 20_000).catch(() => {});
  const envLine = agentEnvLine(agentEnv());
  if (envLine) await read(["herdr", "pane", "run", pane, envLine]);
  await request("agent.start", { name, kind: "claude", pane_id: pane, args: ["--worktree", name, "--name", label], timeout_ms: 90_000 }, 100_000);
  // agent.start can return while Claude's startup hooks still run and before the agent is
  // registered; wait for it to be ready, and address it by pane.
  for (let i = 0; i < 60; i++) {
    const a = await request("agent.get", { target: pane }).catch(() => null);
    if (a?.agent?.interactive_ready) break;
    await Bun.sleep(1000);
  }
  // A config folder's first run, or a repo it has not seen, waits on a person. The answer is the user's, so the prompt does not go.
  const screen = await read(["herdr", "agent", "read", pane, "--source", "recent"]).catch(() => "");
  if (NEEDS_SETUP.test(screen)) {
    note({ item: req.item, trigger: req.kind }, "start-agent", label, "needs setup", { detail: { ...detail, pane } });
    throw new Error(`${label} needs setup: open its tab in herdr, answer Claude's first-run or folder trust question, then start again.`);
  }
  await request("agent.prompt", { target: pane, text: req.prompt });
  note({ item: req.item, trigger: req.kind }, "start-agent", label, "started", { detail: { ...detail, pane } });
  return { name, label, pane };
}
