from pathlib import Path
import subprocess,json
p=Path(__file__).parent
D=lambda *a:subprocess.check_output(['docker',*a],text=True)
def inspect(n):return json.loads(D('inspect',n))[0]
db=inspect('codex-seguridad-db-40');proxy=inspect('codex-seguridad-proxy-40');web=inspect('codex-seguridad-web-40')
ip=db['NetworkSettings']['Networks']['feruga_qa40_fondo']['IPAddress']
top={k:{'redes':v['NetworkSettings']['Networks'],'PortBindings':v['HostConfig']['PortBindings'],'Ports':v['NetworkSettings']['Ports'],'docker_port':D('port',v['Id'])} for k,v in [('db',db),('web',web),('proxy',proxy)]}
(p/'topologia.json').write_text(json.dumps(top,indent=2))
results=[]
for label,net in [('frente','feruga_qa40_frente'),('proxy-red','feruga_qa40_default'),('proxy-espacio','container:codex-seguridad-proxy-40'),('fondo','feruga_qa40_fondo')]:
 cmd=['docker','run','--rm','--pull=never','--name','codex-seguridad-nmap-41','--network',net,'instrumentisto/nmap:7.95','-sT','-Pn','-p','5432','--max-retries','1','--host-timeout','12s',ip]
 r=subprocess.run(cmd,capture_output=True,text=True,timeout=40)
 results.append({'origen':label,'cmd':cmd,'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr});(p/'red.json').write_text(json.dumps(results,indent=2));print(label,r.stdout+r.stderr,flush=True)
# Usa el conjunto concreto que publicar.sh pasa por stdin, y la misma imagen comprobacion.
t=Path((p.parent/'seguridad-40/trabajo.txt').read_text().strip());conf=next((t/'instalacion/publicaciones').glob('*/conjunto.json'))
original=json.loads(conf.read_text());tests=[]
for label,target in [('valida',None),('db-local','db'),('web-local','web')]:
 c=json.loads(json.dumps(original))
 if target:c['services'][target]['ports']=[{'host_ip':'127.0.0.1','published':'54441' if target=='db' else '3241','target':5432 if target=='db' else 3000,'protocol':'tcp'}]
 file=p/('control-'+label+'.json');file.write_text(json.dumps(c,indent=2));file.chmod(0o600)
 cmd=['docker','compose','-p','feruga_qa40','-f',str(conf),'run','--rm','--no-deps','-T','--name','codex-seguridad-comprobacion-41','comprobacion','red','--local']
 r=subprocess.run(cmd,input=file.read_text(),text=True,capture_output=True)
 tests.append({'caso':label,'archivo':str(file),'cmd':cmd,'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
(p/'control-publicacion.json').write_text(json.dumps(tests,indent=2));print(json.dumps(tests,indent=2))
with open('/tmp/feruga-codex-informe-41.md','a') as f:
 f.write('\n## Parte 2 — R40-01: red y rechazo de publicación\n\n')
 for r in results:f.write('- '+r['origen']+' → '+ip+': '+ '; '.join(l for l in r['stdout'].splitlines() if '5432' in l)+'\n')
 f.write('\n`docker port` no devuelve puertos de db/web; PortBindings y Ports se guardan en `topologia.json`. Solo el proxy publica. Los controles pasan la configuración por stdin a `comprobacion red --local`, igual que publicar.sh: no se levanta el puerto prohibido.\n\n')
 for r in tests:f.write('- '+r['caso']+': salida '+str(r['rc'])+'; '+r['stdout'].strip()+' '+r['stderr'].strip()+'\n')
 f.write('\nEvidencia: `red.json`, `topologia.json`, `control-publicacion.json`; sonda repetible: `python3 qa/seguridad-41/red.py`.\n')
