// The subline for a work item's branches (GLOSSARY: Branch). Shared by the board and its tests.
import type { ItemBranch } from "./types";

/** True when a branch is in the last stage of its project's flow. */
export const inLastStage = (b: ItemBranch) => !!b.stages?.length && b.stages[b.stages.length - 1].in === true;

/** Where one branch has got to, such as "on test, not on prod". With no stage to report, "pushed". */
export function branchWhere(b: ItemBranch): string {
  const st = b.stages ?? [], known = st.filter((x) => x.in !== null), last = st[st.length - 1];
  if (!known.length) return "pushed";
  const reached = [...st].reverse().find((x) => x.in === true);
  if (reached === last) return `on ${last.name}`;
  if (reached) return last.in === null ? `on ${reached.name}` : `on ${reached.name}, not on ${last.name}`;
  return `not on ${known[0].name}`;
}

const rank = (b: ItemBranch) => (b.stages ?? []).filter((x) => x.in === true).length;

/** "ABC-12 · on test, not on prod": the branch that got furthest, then the newest, "+N" for the rest. Empty when there are none. */
export function branchLine(bs: ItemBranch[] | undefined): string {
  if (!bs?.length) return "";
  const [b, ...rest] = [...bs].sort((x, y) => rank(y) - rank(x) || y.lastCommitAt.localeCompare(x.lastCommitAt));
  return `${b.name} · ${branchWhere(b)}${rest.length ? ` +${rest.length}` : ""}`;
}

/**
 * The separate lines of work on a work item. A branch and its copy for an earlier stage are one line, if the project names that suffix.
 * A session's scratch branch (worktree-*) and the base branches are not work.
 */
export function workLines(names: (string | null | undefined)[], flow: { stages?: string[]; copySuffix?: string } = {}): string[] {
  const bases = new Set(["HEAD", "main", "master", "develop", ...(flow.stages ?? [])]);
  const real = [...new Set(names.filter((n): n is string => !!n && !bases.has(n) && !n.startsWith("worktree-")))];
  const suffix = flow.copySuffix;
  return [...new Set(real.map((n) => (suffix && n.endsWith(suffix) ? n.slice(0, -suffix.length) : n)))];
}
