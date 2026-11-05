import requests,time,json,re,uuid,sys,os
from pathlib import Path
requests.packages.urllib3.disable_warnings();p=Path('/zap/wrk');base='https://patio.test';api='http://127.0.0.1:8080';role=sys.argv[1];events=[]
maxmins=int(os.getenv('ZAP_MINUTOS','20')); rulemins=int(os.getenv('ZAP_REGLA_MINUTOS','5'))
def z(component,kind,action,**kw):
 r=requests.get(f'{api}/JSON/{component}/{kind}/{action}/',params=kw,timeout=60);r.raise_for_status();data=r.json()
 if 'code' in data and 'message' in data:raise RuntimeError(data)
 return data
def save(name,data): (p/f'zap-{role}-{name}.json').write_text(json.dumps(data,indent=2,ensure_ascii=False))
# Replacer rules persist across sessions: remove them before assigning this role.
for old in z('replacer','view','rules').get('rules',[]):z('replacer','action','removeRule',description=old['description'])
z('core','action','newSession',name='/zap/wrk/session-'+role,overwrite='true')
z('pscan','action','setScanOnlyInScope',onlyInScope='true')
ctx=z('context','action','newContext',contextName=role)['contextId'];z('context','action','includeInContext',contextName=role,regex=r'https://patio\.test(?::443)?/.*')
z('context','action','setContextInScope',contextName=role,booleanInScope='true')
# Session lifecycle is exercised manually. Exclusion protects the role being scanned.
exclude=r'https://patio\.test(?::443)?/api/(sesion/(entrar|salir)|equipo/alta|jornada/(cerrar|reabrir)|arranque/terminar)(\?.*)?'
z('context','action','excludeFromContext',contextName=role,regex=exclude)
z('spider','action','setOptionMaxDepth',Integer=3);z('spider','action','setOptionMaxDuration',Integer=1);z('spider','action','setOptionThreadCount',Integer=2)
headers={'Origin':base,'Content-Type':'application/json'}
if role!='anonimo':
 s=json.loads((p/'sesiones.json').read_text())[role];headers.update({'Cookie':s['cookie'],'X-Persona':s['id']})
 c=json.loads((p/'credenciales.json').read_text())[role]
 login=requests.post(base+'/api/sesion/entrar',json={'persona':c['id'],'clave':c['clave']},headers=headers,verify=str(p/'raiz.crt'),timeout=30)
 assert login.status_code==200,login.text
 headers['Cookie']=login.headers['Set-Cookie'].split(';')[0]
 sessions=json.loads((p/'sesiones.json').read_text());sessions[role]['cookie']=headers['Cookie'];(p/'sesiones.json').write_text(json.dumps(sessions,indent=2))
for label,value in headers.items():z('replacer','action','addRule',description=role+'-'+label,enabled='true',matchType='REQ_HEADER',matchRegex='false',matchString=label,replacement=value,initiators='')
# Every imported request is restricted to the sole target hostname; no external URLs followed.
client=requests.Session();client.trust_env=False;client.proxies={'https':api,'http':api};client.headers.update(headers)
def fetch(method,path,body=None):
 try:
  r=client.request(method,base+path,json=body,verify=False,allow_redirects=False,timeout=25)
  events.append({'method':method,'path':path,'status':r.status_code,'body':r.text[:500],'seconds':r.elapsed.total_seconds()})
 except Exception as e:events.append({'method':method,'path':path,'error':str(e)})
 save('semillas',events)
