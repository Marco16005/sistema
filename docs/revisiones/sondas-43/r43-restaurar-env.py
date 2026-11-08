from pathlib import Path
import subprocess,os,re,json
root=Path('/tmp/feruga-codex-qa14'); work=root/'qa/r43-env-recuperacion';work.mkdir(exist_ok=True)
if not (work/'.env').exists(): subprocess.run(['sh',str(root/'operacion/entorno.sh'),'patio.test','--detras-de-otro-proxy'],cwd=work,check=True,stdout=subprocess.DEVNULL)
# Solo valores falsos para completar la interpolación; no se inicia ningún servicio.
env=os.environ.copy()
for k in list(env):
 if k.startswith('COMPOSE_'): del env[k]
for key in re.findall(r'\$\{([A-Z_]+):\?',(root/'docker-compose.operacion.yml').read_text()): env[key]='sonda43'
for k in ['COMPOSE_FILE','RED_DE_ENTRADA','DOMINIO','ORIGEN','COOKIE_SEGURA']:env.pop(k,None)
p=subprocess.run(['docker','compose','-p','codex43-recuperacion','--env-file',str(work/'.env'),'config','--format','json'],cwd=root,env=env,capture_output=True,text=True)
print('Compose con .env del paquete: exit',p.returncode)
if p.returncode:print(p.stderr)
else:
 d=json.loads(p.stdout);print('proxy command',d['services']['proxy']['command']);print('proxy ports',d['services']['proxy'].get('ports',[]));print('entrada',d['networks']['entrada'])
