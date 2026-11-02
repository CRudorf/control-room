// The one seam for commands to outside systems (gh, prs.py, jira.py, aws, aws-mfa.sh) and the
// one writer of action records (GLOSSARY: Action record). A dev server records writes and sends
// nothing (ADR 0005). Tests swap the spawn adapter and the dev flag.
import { DEV } from "./config";
import { db } from "./db";

export type Spawned = { out: string; err: string; code: number };
export type SpawnOpts = { input?: string; env?: Record<string, string | undefined>; stderr?: "ignore"; signal: AbortSignal };
export type Adapter = (cmd: string[], opts: SpawnOpts) => Promise<Spawned>;
export type ReadOpts = { input?: string; timeoutMs?: number; stderr?: "ignore"; env?: Record<string, string | undefined> };
export type Ctx = { item: string | null; trigger: string };

const bunSpawn: Adapter = async (cmd, o) => {
  const proc = Bun.spawn(cmd, {
    stdin: o.input ? new Blob([o.input]) : "ignore", stdout: "pipe", stderr: o.stderr === "ignore" ? "ignore" : "pipe",
    // Bun.spawn's default is the environment at startup, without what config.ts set for this project.
    env: o.env ?? process.env,
  });
  o.signal.addEventListener("abort", () => proc.kill());
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(), o.stderr === "ignore" ? "" : new Response(proc.stderr as ReadableStream).text(), proc.exited]);
  return { out, err, code };
};

let adapter: Adapter = bunSpawn;
let dev = DEV;

/** Tests only: swap the spawn adapter (null restores Bun.spawn) and the dev flag. */
export function setAdapter(fake: Adapter | null, devFlag: boolean = DEV) {
  adapter = fake ?? bunSpawn;
  dev = devFlag;
}

/** Whether writes are only recorded (a dev server, or a test that says so). */
export const isDev = () => dev;

/** Runs a command and returns its stdout. Throws on a non-zero exit or after the timeout. */
export async function read(cmd: string[], opts: ReadOpts = {}): Promise<string> {
  const ms = opts.timeoutMs ?? 60_000;
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error(`${cmd[0]} timed out after ${ms} ms`)); ac.abort(); }, ms);
  });
  try {
    const { out, err, code } = await Promise.race([adapter(cmd, { input: opts.input, env: opts.env, stderr: opts.stderr, signal: ac.signal }), timeout]);
    if (code !== 0) throw new Error(err.trim().split("\n").slice(-3).join(" ") || `${cmd[0]} exited ${code}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

const insert = db.query(`INSERT INTO action_records (at, work_item, action, trigger, drafted, sent, result, detail, dry_run)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function record(ctx: Ctx, action: string, sent: string, result: string | null, o: { at?: string; drafted?: string; detail?: unknown } = {}) {
  insert.run(o.at ?? new Date().toISOString(), ctx.item, action, ctx.trigger, o.drafted ?? null, sent, result,
    o.detail ? JSON.stringify(o.detail) : null, dev ? 1 : 0);
}

/** Runs a write, or in dev only describes it, and records one action record either way. */
export async function write(ctx: Ctx, action: string, sent: string, op: string[] | (() => Promise<string | void>),
  extra: { drafted?: string; detail?: unknown; liveInDev?: boolean } = {}): Promise<string> {
  const live = !dev || extra.liveInDev;
  let result = live ? "done" : "dry run";
  try {
    if (live) result = (await (Array.isArray(op) ? read(op) : op())) || "done";
  } catch (e) {
    result = `failed: ${(e as Error).message}`;
  }
  record(ctx, action, sent, result, extra);
  if (result.startsWith("failed")) throw new Error(result.slice(8));
  return result;
}

/** Records a local state change that runs no command. `at` defaults to now. */
export function note(ctx: Ctx, action: string, sent: string, result: string | null = null, o: { at?: string; detail?: unknown } = {}) {
  record(ctx, action, sent, result, o);
}
