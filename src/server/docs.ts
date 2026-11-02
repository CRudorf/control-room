// The Docs page: glossary terms, ADRs and statecharts read from the repo, and the user's review of each.
// A review keeps the hash of the text it saw. When the text changes in git, the item needs review again.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocReview, DocsView, DocVerdict } from "../shared/types";
import { ROOT } from "./config";
import { load, save } from "./db";
import { note } from "./runner";

type Stored = { verdict: DocVerdict; comment: string; hash: string; at: string };
type Reviews = Record<string, Stored>;
const KEY = "doc_reviews";

export const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Glossary terms: each top-level `**Term**: text` paragraph, with the lines under it, such as a list of sub-terms. */
export function parseGlossary(md: string): { term: string; text: string }[] {
  const out: { term: string; text: string }[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
    if (m) out.push({ term: m[1], text: m[2] });
    else if (out.length && !line.startsWith("# ")) out[out.length - 1].text += `\n${line}`;
  }
  return out.map((t) => ({ term: t.term, text: t.text.trim() }));
}

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const list = (...p: string[]) => (existsSync(join(ROOT, ...p)) ? readdirSync(join(ROOT, ...p)).sort() : []);

function reviewOf(id: string, hash: string, all: Reviews): DocReview {
  const r = all[id];
  if (!r) return { verdict: null, comment: "", at: null, stale: false, needsReview: true };
  const stale = r.hash !== hash;
  return { verdict: r.verdict, comment: r.comment, at: r.at, stale, needsReview: stale };
}

type Item = { id: string; hash: string };

function terms(): (Item & { term: string; text: string })[] {
  if (!existsSync(join(ROOT, "GLOSSARY.md"))) return [];
  return parseGlossary(read("GLOSSARY.md")).map((t) => ({ ...t, id: `term:${t.term}`, hash: hashOf(`${t.term}\n${t.text}`) }));
}

function adrs(): (Item & { file: string; title: string; text: string })[] {
  return list("docs", "adr").filter((f) => f.endsWith(".md")).map((file) => {
    const text = read("docs", "adr", file);
    const title = text.match(/^# (.+)$/m)?.[1] ?? file;
    return { id: `adr:${file}`, file, title, text, hash: hashOf(text) };
  });
}

export function docsView(): DocsView {
  const all = load<Reviews>(KEY) ?? {};
  const charts = list("docs", "statecharts").filter((n) => existsSync(join(ROOT, "docs", "statecharts", n, "chart.svg"))).map((name) => {
    const mmd = existsSync(join(ROOT, "docs", "statecharts", name, "chart.mmd")) ? read("docs", "statecharts", name, "chart.mmd") : "";
    const title = mmd.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? name;
    const report = existsSync(join(ROOT, "docs", "statecharts", name, "report.md")) ? read("docs", "statecharts", name, "report.md") : "";
    return { name, title, svg: read("docs", "statecharts", name, "chart.svg"), report };
  });
  return {
    terms: terms().map(({ id, term, text, hash }) => ({ id, term, text, hash, review: reviewOf(id, hash, all) })),
    adrs: adrs().map(({ id, file, title, text, hash }) => ({ id, file, title, text, hash, review: reviewOf(id, hash, all) })),
    charts,
  };
}

/** Records the user's verdict on a term or an ADR, with the hash of the text he reviewed. */
export function reviewDoc(id: string, verdict: DocVerdict, comment: string) {
  if (verdict !== "reviewed" && verdict !== "needs-change") throw new Error(`unknown verdict ${verdict}`);
  const item = [...terms(), ...adrs()].find((x) => x.id === id);
  if (!item) throw new Error(`${id} isn't a glossary term or an ADR`);
  const all = load<Reviews>(KEY) ?? {};
  const at = new Date().toISOString();
  const c = comment.slice(0, 2000);
  save(KEY, { ...all, [id]: { verdict, comment: c, hash: item.hash, at } satisfies Stored });
  note({ item: null, trigger: "docs" }, "doc-review", id, verdict, { at, detail: { comment: c, hash: item.hash } });
}
