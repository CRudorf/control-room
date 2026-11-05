// Settings: how the control room looks (kept in this browser), and this project's settings file: where
// its work lives, the PRs it treats specially, and how often and how hard it works (saved on the server).
import { type ReactNode, useEffect, useState } from "react";
import { post, toast } from "./actions";
import { SKINS, type SkinId, skinOf } from "./skins";

export type Theme = "system" | "light" | "dark";
const THEMES: { t: Theme; label: string }[] = [{ t: "system", label: "System" }, { t: "light", label: "Light" }, { t: "dark", label: "Dark" }];

type Section = "polling" | "agents" | "schedule";
type Knob = { section: Section; key: string; label: string; help: string; unit: string; def: number; min: number; max: number; value: number };
type ParkRule = { status: string; note?: string; finishWhen?: string[]; wakeAfterDays?: number };
type Flow = { stages?: string[]; testingStatus?: string; approvedStatus?: string; who?: string; copySuffix?: string; parkRules?: ParkRule[] };
type Project = {
  org: string | null; sentryOrg: string | null; jiraProjects: string[] | null; jiraSuggestSprints: string[] | null; jiraSuggestLabel: string | null;
  pickupHint: string | null; aws: boolean | null; awsMfaScript: string | null; flow: Flow | null;
};
type View = {
  path: string; dev: boolean; project: Project; tracker: { kind: "github"; repos: string[] } | null;
  botPattern: string; defaultBotPattern: string; knobs: Knob[]; adopted: { key: string; note: string }[] | null; excluded: number | null;
  machines: Machine[]; machineStatus: { name: string; up: boolean; error: string | null; repos: string[] }[];
};

const SECTIONS: { s: Section; title: string; blurb: string }[] = [
  { s: "polling", title: "Polling", blurb: "How often each feed is read. Shorter is fresher and costs more API calls." },
  { s: "agents", title: "Agents", blurb: "How many agents the control room starts on its own, and when it stops them." },
  { s: "schedule", title: "Schedule", blurb: "Local hours for the work that runs on its own." },
];

type Machine = { name: string; ssh: string; reposRoot?: string; enabled?: boolean };
type Tab = "look" | "project" | "flow" | "prs" | "machines" | Section;
const TABS: { t: Tab; label: string }[] = [
  { t: "project", label: "Project" }, { t: "flow", label: "Delivery flow" }, { t: "prs", label: "PRs" },
  ...SECTIONS.map((x) => ({ t: x.s, label: x.title })),
  { t: "machines", label: "Machines" },
  { t: "look", label: "Look" },
];

const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const joined = (v: string[] | null | undefined) => (v ?? []).join(", ");

async function save(patch: object, done: string, set: (v: View) => void) {
  const r = await post("/api/settings", { patch });
  if (r.error) { toast(`Couldn't save: ${r.error}`); return false; }
  set(r as View);
  toast(r.dev ? `${done} (dev: until restart, the file is left alone)` : done);
  return true;
}

