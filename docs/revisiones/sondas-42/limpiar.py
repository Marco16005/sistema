from pathlib import Path
import json,subprocess,hashlib,shutil
p=Path(__file__).resolve().parent;root=p.parents[1];project='feruga_qa40';log=[]
def run(args):
 r=subprocess.run(args,capture_output=True,text=True);log.append({'cmd':args,'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr});(p/'limpieza.json').write_text(json.dumps(log,indent=2));return r
# Solo los contenedores del proyecto propio y los nombres exactos de las sondas de esta verificación.
ids=run(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project]).stdout.split()
if ids:assert run(['docker','rm','-f',*ids]).returncode==0
for name in ['codex-seguridad-zap-42','codex-seguridad-browser-42','codex-seguridad-limites-42','codex-seguridad-cabeceras-42','codex-seguridad-preparar-42','codex-seguridad-nmap-42','codex-seguridad-comprobacion-42','codex-seguridad-consola-42','codex-seguridad-navegador-42','codex-seguridad-adicionales-42','codex-seguridad-tls-crudo-42']:
 ids=run(['docker','ps','-aq','--filter','name=^/'+name+'$']).stdout.split()
 if ids:assert run(['docker','rm','-f',*ids]).returncode==0
for kind in ['network','volume']:
 ids=run(['docker',kind,'ls','-q','--filter','label=com.docker.compose.project='+project]).stdout.split()
 if ids:assert run(['docker',kind,'rm',*ids]).returncode==0
images=run(['docker','image','ls','--format','{{.Repository}}:{{.Tag}}','--filter','reference=feruga_qa40-*']).stdout.split()
if images:run(['docker','image','rm',*images])
t=Path((root/'qa/seguridad-40/trabajo.txt').read_text().strip()).resolve()
assert t.parent==root/'qa' and t.name.startswith('trabajo-40.')
manifest=next((t/'instalacion/publicaciones').glob('*/manifiesto.json'));shutil.copy2(manifest,p/'manifiesto-publicado.json')
shutil.copy2(t/'publicar.salida',p/'publicar.salida')
shutil.rmtree(t)
original=json.loads((p/'integridad-inicial.json').read_text());actual={str(x.relative_to(root)):hashlib.sha256(x.read_bytes()).hexdigest() for x in root.rglob('*') if x.is_file() and x.relative_to(root).parts[0] not in ('qa','node_modules','.git','.next')}
final={'productoSinCambios':original==actual,'archivos':len(actual),'instalacionEliminada':not t.exists()}
for kind,cmd in [('contenedores',['docker','ps','-aq']),('redes',['docker','network','ls','-q']),('volumenes',['docker','volume','ls','-q'])]:final[kind]=run(cmd+['--filter','label=com.docker.compose.project='+project]).stdout.split()
(p/'limpieza-verificacion.json').write_text(json.dumps(final,indent=2));assert final['productoSinCambios'] and not any(final[k] for k in ['contenedores','redes','volumenes']);print(json.dumps(final))
with open('/tmp/feruga-codex-informe-42.md','a') as f:f.write('\n## Parte 6 — Retirada e integridad\n\n'+json.dumps(final,ensure_ascii=False)+'. Se retiraron los contenedores de las sondas, la instalación, sus redes, volúmenes y etiquetas de imágenes propias. Se conservan las herramientas que ya existían y la evidencia en qa/seguridad-42. Detalle: `limpieza.json`, `limpieza-verificacion.json`, `manifiesto-publicado.json`.\n')
