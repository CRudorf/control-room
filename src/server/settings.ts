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

import type { ParkRule } from "./parkrules";

/** A project's delivery flow: the branches work moves through, last one means shipped, and the issue statuses of a person's acceptance step. */
export type Flow = { stages?: string[]; testingStatus?: string; approvedStatus?: string; who?: string; copySuffix?: string; parkRules?: ParkRule[] };

export type Settings = { flow?: Flow; aws?: boolean; awsMfaScript?: string; pickupHint?: string; org?: string; sentryOrg?: string; jiraProjects?: string[]; jiraSuggestSprints?: string[]; jiraSuggestLabel?: string; tracker?: { kind: "github"; repos: string[] } };

export const SETTINGS_PATH = process.env.CR_SETTINGS ?? join(homedir(), ".config", "control-room", "projects", `${PROJECT ?? "none"}.json`);

function read(): Settings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try { return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")); } catch { return {}; }
}

export const SETTINGS = read();

/** A GitHub repo's prefix in work item keys: CONTROLROOM-12 is issue 12 of owner/control-room. */
export const trackerPrefix = (repo: string) => repo.split("/").pop()!.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The key prefixes that name an issue here. Tracker setup adds to it while running. */
export const KNOWN_PROJECTS: string[] = [...(SETTINGS.jiraProjects ?? []), ...(SETTINGS.tracker?.repos ?? []).map(trackerPrefix)];
