// Pure helpers for the Finished page.
import type { FinishedItem } from "../shared/types";

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Items by local day, newest day first. Items keep their order inside a day. */
export function groupByDay(items: FinishedItem[]): [string, FinishedItem[]][] {
  const by = new Map<string, FinishedItem[]>();
  for (const f of items) by.set(localDay(f.at), [...(by.get(localDay(f.at)) ?? []), f]);
  return [...by].sort((a, b) => b[0].localeCompare(a[0]));
}

/** "Today", "Yesterday" or "Mon, Oct 26". */
export function dayLabel(day: string, now = new Date()): string {
  const today = localDay(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (day === today) return "Today";
  if (day === localDay(y.toISOString())) return "Yesterday";
  const [a, m, d] = day.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "3h" or "5d" from start to end, or null when the start is unknown or later. */
export function duration(from: string | undefined, to: string): string | null {
  if (!from) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!(ms >= 0)) return null;
  const h = Math.floor(ms / 3_600_000);
  return h < 1 ? "under 1h" : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
