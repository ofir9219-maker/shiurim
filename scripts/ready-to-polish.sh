#!/bin/bash
# assemble+normalize complete wave2 classes, then list Scribe-ready classes not yet launched for Scribe polish
cd /home/user/shiurim
ok=$(for k in 0 1 2; do python3 scripts/assemble-raw.py data/fal-parts-w2-$k.json; done 2>/dev/null | awk '/^OK/{print $2}')
for id in $ok; do [ "$(jq -r .source data/segments/$id.json)" = fal ] || python3 scripts/normalize.py scribe $id >/dev/null; done
python3 - <<'PY'
import json
inv={i['id']:i for i in json.load(open('data/inventory.json'))}
done=set(l.split()[0] for l in open('data/polish-scribe-launched.txt') if l.strip())
done|=set(open('data/scribe-wave3.txt').read().split())
for i in open('data/scribe-wave2.txt').read().split():
    if i in done: continue
    if json.load(open(f'data/segments/{i}.json'))['source']=='fal': print(i, inv[i]['order'])
PY
