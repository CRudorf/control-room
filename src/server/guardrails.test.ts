import { describe, expect, test } from "bun:test";
import { protectionGaps, settingsGaps, type Settings } from "./guardrails";

const SANDBOX = { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false };
const DENY = ["Read(**/.env*)", "Read(**/*.pem)", "Read(~/.aws/**)"];
const tight: Settings = { permissions: { deny: DENY }, sandbox: SANDBOX };

describe("settings gaps", () => {
  test("tight settings have none", () => {
    expect(settingsGaps(tight)).toEqual([]);
  });

  test("no settings file reports every guardrail", () => {
    expect(settingsGaps(null)).toEqual([
      "No Read deny rule for .env, keys (*.pem, *.key, ~/.ssh), credentials (~/.aws, credentials files)",
      "Sandbox is off (sandbox.enabled)",
      "Sandbox fails open when unavailable (sandbox.failIfUnavailable)",
      "Commands can retry outside the sandbox (sandbox.allowUnsandboxedCommands)",
    ]);
  });

  test("names only the secrets no deny rule covers", () => {
    expect(settingsGaps({ ...tight, permissions: { deny: ["Read(./.env)", "Bash(cat *)"] } }))
      .toEqual(["No Read deny rule for keys (*.pem, *.key, ~/.ssh), credentials (~/.aws, credentials files)"]);
  });

  test("a bare Read deny covers every secret", () => {
    expect(settingsGaps({ ...tight, permissions: { deny: ["Read"] } })).toEqual([]);
  });

  test("local settings add deny rules and override sandbox values", () => {
    const local: Settings = { permissions: { deny: ["Read(~/.ssh/**)"] }, sandbox: { allowUnsandboxedCommands: true } };
    expect(settingsGaps({ ...tight, permissions: { deny: ["Read(.env)", "Read(**/credentials.json)"] } }, local))
      .toEqual(["Commands can retry outside the sandbox (sandbox.allowUnsandboxedCommands)"]);
  });

  test("soft_deny only matters when it drops the defaults", () => {
    expect(settingsGaps({ ...tight, autoMode: { soft_deny: ["$defaults", "Never touch the fake-widgets bucket"] } })).toEqual([]);
    expect(settingsGaps({ ...tight, autoMode: { soft_deny: ["Never touch the fake-widgets bucket"] } }))
      .toEqual(["autoMode.soft_deny drops the defaults and has no production deploy rule"]);
    expect(settingsGaps({ ...tight, autoMode: { soft_deny: ["Never deploy to prod without asking"] } })).toEqual([]);
  });

  test("autoMode in local settings is ignored, as Claude Code ignores it", () => {
    expect(settingsGaps(tight, { autoMode: { soft_deny: ["Never touch the fake-widgets bucket"] } })).toEqual([]);
  });
});

describe("branch protection gaps", () => {
  test("unprotected default branches are gaps; unknown ones aren't", () => {
    expect(protectionGaps(new Map([
      ["acme/widgets", { branch: "main", protected: true }],
      ["acme/gadgets", { branch: "trunk", protected: false }],
      ["acme/private", null],
    ]))).toEqual(["acme/gadgets: trunk isn't protected"]);
  });
});
