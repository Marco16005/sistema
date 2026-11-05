from pathlib import Path
import json
p=Path(__file__).parent
s=json.loads((p/'resumen.json').read_text());n=json.loads((p/'navegador.json').read_text());l=json.loads((p/'limites.json').read_text())
assert not s['duplicadas'] and not s['apiSinNoStore'] and not s['nonceElegido']
assert s['nonces']==s['noncesUnicos']
assert all(r['path']=='/%' for r in s['sinCsp']+s['sinNosniff'])
assert all(r['path']=='/api' or r['path'].startswith('/api/') for r in s['htmlSinNonce']+s['scriptsSinNonce'])
assert n['bien'] and len(n['pages'])==10 and not n['errors'] and not n['dialogs']
assert all(not r['violaciones'] for r in n['pages'])
for r in l['navegador']:
 if r.get('error'):assert r['path']=='/favicon.ico';continue
 assert r['ejecutada'] is False
 assert any(v['directiva']=='script-src-attr' for v in r['despues'])
for r in l['http']:
 assert r['headers'].get('content-security-policy') and r['headers'].get('x-content-type-options')=='nosniff'
 if r['status']==308:assert r['headers'].get('cache-control')=='private, no-store'
raw=json.loads((p/'tls-crudo.json').read_text())
assert len(raw)==12
for r in raw:
 if r['path']=='/mostrador':continue
 assert r['respuesta']=='HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n400 Bad Request'
print('Validación correcta: correcciones confirmadas; excepción 400 y HTML de API delimitados.')
