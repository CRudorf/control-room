// Settings: how the control room looks. The theme (light, dark or the system's) and the skin.
import { useEffect } from "react";
import { SKINS, type SkinId, skinOf } from "./skins";

export type Theme = "system" | "light" | "dark";
const THEMES: { t: Theme; label: string }[] = [{ t: "system", label: "System" }, { t: "light", label: "Light" }, { t: "dark", label: "Dark" }];

export function Settings({ theme, setTheme, skin, setSkin, onClose }: {
  theme: Theme; setTheme: (t: Theme) => void; skin: SkinId; setSkin: (s: SkinId) => void; onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [onClose]);
  const themed = skinOf(skin).themed;
  return (
    <div className="settings">
      <div className="vv-head"><b className="vt">Settings</b><span className="st dim">Kept in this browser.</span>
        <div className="row-acts"><button className="btn" onClick={onClose}>Close <kbd>esc</kbd></button></div></div>
      <div className="vfy-body">
        <section className="vfy-check">
          <div className="vfy-check-h"><b>Skin</b><span className="st dim">The whole look of the board.</span></div>
          <div className="skin-list" role="radiogroup" aria-label="Skin">
            {SKINS.map((s) => (
              <button key={s.id} role="radio" aria-checked={skin === s.id} className={`skin-card ${skin === s.id ? "on" : ""}`} onClick={() => setSkin(s.id)}>
                <span className="skin-sw">{s.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span>
                <b>{s.name}</b><span className="st dim">{s.blurb}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="vfy-check">
          <div className="vfy-check-h"><b>Theme</b><span className="st dim">{themed ? "Light, dark, or whatever the system uses." : `${skinOf(skin).name} has its own colours, so the theme doesn't change it.`}</span></div>
          <div className="seg" role="radiogroup" aria-label="Theme">
            {THEMES.map(({ t, label }) => (
              <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "on" : ""} disabled={!themed} onClick={() => setTheme(t)}>{label}</button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
