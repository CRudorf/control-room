import { expect, test } from "bun:test";
import { recipePrompt, SCRIPT_RULE } from "./recipe";

const save = "bun run item K-1 --recipe";

test("with a recipe, an agent gets the steps and how to correct them", () => {
  const p = recipePrompt("o/gizmo", "1. cp .env.example .env\n2. make seed\n3. open http://localhost:8000", save);
  expect(p).toContain("How to run gizmo locally");
  expect(p).toContain("2. make seed");
  expect(p).toContain(`save the corrected steps with \`${save} "<all the steps>"\``);
  expect(p).toContain(SCRIPT_RULE);
});

test("without one, the agent that works it out saves it through the board", () => {
  expect(recipePrompt("o/gizmo", null, save)).toContain(`so the next session doesn't have to: \`${save} "<the steps>"\``);
});

test("a long recipe is cut, pointing at the rest", () => {
  expect(recipePrompt("o/gizmo", "x".repeat(3000), save, "/r.md")).toContain("… (the rest is in /r.md)");
});
