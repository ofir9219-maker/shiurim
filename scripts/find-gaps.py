"""Find gaps >40s in Scribe segment timelines (incl. start/end of audio). Writes data/gaps.json"""
import json, glob
inv = {i['id']: i for i in json.load(open('data/inventory.json'))}
out = []
for f in glob.glob('data/segments/*.json'):
    d = json.load(open(f)); id = f.split('/')[-1][:-5]
    if d['source'] != 'fal': continue
    s = d['segments']; dur = inv[id]['durationMs']
    edges = [(0, s[0]['startMs'])] + [(a['endMs'], b['startMs']) for a, b in zip(s, s[1:])] + [(s[-1]['endMs'], dur)]
    for a, b in edges:
        if b - a > 40000: out.append({'id': id, 'order': inv[id]['order'], 'startMs': max(0, a - 1000), 'endMs': min(dur, b + 1000)})
json.dump(out, open('data/gaps.json', 'w'), indent=1)
print(len(out), 'gaps,', sum(g['endMs'] - g['startMs'] for g in out) // 60000, 'min,', len({g['id'] for g in out}), 'classes')
