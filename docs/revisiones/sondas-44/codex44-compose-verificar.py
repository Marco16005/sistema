import os,re,json,subprocess
from pathlib import Path
root=Path.cwd(); env=os.environ.copy()
for name in re.findall(r'\$\{([A-Z_]+):\?',Path('docker-compose.yml').read_text()+Path('docker-compose.operacion.yml').read_text()):
    env[name]='codex44-prueba'
for name in ['IMAGEN_DB','IMAGEN_WEB','IMAGEN_ADMIN','IMAGEN_RESPALDO','IMAGEN_PROXY']:env[name]='alpine:3.22'
r=subprocess.check_output(['docker','compose','--profile','consola','--env-file','/dev/null','-f','docker-compose.yml','-f','docker-compose.operacion.yml','config','--format','json'],env=env,text=True)
config=json.loads(r)
limites={s:config['services'][s]['deploy']['resources']['limits'] for s in ['db','web','proxy','respaldo','comprobacion','migracion','consola']}
Path('qa/codex44-config-resuelta.json').write_text(json.dumps(limites,indent=2)+'\n')
sonda={'name':'codex44-limites','services':{s:{'image':'alpine:3.22','container_name':'codex44-limite-'+s,'network_mode':'none','command':['sleep','600'],'deploy':{'resources':{'limits':t}}} for s,t in limites.items()}}
Path('qa/codex44-limites.json').write_text(json.dumps(sonda,indent=2)+'\n')
subprocess.run(['docker','compose','-f','qa/codex44-limites.json','up','-d'],check=True)
subprocess.run(['docker','compose','-f','qa/codex44-limites.json','run','-d','--no-deps','--name','codex44-limite-run','comprobacion'],check=True)
names=['codex44-limite-'+s for s in limites]+['codex44-limite-run']
results=[]
for c in json.loads(subprocess.check_output(['docker','inspect',*names])):
    h=c['HostConfig'];row={'name':c['Name'],**{k:h[k] for k in ['Memory','MemorySwap','NanoCpus','PidsLimit']}};results.append(row)
Path('qa/codex44-limites-resultados.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
subprocess.run(['docker','rm','-f',*names],check=True,stdout=subprocess.DEVNULL)
