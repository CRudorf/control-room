import { expect, test } from "bun:test";
import { db, load, save } from "./db";
import { docsView, parseGlossary, reviewDoc } from "./docs";

test("parseGlossary keeps sub-term lists with their term", () => {
  const t = parseGlossary("# Glossary\n\n**Lane**: A grouping.\n\n- **My turn**: Pat's move.\n\n**Ball**: Whose turn.");
  expect(t.map((x) => x.term)).toEqual(["Lane", "Ball"]);
  expect(t[0].text).toContain("My turn");
});

test("a review holds until the text changes, then the item needs review again", () => {
  const before = docsView();
  const term = before.terms.find((t) => t.term === "Lane")!;
  expect(term.review.needsReview).toBe(true);
  reviewDoc(term.id, "reviewed", "reads right");
  const after = docsView().terms.find((t) => t.id === term.id)!;
  expect(after.review).toMatchObject({ verdict: "reviewed", comment: "reads right", needsReview: false, stale: false });
  const rec = db.query<{ action: string; sent: string }, []>("SELECT action, sent FROM action_records WHERE action = 'doc-review' ORDER BY id DESC").get();
  expect(rec).toEqual({ action: "doc-review", sent: term.id });
  // As if the term changed in git: the stored hash no longer matches.
  const all = load<Record<string, { hash: string }>>("doc_reviews")!;
  save("doc_reviews", { ...all, [term.id]: { ...all[term.id], hash: "old" } });
  expect(docsView().terms.find((t) => t.id === term.id)!.review).toMatchObject({ stale: true, needsReview: true });
});

test("reviewDoc refuses an unknown id or verdict", () => {
  expect(() => reviewDoc("term:Nope", "reviewed", "")).toThrow();
  expect(() => reviewDoc("term:Lane", "maybe" as never, "")).toThrow();
});
