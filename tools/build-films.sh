#!/bin/sh
# Join the Flow clips into the two scroll films and paint out the generator marks.
#   hero = hero-a (frames 0-178) dissolving into hero-b   (clouds -> the tower at dusk)
#   tour = enter + tour-b (to the lift doors) dissolving into tour-c   (gate -> lobby -> living -> bedroom)
set -e
V=assets/raw/video
MARKS="delogo=x=1858:y=1034:w=48:h=30,delogo=x=1744:y=898:w=82:h=84"
ffmpeg -v error -y -i $V/hero-a.mp4 -i $V/hero-b.mp4 -filter_complex \
 "[0:v]trim=end_frame=179,setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=0.5:offset=6.958,$MARKS,format=yuv420p" \
 -an -c:v libx264 -crf 12 -preset slow $V/hero.mp4
ffmpeg -v error -y -i $V/enter.mp4 -i $V/tour-b.mp4 -i $V/tour-c.mp4 -filter_complex \
 "[0:v]fps=24,settb=AVTB,setpts=PTS-STARTPTS[e];[1:v]trim=start_frame=1:end_frame=123,fps=24,settb=AVTB,setpts=PTS-STARTPTS[b];[2:v]fps=24,settb=AVTB,setpts=PTS-STARTPTS[c];\
[e][b]concat=n=2:v=1[eb];[eb][c]xfade=transition=fade:duration=0.583:offset=12.458,$MARKS,format=yuv420p" \
 -an -c:v libx264 -crf 12 -preset slow $V/tour.mp4
for f in hero tour; do echo "$f: $(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 $V/$f.mp4) frames"; done
# tour, continued: bedroom -> balcony (tour-d) -> up the facade to the roof terrace (tour-e, its
# dissolving middle 53-79 cut) -> first pull-back from the terrace (tour-f 0-58; the rest changes the tower)
N=24
XOFF=$(echo "scale=4; (491 + 191 + 52 - 8) / $N" | bc)
ffmpeg -v error -y -i $V/tour.mp4 -i $V/tour-d.mp4 -i $V/tour-e.mp4 -i $V/tour-f.mp4 -filter_complex "\
[0:v]fps=24,settb=AVTB,setpts=PTS-STARTPTS[t];\
[1:v]trim=start_frame=1,fps=24,settb=AVTB,setpts=PTS-STARTPTS,$MARKS[d];\
[2:v]split[ea][eb];\
[ea]trim=start_frame=1:end_frame=53,fps=24,settb=AVTB,setpts=PTS-STARTPTS,$MARKS[e1];\
[eb]trim=start_frame=80,fps=24,settb=AVTB,setpts=PTS-STARTPTS,$MARKS[e2];\
[3:v]trim=start_frame=1:end_frame=59,fps=24,settb=AVTB,setpts=PTS-STARTPTS,$MARKS[f];\
[t][d][e1]concat=n=3:v=1[tde];\
[tde][e2]xfade=transition=fade:duration=0.333:offset=$XOFF[te];\
[te][f]concat=n=2:v=1,format=yuv420p[out]" \
 -map "[out]" -an -c:v libx264 -crf 12 -preset slow $V/tour-full.mp4
echo "tour-full: $(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 $V/tour-full.mp4) frames"
