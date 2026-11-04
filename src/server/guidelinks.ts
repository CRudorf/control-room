// Code a field guide names, linked to where it lives on GitHub. A guide's `file.ts:12-20`, `someFunction` and
// `path/to/file.kt` spans become links to that code at the commit the guide was written for. The PR's own repo
// is looked up first; a file only another local clone has links there, at that clone's origin HEAD.
// The links for a guide are worked out once per commit and kept beside it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localRepos, ownerOfRemote, repoPath, REPOS_ROOT } from "./repos";
import { read } from "./runner";

/** A code span as the guide writes it: a file (with lines) or a name. */
export type Target = { kind: "file"; path: string; from: number | null; to: number | null } | { kind: "name"; name: string };

const FILE = /^((?:[\w.@-]+\/)*[\w.@-]+\.[a-z]{1,6})(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/i;
const NAME = /^([A-Za-z_$][\w$]{3,})(?:\(\))?$/;

/** What a code span points at, or null for anything that isn't a file or a single name. */
export function targetOf(code: string): Target | null {
  // "api/.../WidgetHandler.kt:116" names the file by its end.
  const c = code.trim().replace(/^.*(?:\.\.\.|…)\//, "");
  const f = c.match(FILE);
  if (f && !/^\d/.test(f[1])) return { kind: "file", path: f[1], from: f[2] ? Number(f[2]) : null, to: f[3] ? Number(f[3]) : null };
  const n = c.match(NAME);
  return n ? { kind: "name", name: n[1] } : null;
}

const unescape = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Every code span's text, outside links, in the order it appears. */
export function codeSpans(html: string): string[] {
  return [...walk(html, () => null).found];
}

/** The page with each code span outside a link wrapped in the link `href` gives it. */
export function linkify(html: string, href: (code: string) => string | null): string {
  return walk(html, href).html;
}

function walk(html: string, href: (code: string) => string | null) {
  const found = new Set<string>();
  // Scripts and styles (mermaid sources among them) are left alone, as is anything already in a link.
  const out = html.replace(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<a\b[\s\S]*?<\/a>)|<code\b[^>]*>([\s\S]*?)<\/code>/gi, (m, skip, inner) => {
    if (skip) return m;
    const text = unescape(inner);
    found.add(text);
    const url = href(text);
    return url ? `<a class="cr-code" href="${url.replace(/"/g, "&quot;")}" target="_blank" rel="noreferrer">${m}</a>` : m;
  });
  return { html: out, found };
}

// The page's own code colour, underlined: a browser's default link blue is unreadable on a dark guide.
const STYLE = `<style>a.cr-code{color:inherit;text-decoration:none}a.cr-code code{color:inherit;text-decoration:underline dotted;text-underline-offset:3px}a.cr-code:hover code{text-decoration-style:solid}</style>`;

type Clone = { dir: string; slug: string; ref: string; files: string[] };

async function cloneAt(dir: string, slug: string, want: string | null): Promise<Clone | null> {
  try {
    let ref = want;
    if (ref) {
      const has = await read(["git", "-C", dir, "cat-file", "-e", `${ref}^{commit}`]).then(() => true, () => false);
      if (!has) await read(["git", "-C", dir, "fetch", "-q", "origin", ref], { timeoutMs: 30_000 }).catch(() => {});
      if (!(await read(["git", "-C", dir, "cat-file", "-e", `${ref}^{commit}`]).then(() => true, () => false))) ref = null;
    }
    ref ??= (await read(["git", "-C", dir, "rev-parse", "origin/HEAD"])).trim();
    const files = (await read(["git", "-C", dir, "ls-tree", "-r", "--name-only", ref])).split("\n").filter(Boolean);
    return { dir, slug, ref, files };
  } catch { return null; }
}

async function slugOf(dir: string): Promise<string | null> {
  const url = (await read(["git", "-C", dir, "remote", "get-url", "origin"]).catch(() => "")).trim();
  const owner = ownerOfRemote(url), name = url.replace(/\.git$/, "").split(/[/:]/).pop();
  return owner && name ? `${owner}/${name}` : null;
}

const blob = (c: Clone, path: string, from: number | null, to: number | null) =>
  `https://github.com/${c.slug}/blob/${c.ref}/${path.split("/").map(encodeURIComponent).join("/")}${from ? `#L${from}${to && to > from ? `-L${to}` : ""}` : ""}`;

/** The files in a clone ending with `path`, matched on whole path segments. */
const filesEnding = (c: Clone, path: string) => c.files.filter((f) => f === path || f.endsWith(`/${path}`));

/** Where a name is defined in a clone: one definition, or null. */
async function definition(c: Clone, name: string): Promise<{ path: string; line: number } | null> {
  const pat = `(function|const|let|var|def|fun|val|class|interface|type|enum|object)[[:space:]]+${name.replace(/\$/g, "\\$")}([^[:alnum:]_]|$)`;
  const out = await read(["git", "-C", c.dir, "grep", "-n", "-E", pat, c.ref, "--", ":!*.test.*", ":!*.spec.*", ":!*Test.kt", ":!**/__tests__/**"]).catch(() => "");
  const hits = out.split("\n").filter(Boolean).map((l) => l.slice(c.ref.length + 1).match(/^(.+?):(\d+):/)).filter(Boolean) as RegExpMatchArray[];
  const where = [...new Set(hits.map((h) => `${h[1]}:${h[2]}`))];
  if (where.length === 1) return { path: hits[0][1], line: Number(hits[0][2]) };
  if (where.length) return null;
  // No definition (an enum entry, a string value): where it's used, when that's one file.
  const uses = (await read(["git", "-C", c.dir, "grep", "-n", "-w", "-F", name, c.ref, "--", ":!*.test.*", ":!*.spec.*", ":!*Test.kt", ":!**/__tests__/**"]).catch(() => ""))
    .split("\n").filter(Boolean).map((l) => l.slice(c.ref.length + 1).match(/^(.+?):(\d+):/)).filter(Boolean) as RegExpMatchArray[];
  return uses.length && uses.every((u) => u[1] === uses[0][1]) ? { path: uses[0][1], line: Number(uses[0][2]) } : null;
}

/** The links for a guide's code spans, by span text. */
export async function resolveLinks(repo: string, sha: string, spans: string[]): Promise<Record<string, string>> {
  const slug = repo.includes("/") ? repo : null;
  const own = slug ? await cloneAt(repoPath(repo), slug, sha) : null;
  let others: Clone[] | null = null;
  const elsewhere = async () => {
    if (others) return others;
    const dirs = localRepos().map((n) => join(REPOS_ROOT, n)).filter((d) => d !== own?.dir);
    others = (await Promise.all(dirs.map(async (d) => { const s = await slugOf(d); return s ? cloneAt(d, s, null) : null; }))).filter((c): c is Clone => !!c);
    return others;
  };
  const links: Record<string, string> = {};
  for (const span of spans) {
    const t = targetOf(span);
    if (!t) continue;
    if (t.kind === "file") {
      const mine = own ? filesEnding(own, t.path) : [];
      if (mine.length === 1) { links[span] = blob(own!, mine[0], t.from, t.to); continue; }
      if (mine.length) continue;
      const hits = (await elsewhere()).flatMap((c) => filesEnding(c, t.path).map((f) => ({ c, f })));
      if (hits.length === 1) links[span] = blob(hits[0].c, hits[0].f, t.from, t.to);
    } else if (own) {
      const d = await definition(own, t.name);
      if (d) links[span] = blob(own, d.path, d.line, null);
    }
  }
  return links;
}

/** The guide page with its code linked, from the links kept beside it, worked out first if they aren't. */
export async function linkedGuide(file: string, repo: string, sha: string | null): Promise<string> {
  const html = readFileSync(file, "utf8");
  if (!sha) return html;
  const cache = file.replace(/\.html$/, ".links.json");
  let kept: { sha: string; links: Record<string, string> } | null = null;
  try { if (existsSync(cache)) kept = JSON.parse(readFileSync(cache, "utf8")); } catch { kept = null; }
  const spans = codeSpans(html);
  if (!kept || kept.sha !== sha || spans.some((s) => !(s in kept!.links) && targetOf(s))) {
    const links = await resolveLinks(repo, sha, spans);
    // A span with no link is kept as "", so it isn't looked up again for this commit.
    kept = { sha, links: Object.fromEntries(spans.filter((s) => targetOf(s)).map((s) => [s, links[s] ?? ""])) };
    try { writeFileSync(cache, JSON.stringify(kept)); } catch { /* links again next load */ }
  }
  const out = linkify(html, (c) => kept!.links[c] || null);
  return out.includes("</head>") ? out.replace("</head>", `${STYLE}</head>`) : STYLE + out;
}
