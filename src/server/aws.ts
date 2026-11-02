import { SETTINGS } from "./settings";
// The AWS MFA session that a project's log readers use (`AWS_PROFILE=mfa`). The control room
// mints it with the script in this project's settings (`awsMfaScript`) (ADR 0001: scripts run as subprocesses) and
// keeps the expiry, so the header can count down to it.
import { repoPath } from "./repos";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load, save } from "./db";
import { read, write } from "./runner";

export const MFA_SCRIPT = SETTINGS.awsMfaScript ? repoPath(SETTINGS.awsMfaScript.split("/")[0]) + "/" + SETTINGS.awsMfaScript.split("/").slice(1).join("/") : "";
export const PROFILE = "mfa";
const KEY = "aws_mfa";

export type AwsSession = { disabled?: boolean; profile: string; expiresAt: string | null; valid: boolean | null; script: boolean };

/** The expiry from the script's last line: "... expires 2026-11-01T05:28:10+00:00". */
export function parseExpiry(out: string): string | null {
  const m = out.match(/expires\s+(\S+)\s*$/m);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const isCode = (code: string) => /^\d{6}$/.test(code);

let probe: { at: number; valid: boolean } | null = null;

/** Whether the profile works now. Used when the session was minted outside the control room. */
async function probeValid(): Promise<boolean> {
  if (probe && Date.now() - probe.at < 5 * 60_000) return probe.valid;
  const valid = await read(["aws", "sts", "get-caller-identity", "--profile", PROFILE, "--output", "text"], { stderr: "ignore" }).then(() => true, () => false);
  probe = { at: Date.now(), valid };
  return valid;
}

export async function awsSession(): Promise<AwsSession> {
  // Only a project that uses AWS shows the chip.
  if (!SETTINGS.aws) return { profile: PROFILE, expiresAt: null, valid: null, script: false, disabled: true };
  const expiresAt = load<string>(KEY);
  const script = existsSync(MFA_SCRIPT);
  // A known expiry in the future needs no network call; an unknown one asks STS.
  if (expiresAt && Date.parse(expiresAt) > Date.now()) return { profile: PROFILE, expiresAt, valid: true, script };
  return { profile: PROFILE, expiresAt, valid: await probeValid(), script };
}

/** Runs aws-mfa.sh with the authenticator code. The new keys go straight into ~/.aws/credentials. */
export async function refreshMfa(code: string): Promise<AwsSession> {
  if (!isCode(code)) throw new Error("the code is 6 digits");
  if (!existsSync(MFA_SCRIPT)) throw new Error(`no script at ${MFA_SCRIPT}`);
  let out = "";
  // The code is a secret for 30 seconds: `sent` names the script and profile, never the code.
  await write({ item: null, trigger: "header" }, "aws-mfa", `aws-mfa.sh --profile ${PROFILE}`, async () => {
    out = await read(["bash", MFA_SCRIPT, code, "--profile", PROFILE]);
    return "refreshed";
  }, { liveInDev: true });
  const expiresAt = parseExpiry(out);
  save(KEY, expiresAt);
  probe = null;
  return { profile: PROFILE, expiresAt, valid: true, script: true };
}
