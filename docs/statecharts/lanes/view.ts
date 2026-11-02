// The lane the board shows, as the spec's Lane operator computes it.
const lane = (v: any): string => {
  if (v.kind === "own" && v.prs === "done" && v.agent === "none") return "finished";
  if (v.parked) return "parked";
  if (v.kind === "review") return v.review === "asked" ? "asked" : v.review === "author" ? "waiting" : "finished";
  if (v.agent === "waiting") return "mine";
  if (v.blocked || v.agent === "working") return "waiting";
  return v.ball === "user" ? "mine" : "waiting";
};
export const title = "Work item lanes: whose turn it is";
export const state = (v: any) => {
  if (v.groupedInto === "none") return "New on the board";
  const l = lane(v);
  if (l === "finished") return v.kind === "review" ? "Review done: off the board" : "Finished";
  if (l === "parked") return v.agent === "waiting" ? "Parked, agent waiting for input" : "Parked";
  if (l === "asked") return "Asked of me";
  if (v.kind === "review") return "Waiting on others: on the author";
  if (l === "mine") return v.agent === "waiting" ? "My turn: agent waiting for input" : "My turn";
  return v.blocked ? "Waiting on others: blocked" : "Waiting on others";
};
export const group = (v: any) => (v.groupedInto === "none" ? "new" : lane(v));
export const colors = { new: "tan", mine: "yellow", waiting: "teal", asked: "orange", parked: "purple", finished: "blue" };
const STEP: Record<string, string> = {
  Group: "it is grouped by its key",
  PersonActs: "a person gives feedback or acts",
  PersonWakes: "a person acts or the until-date passes", DatePasses: "a person acts or the until-date passes",
  UserPushes: "the user pushes a fix",
  SetDependency: "the user dependencies the PR", DependencyOpens: "the dependency opens",
  StartAgent: "an agent starts", AgentAsks: "the agent asks for input", UserAnswers: "the user answers the agent",
  AgentEnds: "the agent ends",
  Park: "the user parks it",
  AllMergedOrClosed: "all its PRs are merged or closed",
  HandBackToAuthor: "the user waits on the author", UserReviews: "the user reviews it",
};
// Parking from, and waking into, a blocked PR or a review handed back repeats what the other arrows show.
const side = (v: any) => v.blocked || v.review === "author";
export const step = (a: string, from: any, to: any) =>
  (a === "Park" && side(from)) || ((a === "PersonWakes" || a === "DatePasses") && side(to)) ? null : STEP[a] ?? null;
