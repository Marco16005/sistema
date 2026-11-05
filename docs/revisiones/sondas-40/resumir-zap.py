import json,sys,collections
from pathlib import Path
p=Path(__file__).parent;role=sys.argv[1]
s=json.loads((p/f'zap-{role}-escaneo.json').read_text());progress=json.loads((p/f'zap-{role}-reglas-estado.json').read_text());elapsed=json.loads((p/f'zap-{role}-progreso.json').read_text())[-1]['elapsed']
def plugins(x):
 if isinstance(x,dict):
  if 'Plugin' in x:yield x['Plugin']
  for v in x.values():yield from plugins(v)
 elif isinstance(x,list):
  for v in x:yield from plugins(v)
rules=list(plugins(progress));alerts=json.loads((p/f'zap-{role}-alertas.json').read_text())['alerts'];seeds=json.loads((p/f'zap-{role}-semillas.json').read_text());sessions=[e for e in seeds if e['path']=='/api/sesion']
with open('/tmp/feruga-codex-informe-40.md','a') as f:
 f.write(f'\n### ZAP activo repetido: {role}\n\nPlazo total 20 minutos y por regla 5 minutos (antes 6 y 1). Duración observada: {elapsed} s. Resultado: `{json.dumps(s)}`.\n\n')
 f.write('Sesión antes/después: '+json.dumps(sessions,ensure_ascii=False)+'\n\n')
 f.write('| Regla | Estado | Peticiones | Alertas activas |\n|---|---|---|---|\n')
 for r in rules:f.write(f'| {r[0]} ({r[1]}) | {r[3]} | {r[5]} | {r[6]} |\n')
 f.write('\nAlertas totales por tipo (incluyen pasivas): '+json.dumps(dict(collections.Counter((a['risk']+': '+a['alert']) for a in alerts)),ensure_ascii=False)+'. Evidencia: `zap-'+role+'-*`.\n')
print(role,s,elapsed,'sesiones',[(x['status'],x.get('body','')[:120]) for x in sessions],flush=True)
