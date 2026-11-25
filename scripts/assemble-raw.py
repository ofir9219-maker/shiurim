"""Assemble data/raw/{id}.json = {"parts":[{"part","offsetMs","result":<untouched Scribe result>}]} from data/fal-results/{id}_{NN}.json"""
import json, os, sys
m = json.load(open(sys.argv[1] if len(sys.argv)>1 else 'data/fal-parts.json'))
ids = sorted({p['id'] for p in m})
for id in ids:
    parts = sorted([p for p in m if p['id'] == id], key=lambda p: p['part'])
    files = [f"data/fal-results/{id}_{p['part']:02d}.json" for p in parts]
    missing = [f for f in files if not os.path.exists(f)]
    if missing: print('INCOMPLETE', id, len(missing), 'missing'); continue
    out = {'model': 'fal-ai/elevenlabs/speech-to-text/scribe-v2', 'parts': []}
    for p, f in zip(parts, files):
        r = json.load(open(f))
        if 'words' not in r: print('BAD', f, list(r)[:5]); break
        out['parts'].append({'part': p['part'], 'offsetMs': p['offsetMs'], 'durationMs': p['durationMs'], 'result': r})
    else:
        json.dump(out, open(f'data/raw/{id}.json', 'w'), ensure_ascii=False)
        print('OK', id, sum(len(x['result']['words']) for x in out['parts']), 'words')
