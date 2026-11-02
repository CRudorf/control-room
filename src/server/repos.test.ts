import { expect, test } from "bun:test";
import { agentEnv, agentEnvLine, assertInProject, dirInProject, repoInProject, ownerOfRemote, projectOf, repoOfDir, repoPath, REPOS_ROOT } from "./repos";

test("the owner comes from each form of remote", () => {
  expect(ownerOfRemote("https://github.com/acme/app.git\n")).toBe("acme");
  expect(ownerOfRemote("https://me@github.com/acme/app.git")).toBe("acme");
  expect(ownerOfRemote("git@github.com:acme/app.git")).toBe("acme");
  expect(ownerOfRemote("ssh://git@github.com/acme/app.git")).toBe("acme");
  expect(ownerOfRemote("/local/path")).toBeNull();
});
test("a project comes from the list, then the owner, and an unknown repo has none", () => {
  const map = { owners: { acme: "work", me: "home" }, repos: { scratch: "home" } };
  expect(projectOf("app", "https://github.com/acme/app", map)).toBe("work");
  expect(projectOf("scratch", null, map)).toBe("home");
  expect(projectOf("scratch", "https://github.com/acme/scratch", map)).toBe("home");
  expect(projectOf("other", "https://github.com/stranger/other", map)).toBeNull();
  expect(projectOf("other", null, map)).toBeNull();
});
test("a path stays inside the repos root", () => {
  expect(repoPath("acme/app")).toBe(`${REPOS_ROOT}/app`);
  expect(() => repoPath("acme/..")).toThrow();
  expect(repoOfDir(`${REPOS_ROOT}/app/.claude/worktrees/x`)).toBe(`${REPOS_ROOT}/app`);
  expect(repoOfDir("/elsewhere/app")).toBeNull();
});

test("a repo of another owner is refused, and an unknown folder belongs to no project", () => {
  const map = { owners: { acme: "test", other: "elsewhere" }, repos: {} };
  expect(repoInProject("acme/app", map)).toBe(true);
  expect(repoInProject("other/app", map)).toBe(false);
  expect(repoInProject("stranger/app", map)).toBe(false);
  expect(() => assertInProject("other/app")).toThrow("not in this project");
  expect(dirInProject("/elsewhere/app", map)).toBe(false);
});

test("an agent's environment holds only what its project sets, quoted for the shell", () => {
  expect(agentEnv({})).toEqual({ CR_PROJECT: "test" });
  const env = agentEnv({ claudeConfigDir: "/c", ghConfigDir: "/g", gitName: "A", gitEmail: "a@b" });
  expect(env).toMatchObject({ CLAUDE_CONFIG_DIR: "/c", GH_CONFIG_DIR: "/g", GIT_AUTHOR_EMAIL: "a@b", GIT_CONFIG_VALUE_1: "!gh auth git-credential" });
  expect(agentEnvLine({})).toBe("");
  expect(agentEnvLine({ A: "it's" })).toBe(`export A='it'\\''s'`);
});
