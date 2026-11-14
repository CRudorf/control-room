// Effort: how much of the user's own work an item needs before it ships, in points. A review request is
// worth its change's complexity points; one of the user's PRs is worth what's left on it (threads to
// answer, failing CI, conflicts). Points sum over an item's PRs into a size, on the same cut-offs as the
// review tiers. The complexity of a change also says how thoroughly to check it: its tier names the
// treatments (field guide, browser test, flow chart, video explainer) it should get.
//
// The rule is deterministic. Size bands follow SmartBear/Cisco (200-400 lines per review) and the
// Kubernetes size labels; files, spread and sensitive paths follow just-in-time defect prediction (Kamei
// 2013) and Google's outage data (most outages are config and deploy changes). It was checked against the
// user's merged PRs: there one sensitive category alone didn't raise review load and two did, commits
// predicted it best, and "no tests changed" pointed the wrong way, so it isn't counted. Replay it against
// new history now and then: what predicts drifts.
import type { PrRow, WorkItem } from "./types";

export type Tier = "light" | "standard" | "deep" | "critical";
export type Treatment = "guide" | "verify" | "chart" | "video";
export type Complexity = { tier: Tier; score: number; reasons: string[]; treatments: Treatment[]; runtime: string | null };
export type EffortSize = "S" | "M" | "L" | "XL";
export type Effort = { points: number; size: EffortSize; reasons: string[] };
type Size = NonNullable<PrRow["size"]>;

export const TIER_LABEL: Record<Tier, string> = { light: "Light review", standard: "Standard review", deep: "Deep review", critical: "Critical review" };
export const SIZE_LABEL: Record<EffortSize, string> = { S: "Small", M: "Medium", L: "Large", XL: "Extra large" };
export const TREATMENT_LABEL: Record<Treatment, string> = { guide: "Field guide", verify: "Browser test", chart: "Flow chart", video: "Video explainer" };
const TREATMENTS: Record<Tier, Treatment[]> = { light: [], standard: ["guide"], deep: ["guide", "verify", "chart"], critical: ["guide", "verify", "chart", "video"] };
const TIERS: Tier[] = ["light", "standard", "deep", "critical"];

/** Lines nobody reviews by reading: lockfiles, snapshots, generated and minified code. */
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Gemfile\.lock|go\.sum|Cargo\.lock)$|\.snap$|\.min\.(js|css)$|(^|\/)(__generated__|generated|dist|vendor)\//;
const TEST = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$|Tests?\.(kt|java|cs)$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const DOC = /\.(md|mdx|rst|txt)$|(^|\/)docs?\//i;
const MIGRATION = /(^|\/)(migrations?|db\/migrate)\/|\.sql$|schema\.(prisma|rb|graphql)$/i;
const INFRA = /\.tf$|terraform|helm|k8s|kubernetes|(^|\/)Dockerfile|\.github\/workflows\//i;
const SENSITIVE: [RegExp, string][] = [
  [MIGRATION, "the database schema"],
  [/auth|permission|keycloak|oauth|session|password|token/i, "auth"],
  [/payment|billing|invoice|stripe|claim/i, "payments or claims"],
  [INFRA, "infrastructure or CI"],
  [/(^|\/)(config|settings)\/|\.env|application\.(ya?ml|properties)$|feature.?flags?/i, "configuration"],
];
/** Changes reading can't settle: they need running. */
const RUNTIME: [RegExp, string][] = [
  [/\.(tsx|jsx|vue|svelte|css|scss|html)$/, "UI"],
  [MIGRATION, "schema"],
  [/(^|\/)(config|settings)\/|\.env|application\.(ya?ml|properties)$|feature.?flags?/i, "config"],
  [/(^|\/)(package\.json|requirements\.txt|pyproject\.toml|build\.gradle(\.kts)?|pom\.xml|go\.mod|Gemfile|Cargo\.toml)$/, "dependencies"],
];

const band = (n: number) => (n < 50 ? 0 : n < 200 ? 1 : n < 400 ? 2 : n < 1000 ? 3 : 4);
const at = (t: Tier, floor: Tier) => TIERS[Math.max(TIERS.indexOf(t), TIERS.indexOf(floor))];

/** The parts of a change that count: [path, lines] without generated files, split into code and tests. */
function partsOf(size: Size) {
  const paths = size.paths.filter(([p]) => !GENERATED.test(p));
  const tests = paths.filter(([p]) => TEST.test(p)), docs = paths.filter(([p]) => !TEST.test(p) && DOC.test(p));
  const code = paths.filter(([p]) => !TEST.test(p) && !DOC.test(p));
  const sum = (xs: [string, number][]) => xs.reduce((n, [, l]) => n + l, 0);
  // GitHub lists the first 100 files; without the list, every line counts as code.
  return size.paths.length
    ? { code, tests, docs, codeLines: sum(code), testLines: sum(tests) + sum(docs), files: code.length + Math.max(0, size.files - size.paths.length) }
    : { code, tests, docs, codeLines: size.add + size.del, testLines: 0, files: size.files };
}

