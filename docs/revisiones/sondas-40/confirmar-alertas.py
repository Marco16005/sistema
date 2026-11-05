import requests,json,uuid
from pathlib import Path
p=Path('/zap/wrk');s=json.loads((p/'visual-sesion.json').read_text());client=requests.Session();client.trust_env=False;client.verify=str(p/'raiz.crt');client.headers.update({'Cookie':s['cookie'],'X-Persona':s['id'],'Origin':'https://patio.test'});out=[]
for name in ['clientes','/etc/passwd','../../../../etc/passwd','/qa40-no-existe-'+uuid.uuid4().hex,'<script>alert(1);</script>']:
 r=client.post('https://patio.test/api/clientes',json={'nombre':name},timeout=30);d=r.json();row={'request':{'nombre':name},'status':r.status_code,'headers':dict(r.headers),'body':d};out.append(row);(p/'confirmar-alertas.json').write_text(json.dumps(out,indent=2));assert (r.status_code==200 and d['cliente']['nombre']==name) or (r.status_code==409 and d['error']['mensaje']=='Ya hay un cliente que se llama «'+name+'»'),row
r=client.get('https://patio.test/api/clientes',timeout=30);out.append({'path':'/api/clientes','status':r.status_code,'headers':dict(r.headers),'body':r.json()});(p/'confirmar-alertas.json').write_text(json.dumps(out,indent=2))
print('Cinco nombres conservados como datos, sin contenido de archivos.')
