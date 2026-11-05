import requests,json,uuid
from pathlib import Path
p=Path('/zap/wrk');c=json.loads((p/'visual-credenciales.json').read_text());s=requests.Session();s.trust_env=False;s.verify=str(p/'raiz.crt');s.headers.update({'Origin':'https://patio.test','X-Persona':c['id']});log=[]
def r(path,body=None,method='POST'):
 x=s.request(method,'https://patio.test'+path,json=body,timeout=30);log.append({'path':path,'request':body,'status':x.status_code,'body':x.text});(p/'visual-preparacion.json').write_text(json.dumps(log,indent=2));assert x.status_code==200,x.text;return x.json()
if (p/'visual-sesion.json').exists():
 s.cookies.set('feruga',json.loads((p/'visual-sesion.json').read_text())['cookie'][7:],domain='patio.test',path='/')
else:r('/api/equipo/alta',{'codigo':c['codigo']})
r('/api/sesion/entrar',{'persona':c['id'],'clave':c['clave']})
(p/'visual-sesion.json').write_text(json.dumps({'id':c['id'],'cookie':'feruga='+s.cookies['feruga']}))
payloads=['<img src=x onerror=alert(40)>','<script>alert(40)</script>','<b>QA40 HTML</b>'];cases=[]
for payload in payloads:
 clientes=r('/api/clientes',method='GET')['clientes'];cliente=next((x for x in clientes if x['nombre']==payload+' V40'),None) or r('/api/clientes',{'nombre':payload+' V40'})['cliente']
 mats=r('/api/materiales',method='GET')['materiales'];mat=next((x for x in mats if x['nombre']==payload+' V40'),None) or r('/api/materiales',{'familia':1,'nombre':payload+' V40','nombreCorto':'<b>V40 '+str(len(cases))+'</b>','frecuente':True})['material']
 cases.append({'payload':payload,'cliente':cliente,'material':mat})
(p/'visual-casos.json').write_text(json.dumps(cases,indent=2))
print('Preparados',len(cases),'nombres')
