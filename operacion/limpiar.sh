#!/bin/sh
# Limpia únicamente etiquetas propias de imágenes que la operación ya no necesita.
#   sh operacion/limpiar.sh
set -eu
umask 077
cd "$(dirname "$0")/.."
[ "$#" -eq 0 ] || { echo "Uso: sh operacion/limpiar.sh" >&2; exit 1; }
. operacion/candado.sh
. operacion/pasos.sh
. operacion/limpieza.sh
trap soltar_candado EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tomar_candado "limpiar imágenes" || exit 1
limpiar_publicaciones
