#!/bin/sh
# Levanta lo publicado, o lo pone al día después de cambiar el entorno.
#
#   sh operacion/levantar.sh
#
# No construye ni publica nada: levanta el conjunto vigente —el que dejó la última publicación—,
# cada servicio con la imagen de su manifiesto, y con el .env como está ahora. Publicar una versión
# es sh operacion/publicar.sh.
#
# En operación no se usa «docker compose up». Compose reemplaza los contenedores cuya configuración
# cambió ANTES de arrancar nada: con un .env mal puesto quitaría la aplicación que estaba
# atendiendo y el sitio se quedaría caído. Este guion comprueba primero, sin tocar nada de lo que
# corre —el entorno completo, y que a la red solo salga el proxy—, y solo si pasa, levanta. Al
# final pide el sitio por HTTPS validando su certificado, y comprueba que contesta esta versión.
#
# Lo que se comprueba es exactamente lo que se levanta: la configuración se resuelve una sola vez,
# con el .env como está en ese momento, y se guarda. Si alguien lo cambia a media operación, no
# entra a medias.
set -eu
umask 077
cd "$(dirname "$0")/.."

# Una operación a la vez sobre esta instalación: levantar, publicar y migrar a mano piden el mismo candado.
. operacion/candado.sh
. operacion/pasos.sh
# La limpieza queda puesta desde antes: si lo que sigue falla o se le interrumpe, no deja el
# candado ni la configuración resuelta, que lleva las claves.
privado=""
limpiar() {
  [ -z "$privado" ] || rm -rf "$privado"
  soltar_candado
}
trap limpiar EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tomar_candado "levantar" || exit 1
preparar_trabajo || falla "No se pudo preparar la carpeta de trabajo ($TRABAJO). No se tocó nada."
privado=$TRABAJO
preparar_herramientas

pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones: eso no significa que no haya nada pendiente. No se tocó nada."
[ -z "$pendiente" ] || falla "Hay una publicación sin cerrar ($pendiente). Antes de levantar nada se recupera: sh operacion/publicar.sh --recuperar. No se tocó nada."
vigente=$(manifiesto vigente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
[ -n "$vigente" ] || falla "Todavía no se ha publicado nada en esta instalación. La primera vez es: sh operacion/publicar.sh"
# La configuración se resuelve con los archivos de esta carpeta: tiene que ser la del commit publicado.
de_commit=$(manifiesto vigente commit) || falla "No se pudo leer de qué commit es lo publicado. No se tocó nada."
[ "$de_commit" = "$(commit_actual)" ] \
  || falla "Lo publicado ($vigente) es del commit $de_commit, y esta carpeta está en otro. Para levantar lo publicado, ponla en ese commit (git checkout $de_commit); para cambiar de versión, publica: sh operacion/publicar.sh. No se tocó nada."
exigir_carpeta_limpia "lo que se levanta es lo publicado, tal cual"

variables=$(manifiesto variables vigente) || falla "No se pudo leer con qué imágenes corre lo publicado. No se tocó nada."
# shellcheck disable=SC2086  # una palabra por variable
resolver $variables >"$privado/conjunto.json" || falla "La configuración no se pudo resolver: revisa el .env. No se tocó nada."
fija="$privado/conjunto.json"

echo "Comprobando el entorno…"
docker compose -f "$fija" run --rm --no-deps -T comprobacion entorno </dev/null || falla "El entorno no pasa la comprobación. No se tocó nada."
echo "Comprobando qué se publica a la red…"
# ENSAYO=1 lo pone solo el ensayo en una máquina de desarrollo, donde ni el proxy sale a la red.
# shellcheck disable=SC2094  # el mismo archivo se lee dos veces —como configuración y como lo que se revisa—; no se escribe
docker compose -f "$fija" run --rm --no-deps -T comprobacion red ${ENSAYO:+--local} <"$fija" || falla "La configuración publica de más a la red. No se tocó nada."

# Lo comprobado se guarda como la configuración de lo publicado, y eso —no el .env— es lo que se levanta.
# shellcheck disable=SC2046  # una opción, o ninguna
manifiesto_con_entrada conjunto "$vigente" $(opcion_del_ensayo) <"$fija" || falla "No se pudo guardar la configuración comprobada. No se tocó nada."
conf=$(manifiesto vigente configuracion) || falla "No se pudo leer la configuración de lo publicado. No se tocó nada."
conf="$PUBLICACIONES/$conf"
marca=$(manifiesto vigente marca) || falla "No se pudo leer la marca de la base de lo publicado. No se tocó nada."
[ -n "$marca" ] || falla "No se pudo leer la marca de la base de lo publicado. No se tocó nada."

echo "Levantando…"
if ! levantar_conjunto "$vigente" "$conf" "$marca"; then
  echo "Lo publicado no quedó levantado y comprobado. Mira el registro de lo que no arrancó (sh operacion/compose.sh logs <servicio>)." >&2
  exit 1
fi
esta_abierta=$(en_la_base "$conf" estado abierta) || falla "Levantado: $vigente. No se pudo preguntar a la base si la operación está abierta."
if [ "$esta_abierta" = true ]; then
  echo "Levantado: $vigente. La operación está abierta."
else
  echo "Levantado: $vigente. LA OPERACIÓN ESTÁ CERRADA (en mantenimiento): levantar no la abre."
fi