/** How complex a change is to review, from its size, spread and what it touches. `broke`: files a past PR broke. */
export function complexityOf(size: Size, broke: string[] = []): Complexity {
  const { code, tests, docs, codeLines, files } = partsOf(size);
  const reasons: string[] = [];
  let score = band(codeLines);
  if (score) reasons.push(`${codeLines} lines`);
  if (files > 10) { score++; reasons.push(`${files} files`); }
  const areas = new Set(code.map(([p]) => p.split("/").slice(0, 2).join("/")));
  if (areas.size >= 3) { score++; reasons.push(`${areas.size} areas`); }
  const touched = SENSITIVE.filter(([re]) => code.some(([p]) => re.test(p))).map(([, what]) => what);
  if (touched.length >= 2) { score += 2; reasons.push(`touches ${touched.join(" and ")}`); }
  else if (touched.length) reasons.push(`touches ${touched[0]}`);
  if ((size.commits ?? 0) >= 6) { score++; reasons.push(`${size.commits} commits`); }
  const hot = code.map(([p]) => p).filter((p) => broke.some((b) => p === b || p.endsWith(`/${b}`) || b.endsWith(`/${p}`)));
  if (hot.length) { score += 2; reasons.push(`${hot[0].split("/").pop()} broke something before`); }
  let tier: Tier = score <= 1 ? "light" : score <= 3 ? "standard" : score <= 5 ? "deep" : "critical";
  if (code.some(([p]) => MIGRATION.test(p) || INFRA.test(p))) tier = at(tier, "deep");
  if (size.paths.length && !code.length && (tests.length || docs.length)) { tier = "light"; reasons.push("tests or docs only"); }
  const runtime = [...new Set(RUNTIME.filter(([re]) => code.some(([p]) => re.test(p))).map(([, what]) => what))];
  const treatments = TREATMENTS[tier].slice();
  if (runtime.length && !treatments.includes("verify")) treatments.push("verify");
  return { tier, score, reasons, treatments, runtime: runtime.length ? `changes ${runtime.join(", ")}` : null };
}

/** The tiers' cut-offs: 0-1 small, 2-3 medium, 4-5 large, 6 and up extra large. */
export const sizeOf = (points: number): EffortSize => (points <= 1 ? "S" : points <= 3 ? "M" : points <= 5 ? "L" : "XL");

const pts = (n: number) => `${n} pt${n === 1 ? "" : "s"}`;

/** The points one PR is worth to the user, and why. A PR always needs at least a look: 1 point. */
export function prPoints(p: PrRow): { points: number; reasons: string[] } {
  if (p.role === "requested") {
    const score = p.complexity?.score ?? 1;
    // A re-review reads what changed since the last one: half the change's points.
    if (p.prior && p.pushed_since) { const n = Math.max(1, Math.ceil(score / 2)); return { points: n, reasons: [`re-review #${p.number}: ${pts(n)}`] }; }
    const n = Math.max(1, score);
    return { points: n, reasons: [`${p.complexity ? TIER_LABEL[p.complexity.tier].toLowerCase() : "review"} of #${p.number}: ${pts(n)}`] };
  }
  const reasons: string[] = [];
  let n = 0;
  const add = (k: number, why: string) => { n += k; reasons.push(`${why}: ${pts(k)}`); };
  if (p.draft) add(Math.max(1, p.complexity?.score ?? 2), `#${p.number} is a draft`);
  const threads = (p.feedback ?? []).filter((f) => !f.outdated && f.kind === "thread").length;
  if (threads) add(Math.ceil(threads / 2), `${threads} thread${threads === 1 ? "" : "s"} to answer on #${p.number}`);
  if (p.review_decision === "CHANGES_REQUESTED") add(1, `changes requested on #${p.number}`);
  if (/fail|error/i.test(p.checks)) add(1, `CI failing on #${p.number}`);
  if (p.merge_state === "DIRTY") add(1, `conflicts on #${p.number}`);
  if (!n) add(1, `#${p.number}: ${p.state === "merge" ? "merge it" : "see it through"}`);
  return { points: n, reasons };
}

/** The user's work an item needs to ship, summed over its PRs. Null when there's no PR to size. */
export function effortOf(it: Pick<WorkItem, "prs">): Effort | null {
  if (!it.prs.length) return null;
  const parts = it.prs.map(prPoints);
  const points = parts.reduce((n, x) => n + x.points, 0);
  return { points, size: sizeOf(points), reasons: parts.flatMap((x) => x.reasons) };
}
