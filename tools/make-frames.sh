#!/bin/sh
# Split a video into a scroll sequence of WebP frames.
# usage: tools/make-frames.sh <video> <name> [fps=20] [width=1440]
# writes assets/seq/<name>/0001.webp … and manifest.json
# (this ffmpeg has no libwebp, so frames go through PNG and cwebp)
set -e
in="$1"; name="$2"; fps="${3:-20}"; w="${4:-1440}"
out="assets/seq/$name"
tmp="$out.png"
mkdir -p "$out" "$tmp"
ffmpeg -v error -y -i "$in" -an -vf "fps=$fps,scale=$w:-2:flags=lanczos" "$tmp/%04d.png"
for f in "$tmp"/*.png; do
  cwebp -quiet -q 60 -m 6 "$f" -o "$out/$(basename "$f" .png).webp"
done
rm -r "$tmp"
count=$(ls "$out"/*.webp | wc -l | tr -d ' ')
h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$in")
srcw=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$in")
h=$(( h * w / srcw ))
printf '{ "count": %s, "width": %s, "height": %s }\n' "$count" "$w" "$h" > "$out/manifest.json"
echo "$name: $count frames, $(du -sh "$out" | cut -f1)"
