"""Sondas de fuera.sh y del nombre de reserva de limpieza; Docker simulado salvo validación env-file."""
import os, pathlib, subprocess, json, re, pty, shutil
R=pathlib.Path.cwd();Q=R/'qa';F=Q/'fuera-36';F.mkdir(exist_ok=True);B=F/'bin';B.mkdir(exist_ok=True)
D=shutil.which('docker');calls=F/'llamadas';envfile=F/'recuperacion.env'
mock='''#!/bin/sh
printf '%s\\n' "$*" >> "$QA_LLAMADAS"
case "$*" in
 info*|build*|"network "*|"exec "*) exit 0;;
 "rm -f"*) exit "${QA_RM_CODIGO:-0}";;
 "image ls"*) exit 0;;
 "image inspect"*) exit 1;;
 *"--entrypoint age-keygen"*) echo AGE-SECRET-KEY-1FICTICIA;;
 *"sello.ts"*) cat >/dev/null; echo RESPALDO_SELLO=ficticio;;
 *"version-del-respaldo.ts"*) cat >/dev/null; echo version;;
 "run -d "*) echo base;;
 *"restaurar.ts"*) cat >/dev/null; exit 0;;
 *) exit 90;;
esac
'''
(B/'docker').write_text(mock);(B/'docker').chmod(0o755)
e={**os.environ,'PATH':str(B)+':'+os.environ['PATH'],'QA_LLAMADAS':str(calls),'FUERA_ENTORNO':str(envfile)}
for nombre,contenido,rechaza in [
 ('normal','BD_CLAVE=Ficticia36\n',True),
 ('espacios','  BD_CLAVE=Ficticia36\n',False),
 ('variable heredada','BD_CLAVE\n',False),
 ('URL con espacios','  DATABASE_URL=postgres://ficticio:clave@servidor/base\n',False),
]:
 envfile.write_text(contenido);calls.write_text('')
 p=subprocess.run(['/bin/sh','operacion/fuera.sh','version'],env=e,input='AGE-SECRET-KEY-1FICTICIA',text=True,capture_output=True)
 assert (p.returncode!=0)==rechaza
 # Docker real interpreta esas mismas entradas. No consulta ni modifica bases.
 imagen=re.search(r'(?m)^FROM (\S+)',(R/'docker/db.Dockerfile').read_text()).group(1)
 variable='DATABASE_URL' if 'DATABASE_URL' in contenido else 'BD_CLAVE'
 real=subprocess.run([D,'run','--rm','--network','none','--log-driver','none','--env-file',str(envfile),'--entrypoint','sh',imagen,'-c','test -n "$'+variable+'"'],env={**os.environ,'BD_CLAVE':'Ficticia36'},capture_output=True)
 assert real.returncode==0
 print(json.dumps({'caso':nombre,'rechazado_por_fuera':p.returncode!=0,'docker_recibe_dato_de_base':True}),flush=True)
envfile.write_text('RESPALDO_DESTINO=respaldo:cubo/feruga\n');calls.write_text('')
p=subprocess.run(['/bin/sh','operacion/fuera.sh','ensayo'],env={**e,'QA_RM_CODIGO':'1'},input='AGE-SECRET-KEY-1FICTICIA',text=True,capture_output=True)
assert p.returncode==0 and 'El ensayo pasó' in p.stdout
assert 'rm -f feruga-fuera-base-' in calls.read_text()
assert not re.search(r' --publish| -p ',calls.read_text())
assert 'AGE-SECRET-KEY' not in calls.read_text()
print(json.dumps({'caso':'docker rm falla','codigo':p.returncode,'declara_ensayo_exitoso':True,'no_informa_fallo_limpieza':True}),flush=True)
# stdout es una terminal real: llave debe negarse y no entregar ni generar una llave.
calls.write_text('');m,s=pty.openpty()
p=subprocess.run(['/bin/sh','operacion/fuera.sh','llave'],env=e,stdin=subprocess.DEVNULL,stdout=s,stderr=subprocess.PIPE,text=True);os.close(s);os.close(m)
assert p.returncode==1 and 'no a la pantalla' in p.stderr and 'age-keygen' not in calls.read_text()
print('llave con terminal real: rechazo correcto sin generar llave',flush=True)
# La función se incluye sin tocar el producto. Sin imagen disponible inspecciona el nombre esperado.
calls.write_text('')
script='''set -eu
falla() { echo "$*" >&2; exit 1; }
nombre_del_proyecto() { echo recicladora_qa36; }
commit_actual() { echo abcdef0123456789abcdef0123456789abcdef0123; }
candado_turno=sonda
HERRAMIENTAS=""
PUBLICACIONES=publicaciones
. operacion/limpieza.sh
limpiar_publicaciones
'''
p=subprocess.run(['/bin/sh','-c',script],env=e,text=True,capture_output=True)
assert p.returncode==1
assert 'image inspect recicladora_qa36-herramientas:abcdef012345' in calls.read_text()
assert 'image rm' not in calls.read_text() and 'build' not in calls.read_text()
print('limpieza: reserva recicladora_qa36-herramientas:abcdef012345; aborta sin construir ni borrar',flush=True)
