// The week a moment falls in, shared by the server's metrics and the UI that drills into them.

/** Monday 00:00 local of the week `iso` falls in, as YYYY-MM-DD. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
