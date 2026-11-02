// A person's acceptance step, when the project's flow names one: where an issue of the user's stands with product, and the lane that puts it
// in. Pure: the board calls these.
import type { ItemBranch, Issue, AcceptanceFacts, Lane, PrimaryAction } from "../shared/types";
import { branchLine, inLastStage } from "../shared/branches";
import { SETTINGS } from "./settings";

const FLOW = SETTINGS.flow ?? {};
const WHO = FLOW.who ?? "The reviewer";
const same = (a: string, b?: string) => !!b && a.toLowerCase() === b.toLowerCase();
const FIRST = FLOW.stages?.[0] ?? "the first stage";
const LAST = FLOW.stages?.[FLOW.stages.length - 1] ?? "the last stage";

export type Outcome = "testing" | "question" | "failed" | "approved";
const at = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);

/** A question is open while someone else's comment is newer than the user's last one and the move into Testing. */
export function questionOpen(t: AcceptanceFacts): boolean {
  return !!t.questionSince && at(t.questionSince) > Math.max(at(t.lastMyCommentAt), at(t.enteredAt));
}

/**
 * A fail holds until the issue enters Testing again after it. The user's comments never clear it:
 * only a move into Testing newer than the fail does.
 */
export function failOpen(t: AcceptanceFacts | undefined): boolean {
  return !!t?.failed && !(at(t.enteredAt) > at(t.failed.at));
}

/** Where product has the issue, or null when it is not in product testing. */
export function outcomeOf(issue: Issue): Outcome | null {
  if (!issue.mine) return null;
  if (same(issue.status, FLOW.approvedStatus)) return "approved";
  if (failOpen(issue.testing)) return "failed";
  if (same(issue.status, FLOW.testingStatus)) return issue.testing && questionOpen(issue.testing) ? "question" : "testing";
  return null;
}

/** Whether an approved issue's work reached the last stage: a branch named with its key is in it. */
export const reachedLast = (bs: ItemBranch[]) => bs.some(inLastStage);

export type AcceptanceLane = { lane: Lane; why: string; urgency: number; primary: PrimaryAction; note?: string; outcome: Outcome; finished?: boolean };

const quote = (s: string | undefined | null) => (s ? ` · “${s.length > 140 ? `${s.slice(0, 139)}…` : s}”` : "");

/** The prompt context for an agent that fixes a failed issue. */
export function failContext(issue: Issue): string {
  const f = issue.testing!.failed!;
  return `${WHO} failed this in testing on ${FIRST}: ${f.by ?? "someone"} moved it from ${f.from} to ${f.to} at ${f.at}.${f.comment ? ` Their latest comment: "${f.comment.firstLine}"` : ""} Read the issue's comments first, fix what they found, and say on the issue what changed.`;
}

/** The prompt context for an agent that opens the last stage's PR of an approved issue. */
export function releaseContext(issue: Issue, branches: ItemBranch[]): string {
  const names = [...new Set(branches.filter((b) => !inLastStage(b)).map((b) => b.name))].join(", ");
  return `${WHO} approved this on ${FIRST} and moved it to ${issue.status}. Do not change code. Open a PR from the feature branch (${names}) against ${LAST}, not ${FIRST}. The base is ${LAST} because the approval is done. Reuse the body of the branch's staging PR. Show me the PR link.`;
}

/** The lane, why and primary action for an issue in product testing, or null when it isn't. */
export function acceptanceLane(issue: Issue, branches: ItemBranch[], mergedPrs: string[]): AcceptanceLane | null {
  const o = outcomeOf(issue);
  if (!o) return null;
  const t = issue.testing;
  const open = { label: `Open ${issue.key}`, url: issue.url };
  if (o === "failed") {
    const f = t!.failed!;
    return { outcome: o, lane: "mine", urgency: 3, why: `Failed testing (by ${f.by ?? "someone"})${quote(f.comment?.firstLine)}`,
      primary: { label: `Fix ${issue.key} with an agent`, start: issue.key, startContext: failContext(issue) } };
  }
  if (o === "question")
    return { outcome: o, lane: "mine", urgency: 2, why: `${WHO} asked a question${quote(t?.lastComment?.firstLine)}`, primary: { label: `Answer ${WHO.toLowerCase()} on ${issue.key}`, url: issue.url } };
  if (o === "testing") {
    const prs = mergedPrs.length ? ` · merged ${mergedPrs.join(", ")}` : "";
    return { outcome: o, lane: "waiting", urgency: 0, why: `${WHO} testing on ${FIRST}${prs}`, primary: open };
  }
  if (reachedLast(branches)) return { outcome: o, lane: "parked", urgency: 0, why: `Approved, on ${LAST}`, primary: open, finished: true };
  // Approved: the feature branch now goes to the last stage, and that PR is ours to open.
  if (branches.length) return { outcome: o, lane: "mine", urgency: 2, why: `Approved by ${WHO.toLowerCase()}: PR it to ${LAST} · ${branchLine(branches)}`,
    primary: { label: `PR ${issue.key} to ${LAST}`, start: issue.key, startContext: releaseContext(issue, branches) } };
  const note = `Approved, waiting for ${LAST} · no ${issue.key} branch found`;
  return { outcome: o, lane: "parked", urgency: 0, why: `“${note}”`, primary: open, note };
}