for path in json.loads((p/'paginas.json').read_text()):fetch('GET',path.replace('/.','/'))
today=time.strftime('%Y-%m-%d');unknown='00000000-0000-4000-8000-000000000040'
for row in json.loads((p/'rutas.json').read_text()):
 path=row['path']
 if (p/'negocio.json').exists():
  negocios=json.loads((p/'negocio.json').read_text());cuenta=next((json.loads(x['body'])['cuenta']['id'] for x in negocios if x['label']=='cuenta-valida' and x['status']==200),unknown)
  path=path.replace('[cuenta]',cuenta)
 path=path.replace('[cliente]','1').replace('[material]','1')
 path=re.sub(r'\[(cuenta|envio|equipo)\]',unknown,path);path=re.sub(r'\[[^\]]+\]','999999',path)
 if re.match(exclude,base+path):continue
 if row['method']=='GET':
  query={'/api/catalogo':'tipo=compra','/api/comprobantes':'folio=1','/api/exportar':'tipo=ventas','/api/clientes/resumen':'buscar=QA40'}.get(path,'')
  fetch('GET',path+('?' + query if query else ''))
 elif role!='anonimo':
  body={'id':str(uuid.uuid4()),'nombre':'QA40 ZAP '+role,'nombreCorto':'ZAP '+role,'familia':1,'frecuente':False,'tipo':'compra','etiqueta':'ZAP '+role,'material':1,'kg':'1.00','motivo':'Prueba QA40','cambios':[],'saldos':[],'persona':'999999','clave':'000000','rol':'consulta','fecha':today,'concepto':'QA40','importe':'1.00','deDonde':'otro','autoriza':False,'puedeAutorizar':False}
  body={k:v for k,v in body.items() if k in row.get('campos',body)}
  fetch(row['method'],path,body)
 else:fetch(row['method'],path,{})
spid=z('spider','action','scan',url=base+'/',contextName=role,subtreeOnly='true')['scan']
while int(z('spider','view','status',scanId=spid)['status'])<100:time.sleep(2)
save('spider',z('spider','view','results',scanId=spid))
if role!='anonimo':
 # Fixed, relevant built-in rules; no add-on downloads or out-of-band callbacks.
 z('ascan','action','excludeFromScan',regex=r'https://patio\.test(?::443)?/_next/.*')
 scanners=z('ascan','view','scanners')['scanners'];save('reglas-disponibles',scanners)
 ids=['40012','40014','40018','40019','40020','40021','40022','6','7','40003','40008','40009','90019','90020','90021','90023','90024','90025','40032']
 available={s['id'] for s in scanners};ids=[s for s in ids if s in available]
 z('ascan','action','disableAllScanners');z('ascan','action','enableScanners',ids=','.join(ids))
 z('ascan','action','setOptionMaxScanDurationInMins',Integer=maxmins);z('ascan','action','setOptionMaxRuleDurationInMins',Integer=rulemins)
 z('ascan','action','setOptionThreadPerHost',Integer=3);z('ascan','action','setOptionDelayInMs',Integer=10)
 for sid in ids:z('ascan','action','setScannerAttackStrength',id=sid,attackStrength='LOW')
 fetch('GET','/api/sesion');scan=z('ascan','action','scan',url=base+'/',recurse='true',inScopeOnly='true',contextId=ctx)['scan'];start=time.time();states=[]
 while True:
  state=z('ascan','view','status',scanId=scan);states.append({'elapsed':round(time.time()-start),'status':state});save('progreso',states)
  if int(state['status'])>=100:break
  if time.time()-start>(maxmins+1)*60:z('ascan','action','stop',scanId=scan);break
  time.sleep(5)
 save('escaneo',z('ascan','view','scans'));save('reglas-estado',z('ascan','view','scanProgress',scanId=scan));fetch('GET','/api/sesion')
for _ in range(120):
 if int(z('pscan','view','recordsToScan')['recordsToScan'])==0:break
 time.sleep(1)
save('alertas',z('core','view','alerts',baseurl=base,start=0,count=10000));save('urls',z('core','view','urls',baseurl=base));save('mensajes',z('core','view','messages',baseurl=base,start=0,count=100000))
for fmt in ['json','html']:
 r=requests.get(f'{api}/OTHER/core/other/{fmt}report/',timeout=60);(p/f'zap-{role}-informe.{fmt}').write_text(r.text)
save('version',z('core','view','version'))
print('TERMINADO',role,len(events),flush=True)
