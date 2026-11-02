// `bun run item`: one work item as short plain text, for agents to read in one go.
import type { Lane, PrRow, WorkItem } from "../shared/types";
import type { Lesson } from "./lessons";

const LANE: Record<Lane, string> = { mine: "my turn", waiting: "waiting on others", asked: "asked of me", parked: "parked" };
const short = (repo: string) => repo.split("/").pop()!;
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** About 3,000 tokens. */
export const MAX_CHARS = 11_000;

/** The work item a key, id, PR ref (owner/repo#N, repo#N) or PR URL names. */
export function findItem(items: WorkItem[], q: string): WorkItem | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const hit = items.find((it) => it.id === s || it.key.toLowerCase() === s);
  if (hit) return hit;
  const ref = s.match(/([\w.-]+)\/pull\/(\d+)/) ?? s.match(/([\w.-]+)#(\d+)$/);
  if (!ref) return null;
  return items.find((it) => it.prs.some((p) => short(p.repo).toLowerCase() === ref[1] && p.number === Number(ref[2]))) ?? null;
}

function prLines(p: PrRow): string[] {
  const failing = p.checks === "failure" || p.checks === "error";
  const review = p.role === "requested" ? "review asked of the user" : p.review_decision?.toLowerCase().replace("_", " ") ?? "no review decision";
  const waiting = p.pending_reviewers.length ? `, waiting on ${p.pending_reviewers.join(", ")}` : "";
  const out = [
    `${short(p.repo)}#${p.number} "${clip(p.title, 90)}" ${p.url}`,
    `  ${p.draft ? "draft, " : ""}${p.state && p.state !== "draft" ? `${p.state}, ` : ""}CI ${p.checks || "none"}, ${review}${waiting}, merge ${p.can_merge}`,
    `  branch ${p.branch} into ${p.base}${p.merge_state === "DIRTY" ? ", conflicts" : ""}${p.behind_by ? `, ${p.behind_by} behind` : ""}${p.stack ? `, stacked on ${p.stack.on}` : ""}`,
  ];
  if (failing) out.push(`  failing checks: gh pr checks ${p.number} -R ${p.repo}`);
  const fb = (p.feedback ?? []).map((f) => `${f.who}${f.bot ? " (bot)" : ""}${f.where ? ` at ${f.where}` : ""}: ${clip(f.body, 200)}`);
  const threads = (p.threads ?? []).map((t) => `${t.who}${t.bot ? " (bot)" : ""}${t.where ? ` at ${t.where}` : ""}${t.outdated ? " (outdated)" : ""}: ${clip(t.body, 200)}`);
  const open = [...fb, ...threads];
  if (open.length) {
    out.push(`  open feedback (${open.length}):`);
    out.push(...open.slice(0, 8).map((l) => `    - ${l}`));
    if (open.length > 8) out.push(`    + ${open.length - 8} more on the PR`);
  }
  return out;
}

/** The plain-text view: key and lane, PRs with their status and open feedback, the loop, lessons, agents. */
export function formatItem(it: WorkItem, lessons: Lesson[]): string {
  const out = [`${it.key} (${it.title ? clip(it.title, 100) : it.keyKind}): ${LANE[it.lane]}, ${it.why}`];
  if (it.jira) out.push(`Jira: ${it.jira.status} ${it.jira.url}`);
  if (it.park) out.push(`Parked: ${clip(it.park.note, 160)}${it.park.until ? ` until ${it.park.until}` : ""}`);
  if (it.hold) out.push(`Waiting on author: ${clip(it.hold.note, 160)}`);
  for (const g of it.dependencies ?? []) out.push(`Blocked: ${g.ref} waits on ${g.on ?? g.step}`);
  out.push("", it.prs.length ? `PRs (${it.prs.length}):` : "No PRs yet.");
  for (const p of it.prs) out.push(...prLines(p));
  for (const l of it.loop ?? []) if (l.state !== "off") out.push(`Review loop on ${l.ref}: ${l.state}${l.why && l.why !== `loop ${l.state}` ? `, ${clip(l.why, 160)}` : ""}`);
  if (lessons.length) {
    out.push("", `Lessons for ${it.repos.join(", ")} (check the change against these):`);
    out.push(...lessons.map((l) => `- ${clip(l.text, 240)} (${l.ref})`));
  }
  out.push("", it.agents.length ? `Agents (${it.agents.length}):` : "No agents on it.");
  out.push(...it.agents.map((a) => `- ${a.name ?? a.label}: ${a.status}${a.branch ? ` on ${a.branch}` : ""} in ${a.cwd}`));
  const text = out.join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… cut short; open the PRs for the rest` : text;
}