export function Settings({ theme, setTheme, skin, setSkin, onClose, onOpen }: {
  theme: Theme; setTheme: (t: Theme) => void; skin: SkinId; setSkin: (s: SkinId) => void; onClose: () => void; onOpen: (page: "removed") => void;
}) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => void fetch("/api/settings").then((x) => x.json()).then((r) => (r.error ? setErr(r.error) : setV(r))).catch(() => setErr("server unreachable"));
  useEffect(load, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) { t.blur(); return; }
      e.stopPropagation(); onClose();
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [onClose]);
  const [tab, setTab] = useState<Tab>("project");
  const themed = skinOf(skin).themed;
  const { flow, ...where } = v?.project ?? ({} as Project);
  // Every tab stays mounted, so an unsaved edit survives a look at another tab.
  const pane = (t: Tab, body: ReactNode) => <div key={t} className="set-pane" role="tabpanel" hidden={tab !== t}>{body}</div>;
  const needsView = (body: (v: View) => ReactNode) => (v ? body(v) : <div className="empty">{err ? `Couldn't read the settings: ${err}` : "Reading settings…"}</div>);
  return (
    <div className="settings">
      <div className="vv-head"><b className="vt">Settings</b>
        <span className="st dim">Skin and theme are kept in this browser. The rest applies without a restart{v?.dev ? `. This dev server keeps it until it restarts and leaves ${v.path} alone.` : ` and is saved to ${v?.path ?? "this project's settings file"}.`}</span>
        <div className="row-acts"><button className="btn" onClick={onClose}>Close <kbd>esc</kbd></button></div></div>
      <div className="set-wrap">
        <nav className="set-nav" role="tablist" aria-label="Settings">
          {TABS.map((x) => <button key={x.t} role="tab" aria-selected={tab === x.t} className={tab === x.t ? "on" : ""} onClick={() => setTab(x.t)}>{x.label}</button>)}
        </nav>
        <div className="set-body">
          {pane("look", <section className="set-sec">
            <Head title="Skin" blurb="The whole look of the board." />
            <div className="skin-list" role="radiogroup" aria-label="Skin">
              {SKINS.map((s) => (
                <button key={s.id} role="radio" aria-checked={skin === s.id} className={`skin-card ${skin === s.id ? "on" : ""}`} onClick={() => setSkin(s.id)}>
                  <span className="skin-sw">{s.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span>
                  <b>{s.name}</b><span className="st dim">{s.blurb}</span>
                </button>
              ))}
            </div>
            <Head title="Theme" blurb={themed ? "Light, dark, or whatever the system uses." : `${skinOf(skin).name} has its own colours, so the theme doesn't change it.`} />
            <div className="seg" role="radiogroup" aria-label="Theme">
              {THEMES.map(({ t, label }) => (
                <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} disabled={!themed} onClick={() => setTheme(t)}>{label}</button>
              ))}
            </div>
          </section>)}
          {pane("project", needsView((v) => <ProjectForm key={JSON.stringify(where)} v={v} set={setV} />))}
          {pane("flow", needsView((v) => <FlowForm key={JSON.stringify(flow)} flow={flow ?? {}} set={setV} />))}
          {pane("prs", needsView((v) => <PrLists v={v} set={setV} reload={load} onOpen={onOpen} />))}
          {pane("machines", needsView((v) => <MachinesForm key={JSON.stringify(v.machines)} v={v} set={setV} reload={load} />))}
          {SECTIONS.map((x) => pane(x.s, needsView((v) => {
            const knobs = v.knobs.filter((k) => k.section === x.s);
            return <KnobForm key={JSON.stringify(knobs.map((k) => k.value))} {...x} knobs={knobs} set={setV} />;
          })))}
        </div>
      </div>
    </div>
  );
}

function Head({ title, blurb }: { title: string; blurb: string }) {
  return <div className="set-head"><b>{title}</b><span className="st dim">{blurb}</span></div>;
}

/** One setting: its name, its control and what it does. `group` for a row of several controls, which a label can't wrap. */
function Row({ label, help, group, children }: { label: string; help?: string; group?: boolean; children: ReactNode }) {
  const body = <><span className="lbl">{label}</span><span className="ctl">{children}</span>{help && <span className="help">{help}</span>}</>;
  return group ? <div className="set-row">{body}</div> : <label className="set-row">{body}</label>;
}

/** A form's draft: its fields, a setter, input props for a text field, and a save that tracks busy. */
function useDraft<T extends Record<string, string | boolean>>(init: T) {
  const [d, setD] = useState(init);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof T) => ({ className: "field", value: d[k] as string, onChange: (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value })) });
  const run = async (f: () => Promise<unknown>) => { setBusy(true); await f(); setBusy(false); };
  return { d, setD, field, busy, run, dirty: Object.keys(init).some((k) => init[k] !== d[k]) };
}

