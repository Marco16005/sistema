from pathlib import Path
import subprocess,json,re,os
p=Path('/tmp/feruga-codex-qa14'); out=p/'qa/seguridad-40'; trabajo=Path((out/'trabajo.txt').read_text().strip()); conf=next((trabajo/'instalacion/publicaciones').glob('*/conjunto.json'))
log=[]
def consola(*args):
 name='codex-seguridad-consola-40'
 cmd=['docker','compose','-p','feruga_qa40','-f',str(conf),'run','--rm','--no-deps','-T','--name',name,'consola',*args]
 r=subprocess.run(cmd,capture_output=True,text=True);log.append({'cmd':cmd,'stdout':r.stdout,'stderr':r.stderr,'rc':r.returncode});assert r.returncode==0,r.stderr+r.stdout
 return r.stdout
users={}
for i,rol in enumerate(['responsable','mostrador','patio','consulta','bloqueo','expira','duracion','cierre','revoca']):
 actual=rol if i<4 else 'consulta'; pin=str(849201+i)
 s=consola('persona','alta','QA40 '+rol,actual,'--clave='+pin)
 c=consola('equipo','codigo','QA40 '+rol)
 users[rol]={'id':re.search(r'número (\d+)',s)[1],'clave':pin,'codigo':re.search(r'código de equipo: (\S+)',c)[1]}
for rol in ['caducado','carrera']:
 c=consola('equipo','codigo','QA40 '+rol);users[rol]={'codigo':re.search(r'código de equipo: (\S+)',c)[1]}
(out/'credenciales.json').write_text(json.dumps(users,indent=2));os.chmod(out/'credenciales.json',0o600)
(out/'consola.json').write_text(json.dumps(log,indent=2,ensure_ascii=False))
subprocess.run(['docker','exec','codex-seguridad-db-40','psql','-U','feruga','-d','feruga','-c',"UPDATE codigo_alta SET vence_en=now()-interval '1 minute' WHERE nombre_equipo='QA40 caducado'"],check=True)
