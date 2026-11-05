import { expect, test } from "bun:test";
import { every } from "./every";
import { saveSettings, SETTINGS } from "./settings";

test("a save re-arms a waiting timer with the new interval", async () => {
  let ms = 60_000, runs = 0;
  every(() => ms, () => { runs++; ms = 60_000; });
  await Bun.sleep(20);
  expect(runs).toBe(0);
  ms = 10;
  saveSettings({ org: SETTINGS.org ?? null }, { dryRun: true });
  await Bun.sleep(60);
  expect(runs).toBe(1);
});
