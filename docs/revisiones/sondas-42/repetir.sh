#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
python3 qa/seguridad-42/integridad.py
trap 'python3 qa/seguridad-42/limpiar.py' EXIT
CONSERVAR=1 sh qa/ensayo-40.sh > qa/seguridad-42/instalacion.txt 2>&1
python3 qa/seguridad-42/preparar.py
docker cp codex-seguridad-autoridad-40:/ca/raiz.crt qa/seguridad-42/raiz.crt
sh qa/seguridad-42/sonda.sh preparar
sh qa/seguridad-42/sonda.sh cabeceras
sh qa/seguridad-42/sonda.sh limites
sh qa/seguridad-42/sonda.sh adicionales
sh qa/seguridad-42/sonda.sh tls-crudo
python3 qa/seguridad-42/precios.py
sh qa/seguridad-42/sonda.sh navegador
python3 qa/seguridad-42/resumir.py
python3 qa/seguridad-42/validar.py