function ProjectForm({ v, set }: { v: View; set: (v: View) => void }) {
  const p = v.project;
  const { d, setD, field, busy, run, dirty } = useDraft({
    org: p.org ?? "", sentryOrg: p.sentryOrg ?? "", jiraProjects: joined(p.jiraProjects), jiraSuggestSprints: joined(p.jiraSuggestSprints),
    jiraSuggestLabel: p.jiraSuggestLabel ?? "", pickupHint: p.pickupHint ?? "", aws: !!p.aws, awsMfaScript: p.awsMfaScript ?? "",
  });
  // AWS sessions only show for a project whose file already sets them up; the rest never use them.
  const showAws = p.aws !== null || p.awsMfaScript !== null;
  const submit = () => run(() => save({
    org: d.org, sentryOrg: d.sentryOrg, jiraSuggestSprints: list(d.jiraSuggestSprints), jiraSuggestLabel: d.jiraSuggestLabel,
    pickupHint: d.pickupHint, ...(showAws ? { aws: d.aws, awsMfaScript: d.awsMfaScript } : {}),
    ...(v.tracker ? {} : { jiraProjects: list(d.jiraProjects) }),
  }, "Saved the project", set));
  return (
    <form className="set-sec" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Head title="Project" blurb="Where this project's work lives." />
      <Row label="GitHub org" help="What a bare repo#123 means, and whose clones count as this project's."><input {...field("org")} placeholder="acme" /></Row>
      <Row label="Sentry org" help="Production errors for shipped work. Empty turns the check off."><input {...field("sentryOrg")} placeholder="acme" /></Row>
      {v.tracker
        ? <Row label="Issue tracker" help="Set up from the board. A project tracks GitHub Issues or Jira, not both."><span className="st">GitHub Issues in {v.tracker.repos.join(", ")}</span></Row>
        : <Row label="Jira projects" help="Keys of the projects whose issues are this project's work, comma separated."><input {...field("jiraProjects")} placeholder="ABC, XYZ" /></Row>}
      <Row label="Suggestion sprints" help="Sprints Suggestions reads after the active one, comma separated."><input {...field("jiraSuggestSprints")} placeholder="Next up" /></Row>
      <Row label="Suggestion label" help="A backlog label whose issues Suggestions offers."><input {...field("jiraSuggestLabel")} placeholder="cleanup" /></Row>
      <Row label="Pickup hint" help="Added to the prompt of every agent started from a suggestion."><textarea {...field("pickupHint")} className="field set-text" rows={2} /></Row>
      {showAws && <>
      <Row label="AWS sessions" help="Shows the AWS MFA session on the board, refreshed by the script below.">
        <span className="set-inline"><input type="checkbox" checked={d.aws} onChange={(e) => setD((x) => ({ ...x, aws: e.target.checked }))} /> On</span>
      </Row>
      <Row label="MFA script" help="Repo and path of the script that refreshes it, e.g. infra/scripts/aws-mfa.sh."><input {...field("awsMfaScript")} disabled={!d.aws} /></Row>
      </>}
      <div className="row-acts"><button className="btn primary" type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save project"}</button></div>
    </form>
  );
}

function FlowForm({ flow: f, set }: { flow: Flow; set: (v: View) => void }) {
  const { d, field, busy, run, dirty } = useDraft({
    stages: joined(f.stages), testingStatus: f.testingStatus ?? "", approvedStatus: f.approvedStatus ?? "", who: f.who ?? "", copySuffix: f.copySuffix ?? "",
    parkRules: f.parkRules?.length ? JSON.stringify(f.parkRules, null, 2) : "",
  });
  const submit = () => {
    let parkRules: ParkRule[] = [];
    try { parkRules = d.parkRules.trim() ? JSON.parse(d.parkRules) : []; }
    catch { return toast("Couldn't save: the park rules aren't valid JSON"); }
    void run(() => save({ flow: { stages: list(d.stages), testingStatus: d.testingStatus, approvedStatus: d.approvedStatus, who: d.who, copySuffix: d.copySuffix, parkRules } }, "Saved the delivery flow", set));
  };
  return (
    <form className="set-sec" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Head title="Delivery flow" blurb="How work moves from a branch to shipped, and who tests it on the way." />
      <Row label="Stages" help="The branches work moves through, in order. The last one means shipped."><input {...field("stages")} placeholder="staging, main" /></Row>
      <Row label="Testing status" help="The issue status while someone tests it on the first stage."><input {...field("testingStatus")} placeholder="Testing" /></Row>
      <Row label="Approved status" help="The issue status once that person approves it."><input {...field("approvedStatus")} placeholder="Approved" /></Row>
      <Row label="Who tests" help="How the board names them."><input {...field("who")} placeholder="Product" /></Row>
      <Row label="Copy suffix" help="Ends the name of the first stage's copy of a branch."><input {...field("copySuffix")} placeholder="-stage" /></Row>
      <Row label="Park rules" help='Statuses that park an issue, as JSON: [{"status": "Blocked", "note": "...", "finishWhen": ["Done"], "wakeAfterDays": 7}].'>
        <textarea {...field("parkRules")} className="field set-text mono" rows={Math.min(10, Math.max(3, d.parkRules.split("\n").length))} />
      </Row>
      <div className="row-acts"><button className="btn primary" type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save delivery flow"}</button></div>
    </form>
  );
}

