#!/bin/sh
# High-quality scroll sequence: every native frame at full 1920 px, doubled with
# RIFE motion interpolation (real in-between frames, not crossfades).
# usage: tools/make-frames-hq.sh <video> <name> [quality=80] [interpolate=1]
# needs ~/tools-ai/rife-ncnn-vulkan-20221029-macos (rife-ncnn-vulkan) and cwebp
set -e
in="$1"; name="$2"; q="${3:-80}"; interp="${4:-1}"
R=~/tools-ai/rife-ncnn-vulkan-20221029-macos/rife-ncnn-vulkan-20221029-macos
out="assets/seq/$name"
tmp="$(mktemp -d)"
mkdir -p "$tmp/src" "$tmp/mid"
ffmpeg -v error -y -i "$in" -an "$tmp/src/%08d.png"
if [ "$interp" = 1 ]; then
  "$R/rife-ncnn-vulkan" -i "$tmp/src" -o "$tmp/mid" -m "$R/rife-v4.6" 2>/dev/null
else
  mv "$tmp/src"/*.png "$tmp/mid"/ && touch "$tmp/mid/zzzz.png"
fi
rm -rf "$out" && mkdir -p "$out"
ls "$tmp/mid"/*.png | sed '$d' | awk '{printf "%s %04d\n", $0, NR}' | \
  xargs -P 8 -n 2 sh -c 'cwebp -quiet -q '"$q"' -m 5 -sharp_yuv "$0" -o "'"$out"'/$1.webp"'
rm -rf "$tmp"
count=$(ls "$out"/*.webp | wc -l | tr -d ' ')
eval "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of default=nw=1 "$in")"
printf '{ "count": %s, "width": %s, "height": %s }\n' "$count" "$width" "$height" > "$out/manifest.json"
echo "$name: $count frames, $(du -sh "$out" | cut -f1)"
