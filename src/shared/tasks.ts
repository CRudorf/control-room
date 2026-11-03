// A guess at what an agent is for from its tab label's verb, for sessions the control room didn't start.
// The server prefers what it started an agent for, or the last skill its session ran (server/tasks.ts).
import type { AgentTask } from "./types";

export function taskOfLabel(label: string): AgentTask {
  if (/^selfreview\b/.test(label)) return "selfreview";
  if (/^review\b/.test(label)) return "review";
  if (/^(verify|check)\b/.test(label)) return "verify";
  if (/^chart\b/.test(label)) return "chart";
  if (/^(feedback|ci|conflicts|fixreview|fix|stack)\b/.test(label)) return "fix";
  if (/^agent (loop|lesson|arch|stop-check)-/.test(label)) return "improve";
  return "build";
}
