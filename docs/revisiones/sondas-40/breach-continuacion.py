import requests,json,gzip,zlib,hashlib,uuid
from pathlib import Path
p=Path('/zap/wrk');s=json.loads((p/'visual-sesion.json').read_text());cred=json.loads((p/'visual-credenciales.json').read_text());out=[];marker='QA40BREACH_'+uuid.uuid4().hex[:20]
client=requests.Session();client.trust_env=False
h={'Cookie':s['cookie'],'X-Persona':s['id'],'Origin':'https://patio.test','Accept-Encoding':'gzip'}
def req(label,path,method='GET',body=None,anon=False,extra=None):
 headers=dict(h) if not anon else {'Accept-Encoding':'gzip'};headers.update(extra or {})
 r=client.request(method,'https://patio.test'+path,headers=headers,json=body,verify=str(p/'raiz.crt'),timeout=30,stream=True,allow_redirects=False);raw=r.raw.read(decode_content=False);decoded=gzip.decompress(raw) if r.headers.get('content-encoding')=='gzip' else raw;text=decoded.decode('utf-8','replace')
 row={'label':label,'path':path,'status':r.status_code,'headers':dict(r.headers),'comprimida':r.headers.get('content-encoding'),'bytes_red':len(raw),'bytes_cuerpo':len(decoded),'refleja_marcador':marker in text,'refleja_cookie_en_cuerpo':s['cookie'][7:] in text,'cuerpo':text};out.append(row);(p/'breach-continuacion.json').write_text(json.dumps(out,indent=2,ensure_ascii=False));return r,text
for path in ['/','/mostrador','/panel/ajustes','/api/sesion','/api/clientes','/api/clientes/resumen','/api/materiales','/api/panel','/api/catalogo?tipo=compra','/api/precios','/api/salud','/api/comprobantes?folio=1']:
 sep='&' if '?' in path else '?'
 req('consulta-controlada',path+sep+'buscar='+marker)
req('nombre-persistido','/api/clientes','POST',{'nombre':marker})
req('lista-con-reflejo-almacenado','/api/clientes?buscar='+marker)
req('error-reflejado','/api/catalogo?tipo='+marker)
req('anon-query','/?buscar='+marker,anon=True)
req('anon-lista','/api/clientes?buscar='+marker,anon=True)
req('csrf-lectura','/api/clientes?buscar='+marker,extra={'Origin':'https://ajeno.invalid','Sec-Fetch-Site':'cross-site'})
req('csrf-escritura','/api/clientes','POST',{'nombre':marker},extra={'Origin':'https://ajeno.invalid','Sec-Fetch-Site':'cross-site'})
req('codigo-equipo','/api/administracion/equipos','POST',{'nombre':marker,'clave':cred['clave']})
_,body=req('alta-persona-clave','/api/administracion/personas','POST',{'nombre':marker,'rol':'consulta','clave':cred['clave']})
try:pid=json.loads(body)['persona']['id'];req('cambio-clave','/api/administracion/personas/'+pid+'/clave','POST',{'clave':cred['clave']})
except (KeyError,ValueError):pass
for row in out:print(row['label'],row['status'],row['comprimida'],row['bytes_cuerpo'],'reflejo',row['refleja_marcador'])
