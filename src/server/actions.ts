// Writes on the user's PRs (Action flows). Teammate-visible ones arrive here already confirmed in a
// preview sheet. Every write leaves an action record; a dev server records and sends nothing.
import type { PrRow } from "../shared/types";
import { PRS } from "./config";
import { db } from "./db";
import { read as run, write as act } from "./runner";

export type Reply = { reply_to: number; thread_id: string; body: string; resolve: boolean; who: string };

type Ctx = { item: string; trigger: string };

const ref = (p: PrRow) => `${p.repo}#${p.number}`;

/** Reruns the failed GitHub Actions jobs on the PR's head commit. */
export function rerunCi(ctx: Ctx, p: PrRow) {
  return act(ctx, "rerun", `${ref(p)}@${p.head}`, async () => {
    const runs = JSON.parse(await run(["gh", "run", "list", "-R", p.repo, "--commit", p.head, "--json", "databaseId,conclusion,name", "-L", "50"])) as { databaseId: number; conclusion: string; name: string }[];
    const failed = runs.filter((r) => ["failure", "timed_out", "cancelled", "startup_failure"].includes(r.conclusion));
    if (!failed.length) throw new Error("no failed GitHub Actions runs on this commit; the failing check comes from another app");
    for (const r of failed) await run(["gh", "run", "rerun", String(r.databaseId), "--failed", "-R", p.repo]);
    return `reran ${failed.map((r) => r.name).join(", ")}`;
  });
}

/** Merges the base into the PR's branch on GitHub; refuses if someone pushed meanwhile. */
export function updateBranch(ctx: Ctx, p: PrRow) {
  return act(ctx, "update-branch", ref(p), () =>
    run(["gh", "api", "-X", "PUT", `repos/${p.repo}/pulls/${p.number}/update-branch`, "-f", `expected_head_sha=${p.head}`]).then(() => "merged base"));
}

/** Merges a stacked PR's parent branch into it on GitHub: a merge commit, never a rewrite. */
export function restack(ctx: Ctx, p: PrRow, parentBranch: string, parentRef: string) {
  return act(ctx, "restack", `${ref(p)} ← ${parentRef}`, () =>
    run(["gh", "api", "-X", "POST", `repos/${p.repo}/merges`, "-f", `base=${p.branch}`, "-f", `head=${parentBranch}`,
      "-f", `commit_message=Merge #${parentRef.split("#")[1]}'s latest (${parentBranch}) into ${p.branch}`])
      .then(() => "merged parent"));
}

/** prs.py's `addressed` mark: the reviewer knows; the ball is theirs. */
export function markAddressed(ctx: Ctx, p: PrRow, note: string) {
  return act(ctx, "mark-addressed", ref(p), () => run(["python3", PRS, "mark", ref(p), "addressed", note]).then(() => "marked"));
}

/** Asks reviewers again (notifies them), then marks the PR addressed. */
export async function rerequest(ctx: Ctx, p: PrRow, reviewers: string[]) {
  const r = await act(ctx, "rerequest", `${ref(p)} → ${reviewers.join(", ")}`, () =>
    run(["gh", "api", "-X", "POST", `repos/${p.repo}/pulls/${p.number}/requested_reviewers`, "--input", "-"], { input: JSON.stringify({ reviewers }) }).then(() => "requested"));
  await act(ctx, "mark-addressed", ref(p), () => run(["python3", PRS, "mark", ref(p), "addressed", "re-requested from the control room"]).then(() => "marked"));
  return r;
}

/** Posts replies in their threads (notifies the authors), resolving the ones asked for. */
export async function postReplies(ctx: Ctx, p: PrRow, replies: Reply[]) {
  const results: string[] = [];
  for (const r of replies) {
    results.push(await act(ctx, "reply", `${ref(p)} → ${r.who}${r.resolve ? " (resolve)" : ""}`, async () => {
      await run(["gh", "api", `repos/${p.repo}/pulls/${p.number}/comments/${r.reply_to}/replies`, "-f", `body=${r.body}`]);
      if (r.resolve)
        await run(["gh", "api", "graphql", "-f", `query=mutation { resolveReviewThread(input: {threadId: "${r.thread_id}"}) { thread { isResolved } } }`]);
      return r.resolve ? "replied and resolved" : "replied";
    }, { drafted: r.body, detail: r }));
  }
  await act(ctx, "mark-addressed", ref(p), () => run(["python3", PRS, "mark", ref(p), "addressed", "replied from the control room"]).then(() => "marked"));
  return results;
}

/** Resolves threads without replying. Visible on the PR but notifies nobody, so no sheet. */
export async function resolveThreads(ctx: Ctx, p: PrRow, threads: { thread_id: string; who: string }[]) {
  const out: string[] = [];
  for (const t of threads)
    out.push(await act(ctx, "resolve", `${ref(p)} → ${t.who}`, () =>
      run(["gh", "api", "graphql", "-f", `query=mutation { resolveReviewThread(input: {threadId: "${t.thread_id}"}) { thread { isResolved } } }`]).then(() => "resolved")));
  return `${out.length} resolved`;
}

/** PR head commits whose failed checks were already rerun: a second failure goes to an agent. */
export function reranHeads(): Set<string> {
  return new Set(db.query<{ sent: string }, []>("SELECT sent FROM action_records WHERE action = 'rerun' AND dry_run = 0 AND result NOT LIKE 'failed%'").all().map((r) => r.sent));
}
