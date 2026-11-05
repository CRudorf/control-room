import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentEnv, PROJECT, PROJECT_CONFIG, projectOwners } from "./repos";

const SETTINGS_PATH_FOR_SCRIPTS = join(homedir(), ".config", "control-room", "projects", `${PROJECT ?? "none"}.json`);

// The installed app (launchd) and a dev server keep separate state; see ADR 0005.
export const DEV = process.env.CR_DEV === "1";
export const POLL = !DEV || process.argv.includes("--poll");
export const PORT = Number(process.env.CR_PORT ?? (DEV ? 4778 : PROJECT_CONFIG.port ?? 4777));
// prs.py reads these to keep to this project.
process.env.CR_PROJECT_OWNERS = projectOwners().join(",");
process.env.CR_SETTINGS ??= SETTINGS_PATH_FOR_SCRIPTS;
// gh, git and claude run by this server use this project's logins.
Object.assign(process.env, agentEnv());

const support = join(homedir(), "Library", "Application Support");
// CR_STATE_DIR moves the state elsewhere; the test preload points it at a temp folder.
export const STATE_DIR = process.env.CR_STATE_DIR ?? join(support, DEV ? "control-room-dev" : PROJECT_CONFIG.stateDir ?? "control-room");
export const INSTALLED_STATE_DIR = process.env.CR_STATE_DIR ?? join(support, PROJECT_CONFIG.stateDir ?? "control-room");
export const DB_PATH = join(STATE_DIR, "state.db");
export const TOKEN_PATH = join(STATE_DIR, "token");

export const ROOT = resolve(import.meta.dir, "../..");
export const PRS = join(ROOT, "scripts", "prs.py");
export const JIRA = join(ROOT, "scripts", "jira.py");


mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
