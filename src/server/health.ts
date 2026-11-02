// Machine health: memory per herdr pane (everything running under its shell) and how much the
// machine has free, so a heavy tab can be closed before macOS starts killing dev stacks.
const sh = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out : "";
};

/** Every process's parent and resident memory, from one `ps`. */
export async function processTree() {
  const procs = new Map<number, { ppid: number; kb: number }>();
  const kids = new Map<number, number[]>();
  for (const line of (await sh(["ps", "-axo", "pid=,ppid=,rss="])).split("\n")) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    procs.set(pid, { ppid, kb });
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  return { procs, kids };
}

/** Memory of a process and everything under it, in MB. */
export function treeMb(pid: number, t: Awaited<ReturnType<typeof processTree>>): number {
  let kb = 0;
  const stack = [pid];
  const seen = new Set<number>();
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    kb += t.procs.get(p)?.kb ?? 0;
    stack.push(...(t.kids.get(p) ?? []));
  }
  return Math.round(kb / 1024);
}

export type Machine = { totalGb: number; freePct: number | null; low: boolean };

// Below this, macOS starts compressing and swapping hard, and dev stacks were killed before.
export const LOW_FREE_PCT = 15;
let machineCache: { at: number; m: Machine } | null = null;

/** Total memory and macOS's own "memory free percentage". Cached for a minute. */
export async function machine(): Promise<Machine> {
  if (machineCache && Date.now() - machineCache.at < 60_000) return machineCache.m;
  const total = Number((await sh(["sysctl", "-n", "hw.memsize"])).trim()) || 0;
  const pct = (await sh(["memory_pressure", "-Q"])).match(/free percentage: (\d+)%/)?.[1];
  const freePct = pct ? Number(pct) : null;
  const m = { totalGb: Math.round(total / 2 ** 30), freePct, low: freePct !== null && freePct < LOW_FREE_PCT };
  machineCache = { at: Date.now(), m };
  return m;
}
