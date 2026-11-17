# usage: put.py <tsv: id, part, upload_url>. PUTs file; on HTTP 200 sets fileUrl (= upload_url without query) on every manifest entry with that id+part.
import json, subprocess, sys
MAN='/home/user/shiurim/data/fal-parts-w2-1.json'
man=json.load(open(MAN))
for line in open(sys.argv[1]):
    if not line.strip(): continue
    rid,part,up=line.rstrip('\n').split('\t'); part=int(part)
    ents=[x for x in man if x['id']==rid and x['part']==part]
    code=subprocess.run(['curl','-sS','-o','/dev/null','-w','%{http_code}','-X','PUT','-H','Content-Type: audio/mpeg','--upload-file',ents[0]['path'],up],capture_output=True,text=True).stdout.strip()
    print(rid[:8],part,code)
    if code=='200':
        fu=up.split('?')[0]
        for x in ents: x['fileUrl']=fu
        json.dump(man,open(MAN,'w'),ensure_ascii=False,indent=1)
