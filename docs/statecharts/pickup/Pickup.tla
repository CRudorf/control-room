---- MODULE Pickup ----
\* One Jira suggestion (src/server/suggestions.ts) from the suggestions list to a work item.
\* The user chooses it in the Start box and picks the steps: assign, move to In Progress, start an agent.
\* Each step is optional. A dev server only records the Jira writes (ADR 0005). An agent is a local
\* herdr tab, so it starts in dev too.
EXTENDS Naturals
VARIABLES dev, where, steps, assigned, inProgress, agent, jiraWrites, pickedUp, fp, dismissedFp, wasDismissed
vars == <<dev, where, steps, assigned, inProgress, agent, jiraWrites, pickedUp, fp, dismissedFp, wasDismissed>>
Steps == {"assign", "move", "agent"}

\* The board shows a work item for a Jira issue assigned to the user and In Progress, for a running agent,
\* or for a key in the picked set ("Picked up, not started"). Each pickup with a step adds its key to the
\* picked set, also in dev, so the key is a work item and leaves the list.
OnBoard == (assigned /\ inProgress) \/ agent \/ pickedUp
\* jira.py suggest lists To Do issues, and the list leaves out keys on the board and picked keys.
Listed == ~inProgress /\ ~OnBoard
\* The server picks up only with at least one step, and moves to In Progress only with assign.
Allowed(st) == st # {} /\ ("move" \in st => "assign" \in st)

Init == /\ dev \in BOOLEAN /\ where = "listed" /\ steps = {} /\ assigned = FALSE /\ inProgress = FALSE
        /\ agent = FALSE /\ jiraWrites = FALSE /\ pickedUp = FALSE /\ fp = 0 /\ dismissedFp = 0 /\ wasDismissed = FALSE

Choose == /\ where = "listed" /\ where' = "chosen" /\ steps' \in SUBSET Steps
          /\ UNCHANGED <<dev, assigned, inProgress, agent, jiraWrites, pickedUp, fp, dismissedFp, wasDismissed>>
Cancel == /\ where = "chosen" /\ where' = "listed" /\ steps' = {}
          /\ UNCHANGED <<dev, assigned, inProgress, agent, jiraWrites, pickedUp, fp, dismissedFp, wasDismissed>>
\* Pick up runs the chosen steps in order. In dev each Jira write is a dry run with an action record.
PickUp == /\ where = "chosen" /\ Allowed(steps)
          /\ assigned' = (assigned \/ ("assign" \in steps /\ ~dev))
          /\ inProgress' = (inProgress \/ ("move" \in steps /\ ~dev))
          /\ agent' = (agent \/ "agent" \in steps)
          /\ jiraWrites' = (jiraWrites \/ (~dev /\ steps \cap {"assign", "move"} # {}))
          /\ pickedUp' = TRUE
          /\ where' = IF OnBoard' THEN "item" ELSE IF inProgress' THEN "gone" ELSE "listed"
          /\ UNCHANGED <<dev, steps, fp, dismissedFp, wasDismissed>>
\* The server refuses a pickup with no step, or with move but not assign. Nothing changes, and the user sees why.
Refused == /\ where = "chosen" /\ ~Allowed(steps) /\ UNCHANGED vars
Dismiss == /\ where = "listed" /\ where' = "dismissed" /\ dismissedFp' = fp /\ wasDismissed' = TRUE
           /\ UNCHANGED <<dev, steps, assigned, inProgress, agent, jiraWrites, pickedUp, fp>>
\* Someone changes the status, assignee or priority in Jira: the fingerprint changes.
FingerprintChanges == /\ where \in {"listed", "dismissed"} /\ fp < 2 /\ fp' = fp + 1
                      /\ UNCHANGED <<dev, where, steps, assigned, inProgress, agent, jiraWrites, pickedUp, dismissedFp, wasDismissed>>
\* Any other change, such as the summary or a label, keeps the fingerprint.
OtherFieldChanges == /\ where = "dismissed" /\ UNCHANGED vars
Returns == /\ where = "dismissed" /\ fp # dismissedFp /\ where' = "listed"
           /\ UNCHANGED <<dev, steps, assigned, inProgress, agent, jiraWrites, pickedUp, fp, dismissedFp, wasDismissed>>
Done == where \in {"item", "gone"} /\ UNCHANGED vars

Next == Choose \/ Cancel \/ PickUp \/ Refused \/ Dismiss \/ FingerprintChanges \/ OtherFieldChanges \/ Returns \/ Done
Spec == Init /\ [][Next]_vars

\* Rules the reader agrees to.
NoJiraWriteInDev == dev => ~jiraWrites
PickedUpLeavesTheList == pickedUp => where # "listed"
PickedUpNeverVanishes == where # "gone"
DismissedReturnsOnlyOnChange == (wasDismissed /\ where = "listed") => fp # dismissedFp
====
