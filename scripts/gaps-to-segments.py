"""Convert data/fal-results-gaps/<id>_g<startMs>.json into raw gap segments data/gapfill-raw/<id>.json
(only parts that fall inside the gap, not overlapping existing Scribe segments)."""
import json, os, re, glob, sys
sys.path.insert(0, 'scripts')
os.makedirs('data/gapfill-raw', exist_ok=True)
by = {}
for f in sorted(glob.glob('data/fal-results-gaps/*_g*.json')):
    m = re.match(r'(.+)_g(\d+)\.json$', os.path.basename(f)); id, off = m.group(1), int(m.group(2))
    r = json.load(open(f)); words = [w for w in r['words'] if w.get('type', 'word') != 'audio_event']
    segs, cur = [], None
    for i, w in enumerate(words):
        if cur is None:
            if w.get('type') == 'spacing': continue
            cur = {'startMs': off + int(w['start'] * 1000), 'endMs': 0, 'text': ''}
        cur['text'] += w['text']; cur['endMs'] = off + int(w['end'] * 1000)
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (nxt['start'] - w['end']) if nxt else 99
        d = cur['endMs'] - cur['startMs']
        if nxt is None or gap > 1.2 or (w['text'].rstrip().endswith(('.', '?', '!')) and d > 6000) or (d > 25000 and w.get('type') == 'spacing'):
            cur['text'] = cur['text'].strip()
            if cur['text']: segs.append(cur)
            cur = None
    base = json.load(open(f'data/segments/{id}.json'))['segments']
    ok = [s for s in segs if not any(s['startMs'] < b['endMs'] and b['startMs'] < s['endMs'] for b in base)]
    by.setdefault(id, []).extend(ok)
tot = 0
for id, segs in by.items():
    segs.sort(key=lambda s: s['startMs']); json.dump(segs, open(f'data/gapfill-raw/{id}.json', 'w'), ensure_ascii=False, indent=0); tot += len(segs)
print(len(by), 'classes,', tot, 'new segments,', sum(s['endMs'] - s['startMs'] for v in by.values() for s in v) // 60000, 'min of speech')
