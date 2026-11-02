// Work item keys (GLOSSARY: Work item key): the shapes of id that name an issue, in any system that uses them.
// An error report's short id: org prefix, a one- or two-digit number, the project, the issue (ABC-3-CLIENT-N).
export const ERROR_ID = /\b([A-Z][A-Z0-9]*-\d{1,2}-[A-Z][A-Z0-9]*-[A-Z0-9]{1,4})\b/;
const TRACKER = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export function errorKey(text: string): string | null {
  return text.toUpperCase().match(ERROR_ID)?.[1] ?? null;
}

export function trackerKey(text: string, projects?: Set<string>): string | null {
  const upper = text.toUpperCase();
  const err = errorKey(upper);
  const scrubbed = err ? upper.replace(err, " ") : upper;
  for (const m of scrubbed.matchAll(TRACKER)) {
    const project = m[1].split("-")[0];
    if (!projects || projects.has(project)) return m[1];
  }
  return null;
}
