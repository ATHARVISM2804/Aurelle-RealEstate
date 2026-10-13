#!/bin/sh
# Import a Flow room render: paint out the sparkle mark, write <name>.webp (2560) and <name>-1600.webp
# usage: tools/import-room.sh <src.jpg> <name>
set -e
src="$1"; name="$2"; out=assets/img
ffmpeg -v error -y -i "$src" -vf "delogo=x=2590:y=1375:w=95:h=95,scale='min(2560,iw)':-2:flags=lanczos" -q:v 2 "$out/$name.jpg"
cwebp -quiet -q 84 -m 6 -sharp_yuv "$out/$name.jpg" -o "$out/$name.webp"
ffmpeg -v error -y -i "$out/$name.jpg" -vf "scale=1600:-2:flags=lanczos" -q:v 2 "$out/$name-1600.tmp.jpg"
cwebp -quiet -q 84 -m 6 -sharp_yuv "$out/$name-1600.tmp.jpg" -o "$out/$name-1600.webp" && rm "$out/$name-1600.tmp.jpg"
echo "$name: $(du -h "$out/$name.webp" | cut -f1)"
