# Verification video spec

This spec defines the optional video for one verification run. A tuning can name an approved example.

## Purpose

The video shows a reviewer what a change does and how the run tested the change. The audience is technical: the reviewer and the change's owner. The video does not replace the run's results or the user's verdict.

## When to make a video

- Make a video only when the user or the control room asks for one. The video is optional.
- Make the video after the run's items have results.
- Make the video from one run that the control room started, with the real build. Do not use a sass-compiled stylesheet.
- Do not record footage of the behavior before the change.

## Format

- Use HyperFrames. Make one video at 1920x1080, with no narration and no sound.
- Use on-screen text for all explanation.
- Let the content set the length. Do not add scenes to fill time.
- Use text of 28px or larger in the 1920x1080 frame.

## Rules for truth

1. Use real footage from the run. Do not show a mock-up of the product.
2. Record the footage from the commit that the video names.
3. Show real log lines from the same run. Remove secrets, tokens, user ids and email addresses.
4. Generate each result from `results.json`. Do not type a result by hand.
5. State each result in the words of its criterion. Show a number only when the criterion or the mockup states the number.
6. Show a failed, not-tested or not-compared item with that status. Do not leave the item out.
7. Label the results as the agent's results, with the verdict pending. Do not show a result as the user's verdict.
8. Show the test conditions on each frame or on the results scene. Include the commit, the server, the test data and other limits of the proof.
9. If a scene shows a summary of code, do not present the summary as a code excerpt.

## Scenes

Use these scenes in this order. Leave out a scene when the run has nothing real to show for it.

1. **The problem.** One headline and one short sentence, from the ticket.
2. **Each surface.** Footage of the behavior on each surface that the run tested, with a short caption.
3. **The request.** Footage beside the real log line and the real page attribute or state that drives the behavior.
4. **How it works.** Up to four short steps, from the server to the script.
5. **Edge cases.** Footage of each outcome that the ticket names, such as an alert.
6. **Decision logic.** A small table, when the change picks between outcomes.
7. **Window widths.** Footage at the widths that the run tested. Show the widths that fit, and list the rest in the caption.
8. **Results.** One row for each acceptance criterion and one column for each surface, with the verdict pending. Hold this scene long enough to read.

## A persistent strip

Each frame shows the PR, the ticket, the short commit hash and the test conditions.

## Inputs from the run

- `results.json`
- One recording for each surface, each edge case and each width. The recording in a run folder is the source.
- The server log for the run
- The ticket's acceptance criteria

## Checks before hand-back

1. Run `npx hyperframes check`. It must report no errors. Ignore a "no sound" warning.
2. Look at a frame from each scene at full size.
3. Compare each result on the results scene with `results.json`.
4. Save the video and its source in the visual store: `<state>/visuals/video-<key>-<short commit>/`, with `state` from `verify.py where`. Put the source in a `source` subfolder. Write `meta.json` with `kind` set to `"video"`, the key, the PR, `rulesHold` set to `null`, and the video in `files`. Put the run id in `reason`.

## Automation

- Find the way to fill a template from `results.json`. The first example was hand-written. If HyperFrames variables cannot fill it, generate the scene files from `results.json`.
- Split the scenes into sub-compositions. The example is one file, and `hyperframes check` warns about its structure.
- A toggle in the Start box, off by default, starts the video through `/signal-to-pr ... video`.
