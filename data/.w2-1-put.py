import json, subprocess, sys, os
# usage: put.py <uploads.tsv> ; PUTs each file, then sets fileUrl in manifest only after 200
MAN='/home/user/shiurim/data/fal-parts-w2-1.json'
man=json.load(open(MAN))
idx={(x['id'],x['part']):x for x in man}
for line in open(sys.argv[1]):
    if not line.strip(): continue
    rid,part,up,fu=line.rstrip('\n').split('\t')
    x=idx[(rid,int(part))]
    code=subprocess.run(['curl','-sS','-o','/dev/null','-w','%{http_code}','-X','PUT','-H','Content-Type: audio/mpeg','--upload-file',x['path'],up],capture_output=True,text=True).stdout.strip()
    print(rid[:12],part,code)
    if code=='200':
        x['fileUrl']=fu
        json.dump(man,open(MAN,'w'),ensure_ascii=False,indent=1)
