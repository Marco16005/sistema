import requests,time,json,re
from pathlib import Path
p=Path('/zap/wrk');base='https://patio.test';api='http://127.0.0.1:8080'
requests.packages.urllib3.disable_warnings()
def z(component,kind,action,**kw):
 r=requests.get(f'{api}/JSON/{component}/{kind}/{action}/',params=kw,timeout=30);r.raise_for_status();return r.json()
def save(name,x):(p/('zap-'+name+'.json')).write_text(json.dumps(x,indent=2))
z('core','action','newSession',name='/zap/wrk/pasivo41',overwrite='true')
z('context','action','newContext',contextName='responsable41');z('context','action','includeInContext',contextName='responsable41',regex=r'https://patio\.test(?::443)?/.*');z('context','action','setContextInScope',contextName='responsable41',booleanInScope='true');z('pscan','action','setScanOnlyInScope',onlyInScope='true')
s=json.loads((p/'sesion.json').read_text());client=requests.Session();client.trust_env=False;client.proxies={'https':api};client.headers.update({'Cookie':s['cookie'],'X-Persona':s['id']});events=[];assets=set()
paths=['/','/mostrador','/inventario','/precios','/cierre','/panel','/panel/clientes','/panel/materiales','/panel/ajustes','/panel/bitacora','/panel/fiado','/no-existe-41','/apicualquiera','/favicon.ico','/api/no-existe-41','/mostrador/','/api/clientes/','/api/salud','/api/sesion','/api/personas','/api/materiales','/api/clientes','/api/precios','/api/cuentas','/api/administracion','/api/historial','/api/panel','/api/fiado','/api/caja','/api/inventario','/api/bitacora']
for path in paths:
 r=client.get(base+path,verify=False,timeout=30,allow_redirects=False);events.append({'path':path,'status':r.status_code,'headers':dict(r.headers),'sesion':r.json() if path=='/api/sesion' else None});assets.update(re.findall(r'(?:src|href)="(/_next/static/[^"<>]+)"',r.text));save('peticiones',events)
for path in sorted(assets):
 r=client.get(base+path,verify=False,timeout=30,allow_redirects=False);events.append({'path':path,'status':r.status_code,'headers':dict(r.headers)});save('peticiones',events)
for _ in range(90):
 pending=z('pscan','view','recordsToScan')
 if int(pending['recordsToScan'])==0:break
 time.sleep(1)
save('cola',pending);save('alertas',z('core','view','alerts',baseurl=base,start=0,count=10000));save('mensajes',z('core','view','messages',baseurl=base,start=0,count=10000));save('version',z('core','view','version'));save('escaneos-activos',z('ascan','view','scans'))
print('Pasivo completo',len(events),'peticiones',pending)
