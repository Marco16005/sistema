import requests,json,uuid
from pathlib import Path
p=Path('/zap/wrk');sessions=json.loads((p/'sesiones.json').read_text());out=[]
def r(label,path,method='GET',body=None,headers=None,role='responsable'):
 s=sessions[role];h={'Cookie':s['cookie'],'Origin':'https://patio.test','X-Persona':s['id'],'Content-Type':'application/json'};h.update(headers or {})
 x=requests.request(method,'https://patio.test'+path,headers=h,json=body,verify=str(p/'raiz.crt'),timeout=20,allow_redirects=False);out.append({'label':label,'method':method,'path':path,'request':body,'status':x.status_code,'headers':dict(x.headers),'body':x.text});(p/'suplemento.json').write_text(json.dumps(out,indent=2,ensure_ascii=False));print(label,x.status_code,x.text[:300]);return x
r('material-xss','/api/materiales','POST',{'familia':1,'nombre':'<img src=x onerror=alert(40)>','nombreCorto':'QA40XSS','frecuente':False})
id=str(uuid.uuid4());body={'id':id,'tipo':'compra','etiqueta':'QA40 duplicado'}
r('envio-original','/api/cuentas','POST',body,role='mostrador');r('envio-duplicado','/api/cuentas','POST',body,role='mostrador');r('envio-sin-id','/api/cuentas','POST',{'tipo':'compra'},role='mostrador')
r('cabeceras-html','/');r('cabeceras-api','/api/clientes');r('cors-lectura','/api/clientes',headers={'Origin':'https://ajeno.invalid'});r('cors-preflight','/api/clientes','OPTIONS',headers={'Origin':'https://ajeno.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-persona'})
r('cache-condicional','/api/clientes',headers={'If-None-Match':'*'})
