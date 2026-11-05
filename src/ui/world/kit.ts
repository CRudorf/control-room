// A world kit: what the World draws and calls things, for one skin. The layout, paths and what each agent does
// come from map.ts and agents.ts and are the same in every kit; a kit swaps the models and the names.
// The town (scene.ts) is the default; a skin can bring its own through src/ui/extra.ts.
import type * as THREE from "three";
import type { AgentTask } from "../../shared/types";
import type { Skill, Spot } from "./map";
import { type Bit, buildTown, burst, hintArrow, keeper, type Keeper, minimapImage, outfit, type Person, person, scroll, SHIRTS, tool } from "./scene";

export type WorldKit = {
  buildTown: () => { scene: THREE.Scene; ground: THREE.Mesh; roofs: THREE.Object3D[]; walls: THREE.Mesh[] };
  person: (shirt: number, legs?: number, seed?: number) => Person;
  outfit: (task: AgentTask) => THREE.Object3D;
  keeper: (kind: Keeper) => Person;
  tool: (kind: Skill | "mug" | "sword" | "staff") => THREE.Group;
  scroll: (pin: number) => THREE.Group;
  hintArrow: (color: number) => THREE.Group;
  minimapImage: () => HTMLCanvasElement;
  shirts: number[];
  /** A building's name and what it's for, by id, where the kit calls it something else. */
  buildings: Record<string, { name: string; does?: string }>;
  /** An area's name (map.ts AREAS), where the kit calls it something else. */
  areas: Record<string, string>;
  /** What a skill's work is called in chat ("Smithing at an anvil"), where the kit says it differently. */
  verbs: Partial<Record<Skill, string>>;
  /** The chat box's first lines. */
  welcome: { t: string; c?: "blue" }[];
  /** What the ground is, when examined. */
  ground: string;
  /** The Quest board's name over it. */
  board: string;
  /** What an agent is doing when examined, by what it's at: waiting on a review, spent, idle. */
  pray: string; burn: string; drink: string;
  /** Where resting agents go, in order, in place of the Inn's seats. */
  seats?: Spot[];
  /** A resting agent: what it holds (the town's mug of ale), and in place of drinking, a pose each frame and now and
   *  then an effect over it. */
  rest: { held: "mug" | null; pose?: (p: Person, t: number, seed: number) => void; fx?: (scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number) => void };
  /** A self-review and its PR's session at odds: the effect when the self-review lands one, what each is doing, and
   *  the line when the session takes the findings. */
  fight: { hit: (scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number) => void; attack: string; defend: string; holding: string; fighting: string; defeat: (winner: string, loser: string) => string };
  /** The side panel's words: its three tabs, the list of what needs you, the stats, the experience counter. */
  panel: { quests: string; stats: string; options: string; list: string; statsTitle: string | null; total: string; xp: string; how: string };
  /** How the view is drawn. Left out, it's the client's: rendered small and scaled up in chunky pixels. `sharp` draws
   *  at the screen's full resolution, smoothed; `shadows` lets the kit's lights cast them; `exposure` turns on filmic
   *  tone mapping at that brightness; `environment` lights everything from a studio's surroundings too, so metal and
   *  glass reflect, at that strength; `ao` darkens creases and contact with ambient occlusion; `bloom` lets bright
   *  lights glow, at that strength. */
  render?: { sharp?: boolean; shadows?: boolean; exposure?: number; environment?: number; ao?: boolean; bloom?: number };
};

export const TOWN: WorldKit = {
  buildTown, person, outfit, keeper, tool, scroll, hintArrow, minimapImage, shirts: SHIRTS,
  buildings: {}, areas: {}, verbs: {},
  welcome: [{ t: "Welcome to the control room." }, { t: "Everyone you see is an agent. What needs you is pinned on the Quest board north of the fountain: yellow pins are your turn, red are asked of you, most pressing top left.", c: "blue" }],
  ground: "Grass. It could do with a trim.",
  board: "Quest board", pray: "praying for a review from", burn: "burning its logs: done,", drink: "enjoying an ale at the Inn",
  rest: { held: "mug" },
  fight: {
    hit: (scene, bits, x, y, z) => burst(scene, bits, x, y, z, 0x40a0ff, 6, 0.8, true),
    attack: "Fighting the review", defend: "Self-review",
    holding: "holding the self-review's findings until its PR's session takes them", fighting: "fighting its self-review for the findings",
    defeat: (w, l) => `${w} has defeated ${l}! The review's findings are back with ${w}.`,
  },
  panel: { quests: "Quests", stats: "Stats", options: "Options", list: "Quest List", statsTitle: null, total: "Total level", xp: "XP",
    how: "XP comes from the board: CI passing, approvals and answered threads, agents finishing, and work shipping." },
};

/** A building's name and purpose in a kit. */
export const named = (kit: WorldKit, b: { id: string; name: string; does: string }) => ({ name: kit.buildings[b.id]?.name ?? b.name, does: kit.buildings[b.id]?.does ?? b.does });
