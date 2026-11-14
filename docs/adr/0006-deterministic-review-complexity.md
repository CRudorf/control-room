# Review complexity and effort are deterministic points

A review request needs a label that says how thoroughly to check it, and every work item needs a size that says how much of the user's work it takes to ship. Both come from one deterministic score in `src/shared/effort.ts`, not from an agent's judgment, so the same PR always gets the same label and the rule can be replayed against history.

**Complexity points** come from the PR's size as GitHub reports it, after dropping lockfiles, snapshots and generated files: code lines in the bands under 50 / 50-199 / 200-399 / 400-999 / 1000+ (0 to 4), more than 10 files (+1), 3 or more top-level areas (+1), 2 or more sensitive categories (schema, auth, payments, infra or CI, config: +2), 6 or more commits (+1), and a file a past PR broke (+2, from lessons). Points map to a tier: 0-1 light, 2-3 standard, 4-5 deep, 6+ critical. A migration or infra change is at least deep; a PR of only tests or docs is light. Each tier names its treatments (field guide; browser test and flow chart; video explainer), and deep and critical reviews run 3 personas. A change to UI, config, schema or dependencies asks for a browser test at any tier.

**Effort points** reuse that scale. A review request is worth its complexity points (at least 1; a re-review half, rounded up). One of the user's PRs is worth what's left on it: 1 per 2 open threads, 1 each for changes requested, failing CI and conflicts, a draft its own complexity points, else 1. An item's points sum over its PRs into Small, Medium, Large or Extra large on the tiers' cut-offs. The board groups by that size.

The size bands follow SmartBear/Cisco (200-400 lines per review) and the Kubernetes size labels. Files, spread and sensitive paths follow just-in-time defect prediction (Kamei 2013) and Google's outage data, where most outages are config and deploy changes. Replayed over the user's 190 merged PRs, the tiers rank in order of review load: light averages 0.1 human threads and 2 hours to approval, critical 2.4 threads and 77 hours (rank correlation with threads 0.49, with time to approval 0.59). The same replay changed the published rule in three places: one sensitive category alone didn't raise review load, so only two or more count; commits were the strongest single predictor, so they score; and "no tests changed" pointed the wrong way, so it doesn't.

## Considered options

- **Minutes of review time.** A published reading pace (about 420 lines an hour) would turn size into minutes, but nothing records how long the user spends reviewing, so the minutes could not be checked and claimed a precision the rule doesn't have. Rejected for points.
- **An agent's judgment.** An LLM label could read intent, but it varies between runs and can't be replayed against history. Rejected.
- **Hand-named efforts** (a level above work items, set with `y`). Never used. Replaced.

## Consequences

The rule drifts as the team and repos change: replay it against `pr_facts` now and then and move the cut-offs. The "broke before" signal is empty until breaks are confirmed into lessons.
