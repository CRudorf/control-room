#!/usr/bin/env bash
# One contact sheet of frames from a rendered video, 640px per frame, to find a scene worth a closer look.
# usage: frames.sh <video.mp4> <out.png> <second> [<second> ...]
# Look at the sheet to choose; then pull the one frame being judged at full size (spec check 2).
set -euo pipefail
video=$1 out=$2; shift 2
[[ -f "$video" ]] || { echo "no video at $video" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/frames.XXXXXX")
i=0
for t in "$@"; do
  i=$((i + 1))
  ffmpeg -loglevel error -y -ss "$t" -i "$video" -frames:v 1 -vf scale=640:-1 "$tmp/$(printf %02d $i).png"
done
ffmpeg -loglevel error -y -pattern_type glob -i "$tmp/*.png" -vf "tile=3x$(( (i + 2) / 3 ))" -frames:v 1 "$out"
rm -rf "$tmp"
echo "$out"
