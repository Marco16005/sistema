from pathlib import Path
import subprocess
p=Path.cwd(); q=p/'qa'; dep=subprocess.check_output(['docker','image','inspect','feruga-migracion_recorrido:latest','--format','{{.Id}}'],text=True).strip()
(q/'dependencias-40.txt').write_text(dep+'\n')
common=(p/'operacion/ensayo/comun.sh').read_text().replace('trabajo=$(mktemp -d)', 'trabajo=$(mktemp -d "'+str(q)+'/trabajo-40.XXXXXX")').replace("--exclude './.operacion.candado*'", "--exclude './qa/trabajo-40.*' --exclude './qa/seguridad-40' --exclude './.operacion.candado*'").replace('$OPERACION:docker-compose.ensayo.yml', '$OPERACION:docker-compose.ensayo.yml:qa/nombres-40.yml')
(q/'comun-40.sh').write_text(common)
services=['db','web','proxy','respaldo','migracion','consola','comprobacion','autoridad','vigia','almacen-ensayo','almacen_listo','recorrido_operacion']
(q/'nombres-40.yml').write_text('services:\n'+''.join('  '+s+':\n    container_name: codex-seguridad-'+s+'-40\n' for s in services))
(q/'ensayo-40.sh').write_text('''#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
export PATH="$PWD/qa/bin-40:$PATH"
export QA40_RAIZ="$PWD"
PROYECTO=feruga_qa40
BD_PUERTO=54440
WEB_PUERTO=3240
PROXY_HTTP=8540
PROXY_HTTPS=8543
. qa/comun-40.sh
preparar_la_instalacion
preparar_el_arnes
sh operacion/publicar.sh > "$trabajo/publicar.salida" 2>&1 || { cat "$trabajo/publicar.salida"; exit 1; }
printf '%s\\n' "$trabajo" > "$QA40_RAIZ/qa/seguridad-40/trabajo.txt"
atiende
operacion ps
''')
