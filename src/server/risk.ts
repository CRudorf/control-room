// Which of a PR's changes are high risk: the review loop stops and hands those PRs to the user.
// `classify` is pure; `riskOf` fetches the PR's files once per head commit.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrRow } from "../shared/types";
import { prRef } from "../shared/types";
import { STATE_DIR } from "./config";
import { read } from "./runner";

export type Category = "migration" | "auth" | "money" | "phi" | "infra" | "dependencies";
export type Flag = { category: Category; file: string };
type Rule = { paths?: RegExp[]; added?: RegExp[] };

/** Paths match the file name; `added` matches lines the PR adds. */
export const DEFAULT_RULES: Record<Category, Rule> = {
  migration: { paths: [/(^|\/)migrations\/\d{4}_.*\.py$/, /(^|\/)alembic\/versions\//, /(^|\/)db\/migrate\//, /(^|\/)prisma\/migrations\//, /\.sql$/] },
  auth: {
    // Whole words only: "authorizations" in HA are care authorizations, not access control.
    paths: [/(^|\/)(auth0?|authentication|oauth|sso|jwt|login|permissions?|middleware)(\/|\.\w+$|[_-])/i, /(^|\/)Auth(Service|Controller|Middleware|Provider|Filter)\b/],
    added: [/\b(permission_classes|authentication_classes|login_required|has_(object_)?permission|AUTHENTICATION_BACKENDS|csrf_exempt|AllowAny)\b/, /\bjwt\./],
  },
  money: {
    paths: [/(payment|billing|invoice|stripe|payout|reimburs|refund|ledger|pricing|claims?)[^/]*(\/|\.\w+$)/i],
    added: [/\bstripe\./i, /\b(payout|refund|invoice)s?\b/i],
  },
  phi: {
    paths: [/(patient|phi|hipaa|medical|diagnos|health_record|pii)[^/]*(\/|\.\w+$)/i],
    added: [/\b(ssn|social_security|date_of_birth|dob|diagnosis|medicaid_id|medicare_id|member_id)\b/i],
  },
  infra: { paths: [/\.tf$/, /(^|\/)terraform\//, /(^|\/)\.github\/workflows\//, /(^|\/)Dockerfile/, /(^|\/)(helm|k8s)\//] },
  dependencies: { paths: [/(^|\/)(requirements[^/]*\.txt|pyproject\.toml|package\.json|Gemfile|go\.mod|Pipfile)$/] },
};

/**
 * Per-repo tuning, in risk.json in the state dir: `{ "<repo>": { "skip": ["path regex"], "paths":
 * { "<category>": ["path regex"] } } }`. Skipped paths never flag; extra paths flag as their category.
 */
type Tuning = Record<string, { skip?: string[]; paths?: Partial<Record<Category, string[]>> }>;
export const RISK_FILE = join(STATE_DIR, "risk.json");
function tuning(): Tuning {
  try { return existsSync(RISK_FILE) ? JSON.parse(readFileSync(RISK_FILE, "utf8")) : {}; } catch { return {}; }
}

export type ChangedFile = { filename: string; patch?: string };

// Tests change no behavior in production, so they never flag.
const TEST = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.\w+$|(^|\/)test_[^/]*$|_test\.\w+$|Test\.\w+$/;

/** The high-risk files in a change, one flag per category and file. */
export function classify(files: ChangedFile[], repo: string, tune: Tuning = {}): Flag[] {
  const t = tune[repo.split("/").pop()!] ?? tune[repo] ?? {};
  const skip = (t.skip ?? []).map((s) => new RegExp(s));
  const out: Flag[] = [];
  for (const f of files) {
    if (TEST.test(f.filename) || skip.some((r) => r.test(f.filename))) continue;
    const added = (f.patch ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    for (const [category, rule] of Object.entries(DEFAULT_RULES) as [Category, Rule][]) {
      const extra = (t.paths?.[category] ?? []).map((s) => new RegExp(s));
      const hit = [...(rule.paths ?? []), ...extra].some((r) => r.test(f.filename)) || (rule.added ?? []).some((r) => r.test(added));
      if (hit) out.push({ category, file: f.filename });
    }
  }
  return out;
}

/** "migration (app/migrations/0042_x.py), auth (2 files)" */
export function describe(flags: Flag[]): string {
  const by = new Map<Category, string[]>();
  for (const f of flags) by.set(f.category, [...(by.get(f.category) ?? []), f.file]);
  return [...by].map(([c, fs]) => `${c} (${fs.length === 1 ? fs[0] : `${fs.length} files`})`).join(", ");
}

// ref@head → flags; a head never changes its files, so a hit is good forever.
const cache = new Map<string, Flag[]>();
const pending = new Set<string>();

/** The PR's flags at its head, or undefined while they're being fetched (`onReady` fires then). */
export function riskOf(p: PrRow, onReady: () => void): Flag[] | undefined {
  const k = `${prRef(p)}@${p.head}`;
  if (cache.has(k)) return cache.get(k);
  if (!pending.has(k)) {
    pending.add(k);
    void files(p).then((fs) => { cache.set(k, classify(fs, p.repo, tuning())); onReady(); })
      .catch((e) => console.log(new Date().toISOString(), `risk check failed for ${k}:`, (e as Error).message))
      .finally(() => pending.delete(k));
  }
  return undefined;
}

async function files(p: PrRow): Promise<ChangedFile[]> {
  const out = await read(["gh", "api", "--paginate", `repos/${p.repo}/pulls/${p.number}/files?per_page=100`, "--jq", ".[] | {filename, patch} | @json"]);
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
