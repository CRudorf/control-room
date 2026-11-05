// Skins and worlds a deployment adds beyond the built-in ones. None here: a private copy of this file can
// register its own skin (with a stylesheet it imports) and a World kit for it.
import type { Skin } from "./skins";
import type { WorldKit } from "./world/kit";

export const EXTRA_SKINS: Skin[] = [];
/** A skin's own World kit, loaded when its World opens. */
export const EXTRA_WORLDS: Partial<Record<string, () => Promise<WorldKit>>> = {};
