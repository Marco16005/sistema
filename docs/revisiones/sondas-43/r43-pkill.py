from pathlib import Path
import subprocess,time
root=Path('/tmp/feruga-codex-qa14/qa/r43-proceso-ajeno'); (root/'operacion').mkdir(parents=True,exist_ok=True)
(root/'operacion/publicar.sh').write_text('#!/bin/sh\nsleep 30\nexit 0\n')
p=subprocess.Popen(['sh','operacion/publicar.sh'],cwd=root,start_new_session=True)
try:
 time.sleep(.15)
 r=subprocess.run(['pgrep','-f','sh operacion/publicar.sh'],capture_output=True,text=True)
 print('pgrep exit',r.returncode,'stderr',r.stderr.strip())
 ids=r.stdout.split()
 print('El selector de ensayo-publicacion.sh incluye al proceso de otra carpeta:',str(p.pid) in ids)
 print('No se ejecutó pkill; solo pgrep y cierre del proceso propio por su PID/grupo.')
finally:
 import os,signal
 os.killpg(p.pid,signal.SIGTERM); p.wait()
