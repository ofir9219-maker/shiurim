import json, re, unicodedata, subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor
P='data/drive-pages'
files={}
for fn in ['a1.json','a2.json','md.json']:
    for f in json.load(open(f'{P}/{fn}'))['files']:
        files[f['id']]=f
N=lambda s: unicodedata.normalize('NFC',s).strip()
def base(t):
    t=N(t); return N(os.path.splitext(t)[0]) if re.search(r'\.[A-Za-z0-9]{2,4}$',t) else t
audios=[f for f in files.values() if f['mimeType'].startswith('audio') or re.search(r'\.(m4a|mp3|wav|ogg|aac)$',f['title'],re.I)]
mds={base(f['title']):f for f in files.values() if f['title'].lower().endswith('.md')}
sh={a['audioId']:a for a in json.load(open('data/sidra49.json'))}
def order(t):
    m=re.match(r'\s*(\d+(?:\.\d+)?)',t)
    if m: return m.group(1)
    m=re.search(r'(\d+(?:\.\d+)?)\s*\.\w+$',t.strip())
    return m.group(1) if m else None
def dur(id):
    try:
        out=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t'],capture_output=True,text=True,timeout=300,env={**os.environ,'http_proxy':os.environ['HTTPS_PROXY']}).stdout.strip()
        return int(float(out)*1000)
    except Exception as e: return None
with ThreadPoolExecutor(6) as ex: durs=dict(zip([a['id'] for a in audios], ex.map(dur,[a['id'] for a in audios])))
inv=[]
for a in audios:
    b=base(a['title']); md=mds.get(b); s=sh.get(a['id'])
    d=durs[a['id']] or (s or {}).get('duracionMs')
    inv.append(dict(id=a['id'],name=N(a['title']),order=order(a['title']),ext=os.path.splitext(a['title'])[1].lower(),mimeType=a['mimeType'],sizeBytes=int(a.get('fileSize',0)),durationMs=d,mdId=md and md['id'],mdName=md and N(md['title']),transcript='drive_md' if md else ('shiurim' if s and s['tieneTranscripcion'] else 'none'),inShiurim=bool(s)))
key=lambda x:(float(x['order']) if x['order'] else 9999, x['name'])
inv.sort(key=key)
json.dump(inv,open('data/inventory.json','w'),ensure_ascii=False,indent=1)
used={i['mdId'] for i in inv}
orph=[m['title'] for m in mds.values() if m['id'] not in used]
print('audios',len(inv),'hours',round(sum(i['durationMs'] or 0 for i in inv)/3.6e6,1))
from collections import Counter; print(Counter(i['transcript'] for i in inv))
print('no duration',[i['name'] for i in inv if not i['durationMs']])
print('orphan md',orph)
print('no order',[i['name'] for i in inv if not i['order']])
c=Counter(i['order'] for i in inv); print('dup orders',[k for k,v in c.items() if v>1])
