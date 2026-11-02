// Where this project's work lives, from ~/.config/control-room/projects/<project>.json, so none of it is in the repo:
//   {"org": "acme", "sentryOrg": "acme", "jiraProjects": ["ABC", "XYZ"],
//    "jiraSuggestSprints": ["Next up"], "jiraSuggestLabel": "cleanup"}
// jiraSuggestSprints are the container sprints Suggestions read after the active sprint
// (none by default); jiraSuggestLabel marks a backlog label to suggest (none by default).
// prs.py and review-handoff.sh read the same file. Every key is optional.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROJECT } from "./repos";

/** A project's delivery flow: the branches work moves through, last one means shipped, and the issue statuses of a person's acceptance step. */
export type Flow = { stages?: string[]; testingStatus?: string; approvedStatus?: string; who?: string; copySuffix?: string };

export type Settings = { flow?: Flow; aws?: boolean; awsMfaScript?: string; pickupHint?: string; org?: string; sentryOrg?: string; jiraProjects?: string[]; jiraSuggestSprints?: string[]; jiraSuggestLabel?: string };

export const SETTINGS_PATH = process.env.CR_SETTINGS ?? join(homedir(), ".config", "control-room", "projects", `${PROJECT ?? "none"}.json`);

function read(): Settings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try { return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")); } catch { return {}; }
}

export const SETTINGS = read();
