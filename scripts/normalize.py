"""Normalize sources into data/segments/{id}.json.
  python3 scripts/normalize.py md       -> downloads each Drive .md (Plaud) and parses it
  python3 scripts/normalize.py scribe   -> converts data/raw/{id}.json (Fal Scribe v2) to segments
"""
import json, re, sys, os, subprocess
inv = json.load(open('data/inventory.json'))
os.makedirs('data/md', exist_ok=True); os.makedirs('data/segments', exist_ok=True)
TS = re.compile(r'^\*\*\[(\d+):(\d\d):(\d\d)\]\s*([^:*]*):\*\*\s*(.*)$')

def md(item):
    p = f"data/md/{item['id']}.md"
    if not os.path.exists(p):
        subprocess.run(['curl','-sS','-L','--max-time','120','-o',p,
            f"https://drive.usercontent.google.com/download?id={item['mdId']}&export=download&confirm=t"], check=True)
    segs = []
    for line in open(p, encoding='utf-8'):
        m = TS.match(line.strip())
        if m:
            h, mi, s, spk, txt = m.groups()
            segs.append({'startMs': (int(h)*3600+int(mi)*60+int(s))*1000, 'speaker': spk.strip(), 'text': txt.strip()})
        elif segs and line.strip() and not line.startswith(('#','- **','---')):
            segs[-1]['text'] += ' ' + line.strip()
    end = item.get('durationMs') or (segs[-1]['startMs'] + 15000 if segs else 0)
    for i, sg in enumerate(segs):
        sg['endMs'] = segs[i+1]['startMs'] if i+1 < len(segs) else max(end, sg['startMs'] + 1000)
    segs = [s for s in segs if s['text'] and s['endMs'] > s['startMs']]
    return {'source': 'drive_md_plaud', 'model': 'plaud', 'segments': [{'startMs':s['startMs'],'endMs':s['endMs'],'speaker':s['speaker'],'text':s['text']} for s in segs]}

def scribe(item):
    r = json.load(open(f"data/raw/{item['id']}.json"))
    # raw is either one Scribe result, or {"parts":[{"offsetMs":..,"result":<Scribe result>}]} for split audio
    allw = []
    for part in (r['parts'] if 'parts' in r else [{'offsetMs': 0, 'result': r}]):
        o = part['offsetMs'] / 1000
        for w in part['result']['words']:
            allw.append({**w, 'start': w['start'] + o, 'end': w['end'] + o})
        allw.append({'text': ' ', 'type': 'spacing', 'start': allw[-1]['end'] if allw else o, 'end': allw[-1]['end'] if allw else o})
    words = [w for w in allw if w.get('type','word') != 'audio_event']
    segs, cur = [], None
    for i, w in enumerate(words):
        if cur is None:
            if w.get('type') == 'spacing': continue
            cur = {'startMs': int(w['start']*1000), 'endMs': int(w['end']*1000), 'text': ''}
        cur['text'] += w['text']; cur['endMs'] = int(w['end']*1000)
        nxt = words[i+1] if i+1 < len(words) else None
        gap = (nxt['start'] - w['end']) if nxt else 99
        dur = cur['endMs'] - cur['startMs']
        sentence_end = w['text'].rstrip().endswith(('.', '?', '!', '…'))
        if nxt is None or gap > 1.2 or (sentence_end and dur > 6000) or (dur > 25000 and w.get('type') == 'spacing'):
            cur['text'] = cur['text'].strip()
            if cur['text']: segs.append(cur)
            cur = None
    return {'source': 'fal', 'model': 'fal-ai/elevenlabs/speech-to-text/scribe-v2', 'segments': segs}

mode = sys.argv[1]; only = sys.argv[2:] 
for item in inv:
    if only and item['id'] not in only: continue
    out = f"data/segments/{item['id']}.json"
    if mode == 'md' and item.get('mdId'):
        d = md(item)
    elif mode == 'scribe' and os.path.exists(f"data/raw/{item['id']}.json"):
        d = scribe(item)
    else: continue
    json.dump(d, open(out, 'w'), ensure_ascii=False, indent=0)
    print(item['order'], len(d['segments']), 'segs')
