from pathlib import Path
import os,re,subprocess,json
root=Path('/tmp/feruga-codex-qa14')
files=['docker-compose.yml','docker-compose.operacion.yml','docker-compose.detras.yml']
env=os.environ.copy()
for k in list(env):
 if k.startswith('COMPOSE_'): del env[k]
for f in files:
 for key in re.findall(r'\$\{([A-Z_]+)',(root/f).read_text()): env[key]='sonda43'
env.update({k:'12345' for k in env if k.endswith('_PUERTO') or k in ('PROXY_HTTP','PROXY_HTTPS')})
env.update(DOMINIO='patio.test',ORIGEN='https://patio.test',RED_DE_ENTRADA='codex43-entrada',COOKIE_SEGURA='1')
for label,profiles,red in [('normal',[], 'codex43-entrada'),('consola',['consola'],'codex43-entrada'),('todos',['*'],'codex43-entrada'),('vacia',[],''),('espacios',[],'   '),('con espacios',[],'codex43-a codex43-b')]:
 args=['docker','compose','--env-file','/dev/null','-p','codex43-config']
 for profile in profiles: args+=['--profile',profile]
 for f in files: args+=['-f',f]
 p=subprocess.run(args+['config','--format','json'],cwd=root,env={**env,'RED_DE_ENTRADA':red},capture_output=True,text=True)
 print(label,'exit',p.returncode)
 if p.returncode: print(p.stderr.strip()); continue
 data=json.loads(p.stdout); (root/f'qa/r43-compose-{label.replace(" ","-")}.json').write_text(p.stdout)
 print('servicios',','.join(data['services']))
 print('proxy redes',data['services']['proxy']['networks'],'puertos',data['services']['proxy'].get('ports',[]))
 print('red',data['networks']['entrada'])
 print('respaldo SITIO_POR',data['services']['respaldo']['environment'].get('SITIO_POR'),'SESION_CLAVE presente', 'SESION_CLAVE' in data['services']['respaldo']['environment'])
