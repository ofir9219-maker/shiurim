#!/bin/bash
# Download audios needing Fal and split into <=19 min mono mp3 parts with offsets manifest
set -e
OUT=${SPLIT_DIR:-/tmp/claude-0/-home-user-shiurim/f39cbfef-c1b5-5b80-9001-8723138a7602/scratchpad/audio}
mkdir -p $OUT
for id in $(jq -r '.[]|select(.needsFal)|.id' data/inventory.json); do
  [ -f "$OUT/$id.done" ] && continue
  curl -sS -L --max-time 900 -o "$OUT/$id.src" "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t"
  ffmpeg -v error -y -i "$OUT/$id.src" -vn -ac 1 -ar 22050 -b:a 48k -f segment -segment_time 1140 -reset_timestamps 1 "$OUT/${id}_%02d.mp3"
  rm "$OUT/$id.src"; touch "$OUT/$id.done"; echo "split $id"
done
python3 - "$OUT" <<'PY'
import sys,glob,json,subprocess,os
out=sys.argv[1]; man=[]
for id in sorted({os.path.basename(p).rsplit('_',1)[0] for p in glob.glob(f'{out}/*_[0-9][0-9].mp3')}):
    off=0
    for p in sorted(glob.glob(f'{out}/{id}_[0-9][0-9].mp3')):
        d=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p],capture_output=True,text=True).stdout)
        man.append(dict(id=id,part=int(p[-6:-4]),path=p,size=os.path.getsize(p),offsetMs=int(off*1000),durationMs=int(d*1000))); off+=d
json.dump(man,open('data/fal-parts.json','w'),indent=1); print(len(man),'parts')
PY
