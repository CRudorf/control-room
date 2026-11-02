import { useEffect, useRef, useState } from "react";

type Session = { profile: string; expiresAt: string | null; valid: boolean | null; script: boolean; error?: string };

/** "7h 12m", "42m", "58s". */
export function left(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
}

/** The AWS MFA session in the header: a countdown to its expiry, and a box for the authenticator code. */
export function AwsSession() {
  const [s, setS] = useState<Session | null>(null);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const fetchS = () => fetch("/api/aws").then((r) => r.json()).then(setS).catch(() => {});
  useEffect(() => { fetchS(); const t = setInterval(fetchS, 5 * 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  if (!s?.script) return null;
  const ms = s.expiresAt ? Date.parse(s.expiresAt) - now : null;
  const live = ms !== null ? ms > 0 : !!s.valid;
  const tone = !live ? "bad" : ms !== null && ms < 60 * 60_000 ? "warn" : "ok";
  const label = !live ? "AWS expired" : ms !== null ? `AWS ${left(ms)}` : "AWS signed in";

  const submit = async () => {
    setBusy(true); setErr("");
    const r = await fetch("/api/aws/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })
      .then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setS(r); setCode(""); setOpen(false);
  };

  return (
    <span className="awswrap">
      <button className={`awschip ${tone}`} onClick={() => setOpen((x) => !x)}
        title={s.expiresAt ? `'${s.profile}' profile expires ${new Date(s.expiresAt).toLocaleString()}` : `'${s.profile}' profile`}>
        <i />{label}
      </button>
      {open && (
        <form className="awspop" onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
          <label>MFA code
            <input ref={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
          </label>
          <button type="submit" disabled={busy || code.length !== 6}>{busy ? "Signing in" : "Sign in"}</button>
          {err && <div className="awserr">{err}</div>}
        </form>
      )}
    </span>
  );
}
