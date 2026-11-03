// Skins: a whole look for the board, chosen on the Settings page. A skin is one stylesheet keyed on
// <html data-skin="<id>"> (src/ui/skins/<id>.css, linked from index.html), plus what it adds to the page.
// The default skin has no stylesheet: it's styles.css, with the light and dark themes.

export type SkinId = "default" | "osrs";

export type Skin = {
  id: SkinId;
  name: string;
  blurb: string;
  /** Follows the light and dark themes. A skin with its own fixed palette doesn't. */
  themed: boolean;
  /** Shows the minimap in the header. */
  minimap: boolean;
  /** Stylesheets to load the first time the skin is on, such as web fonts. */
  fonts: string[];
  /** Colours for the swatch on the Settings page. */
  swatch: string[];
};

export const SKINS: Skin[] = [
  { id: "default", name: "Default", blurb: "Flight strips on a rack, light or dark.", themed: true, minimap: false, fonts: [], swatch: ["#dbe2ea", "#f2dcab", "#b6e0d7", "#f6c3b4"] },
  { id: "osrs", name: "Old School RS", blurb: "Stone, parchment and a minimap, after the 2007 game client.", themed: false, minimap: true,
    fonts: ["https://fonts.googleapis.com/css2?family=Pixelify+Sans&display=swap"], swatch: ["#4b4032", "#d3c4a0", "#ffff00", "#ff981f"] },
];

export const skinOf = (id: string): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0];

/** Puts a skin on the page: its attribute, and its fonts the first time. */
export function applySkin(id: SkinId) {
  const s = skinOf(id);
  if (s.id === "default") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", s.id);
  for (const href of s.fonts) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
  }
}
