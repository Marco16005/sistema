from pathlib import Path
import subprocess,json,re
p=Path(__file__).parent;t=Path((p.parent/'seguridad-40/trabajo.txt').read_text().strip());conf=next((t/'instalacion/publicaciones').glob('*/conjunto.json'))
def run(*args):
 return subprocess.check_output(['docker','compose','-p','feruga_qa40','-f',str(conf),'run','--rm','--no-deps','-T','--name','codex-seguridad-consola-42','consola',*args],text=True)
s=run('persona','alta','QA41 visual','responsable','--autoriza','--clave=735829');c=run('equipo','codigo','QA41 visual')
f=p/'credenciales.json';f.write_text(json.dumps({'id':re.search(r'número (\d+)',s)[1],'clave':'735829','codigo':re.search(r'código de equipo: (\S+)',c)[1]}));f.chmod(0o600)
