// Where repos are and which project owns each. Other modules ask here, and do not build a clone's path.
// The map of owners to projects is private: ~/.config/control-room/projects.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const REPOS_ROOT = process.env.CR_REPOS_ROOT ?? join(homedir(), "Projects");
export const PROJECTS_PATH = process.env.CR_PROJECTS_PATH ?? join(homedir(), ".config", "control-room", "projects.json");

export type ProjectMap = { owners: Record<string, string>; repos: Record<string, string> };

const shortName = (repo: string) => {
  const name = repo.split("/").pop() ?? "";
  if (!name || name === "." || name === "..") throw new Error(`bad repo name: ${repo}`);
  return name;
};

/** The clone of a repo, from its name or owner/name. The folder need not exist. */
export const repoPath = (repo: string) => join(REPOS_ROOT, shortName(repo));

/** A clone's path as a person writes it, for prompts. */
export const repoPathText = (repo: string) => repoPath(repo).replace(homedir(), "~");

/** The name of each clone. A linked worktree (.git is a file) is not a clone. */
export function localRepos(): string[] {
  if (!existsSync(REPOS_ROOT)) return [];
  return readdirSync(REPOS_ROOT).sort().filter((n) => { try { return statSync(join(REPOS_ROOT, n, ".git")).isDirectory(); } catch { return false; } });
}

/** The clone that holds a folder, or null when the folder is outside the repos root. */
export function repoOfDir(dir: string): string | null {
  if (!dir.startsWith(REPOS_ROOT + "/")) return null;
  const top = dir.slice(REPOS_ROOT.length + 1).split("/")[0];
  return top ? join(REPOS_ROOT, top) : null;
}

/** The owner in a git remote URL: https, ssh, or with a user in the URL. Null when it is not a recognized remote. */
export function ownerOfRemote(url: string): string | null {
  return url.trim().match(/^(?:[a-z+]+:\/\/(?:[^@/]+@)?[^/]+\/|[^@/]+@[^:/]+:)([^/]+)\/[^/]+$/i)?.[1] ?? null;
}

/**
 * The project of a repo: a name listed in `repos` wins, then the remote's owner. Null means no project
 * claims it, and the caller refuses. Nothing guesses, so an unknown repo cannot land in the wrong project.
 */
export function projectOf(name: string, remote: string | null, map: ProjectMap): string | null {
  const listed = map.repos[basename(name)];
  if (listed) return listed;
  const owner = remote ? ownerOfRemote(remote) : null;
  return owner ? map.owners[owner] ?? null : null;
}

/** The private map, or an empty map when there is no file: then every repo is refused. */
export function loadProjectMap(path = PROJECTS_PATH): ProjectMap {
  try { const m = JSON.parse(readFileSync(path, "utf8")); return { owners: m.owners ?? {}, repos: m.repos ?? {} }; }
  catch { return { owners: {}, repos: {} }; }
}

export type ProjectConfig = { port?: number; stateDir?: string; claudeConfigDir?: string; ghConfigDir?: string; gitName?: string; gitEmail?: string };

/** The project this control room serves: CR_PROJECT, else the private map's default. Null fails closed: no repo belongs. */
export const currentProject = (path = PROJECTS_PATH): string | null => {
  if (process.env.CR_PROJECT) return process.env.CR_PROJECT;
  try { return JSON.parse(readFileSync(path, "utf8")).default ?? null; } catch { return null; }
};
export const PROJECT = currentProject();
export const PROJECT_CONFIG: ProjectConfig = (() => {
  try { return JSON.parse(readFileSync(PROJECTS_PATH, "utf8")).projects?.[PROJECT ?? ""] ?? {}; } catch { return {}; }
})();

const expand = (p: string) => p.replace(/^~(?=\/)/, homedir());

