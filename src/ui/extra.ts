// Skins and worlds a deployment adds beyond the built-in ones. None here: a private deployment fills these in.
import type { Skin } from "./skins";
import type { WorldKit } from "./world/kit";

export const EXTRA_SKINS: Skin[] = [];
export const EXTRA_WORLDS: Partial<Record<string, () => Promise<WorldKit>>> = {};
