#!/bin/sh
set -eu
QA40_RAIZ=/tmp/feruga-codex-qa14
export QA40_RAIZ
export PATH="$QA40_RAIZ/qa/bin-40:$PATH"
export BUILDX_CONFIG="$QA40_RAIZ/qa/buildx-40"
trabajo="$QA40_RAIZ/qa/trabajo-40.tDha4M"
export COMPOSE_PROJECT_NAME=feruga_qa40 COMPOSE_FILE=docker-compose.yml:docker-compose.operacion.yml:docker-compose.ensayo.yml:qa/nombres-40.yml
export COMPOSE_ENV_FILES="$trabajo/.env" ENSAYO=1 ENSAYO_DE_FUERA=autoridad,vigia,almacen-ensayo,almacen_listo,recorrido_operacion NODE_EXTRA_CA_CERTS=/ca/raiz.crt
cd "$trabajo/instalacion"
sh operacion/publicar.sh --recuperar > "$trabajo/publicar.salida" 2>&1 || { cat "$trabajo/publicar.salida"; exit 1; }
printf '%s\n' "$trabajo" > "$QA40_RAIZ/qa/seguridad-40/trabajo.txt"
sh operacion/compose.sh ps