/** This project's Claude config folder. Skills, memory, transcripts and the login live there. */
export const CLAUDE_DIR = expand(process.env.CLAUDE_CONFIG_DIR ?? PROJECT_CONFIG.claudeConfigDir ?? join(homedir(), ".claude"));

/**
 * What an agent of this project runs with: its Claude config, its gh login, git pushes through that
 * login and not the machine's shared keychain, and its commit identity. A project with none of these keeps the machine's defaults.
 */
export function agentEnv(c: ProjectConfig = PROJECT_CONFIG): Record<string, string> {
  const env: Record<string, string> = PROJECT ? { CR_PROJECT: PROJECT } : {};
  if (c.claudeConfigDir) env.CLAUDE_CONFIG_DIR = expand(c.claudeConfigDir);
  if (c.ghConfigDir) Object.assign(env, { GH_CONFIG_DIR: expand(c.ghConfigDir), GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "", GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: "!gh auth git-credential" });
  if (c.gitName) Object.assign(env, { GIT_AUTHOR_NAME: c.gitName, GIT_COMMITTER_NAME: c.gitName });
  if (c.gitEmail) Object.assign(env, { GIT_AUTHOR_EMAIL: c.gitEmail, GIT_COMMITTER_EMAIL: c.gitEmail });
  return env;
}

/** The shell line that sets an agent's environment, each value quoted. Empty when there is nothing to set. */
export const agentEnvLine = (env: Record<string, string>) => {
  const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  const parts = Object.entries(env).map(([k, v]) => `${k}=${q(v)}`);
  return parts.length ? `export ${parts.join(" ")}` : "";
};

/** True when this project or this repo has a tuning for a skill. */
export const tuned = (repo: string, skill: string) => {
  const dir = join(homedir(), ".config", "control-room", "projects", PROJECT ?? "none");
  return [join(dir, "tuning", `${skill}.md`), join(dir, "repos", shortName(repo), `${skill}.md`), join(repoPath(repo), ".control-room", `${skill}.md`)].some((f) => existsSync(f));
};

/** This project's GitHub owners, for prs.py. */
export const projectOwners = (map = loadProjectMap()) => Object.entries(map.owners).filter(([, p]) => p === PROJECT).map(([o]) => o);

const remoteCache = new Map<string, string | null>();
function remoteOfClone(clone: string): string | null {
  if (remoteCache.has(clone)) return remoteCache.get(clone)!;
  let url: string | null = null;
  try {
    // A linked worktree's .git is a file that points into the clone it came from.
    let git = join(clone, ".git");
    if (statSync(git).isFile()) git = readFileSync(git, "utf8").match(/gitdir: (.+)/)![1].trim().replace(/\/worktrees\/[^/]+$/, "");
    url = readFileSync(join(git, "config"), "utf8").match(/\[remote "origin"\][^[]*?url = (.+)/)?.[1]?.trim() ?? null;
  } catch {}
  remoteCache.set(clone, url);
  return url;
}

/** True when a repo belongs to this project. owner/name goes by its owner unless it is listed; a bare name goes by its clone's remote. */
export function repoInProject(repo: string, map = loadProjectMap()): boolean {
  if (!PROJECT) return false;
  const name = shortName(repo);
  const remote = repo.includes("/") ? `https://github.com/${repo}` : remoteOfClone(repoPath(name));
  return projectOf(name, remote, map) === PROJECT;
}

/** True when a folder is in a repo of this project. A folder outside every repo belongs to none. */
export function dirInProject(dir: string, map = loadProjectMap()): boolean {
  const top = repoOfDir(dir);
  return !!top && repoInProject(basename(top), map);
}

/** The clones of this project. */
export const projectRepos = () => localRepos().filter((n) => repoInProject(n));

/** Stops work on a repo of another project, or of none. */
export function assertInProject(repo: string) {
  if (!repoInProject(repo)) throw new Error(`${repo} is not in this project (${PROJECT ?? "none"}). See ~/.config/control-room/projects.json.`);
}
