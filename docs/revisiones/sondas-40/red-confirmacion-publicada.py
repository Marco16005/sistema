from pathlib import Path
import subprocess,json
p=Path(__file__).parent
image='instrumentisto/nmap@sha256:3cca6ece8de5a571c956022ec6c2cf343da8c4416fa36e1891e8c33623cfc845'
def inspect(n):return json.loads(subprocess.check_output(['docker','inspect',n]))[0]
db=inspect('codex-seguridad-db-40'); proxy=inspect('codex-seguridad-proxy-40'); ip=db['NetworkSettings']['Networks']['feruga_qa40_fondo']['IPAddress']
assert set(db['NetworkSettings']['Networks'])=={'feruga_qa40_fondo'}
assert 'feruga_qa40_fondo' not in proxy['NetworkSettings']['Networks']
results=[]
for label,net in [('frente','feruga_qa40_frente'),('proxy-red','feruga_qa40_default'),('proxy-espacio','container:codex-seguridad-proxy-40'),('fondo','feruga_qa40_fondo')]:
 for target in ['db','codex-seguridad-db-40',ip]:
  name='codex-seguridad-nmap-cont-40'
  cmd=['docker','run','--rm','--pull=never','--name',name,'--network',net,image,'-sT','-Pn','-p','5432','--max-retries','1','--host-timeout','12s',target]
  r=subprocess.run(cmd,capture_output=True,text=True,timeout=40)
  results.append({'origen':label,'red':net,'destino':target,'cmd':cmd,'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr});(p/'red-confirmacion-publicada.json').write_text(json.dumps(results,indent=2))
  print(label,target,r.stdout+r.stderr,flush=True)
(p/'red-confirmacion-publicada-topologia.json').write_text(json.dumps({'base':db['NetworkSettings']['Networks'],'proxy':proxy['NetworkSettings']['Networks']},indent=2))
with open('/tmp/feruga-codex-informe-40.md','a') as f:
 f.write('\n## Contraprueba R40-01: se restaura la publicación original de 5432\n\nLa base pertenece únicamente a `feruga_qa40_fondo`; el proxy a `feruga_qa40_frente` y a `feruga_qa40_default` (servicios externos ficticios). Evidencias y órdenes completas: `red-confirmacion-publicada.json`, `red-confirmacion-publicada-topologia.json`.\n\n')
 for r in results:
  desc='; '.join(x for x in (r['stdout']+r['stderr']).splitlines() if any(k in x for k in ['5432','Failed to resolve','timed out']))
  f.write(f"- {r['origen']} → `{r['destino']}`: {desc}.\n")
