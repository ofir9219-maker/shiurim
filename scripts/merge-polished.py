"""Merge polish parts → data/polished/{id}.json and validate against data/segments/{id}.json.
Parts: data/polished/parts/{id}/NNN.json = [{"i": <segment index>, "text": "..."}...]
Meta:  data/polished/parts/{id}/meta.json = {summary, tags, daf:[{daf,amud}], title, newName}
Usage: python3 scripts/merge-polished.py <id>   (exit 1 + message on any problem)"""
import json, sys, glob, os, re
id = sys.argv[1]
src = json.load(open(f'data/segments/{id}.json'))['segments']
texts = {}
for p in sorted(glob.glob(f'data/polished/parts/{id}/[0-9]*.json')):
    for r in json.load(open(p)):
        texts[int(r['i'])] = r['text'].strip()
errs = []
missing = [i for i in range(len(src)) if i not in texts]
extra = [i for i in texts if i >= len(src) or i < 0]
if missing: errs.append(f'missing segment indexes: {missing[:30]}{"..." if len(missing)>30 else ""}')
if extra: errs.append(f'indexes out of range: {extra[:20]}')
empty = [i for i, t in texts.items() if not t]
if empty: errs.append(f'empty texts: {empty[:20]}')
heb = [i for i, t in texts.items() if re.search(r'[֐-׿]', t)]
if heb: errs.append(f'Hebrew script found in segments (must be Latin transliteration): {heb[:20]}')
try: meta = json.load(open(f'data/polished/parts/{id}/meta.json'))
except Exception as e: errs.append(f'meta.json: {e}'); meta = {}
for k in ('summary', 'tags', 'daf', 'title', 'newName'):
    if not meta.get(k): errs.append(f'meta.{k} missing')
if errs:
    print('FAIL', id); [print(' -', e) for e in errs]; sys.exit(1)
out = {'id': id, 'segments': [{'startMs': s['startMs'], 'endMs': s['endMs'], 'text': texts[i]} for i, s in enumerate(src)], **meta}
json.dump(out, open(f'data/polished/{id}.json', 'w'), ensure_ascii=False, indent=0)
ch = sum(1 for i, s in enumerate(src) if texts[i] != s['text'].strip())
print(f'OK {id}: {len(src)} segments, {ch} changed; title={meta["newName"]}')
