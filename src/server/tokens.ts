// Token use per work item, from Claude Code's transcripts, and a rough estimate of the electricity
// and water behind it. Pure: no I/O. usage.ts reads the transcripts.
import type { UsageCoeffs, UsageTotals } from "../shared/types";
import { weekOf } from "./metrics";

/** One model response: its tokens, and where the session was working. */
export type Turn = {
  id: string; at: string; session: string; model: string; dir: string; branch: string;
  input: number; output: number; read: number; write5m: number; write1h: number;
};

/**
 * Each kind of token weighted by its price relative to an uncached input token: a proxy for the
 * compute behind it. A cache read is cheap to serve; an output token is the most work.
 */
export const WEIGHTS = { input: 1, output: 5, read: 0.1, write5m: 1.25, write1h: 2 } as const;

/**
 * Assumptions, editable in Metrics. No provider publishes energy per token, so these are
 * order-of-magnitude figures: good for comparing work items, not as measurements.
 * whPerMTok: watt-hours per million weighted tokens, for a frontier model on data center hardware.
 * litersPerKwh: water per kWh, on-site cooling plus the water used generating the electricity.
 */
export const DEFAULT_COEFFS: UsageCoeffs = { whPerMTok: 200, litersPerKwh: 1.9 };

/**
 * Anthropic API list prices, US$ per million tokens: input, output, cache read. Cache writes are
 * 1.25× input for 5 minutes and 2× for an hour. Matched by model id prefix; an unknown model is
 * priced as Claude Opus 5.5.
 */
export const PRICES_AS_OF = "October 2026";
const PRICES: [string, number, number, number][] = [
  ["claude-fable-5-1", 10, 50, 0.25], ["claude-mythos-5-1", 10, 50, 0.25], ["claude-fable-5", 10, 50, 1], ["claude-mythos-5", 10, 50, 1],
  ["claude-opus-5-5", 4, 20, 0.2], ["claude-opus-5", 5, 25, 0.5], ["claude-opus-4", 5, 25, 0.5],
  ["claude-sonnet-5-5", 2, 10, 0.2], ["claude-sonnet-5", 2, 10, 0.2], ["claude-sonnet-4", 3, 15, 0.3],
  ["claude-haiku-5-5", 0.1, 0.5, 0.01], ["claude-haiku-4", 1, 5, 0.1],
];
const priceOf = (model: string) => PRICES.find(([p]) => model.startsWith(p)) ?? PRICES[4];

/** What a turn would have cost through the API, in US$. */
export function usd(t: Turn): number {
  const [, inp, out, read] = priceOf(t.model);
  return (t.input * inp + t.output * out + t.read * read + t.write5m * inp * 1.25 + t.write1h * inp * 2) / 1e6;
}

/** A transcript line as a Turn, or null when it isn't a model response with usage. */
export function turnOf(line: string): Turn | null {
  if (!line.includes('"usage"')) return null;
  let d: any;
  try { d = JSON.parse(line); } catch { return null; }
  const m = d?.message, u = m?.usage;
  if (d?.type !== "assistant" || !u || !m.id || m.model === "<synthetic>") return null;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    id: m.id, at: d.timestamp, session: d.sessionId ?? "", model: m.model ?? "", dir: d.cwd ?? "", branch: d.gitBranch ?? "",
    input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, read: u.cache_read_input_tokens ?? 0,
    write5m: (u.cache_creation_input_tokens ?? 0) - write1h, write1h,
  };
}

export const weighted = (t: Pick<Turn, "input" | "output" | "read" | "write5m" | "write1h">) =>
  t.input * WEIGHTS.input + t.output * WEIGHTS.output + t.read * WEIGHTS.read + t.write5m * WEIGHTS.write5m + t.write1h * WEIGHTS.write1h;

const empty = (): UsageTotals => ({ input: 0, output: 0, cache: 0, weighted: 0, kwh: 0, liters: 0, usd: 0, sessions: 0 });

// `work`: a session in a repo. Plugins' background agents run hundreds of short sessions outside
// any repo; their tokens count, but they aren't sessions of the user's.
function add(u: UsageTotals & { _s?: Set<string> }, t: Turn, c: UsageCoeffs, work: boolean) {
  const w = weighted(t);
  u.input += t.input; u.output += t.output; u.cache += t.read + t.write5m + t.write1h; u.weighted += w;
  u.kwh += (w / 1e6) * c.whPerMTok / 1000;
  u.liters = u.kwh * c.litersPerKwh;
  u.usd += usd(t);
  u._s ??= new Set();
  if (work) u._s.add(t.session);
  u.sessions = u._s.size;
}
const strip = <T extends UsageTotals>({ _s, ...u }: T & { _s?: Set<string> }): T => u as unknown as T;

/** Totals per work item key, and per week; `keyOf` names the work item a session's repo and branch belong to. */
export function tally(turns: Turn[], keyOf: (t: Turn) => { key: string; repo: string | null }, c: UsageCoeffs, from = "") {
  const items = new Map<string, UsageTotals & { key: string; repos: string[]; first: string; last: string; _s?: Set<string> }>();
  const weeks = new Map<string, UsageTotals & { week: string; _s?: Set<string> }>();
  for (const t of turns) {
    if (t.at < from) continue;
    const { key, repo } = keyOf(t);
    const it = items.get(key) ?? { ...empty(), key, repos: [], first: t.at, last: t.at };
    add(it, t, c, !!repo);
    if (repo && !it.repos.includes(repo)) it.repos.push(repo);
    if (t.at < it.first) it.first = t.at;
    if (t.at > it.last) it.last = t.at;
    items.set(key, it);
    const wk = weekOf(t.at);
    const w = weeks.get(wk) ?? { ...empty(), week: wk };
    add(w, t, c, !!repo);
    weeks.set(wk, w);
  }
  return {
    items: [...items.values()].map(strip).sort((a, b) => b.weighted - a.weighted),
    weeks: [...weeks.values()].map(strip).sort((a, b) => a.week.localeCompare(b.week)),
  };
}

/** Sums totals, for a work item that spans several keys. */
export function sum(us: UsageTotals[]): UsageTotals {
  const out = empty();
  for (const u of us) for (const k of Object.keys(out) as (keyof UsageTotals)[]) out[k] += u[k];
  return out;
}
