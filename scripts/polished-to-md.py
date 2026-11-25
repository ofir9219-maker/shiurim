import json,sys,os
id=sys.argv[1]; p=json.load(open(f'data/polished/{id}.json'))
f=lambda ms:f"{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d}"
L=[f"# {p['title']}","",f"- **Daf:** "+", ".join(f"{d['daf']} {d['amud']}" for d in p['daf']),f"- **Resumen:** {p['summary']}",f"- **Tags:** "+", ".join(p['tags']),"","---",""]
L+= [f"**[{f(s['startMs'])}]** {s['text']}\n" for s in p['segments']]
os.makedirs('data/md-out',exist_ok=True); open(f'data/md-out/{id}.md','w').write("\n".join(L)); print(f'data/md-out/{id}.md')
