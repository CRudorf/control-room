---- MODULE Lanes ----
\* One work item on the board and the lane it shows in (GLOSSARY.md: Lane, Ball, Dependency, Agent, Parked,
\* Finished, Review request, Waiting on author). The item is the user's own work, or a review request.
\* A review request can share a Jira issue with the user's own work item.
VARIABLES kind, sharesJira, groupedInto, ball, blocked, agent, parked, prs, review, wokeBy
vars == <<kind, sharesJira, groupedInto, ball, blocked, agent, parked, prs, review, wokeBy>>

Init == /\ kind \in {"own", "review"}
        /\ sharesJira \in BOOLEAN
        /\ groupedInto = "none"
        /\ ball = "reviewer" /\ blocked = FALSE /\ agent = "none" /\ parked = FALSE
        /\ prs = "open" /\ review = (IF kind = "review" THEN "asked" ELSE "none") /\ wokeBy = "none"

\* The lane the board shows, in the order workitems.ts decides it: Parked wins over the rest.
Lane ==
  IF kind = "own" /\ prs = "done" /\ agent = "none" THEN "finished"
  ELSE IF parked THEN "parked"
  ELSE IF kind = "review" THEN (IF review = "asked" THEN "asked" ELSE IF review = "author" THEN "waiting" ELSE "finished")
  ELSE IF agent = "waiting" THEN "mine"
  ELSE IF blocked THEN "waiting"
  ELSE IF agent = "working" THEN "waiting"
  ELSE IF ball = "user" THEN "mine" ELSE "waiting"

Open == Lane # "finished"
OwnOpen == kind = "own" /\ prs = "open"
Ready == groupedInto # "none" /\ ~parked
Idle == OwnOpen /\ Ready /\ agent = "none" /\ ~blocked

\* Work item key: a review request is keyed by its PR, the user's own work by its Jira issue.
Group == /\ groupedInto = "none"
         /\ groupedInto' = IF kind = "review" THEN "its own PR" ELSE "the Jira issue"
         /\ UNCHANGED <<kind, sharesJira, ball, blocked, agent, parked, prs, review, wokeBy>>

\* A person acts: feedback, a review re-request, a mention, or the author acts on a review handed back.
PersonActs == /\ Ready
              /\ \/ kind = "own" /\ OwnOpen /\ agent = "none" /\ ball = "reviewer" /\ ball' = "user" /\ review' = review
                 \/ kind = "review" /\ review = "author" /\ review' = "asked" /\ ball' = ball
              /\ UNCHANGED <<kind, sharesJira, groupedInto, blocked, agent, parked, prs, wokeBy>>
\* A parked item wakes when a person does something new on it, or when its until-date passes.
PersonWakes == /\ parked /\ Open /\ parked' = FALSE /\ wokeBy' = "person"
               /\ ball' = (IF kind = "own" THEN "user" ELSE ball)
               /\ review' = (IF kind = "review" THEN "asked" ELSE review)
               /\ UNCHANGED <<kind, sharesJira, groupedInto, blocked, agent, prs>>
DatePasses == /\ parked /\ Open /\ parked' = FALSE /\ wokeBy' = "date"
              /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, agent, prs, review>>
\* A bot comment, CI or a push. Nothing a person did, so it does not wake a parked item.
BotActs == /\ Open /\ groupedInto # "none" /\ UNCHANGED vars
UserPushes == /\ Idle /\ ball = "user" /\ ball' = "reviewer"
              /\ UNCHANGED <<kind, sharesJira, groupedInto, blocked, agent, parked, prs, review, wokeBy>>
SetDependency == /\ Idle /\ blocked' = TRUE
           /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, agent, parked, prs, review, wokeBy>>
DependencyOpens == /\ Ready /\ blocked /\ blocked' = FALSE
             /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, agent, parked, prs, review, wokeBy>>
\* Handoff: The user gives his turn to an agent.
StartAgent == /\ Idle /\ ball = "user" /\ agent' = "working"
              /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, parked, prs, review, wokeBy>>
\* The agent can ask for input at any time. An agent waiting for input wakes a parked item, the same
\* as a person's comment: the item is My turn, and the agent's question is the why.
AgentAsks == /\ agent = "working" /\ agent' = "waiting"
             /\ parked' = FALSE
             /\ wokeBy' = (IF parked THEN "agent" ELSE wokeBy)
             /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, prs, review>>
UserAnswers == /\ Ready /\ agent = "waiting" /\ agent' = "working"
               /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, parked, prs, review, wokeBy>>
\* The agent pushes its fix and ends: the reviewer has the ball.
AgentEnds == /\ Ready /\ agent = "working" /\ agent' = "none" /\ ball' = "reviewer"
             /\ UNCHANGED <<kind, sharesJira, groupedInto, blocked, parked, prs, review, wokeBy>>
\* An agent that waits for input wakes the item at once, so a park holds only while no agent waits.
Park == /\ Ready /\ Open /\ agent # "waiting" /\ parked' = TRUE
        /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, agent, prs, review, wokeBy>>
AllMergedOrClosed == /\ Idle /\ ball = "user" /\ prs' = "done"
                     /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, agent, parked, review, wokeBy>>
\* Waiting on author: The user hands a review request back to its author.
HandBackToAuthor == /\ kind = "review" /\ Ready /\ review = "asked" /\ review' = "author"
                    /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, agent, parked, prs, wokeBy>>
UserReviews == /\ kind = "review" /\ Ready /\ review = "asked" /\ review' = "done"
               /\ UNCHANGED <<kind, sharesJira, groupedInto, ball, blocked, agent, parked, prs, wokeBy>>
Done == Lane = "finished" /\ UNCHANGED vars

Next == Group \/ PersonActs \/ PersonWakes \/ DatePasses \/ BotActs \/ UserPushes \/ SetDependency \/ DependencyOpens
     \/ StartAgent \/ AgentAsks \/ UserAnswers \/ AgentEnds \/ Park \/ AllMergedOrClosed
     \/ HandBackToAuthor \/ UserReviews \/ Done
Spec == Init /\ [][Next]_vars

\* Rules from GLOSSARY.md.
ReviewRequestNeverInOwnItem == kind = "review" => groupedInto # "the Jira issue"
AgentWaitingIsMyTurn == agent = "waiting" => Lane = "mine"
BotsNeverWake == wokeBy # "bot"
FinishedMeansAllDone == (kind = "own" /\ Lane = "finished") => (prs = "done" /\ agent = "none")
BlockedIsWaiting == (blocked /\ agent # "waiting" /\ ~parked) => Lane = "waiting"
ParkedNeverNotifies == parked => Lane \in {"parked", "finished"}
====
