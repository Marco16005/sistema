import requests,json,uuid,time,concurrent.futures,sys
from pathlib import Path
requests.packages.urllib3.disable_warnings()
p=Path('/zap/wrk'); creds=json.loads((p/'credenciales.json').read_text()); out=[]; sessions={}; base='https://patio.test'
def req(label,method,path,role=None,body=None,headers=None,cookie=None):
 h={'Origin':base,'Content-Type':'application/json','X-Envio':str(uuid.uuid4())}
 if role and role in sessions:h.update({'Cookie':sessions[role]['cookie'],'X-Persona':sessions[role]['id']})
 if cookie is not None:h['Cookie']=cookie
 for k,v in (headers or {}).items():
  if v is None:h.pop(k,None)
  else:h[k]=v
 r=requests.request(method,base+path,headers=h,json=body,verify='/zap/wrk/raiz.crt',timeout=30,allow_redirects=False)
 row={'label':label,'method':method,'path':path,'role':role,'request_headers':h,'request_body':body,'status':r.status_code,'headers':dict(r.headers),'body':r.text,'seconds':r.elapsed.total_seconds()};out.append(row)
 print(label,r.status_code,r.text[:160],flush=True)
 (p/'manual.json').write_text(json.dumps(out,indent=2,ensure_ascii=False))
 return r
for label,method,path in [('anon-personas','GET','/api/personas'),('anon-admin','GET','/api/administracion'),('anon-salud','GET','/api/salud')]: req(label,method,path)
for role,c in creds.items():
 if 'id' not in c:continue
 r=req('alta-'+role,'POST','/api/equipo/alta',body={'codigo':c['codigo']});cookie=r.headers['Set-Cookie'].split(';')[0]
 sessions[role]={'cookie':cookie,'id':c['id']}
 r=req('entrar-'+role,'POST','/api/sesion/entrar',role,{'persona':c['id'],'clave':c['clave']});sessions[role]['cookie']=r.headers['Set-Cookie'].split(';')[0]
 req('confirmar-'+role,'GET','/api/sesion',role)
(p/'sesiones.json').write_text(json.dumps(sessions,indent=2))
req('codigo-reutilizado','POST','/api/equipo/alta',body={'codigo':creds['responsable']['codigo']})
req('codigo-caducado','POST','/api/equipo/alta',body={'codigo':creds['caducado']['codigo']})
with concurrent.futures.ThreadPoolExecutor(2) as ex:list(ex.map(lambda _:req('codigo-carrera','POST','/api/equipo/alta',body={'codigo':creds['carrera']['codigo']}),range(2)))
for i in range(12):req('codigo-incorrecto-'+str(i),'POST','/api/equipo/alta',body={'codigo':'AAAAA-BBBBB'})
for i in range(5):req('pin-fallo-'+str(i+1),'POST','/api/sesion/entrar','bloqueo',{'persona':creds['bloqueo']['id'],'clave':'000000'})
req('pin-bloqueado-correcto','POST','/api/sesion/entrar','bloqueo',{'persona':creds['bloqueo']['id'],'clave':creds['bloqueo']['clave']})
req('pin-persona-inexistente','POST','/api/sesion/entrar','bloqueo',{'persona':'999999','clave':'000000'})
req('pin-sin-equipo','POST','/api/sesion/entrar',body={'persona':creds['responsable']['id'],'clave':creds['responsable']['clave']})
req('finalizar-arranque','POST','/api/arranque/terminar','responsable',{'saldos':[]})
req('abrir-jornada','POST','/api/jornada/abrir','responsable',{})
for role in ['responsable','mostrador','patio','consulta']:
 for path in ['/api/administracion','/api/materiales','/api/clientes','/api/precios','/api/historial','/api/cuentas','/api/panel']:
  req('roles-lectura-'+role,'GET',path,role)
 if role!='responsable':
  for path,body in [('/api/clientes',{'nombre':'Escalada '+role}),('/api/materiales',{'familia':1,'nombre':'Escalada','nombreCorto':'Escalada','frecuente':False}),('/api/administracion/personas',{'nombre':'Escalada','rol':'responsable','clave':'789123'})]:req('roles-escritura-'+role,'POST',path,role,body)
req('consulta-cuenta','POST','/api/cuentas','consulta',{'id':str(uuid.uuid4()),'tipo':'compra','etiqueta':'prohibida'})
for origen in [None,'null','https://ajeno.invalid','https://patio.test.ajeno.invalid','http://patio.test']:
 req('csrf-'+str(origen),'POST','/api/clientes','responsable',{'nombre':'CSRF'},headers={'Origin':origen})
req('csrf-host-falso','POST','/api/clientes','responsable',{'nombre':'CSRF'},headers={'Origin':'https://ajeno.invalid','X-Forwarded-Host':'ajeno.invalid','X-Forwarded-Proto':'https'})
req('persona-falsa','POST','/api/clientes','mostrador',{'nombre':'Escalada','persona':creds['responsable']['id'],'rol':'responsable'},headers={'X-Persona':creds['responsable']['id']})
req('sin-persona','POST','/api/clientes','responsable',{'nombre':'Falta'},headers={'X-Persona':None})
for payload in ["QA40 ' OR 1=1 --",'<img src=x onerror=alert(40)>','QA40 ${7*7} {{7*7}}',"QA40 ';SELECT pg_sleep(2);--"]:
 req('inyeccion-cliente','POST','/api/clientes','responsable',{'nombre':payload})
 req('inyeccion-material','POST','/api/materiales','responsable',{'familia':1,'nombre':payload,'nombreCorto':payload[:30],'frecuente':False})
 for path in ['/api/comprobantes?folio=','/api/historial?antes=','/api/clientes?buscar=']:
  req('inyeccion-busqueda','GET',path+requests.utils.quote(payload,safe=''),'responsable')
req('clientes-persistidos','GET','/api/clientes','responsable')
req('materiales-persistidos','GET','/api/materiales','responsable')
for body in [[],None,{'nombre':'x'*1001},{'nombre':{'$ne':None}}]:req('forma-incorrecta','POST','/api/clientes','responsable',body)
for path in ['/.env','/.git/config','/api/no-existe','/api/clientes/999999999999999999999999999999','/api/cuentas/no-uuid']:
 req('errores-detalle','GET',path,'responsable')
c=sessions['responsable']['cookie'];req('cookie-alterada','GET','/api/sesion',cookie=c[:-5]+'XXXXX')
old=sessions['cierre']['cookie'];req('cierre','POST','/api/sesion/salir','cierre',{});req('cookie-tras-cierre','GET','/api/precios',cookie=old)
req('control-sesion-final','GET','/api/sesion','responsable')
(p/'sesiones.json').write_text(json.dumps(sessions,indent=2))
