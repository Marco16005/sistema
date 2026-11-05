import requests,json,uuid
from pathlib import Path
p=Path('/zap/wrk');s=json.loads((p/'sesiones.json').read_text());c=json.loads((p/'credenciales.json').read_text());out=[]
def req(label,role,path,body):
 h={'Cookie':s[role]['cookie'],'Origin':'https://patio.test','X-Persona':s[role]['id']};r=requests.post('https://patio.test'+path,headers=h,json=body,verify=str(p/'raiz.crt'),timeout=25)
 out.append({'label':label,'role':role,'path':path,'request':body,'status':r.status_code,'body':r.text,'headers':dict(r.headers)});(p/'negocio.json').write_text(json.dumps(out,indent=2));print(label,r.status_code,r.text[:250]);return r
req('precio-valido','responsable','/api/precios',{'cambios':[{'material':1,'compra':'1.00','venta':'2.00'}]})
req('publicar-precios','responsable','/api/precios/publicar',{})
id=str(uuid.uuid4());body={'id':id,'tipo':'compra','etiqueta':'QA40-idempotente'}
req('cuenta-valida','mostrador','/api/cuentas',body);req('cuenta-repetida','mostrador','/api/cuentas',body)
req('patio-cuenta-valida','patio','/api/cuentas',{'id':str(uuid.uuid4()),'tipo':'compra','etiqueta':'QA40-patio'})
req('consulta-cuenta-prohibida','consulta','/api/cuentas',{'id':str(uuid.uuid4()),'tipo':'compra','etiqueta':'QA40-consulta'})
req('pin-tras-cinco-minutos','bloqueo','/api/sesion/entrar',{'persona':c['bloqueo']['id'],'clave':c['bloqueo']['clave']})
