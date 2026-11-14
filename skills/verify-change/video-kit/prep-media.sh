#!/usr/bin/env bash
# Footage and screenshots for the video, from the run folder into assets/ (webm -> h264 mp4, no audio).
# usage: prep-media.sh <run dir> <clips file> [shot names...]
# The clips file has one line per clip:  <name> <source webm, no extension> <start s|auto> <slow> <scene length s>
#   start auto: where find_start.py sees the app's header bar appear for the last time (after login). A step
#   that reloads the page mid-recording gets the last reload: give such a clip a number.
#   slow: 1 plays as recorded, 1.5 plays at two thirds speed. The last frame is held to fill the scene.
# Shot names are copied to assets/shots/ from <run>/shots/<name>.png, or from <run>/<name>.png where the run keeps
# its screenshots (verify-change Step 3).
set -euo pipefail
RUN=$1 CLIPS=$2; shift 2
KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p assets/video assets/shots
while read -r name src start slow len; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  if [[ "$start" == auto ]]; then
    start=$(python3 "$KIT/find_start.py" --quiet "$RUN/video/$src.webm")
  fi
  ffmpeg -loglevel error -y -ss "$start" -i "$RUN/video/$src.webm" -an \
    -vf "setpts=${slow}*PTS,tpad=stop_mode=clone:stop_duration=${len}" -t "$len" \
    -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 20 -r 30 "assets/video/$name.mp4" </dev/null
  echo "$name: $src from ${start}s, x$slow, ${len}s"
done < "$CLIPS"
for s in "$@"; do
  if [[ -f "$RUN/shots/$s.png" ]]; then cp "$RUN/shots/$s.png" assets/shots/; else cp "$RUN/$s.png" assets/shots/; fi
done
