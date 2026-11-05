from pathlib import Path
import json
p=Path(__file__).parent
rows=[]
for name in ['cabeceras','adicionales']:
 for i,r in enumerate(json.loads((p/(name+'.json')).read_text())): rows.append(dict(r,fuente=name,indice=i))
errores=[r for r in rows if 'error' in r]
rows=[r for r in rows if 'error' not in r]
keys=['content-security-policy','x-content-type-options','strict-transport-security','x-frame-options','cache-control']
def breve(r):return {k:r.get(k) for k in ['fuente','indice','path','method','status','requestHeaders','html','nonce','scripts','sinNonce','headers']}
nonces=[r['nonce'] for r in rows if r.get('nonce')]
result={'respuestas':len(rows),'erroresSonda':errores,'sinCsp':[breve(r) for r in rows if not r.get('headers',{}).get('content-security-policy')],'sinNosniff':[breve(r) for r in rows if r.get('headers',{}).get('x-content-type-options')!='nosniff'],'duplicadas':[],'htmlSinNonce':[breve(r) for r in rows if r.get('html') and not r.get('nonce')],'scriptsSinNonce':[breve(r) for r in rows if r.get('html') and r.get('sinNonce')],'apiSinNoStore':[breve(r) for r in rows if (r['path']=='/api' or r['path'].startswith('/api/')) and 'no-store' not in r.get('headers',{}).get('cache-control','')],'nonceElegido':[breve(r) for r in rows if r.get('nonceElegido')],'nonces':len(nonces),'noncesUnicos':len(set(nonces)),'errores500':[breve(r) for r in rows if r.get('status')==500]}
for r in rows:
 for k in keys:
  vals=[h['value'] for h in r.get('rawHeaders',[]) if h['name'].lower()==k]
  if len(vals)>1 or (k=='x-content-type-options' and any(',' in v for v in vals)):result['duplicadas'].append({'fuente':r['fuente'],'indice':r['indice'],'path':r['path'],'cabecera':k,'valores':vals})
(p/'resumen.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:(len(v) if isinstance(v,list) else v) for k,v in result.items()},indent=2))
