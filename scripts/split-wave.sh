#!/bin/bash
# usage: scripts/split-wave.sh IDS_FILE MANIFEST  — download + split audios into <=19min mono mp3 parts (parallel 4), write manifest
IDS=$1; MAN=$2; OUT=${SPLIT_DIR:-/tmp/claude-0/-home-user-shiurim/f39cbfef-c1b5-5b80-9001-8723138a7602/scratchpad/audio}
mkdir -p $OUT; export OUT
one() { id=$1; [ -f "$OUT/$id.done" ] && return
  curl -sS -L --max-time 1200 -o "$OUT/$id.src" "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t" &&
  ffmpeg -v error -y -i "$OUT/$id.src" -vn -ac 1 -ar 22050 -b:a 48k -f segment -segment_time 1140 -reset_timestamps 1 "$OUT/${id}_%02d.mp3" &&
  rm "$OUT/$id.src" && touch "$OUT/$id.done" && echo "split $id" || echo "FAIL $id"; }
export -f one
cat $IDS | xargs -P4 -I{} bash -c 'one {}'
python3 - "$OUT" "$IDS" "$MAN" <<'PY'
import sys,glob,json,subprocess,os
out,ids,man_p=sys.argv[1:]; man=[]
for id in open(ids).read().split():
    off=0
    for p in sorted(glob.glob(f'{out}/{id}_[0-9][0-9].mp3')):
        d=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p],capture_output=True,text=True).stdout)
        man.append(dict(id=id,part=int(p[-6:-4]),path=p,size=os.path.getsize(p),offsetMs=int(off*1000),durationMs=int(d*1000))); off+=d
json.dump(man,open(man_p,'w'),indent=1); print(len(man),'parts')
PY
