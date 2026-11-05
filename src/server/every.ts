// Timers whose interval is a setting. Each wait reads the interval afresh, and a save on the Settings
// page re-arms every timer from its last run, so a new interval applies now rather than after the old wait.
import { onSettingsChange } from "./settings";

type Timer = { ms: () => number; run: () => void; last: number; handle: ReturnType<typeof setTimeout> | null };
const timers = new Set<Timer>();

function arm(t: Timer) {
  if (t.handle) clearTimeout(t.handle);
  t.handle = setTimeout(() => { t.last = Date.now(); t.run(); arm(t); }, Math.max(0, t.last + t.ms() - Date.now()));
}

/** Runs `run` every `ms()` milliseconds, starting one interval from now. */
export function every(ms: () => number, run: () => void) {
  const t: Timer = { ms, run, last: Date.now(), handle: null };
  timers.add(t);
  arm(t);
}

onSettingsChange(() => { for (const t of timers) arm(t); });