function MachinesForm({ v, set, reload }: { v: View; set: (v: View) => void; reload: () => void }) {
  const [list, setList] = useState<Machine[]>(v.machines);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(list) !== JSON.stringify(v.machines);
  const edit = (i: number, m: Partial<Machine>) => setList((xs) => xs.map((x, j) => (j === i ? { ...x, ...m } : x)));
  const submit = async () => { setBusy(true); await save({ machines: list }, "Saved the machines", set); setBusy(false); };
  return (
    <form className="set-sec" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Head title="Machines" blurb="Other machines that run agents, each with its own herdr, reached over ssh. Routines start on the first one that's ready and fall back to this Mac." />
      {!list.length && <div className="st dim">None. Routines run on this Mac.</div>}
      {list.map((m, i) => {
        const st = v.machineStatus.find((x) => x.name === m.name);
        const saved = v.machines.some((x) => x.name === m.name);
        return (
          <div key={i} className="set-machine">
            <div className="set-inline">
              <input className="field set-mname" value={m.name} placeholder="box" aria-label="Name" onChange={(e) => edit(i, { name: e.target.value })} />
              <input className="field" value={m.ssh} placeholder="user@host" aria-label="ssh target" onChange={(e) => edit(i, { ssh: e.target.value })} />
              <input className="field" value={m.reposRoot ?? ""} placeholder="~/Projects" aria-label="Repos folder" onChange={(e) => edit(i, { reposRoot: e.target.value || undefined })} />
              <label className="set-inline"><input type="checkbox" checked={m.enabled !== false} onChange={(e) => edit(i, { enabled: e.target.checked ? undefined : false })} /> On</label>
              <button type="button" className="btn sm" onClick={() => setList((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
            </div>
            <div className={`st ${st?.up ? "ok" : st && m.enabled !== false ? "pen" : "dim"}`}>
              {!saved ? "Save to connect." : m.enabled === false ? "Off: routines skip it." : !st ? "Not checked yet." : st.up ? `Connected. Cloned there: ${st.repos.join(", ") || "nothing"}.` : `Not connected: ${st.error ?? "unknown"}.`}
            </div>
          </div>
        );
      })}
      <div className="row-acts">
        <button type="button" className="btn" onClick={() => setList((xs) => [...xs, { name: "", ssh: "" }])}>Add a machine</button>
        <button className="btn primary" type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save machines"}</button>
        <button type="button" className="btn" onClick={reload}>Check again</button>
      </div>
      <div className="st dim">Each machine needs herdr, Claude and gh signed in, and the repos cloned in its repos folder. Before each run the control room copies its skills, scripts and this project's settings there; never a login or token.</div>
    </form>
  );
}

function PrLists({ v, set, reload, onOpen }: { v: View; set: (v: View) => void; reload: () => void; onOpen: (page: "removed") => void }) {
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [bot, setBot] = useState(v.botPattern);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setBot(v.botPattern), [v.botPattern]);
  const adopt = async (key: string, n: string | null) => {
    setBusy(key);
    const r = await post("/api/adopt", { ref: key, note: n, item: null });
    setBusy(null);
    toast(r.error ? `Couldn't: ${r.error}` : n === null ? `Handed back ${key}` : `Took over ${key}`);
    if (!r.error && n !== null) { setRef(""); setNote(""); }
    reload();
  };
  return (
    <section className="set-sec">
      <Head title="PRs" blurb="PRs the board treats differently from what GitHub says." />
      <Row group label="Taken over" help="Someone else's PRs that you now drive: they show as yours.">
        <span className="set-list">
          {v.adopted === null && <span className="st pen">Couldn't read the list.</span>}
          {v.adopted?.length === 0 && <span className="st dim">None.</span>}
          {v.adopted?.map((a) => (
            <span key={a.key} className="it"><code>{a.key}</code><span className="st dim">{a.note}</span>
              <button type="button" className="btn sm" disabled={busy === a.key} onClick={() => void adopt(a.key, null)}>Hand back</button></span>
          ))}
          <form className="it" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) void adopt(ref.trim(), note.trim()); }}>
            <input className="field" value={ref} placeholder="owner/repo#123 or PR link" onChange={(e) => setRef(e.target.value)} />
            <input className="field" value={note} placeholder="why (optional)" onChange={(e) => setNote(e.target.value)} />
            <button className="btn sm" type="submit" disabled={!ref.trim() || busy === ref.trim()}>Take over</button>
          </form>
        </span>
      </Row>
      <Row group label="Hidden" help="PRs and repos taken off the board.">
        <span className="set-inline"><span className="st">{v.excluded === null ? "Couldn't read the list." : v.excluded === 1 ? "1 hidden" : `${v.excluded} hidden`}</span>
          <button type="button" className="btn sm" onClick={() => onOpen("removed")}>Open Removed</button></span>
      </Row>
      <form onSubmit={(e) => { e.preventDefault(); void save({ prs: { botPattern: bot } }, "Saved the bot pattern", set); }}>
        <Row group label="Review bots" help={`Reviewers whose login matches count as bots: their activity doesn't make a PR look fresh and their reviews aren't a person's verdict. Case-insensitive. Default: ${v.defaultBotPattern}`}>
          <span className="set-inline">
            <input className="field mono" value={bot} onChange={(e) => setBot(e.target.value)} />
            <button className="btn sm" type="submit" disabled={bot === v.botPattern}>Save</button>
            {v.botPattern !== v.defaultBotPattern && <button type="button" className="btn sm" onClick={() => void save({ prs: null }, "Bot pattern back to the default", set)}>Default</button>}
          </span>
        </Row>
      </form>
    </section>
  );
}

