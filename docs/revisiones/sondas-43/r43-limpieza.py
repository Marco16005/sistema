from pathlib import Path
import os,subprocess
root=Path('/tmp/feruga-codex-qa14'); base=root/'qa/r43-limpieza'; bin=base/'bin'; bin.mkdir(parents=True,exist_ok=True)
(bin/'docker').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$R43_LOG"\nexit 0\n');(bin/'docker').chmod(0o755)
s=(root/'operacion/ensayo/comun.sh').read_text(); f=s[s.index('limpiar() {'):s.index('\ntrap limpiar EXIT')]
for project in ['feruga_ensayo','feruga_publicacion']:
 log=base/(project+'.txt');log.write_text('');work=base/(project+'-trabajo');work.mkdir(exist_ok=True)
 prefix=f'''set -eu
PROYECTO={project}
DETRAS=1
RED_DE_ENTRADA_DEL_ENSAYO="$PROYECTO-entrada"
OTRO_PROXY="$PROYECTO-otro-proxy"
OTRO_PROXY_DATOS="$PROYECTO-otro-proxy-datos"
trabajo='{work}'
copia="$trabajo/instalacion"
otra=""
CONSERVAR=""
'''
 p=subprocess.run(['sh','-c',prefix+f+'\nlimpiar\n'],env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH'],'R43_LOG':str(log)},capture_output=True,text=True,cwd=root)
 print(project,'exit',p.returncode); print(log.read_text(),end='')
