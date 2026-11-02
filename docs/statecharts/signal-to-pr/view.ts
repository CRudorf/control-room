const LABEL: Record<string, string> = {
  profile: "Reading the tuning and credentials", creds: "Reading the tuning and credentials", dupes: "Looking for duplicate work",
  route: "Looking for duplicate work", menu: "Showing the triage menu", dupes2: "Looking for duplicate work again", evidence: "Building the evidence pack",
  gates: "Checking the gates", asking: "Asking you", test: "Writing a failing test", fix: "Fixing until the test passes",
  review: "Independent review", handback: "Handing back", envfirst: "Verifying after deploy", envlast: "Verifying after deploy",
  stopped: "Run over", recorded: "Run record written",
};
export const title = "signal-to-pr: one run";
export const state = (v: any) => LABEL[v.phase];
const GROUP: Record<string, string> = {
  profile: "checks", creds: "checks", dupes: "checks", route: "checks", menu: "find", dupes2: "checks", evidence: "find", gates: "find", asking: "you",
  test: "fix", fix: "fix", review: "fix", handback: "ship", envfirst: "ship", envlast: "ship", stopped: "end", recorded: "end",
};
export const group = (v: any) => GROUP[v.phase];
export const colors = { checks: "tan", find: "blue", you: "pink", fix: "orange", ship: "teal", end: "purple" };
const STEP: Record<string, string> = {
  ProfileFound: "the profile is there", NoProfile: "a credential fails",
  CredsOk: "the tuning and credentials are ok", CredsFail: "a credential fails",
  NoDuplicate: "no open work for it", DuplicateFound: "open work for it exists",
  RouteTriage: "none found, no signal given", RouteTicket: "none found, a ticket key", RouteSignal: "none found, a link or request id",
  NoDuplicateAgain: "no open work for the endpoint or fingerprint", DuplicateAgain: "open work for it exists",
  YouChoose: "you choose a finding", NoChoice: "no finding chosen",
  PackWritten: "the pack is written", GatesPass: "every gate passes",
  GateAsks: "a gate fails [attended]", GateStops: "a gate fails [unattended]",
  YouSayGoOn: "you say go on", YouSayStop: "you say stop",
  TestFails: "the new test fails", FixPasses: "the test passes",
  ReviewOk: "the reviewer finds no problem", ReviewFixes: "the reviewer finds a problem [attended]",
  ReviewStops: "the reviewer finds a problem [unattended]",
  HandBack: "you deploy", LastEnvOk: "each environment has a verdict",
  Record: "the run record is written",
};
export const step = (a: string) => STEP[a] ?? null;
