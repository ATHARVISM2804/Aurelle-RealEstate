#!/bin/sh
# Scroll-film frames as AVIF, in two tiers that js/sequence.js picks between:
#   hd: 1920 px, every frame (RIFE-doubled when interpolate=1)   sd: 1280 px, every 2nd source frame
# usage: tools/make-frames-avif.sh <video> <name> <interpolate 0|1>
set -e
in="$1"; name="$2"; interp="${3:-0}"
R=~/tools-ai/rife-ncnn-vulkan-20221029-macos/rife-ncnn-vulkan-20221029-macos
tmp="$(mktemp -d)"; mkdir -p "$tmp/src" "$tmp/hd"
ffmpeg -v error -y -i "$in" -an "$tmp/src/%08d.png"
if [ "$interp" = 1 ]; then
  "$R/rife-ncnn-vulkan" -i "$tmp/src" -o "$tmp/hd" -m "$R/rife-v4.6" 2>/dev/null
  rm "$(ls "$tmp/hd"/*.png | tail -1)"   # RIFE repeats the last frame
else
  cp "$tmp/src"/*.png "$tmp/hd"/
fi
enc() { # <tier> <width> <quality> <list of pngs on stdin>
  out="assets/seq/$name/$1"; rm -rf "$out"; mkdir -p "$out"
  export W="$2" Q="$3" OUT="$out"
  awk '{printf "%s %04d\n", $0, NR}' | xargs -P 8 -n 2 sh -c \
    'ffmpeg -v error -y -i "$0" -vf "scale=$W:-2:flags=lanczos" "$0.$W.png" && avifenc -q $Q -s 6 -j 2 "$0.$W.png" "$OUT/$1.avif" >/dev/null && rm "$0.$W.png"'
  n=$(ls "$out"/*.avif | wc -l | tr -d ' ')
  h=$(( $2 * 1080 / 1920 ))
  printf '{ "count": %s, "width": %s, "height": %s, "ext": "avif" }\n' "$n" "$2" "$h" > "$out/manifest.json"
  echo "$name/$1: $n frames, $(du -sh "$out" | cut -f1)"
}
ls "$tmp/hd"/*.png | enc hd 1920 60
ls "$tmp/src"/*.png | awk 'NR % 2 == 1' | enc sd 1280 56
rm -rf "$tmp"
