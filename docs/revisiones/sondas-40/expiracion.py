import requests,json
from pathlib import Path
p=Path('/zap/wrk');s=json.loads((p/'sesiones.json').read_text());result=[]
for role in ['expira','duracion','revoca']:
 r=requests.get('https://patio.test/api/precios',headers={'Cookie':s[role]['cookie']},verify=str(p/'raiz.crt'),timeout=20)
 result.append({'role':role,'status':r.status_code,'body':r.text,'headers':dict(r.headers)});print(role,r.status_code,r.text)
(p/'expiracion.json').write_text(json.dumps(result,indent=2))
