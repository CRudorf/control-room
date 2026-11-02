// The step names a pickup takes (PickupSteps in src/server/suggestions.ts) and the reader's words for them.
const STEPNAME: Record<string, string> = { assign: "assign", move: "move to In Progress", agent: "start agent" };
export const title = "Suggestion pickup";
export const state = (v: any) => {
  if (v.where === "item") return "Work item on the board";
  if (v.where === "dismissed") return "Dismissed";
  if (v.where === "gone") return "In Progress, not the user's: in no list";
  if (v.where === "chosen") return "Chosen in the Start box";
  return v.pickedUp ? "Picked up, still in the list" : "Suggested";
};
export const group = (v: any) => (v.where === "item" ? "board" : v.where === "dismissed" ? "hidden" : "list");
export const colors = { list: "blue", hidden: "tan", board: "teal" };
export const step = (a: string, from: any, to: any) => {
  if (a === "Choose") return "the user chooses it";
  if (a === "Cancel") return "the user closes the Start box";
  if (a === "PickUp") {
    if (to.where === "item") return `pick up with ${STEPNAME.assign}, ${STEPNAME.move} or ${STEPNAME.agent} (${STEPNAME.move} only with ${STEPNAME.assign})`;
    if (to.where === "gone") return `pick up with ${STEPNAME.move} but not ${STEPNAME.assign} or ${STEPNAME.agent}`;
    return `pick up with ${STEPNAME.assign} only or no steps, or in dev without ${STEPNAME.agent}`;
  }
  if (a === "Refused") return `the server refuses: no step, or ${STEPNAME.move} without ${STEPNAME.assign}`;
  if (a === "Dismiss") return "the user dismisses it";
  if (a === "FingerprintChanges") return "status, assignee or priority changes";
  if (a === "Returns") return "it shows again";
  return null;
};
