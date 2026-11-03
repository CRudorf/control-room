// Test preload (bunfig.toml): state goes to a fresh temp folder, never the installed app's DB.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CR_STATE_DIR = mkdtempSync(join(tmpdir(), "cr-test-"));
// Tests never read the private project map. Everything under acme and the example owners is this test project.
process.env.CR_PROJECT = "test";
process.env.CR_PROJECTS_PATH = join(process.env.CR_STATE_DIR ?? tmpdir(), "projects-test.json");
process.env.CR_SETTINGS = join(process.env.CR_STATE_DIR ?? tmpdir(), "settings-test.json");
writeFileSync(process.env.CR_PROJECTS_PATH, JSON.stringify({ default: "test", owners: { acme: "test", "o": "test", org: "test" }, repos: {} }));
writeFileSync(process.env.CR_SETTINGS, JSON.stringify({ flow: { stages: ["staging", "master"], testingStatus: "Testing", approvedStatus: "Approved", who: "Product", copySuffix: "-stage" } }));
