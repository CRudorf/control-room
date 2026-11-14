"""Where a recording's usable footage starts: the last time the app's header bar appears (after the login
page and the blank page loads). Samples every 0.1 s at a point inside the header.

usage: find_start.py [--quiet] [--at X,Y] [--max-r R] [--max-g G] video.webm ...
  --at     the sample point as fractions of the frame (default 0.16,0.05: inside BH's header, near the left)
  --max-r / --max-g   the header colour test (default BH's dark green: r < 40, g < 80)
  --quiet  print only the start in seconds (one video)
"""
import argparse
import subprocess

W, H = 64, 45
ap = argparse.ArgumentParser()
ap.add_argument("videos", nargs="+")
ap.add_argument("--quiet", action="store_true")
ap.add_argument("--at", default="0.16,0.05")
ap.add_argument("--max-r", type=int, default=40)
ap.add_argument("--max-g", type=int, default=80)
a = ap.parse_args()
fx, fy = (float(v) for v in a.at.split(","))
px = (int(fy * H) * W + int(fx * W)) * 3
for path in a.videos:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vf", f"fps=10,scale={W}:{H}", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    frames = [raw[i:i + W * H * 3] for i in range(0, len(raw), W * H * 3)]
    marks = [f[px] < a.max_r and f[px + 1] < a.max_g for f in frames]
    starts = [i for i in range(len(marks)) if marks[i] and (i == 0 or not marks[i - 1])]
    start = starts[-1] / 10 if starts else 0
    if a.quiet:
        print(start)
    else:
        print(f"{path}: header last appears at {start}s of {len(marks) / 10}s\n  {''.join('#' if m else '.' for m in marks)}")
