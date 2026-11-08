from pathlib import Path
p=Path('operacion/ensayo.sh').read_text()
a=p.index('if [ -n "$DETRAS" ]; then\n  paso "Detrás de otro proxy:'); b=p.index('\npaso "El recorrido en el navegador',a)
head='''#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
PROYECTO=codex43-aislamiento
DETRAS=1
RED_DE_ENTRADA_DEL_ENSAYO=codex43-aislamiento-entrada
DOMINIO=patio.test
trabajo=qa/r43-aislamiento
mkdir -p "$trabajo"
paso() { echo "$*"; }
falla() { echo "FALLO: $*"; exit 1; }
operacion() { docker inspect -f '{{.Id}}' "codex43-aislamiento-$3"; }
otro_proxy() { docker inspect -f '{{.Id}}' codex43-aislamiento-otro; }
ip_de_la_base=$(docker inspect -f '{{(index .NetworkSettings.Networks "codex43-aislamiento_fondo").IPAddress}}' codex43-aislamiento-db)
'''
Path('qa/r43-bloque-aislamiento.sh').write_text(head+p[a:b])
