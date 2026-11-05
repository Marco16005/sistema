from pathlib import Path
import subprocess,json,re
p=Path(__file__).parent;t=Path((p/'trabajo.txt').read_text().strip());conf=next((t/'instalacion/publicaciones').glob('*/conjunto.json'))
def run(*args):
 r=subprocess.run(['docker','compose','-p','feruga_qa40','-f',str(conf),'run','--rm','--no-deps','-T','--name','codex-seguridad-consola-visual-40','consola',*args],capture_output=True,text=True,check=True);return r.stdout
s=run('persona','alta','QA40 visual','responsable','--autoriza','--clave=735829');c=run('equipo','codigo','QA40 visual')
(p/'visual-credenciales.json').write_text(json.dumps({'id':re.search(r'número (\d+)',s)[1],'clave':'735829','codigo':re.search(r'código de equipo: (\S+)',c)[1]}))

(p/'visual-sesion.json').unlink(missing_ok=True)
