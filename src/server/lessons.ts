// Lessons: what would have caught a break the user confirmed, per repo. Self-reviews of that repo check
// each PR against them, and the weekly loop sees them, so a kind of break gets caught once.
// Each cites the files the break was in. One unused for 90 days drops out of self-reviews; a later
// break through the same files brings it back.
import { load, save } from "./db";

export type Lesson = {
  repo: string; ref: string; text: string; at: string;
  /** Files the break was in: where later commits rewrote the PR's lines, else the PR's own. */
  files?: string[];
  /** Last time a later break went through its files. */
  seen?: string;
  /** The agent started to make it stick in the repo: a test, lint rule, hook or rules file. */
  stick?: { agent: string; at: string };
};

/** Self-review and its replays both check this: a test can pass because someone weakened it. */
export const TESTS_RULE = "If the diff changes a test along with the code it tests, check the test wasn't weakened or special-cased to pass. Run the old test against the new code. Make it a finding if it fails.";

export const SHELF_MS = 90 * 24 * 3600_000;

let lessons: Lesson[] = load<Lesson[]>("lessons") ?? [];

export const allLessons = () => lessons;

/** Adds a lesson; older lessons of that repo sharing a file with it are seen again. */
export function withLesson(all: Lesson[], l: Lesson): Lesson[] {
  const name = l.repo.split("/").pop();
  const files = new Set(l.files ?? []);
  return [...all.filter((x) => x.ref !== l.ref).map((x) =>
    x.repo.split("/").pop() === name && x.files?.some((f) => files.has(f)) ? { ...x, seen: l.at } : x), l];
}

export function addLesson(repo: string, ref: string, text: string, files: string[] = []) {
  lessons = withLesson(lessons, { repo, ref, text, at: new Date().toISOString(), ...(files.length ? { files } : {}) });
  save("lessons", lessons);
}

export function markStick(ref: string, agent: string) {
  lessons = lessons.map((l) => l.ref === ref ? { ...l, stick: { agent, at: new Date().toISOString() } } : l);
  save("lessons", lessons);
}

/** The prompt for an agent that turns a lesson into something the repo enforces, in a draft PR. */
export function stickPrompt(l: Lesson, url: string): string {
  return `My merged PR ${l.ref} (${url}) broke something. The lesson: "${l.text}"${l.files?.length ? `, in ${l.files.join(", ")}` : ""}.

Make this repo enforce it, so whoever writes the next change here, an agent or a person, can't repeat it. A reminder in prose isn't enough. Pick the strongest form that fits:
1. a test or lint rule that fails on the mistake
2. a Claude Code hook (PreToolUse or Stop) in the repo's .claude/settings.json that blocks it
3. a path-scoped rules file, .claude/rules/<topic>.md with \`paths:\` frontmatter, that loads when those files are touched
Read the repo's tests, lint config and .claude first and match them. Show it works by running it: it fails on the mistake (the PR's code as merged, or a minimal reproduction) and passes on main. Note the commands and exit codes.

Then branch from the latest main as \`lesson/<short-slug>\`, commit, push, and open a draft PR whose body says what it enforces and why, linking ${url}. Never merge. Tell me the PR link.`;
}

export function removeLesson(ref: string) {
  lessons = lessons.filter((l) => l.ref !== ref);
  save("lessons", lessons);
}

/** The newest current lessons for a repo, owner/name or just the name: none past its shelf life. */
export function current(all: Lesson[], repo: string, n = 8, now = Date.now()): Lesson[] {
  const name = repo.split("/").pop();
  return all.filter((l) => l.repo.split("/").pop() === name && now - Date.parse(l.seen ?? l.at) < SHELF_MS).slice(-n);
}

/** The next lesson to make stick: the newest current one with no agent on it yet, whose PR is still watched. */
export function dueStick<W extends { ref: string }>(all: Lesson[], watched: W[], now = Date.now()): { lesson: Lesson; watched: W } | null {
  for (const l of [...all].reverse()) {
    const w = watched.find((x) => x.ref === l.ref);
    if (w && !l.stick && now - Date.parse(l.seen ?? l.at) < SHELF_MS) return { lesson: l, watched: w };
  }
  return null;
}

/** Lessons whose cited files are all gone. `exists` answers null when it can't tell, and that keeps the lesson. */
export const goneLessons = (all: Lesson[], exists: (repo: string, file: string) => boolean | null) =>
  all.filter((l) => l.files?.length && l.files.every((f) => exists(l.repo, f) === false));

export const lessonsFor = (repo: string, n = 8) => current(lessons, repo, n);