function KnobForm({ s, title, blurb, knobs, set }: { s: Section; title: string; blurb: string; knobs: Knob[]; set: (v: View) => void }) {
  const [d, setD] = useState<Record<string, string>>(() => Object.fromEntries(knobs.map((k) => [k.key, String(k.value)])));
  const [busy, setBusy] = useState(false);
  const bad = knobs.filter((k) => { const n = Number(d[k.key]); return !Number.isInteger(n) || n < k.min || n > k.max; });
  const changed = knobs.some((k) => d[k.key] !== String(k.value));
  const atDefault = knobs.every((k) => k.value === k.def);
  const submit = async (patch: object, done: string) => { setBusy(true); await save(patch, done, set); setBusy(false); };
  return (
    <form className="set-sec knobs" onSubmit={(e) => { e.preventDefault(); if (!bad.length) void submit({ [s]: Object.fromEntries(knobs.map((k) => [k.key, Number(d[k.key])])) }, `Saved ${title.toLowerCase()}`); }}>
      <Head title={title} blurb={blurb} />
      {knobs.map((k) => (
        <Row key={k.key} label={k.label} help={`${k.help} Default ${k.def}${k.unit === ":00" ? ":00" : ` ${k.unit}`}.`}>
          <span className="set-inline">
            <input className={`field set-num ${bad.includes(k) ? "bad" : ""}`} type="number" min={k.min} max={k.max} step={1} value={d[k.key]} onChange={(e) => setD((x) => ({ ...x, [k.key]: e.target.value }))} />
            <span className="st dim">{k.unit}</span>
          </span>
        </Row>
      ))}
      {bad.length > 0 && <div className="st pen">{bad.map((k) => `${k.label}: ${k.min} to ${k.max}`).join(" · ")}</div>}
      <div className="row-acts">
        <button className="btn primary" type="submit" disabled={busy || !changed || bad.length > 0}>{busy ? "Saving…" : `Save ${title.toLowerCase()}`}</button>
        {!atDefault && <button type="button" className="btn" disabled={busy} onClick={() => void submit({ [s]: null }, `${title} back to the defaults`)}>Defaults</button>}
      </div>
    </form>
  );
}
