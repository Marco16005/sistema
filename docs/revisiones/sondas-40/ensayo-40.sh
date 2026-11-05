#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
export PATH="$PWD/qa/bin-40:$PATH"
export QA40_RAIZ="$PWD"
export BUILDX_CONFIG="$PWD/qa/buildx-40"
PROYECTO=feruga_qa40
BD_PUERTO=54440
WEB_PUERTO=3240
PROXY_HTTP=48540
PROXY_HTTPS=48543
. qa/comun-40.sh
preparar_la_instalacion
preparar_el_arnes
sh operacion/publicar.sh > "$trabajo/publicar.salida" 2>&1 || { cat "$trabajo/publicar.salida"; exit 1; }
printf '%s\n' "$trabajo" > "$QA40_RAIZ/qa/seguridad-40/trabajo.txt"
atiende
operacion ps
