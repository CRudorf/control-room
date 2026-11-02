// Sessions: every Claude session in herdr, work item or not, by what it needs from the user; the picked
// one is live beside the list, to message and answer without switching to herdr.
import { useEffect, useMemo, useState } from "react";
import type { Session } from "../shared/types";
import { LiveConsole } from "./console";

const H = 3600_000, D = 24 * H;
function ago(iso: string | null) {
  if (!iso) return "—";
  const d = Date.now() - Date.parse(iso);
  return d < H ? `${Math.max(1, Math.round(d / 60_000))}m` : d < D ? `${Math.round(d / H)}h` : `${Math.round(d / D)}d`;
}
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);

const GROUPS: { k: Session["status"][]; t: string; hc: string }[] = [
  { k: ["blocked", "finished"], t: "Needs you", hc: "--h-mine" },
  { k: ["working"], t: "Working", hc: "--h-wait" },
  { k: ["idle"], t: "Idle", hc: "--ink-3" },
];
const STATUS = { blocked: "waiting on you", finished: "finished", working: "working", idle: "idle" };
const DOT = { blocked: "blocked", finished: "done", working: "working", idle: "idle" };

export function Sessions({ onClose, onItem, onFocus }: { onClose: () => void; onItem: (id: string) => void; onFocus: (pane: string) => void }) {
  const [list, setList] = useState<Session[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/sessions").then((x) => x.json())
      .then((r) => { setErr(r.error ?? null); if (r.sessions) setList(r.sessions); })
      .catch(() => setErr("server unreachable"));
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, ss: (list ?? []).filter((s) => g.k.includes(s.status))
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "")) })), [list]);
  const order = groups.flatMap((g) => g.ss.map((s) => s.pane));
  const cur = (list ?? []).find((s) => s.pane === sel) ?? (list ?? []).find((s) => s.pane === order[0]) ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [data-keys]")) return;
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      const i = cur ? order.indexOf(cur.pane) : -1;
      if (e.key === "j" || e.key === "k") {
        e.stopPropagation(); e.preventDefault();
        const n = order[Math.max(0, Math.min(order.length - 1, i + (e.key === "j" ? 1 : -1)))];
        if (n) { setSel(n); document.getElementById(`sess-${n}`)?.scrollIntoView({ block: "nearest" }); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, order, cur]);

  const loose = (list ?? []).filter((s) => !s.item).length;
  const total = (list ?? []).reduce((a, s) => a + (s.spend?.usd ?? 0), 0);
  return (
    <div className="tidy">
      <div className="tidy-head">
        <div>
          <h2>Sessions</h2>
          <span className="st dim">{list ? `${list.length} Claude sessions in herdr · ${loose} without a work item · $${total.toFixed(0)} so far` : "Loading…"}</span>
        </div>
        <div className="row-acts"><button className="btn" onClick={onClose}>Done <kbd>esc</kbd></button></div>
      </div>
      {err && <div className="tidy-err">{err}</div>}
      <div className="sess-body">
        <div className="tidy-list">
          {groups.map((g) => !g.ss.length ? null : (
            <section key={g.t}>
              <div className="bay-h" style={{ "--hc": `var(${g.hc})` } as React.CSSProperties}><span className="sw" />{g.t} <span className="c">{g.ss.length}</span><span className="rule" /></div>
              {g.ss.map((s) => (
                <div key={s.pane} id={`sess-${s.pane}`} className={`sess-row ${cur?.pane === s.pane ? "on" : ""}`} onClick={() => setSel(s.pane)} title={`${s.cwd}${s.session ? `\nsession ${s.session}` : ""}`}>
                  <i className={`dot ${DOT[s.status]}`} />
                  <div className="sl">
                    <b>{s.title || s.label}</b>
                    <span className="st dim">{s.item ? s.item.key : s.repo ?? "no repo"} · {s.workspace}{s.title && s.title !== s.label ? ` / ${s.label}` : ""} · {STATUS[s.status]}</span>
                  </div>
                  <div className="ta">
                    {s.spend && <span title={`${s.spend.tokens.toLocaleString()} tokens since ${new Date(s.spend.since).toLocaleString()}`}>${s.spend.usd.toFixed(2)} · </span>}
                    {ago(s.lastActive)}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {list && !list.length && <div className="empty">No Claude sessions in herdr.</div>}
        </div>
        {cur && (
          <aside className="pane sess-live">
            <h3>
              <span>{cur.title || cur.label}</span>
              <span className="st dim">{STATUS[cur.status]}</span>
            </h3>
            <div className="in agent">
              <div className="meta">
                {cur.item
                  ? <button className="chip" onClick={() => onItem(cur.item!.id)} title={`Open ${cur.item.key} on the board: ${cur.item.title}`}>{cur.item.key}</button>
                  : <span className="chip loose" title="No work item: it belongs to its repo">{cur.repo ?? "no repo"}</span>}
                {" "}{cur.workspace} / {cur.label}{cur.branch ? ` · ${cur.branch}` : ""}
                {" "}<button className="btn" onClick={() => onFocus(cur.pane)} title="Show it in herdr and bring herdr forward">Open in herdr</button>
              </div>
              <LiveConsole key={cur.pane} pane={cur.pane} status={cur.status} name={cur.title || cur.label} item={cur.item?.id ?? null} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
