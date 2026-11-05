from pathlib import Path
import subprocess,json,shutil,datetime
root=Path('/tmp/feruga-codex-qa14').resolve();p=root/'qa/seguridad-40';log=[]
def run(args):
 r=subprocess.run(['docker',*args],capture_output=True,text=True);log.append({'cmd':['docker',*args],'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr});(p/'limpieza-continuacion.json').write_text(json.dumps(log,indent=2));assert r.returncode==0,r.stderr;return r.stdout
# Solo el proyecto propio y los nombres de herramientas de esta revisión.
ids=set(run(['ps','-aq','--filter','label=com.docker.compose.project=feruga_qa40']).split())
for line in run(['ps','-a','--filter','name=codex-seguridad-','--format','{{.ID}} {{.Names}}']).splitlines():
 cid,name=line.split()
 if name.startswith('codex-seguridad-40-') or name.endswith('-40'):ids.add(cid)
for cid in ids:
 d=json.loads(run(['inspect',cid]))[0];name=d['Name'];assert name.startswith('/codex-seguridad-')
 run(['rm','-f',cid])
for kind in ['network','volume']:
 for name in run([kind,'ls','-q','--filter','label=com.docker.compose.project=feruga_qa40']).split():run([kind,'rm',name])
# Guardar registros de publicación; después quitar ambas instalaciones generadas y sus llaves.
for work in (root/'qa').glob('trabajo-40.*'):
 assert work.is_dir() and work.resolve().parent==root/'qa'
 archive=p/('publicacion-'+work.name);archive.mkdir(exist_ok=True)
 for name in ['publicar.salida','queja','servicios']:
  if (work/name).is_file():shutil.copy2(work/name,archive/name)
 shutil.rmtree(work)
# Solo etiquetas de imágenes de este proyecto; conservar herramientas fijadas para poder repetir.
for tag in run(['image','ls','--format','{{.Repository}}:{{.Tag}}','--filter','reference=feruga_qa40-*']).splitlines():
 if not tag.endswith(':<none>'):run(['image','rm',tag])
remaining={kind:run(args).strip() for kind,args in {
 'contenedores_proyecto':['ps','-aq','--filter','label=com.docker.compose.project=feruga_qa40'],
 'contenedores_prefijo':['ps','-a','--filter','name=codex-seguridad-','--format','{{.Names}}'],
 'redes':['network','ls','-q','--filter','label=com.docker.compose.project=feruga_qa40'],
 'volumenes':['volume','ls','-q','--filter','label=com.docker.compose.project=feruga_qa40'],
 'imagenes_proyecto':['image','ls','--format','{{.Repository}}:{{.Tag}}','--filter','reference=feruga_qa40-*']}.items()}
remaining['instalaciones']=[str(x) for x in (root/'qa').glob('trabajo-40.*')]
(p/'limpieza-verificacion.json').write_text(json.dumps(remaining,indent=2));assert not any(remaining.values()),remaining
with open('/tmp/feruga-codex-informe-40.md','a') as f:f.write('\n## Limpieza completada\n\nComprobación final: cero contenedores `feruga_qa40`, cero contenedores `codex-seguridad-…`, cero redes, volúmenes o etiquetas de imágenes del proyecto y cero directorios `qa/trabajo-40.*`. Se retiraron también las dos instalaciones generadas y sus llaves. Los registros de publicación se conservaron dentro de las evidencias. Las imágenes locales de herramientas/dependencias se conservan para repetir sin instalar paquetes. Evidencia: `limpieza-continuacion.json` y `limpieza-verificacion.json`. La copia de trabajo y sus sondas siguen en `/tmp/feruga-codex-qa14/qa/`; el informe completo queda en `/tmp/feruga-codex-informe-40.md`.\n')
print(json.dumps(remaining,indent=2))
