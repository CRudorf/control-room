---- MODULE SignalToPr ----
\* One run of the signal-to-pr skill (~/.claude/skills/signal-to-pr/SKILL.md).
\* The inputs are the kind of signal and the mode, chosen at the start.
VARIABLES mode, kind, phase, asked, failingTest, codeChanged, reviewed, prReady, recorded, chosen, dupChecked
vars == <<mode, kind, phase, asked, failingTest, codeChanged, reviewed, prReady, recorded, chosen, dupChecked>>

Init == /\ mode \in {"attended", "unattended"}
        /\ kind \in {"triage", "ticket", "link", "request"}
        /\ phase = "profile"
        /\ asked = FALSE /\ failingTest = FALSE /\ codeChanged = FALSE /\ reviewed = FALSE
        /\ prReady = FALSE /\ recorded = FALSE /\ chosen = FALSE /\ dupChecked = FALSE

Go(from, to) == phase = from /\ phase' = to
Stop(from) == phase = from /\ phase' = "stopped"
Keep == UNCHANGED <<mode, kind, asked, failingTest, codeChanged, reviewed, prReady, recorded, chosen, dupChecked>>

ProfileFound   == Go("profile", "creds") /\ Keep
NoProfile      == Stop("profile") /\ Keep
CredsOk        == Go("creds", "dupes") /\ Keep
CredsFail      == Stop("creds") /\ Keep
\* Step 3 searches by "<key or endpoint>". Only a ticket key gives one before step 4 routes the signal.
NoDuplicate    == Go("dupes", "route") /\ dupChecked' = (kind = "ticket")
                  /\ UNCHANGED <<mode, kind, asked, failingTest, codeChanged, reviewed, prReady, recorded, chosen>>
DuplicateFound == Stop("dupes") /\ Keep
RouteTriage    == kind = "triage" /\ Go("route", "menu") /\ Keep
\* A ticket key was searched in step 3. A link or a request id gives an endpoint or a fingerprint only now.
RouteTicket      == kind = "ticket" /\ Go("route", "evidence") /\ Keep
RouteSignal    == kind \in {"link", "request"} /\ Go("route", "dupes2") /\ Keep
YouChoose      == mode = "attended" /\ Go("menu", "dupes2") /\ chosen' = TRUE
                  /\ UNCHANGED <<mode, kind, asked, failingTest, codeChanged, reviewed, prReady, recorded, dupChecked>>
NoChoice       == Stop("menu") /\ Keep
\* Step 4a: the second search for duplicate work, by the endpoint or the fingerprint, before the pack.
NoDuplicateAgain == Go("dupes2", "evidence") /\ dupChecked' = TRUE
                    /\ UNCHANGED <<mode, kind, asked, failingTest, codeChanged, reviewed, prReady, recorded, chosen>>
DuplicateAgain   == Stop("dupes2") /\ Keep
PackWritten    == Go("evidence", "gates") /\ Keep
GatesPass      == Go("gates", "test") /\ Keep
GateAsks       == mode = "attended" /\ Go("gates", "asking") /\ asked' = TRUE
                  /\ UNCHANGED <<mode, kind, failingTest, codeChanged, reviewed, prReady, recorded, chosen, dupChecked>>
GateStops      == mode = "unattended" /\ Stop("gates") /\ Keep
YouSayGoOn     == Go("asking", "test") /\ Keep
YouSayStop     == Stop("asking") /\ Keep
TestFails      == Go("test", "fix") /\ failingTest' = TRUE
                  /\ UNCHANGED <<mode, kind, asked, codeChanged, reviewed, prReady, recorded, chosen, dupChecked>>
FixPasses      == Go("fix", "review") /\ codeChanged' = TRUE
                  /\ UNCHANGED <<mode, kind, asked, failingTest, reviewed, prReady, recorded, chosen, dupChecked>>
ReviewOk       == Go("review", "handback") /\ reviewed' = TRUE
                  /\ UNCHANGED <<mode, kind, asked, failingTest, codeChanged, prReady, recorded, chosen, dupChecked>>
ReviewFixes    == mode = "attended" /\ Go("review", "fix") /\ Keep
ReviewStops    == mode = "unattended" /\ Stop("review") /\ Keep
HandBack       == Go("handback", "envfirst") /\ prReady' = TRUE
                  /\ UNCHANGED <<mode, kind, asked, failingTest, codeChanged, reviewed, recorded, chosen, dupChecked>>
FirstEnvOk      == Go("envfirst", "envlast") /\ Keep
LastEnvOk         == Go("envlast", "stopped") /\ Keep
Record         == phase = "stopped" /\ phase' = "recorded" /\ recorded' = TRUE
                  /\ UNCHANGED <<mode, kind, asked, failingTest, codeChanged, reviewed, prReady, chosen, dupChecked>>
Done           == phase = "recorded" /\ UNCHANGED vars

Next == ProfileFound \/ NoProfile \/ CredsOk \/ CredsFail \/ NoDuplicate \/ DuplicateFound
     \/ RouteTriage \/ RouteTicket \/ RouteSignal \/ YouChoose \/ NoChoice \/ NoDuplicateAgain \/ DuplicateAgain \/ PackWritten
     \/ GatesPass \/ GateAsks \/ GateStops \/ YouSayGoOn \/ YouSayStop
     \/ TestFails \/ FixPasses \/ ReviewOk \/ ReviewFixes \/ ReviewStops
     \/ HandBack \/ FirstEnvOk \/ LastEnvOk \/ Record \/ Done

Spec == Init /\ [][Next]_vars

\* Rules the reader agrees to.
NoCodeBeforeFailingTest == codeChanged => failingTest
NoPrWithoutReview == prReady => reviewed
UnattendedNeverAsks == mode = "unattended" => ~asked
EveryRunRecorded == phase = "recorded" => recorded
TriageWithoutChoiceNeverFixes == (kind = "triage" /\ ~chosen) => ~codeChanged
NoFixWithoutDuplicateCheck == codeChanged => dupChecked
====
