// Park rules: a project's settings can park an issue when it reaches a status, and say what takes it
// off Parked. Pure: the board and the Finished page call these.
import type { Issue, ItemBranch } from "../shared/types";
import { inLastStage } from "../shared/branches";

/**
 * One rule. `finishWhen` takes "last-stage" (a branch reached the flow's last stage), "done" (the
 * issue's status is in a done category) and "status:<name>". `wakeAfterDays` returns a stuck issue to My turn.
 */
export type ParkRule = { status: string; note?: string; finishWhen?: string[]; wakeAfterDays?: number };
/** An issue a rule parked: since when, and the status of that rule. */
export type RulePark = { status: string; at: string };
export type ParkState =
  | { state: "none" }
  | { state: "parked"; rule: ParkRule; since: string; note: string }
  | { state: "woke"; rule: ParkRule; since: string; why: string }
  | { state: "finished"; rule: ParkRule; why: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The first finishWhen condition this issue meets, in words, or null. */
export function finishReason(rule: ParkRule, issue: Issue, branches: ItemBranch[]): string | null {
  for (const c of rule.finishWhen ?? []) {
    if (c === "last-stage" && branches.some(inLastStage)) {
      const stages = branches.find(inLastStage)!.stages;
      return `reached ${stages[stages.length - 1].name}`;
    }
    if (c === "done" && issue.category === "done") return `moved to ${issue.status}`;
    if (c.startsWith("status:") && same(issue.status, c.slice(7))) return `moved to ${issue.status}`;
  }
  return null;
}

/** Where a rule puts an issue. An issue that left the rule's status without a finish condition is back on the normal board. */
export function parkState(issue: Issue, branches: ItemBranch[], rules: ParkRule[], prior: RulePark | undefined, released: boolean, now = Date.now()): ParkState {
  const matching = rules.find((r) => same(r.status, issue.status));
  const rule = matching ?? (prior ? rules.find((r) => same(r.status, prior.status)) : undefined);
  if (!rule) return { state: "none" };
  const why = finishReason(rule, issue, branches);
  if (why) return { state: "finished", rule, why };
  if (!matching || released) return { state: "none" };
  const since = prior && same(prior.status, rule.status) ? prior.at : new Date(now).toISOString();
  if (rule.wakeAfterDays !== undefined && now - Date.parse(since) >= rule.wakeAfterDays * 86_400_000)
    return { state: "woke", rule, since, why: `Still ${issue.status} after ${rule.wakeAfterDays} days` };
  return { state: "parked", rule, since, note: rule.note ?? issue.status };
}
