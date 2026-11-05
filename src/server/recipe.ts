// How to run a repo locally: env, seed data, the URL to open, and any auth to do first. Each session used
// to work this out again and hand the user commands to paste; now the steps live in the project's tuning
// (~/.config/control-room/projects/<project>/repos/<repo>/run.md, private, or the repo's
// .control-room/run.md), every agent on the repo is given them, and an agent that had to work them out saves
// them through the board (`bun run item <key> --recipe`) for the next one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROJECT, repoPath } from "./repos";

const short = (repo: string) => repo.split("/").pop()!;
/** Where a new recipe goes: the private tuning, not the repo. */
export const recipePath = (repo: string) => join(homedir(), ".config", "control-room", "projects", PROJECT ?? "none", "repos", short(repo), "run.md");
const paths = (repo: string) => [recipePath(repo), join(repoPath(short(repo)), ".control-room", "run.md")];

export function recipeFor(repo: string): string | null {
  const f = paths(repo).find((p) => existsSync(p));
  if (!f) return null;
  try { return readFileSync(f, "utf8").trim() || null; } catch { return null; }
}

/** Saves a repo's recipe, as an agent sent it through the board (agents can't write the tuning folder). */
export function saveRecipe(repo: string, text: string): string {
  const t = text.trim();
  if (t.length < 20) throw new Error("a recipe needs the actual steps");
  if (t.length > 8000) throw new Error("keep a recipe under 8,000 characters");
  const f = recipePath(repo);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${t}\n`);
  return f;
}

/** Commands the user must run: one rule for every agent, from the user's own instructions. */
export const SCRIPT_RULE = "A command I have to run myself (VPN, prod access, interactive auth) goes in a script at ~/s/<name>.sh: executable (chmod +x), bash, checked with `bash -n`, writing its output to a file you then read, so I never paste output back. Give me `bash ~/s/<name>.sh` and say what output to expect.";

/** What a prompt says about running the repo. Pure. */
export function recipePrompt(repo: string, recipe: string | null, save: string, path = recipePath(repo)): string {
  const clip = recipe && recipe.length > 2000 ? `${recipe.slice(0, 2000)}\n… (the rest is in ${path})` : recipe;
  const how = clip
    ? `How to run ${short(repo)} locally (env, seed, URL, auth first), from the last session that worked it out:\n${clip}\nIf a step is wrong or missing, save the corrected steps with \`${save} "<all the steps>"\`.`
    : `If you work out how to run ${short(repo)} locally (env vars, seed data, the URL to open, auth to do first), save the steps so the next session doesn't have to: \`${save} "<the steps>"\`.`;
  return `\n\n${how}\n${SCRIPT_RULE}`;
}
