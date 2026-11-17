#!/bin/bash
# Cut gap clips from source audio (downloaded from Drive) → data/gaps.json gets path/size per clip
OUT=/tmp/claude-0/-home-user-shiurim/f39cbfef-c1b5-5b80-9001-8723138a7602/scratchpad/gaps; mkdir -p $OUT
python3 - "$OUT" <<'PY'
import json,subprocess,os,sys
out=sys.argv[1]; g=json.load(open('data/gaps.json'))
for id in sorted({x['id'] for x in g}):
    src=f'{out}/{id}.src'
    if not os.path.exists(src):
        subprocess.run(['curl','-sS','-L','--max-time','1200','-o',src,f'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t'],check=True)
    for k,x in enumerate([x for x in g if x['id']==id]):
        p=f"{out}/{id}_g{x['startMs']}.mp3"
        subprocess.run(['ffmpeg','-v','error','-y','-ss',str(x['startMs']/1000),'-to',str(x['endMs']/1000),'-i',src,'-vn','-ac','1','-ar','22050','-b:a','48k',p],check=True)
        x['path']=p; x['size']=os.path.getsize(p)
    os.remove(src); print('cut',id,flush=True)
json.dump(g,open('data/gaps.json','w'),indent=1)
PY
