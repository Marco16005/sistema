#!/bin/sh
# Migrar a mano, en operación. No es el camino de siempre —migra quien publica o levanta—, pero
# cuando hace falta pide el mismo candado que ellos: dos operaciones a la vez no entran.
#
#   sh operacion/migrar.sh --revisar   dice si lo publicado puede migrar la base y qué aplicaría; no toca nada
#   sh operacion/migrar.sh             aplica las pendientes y le vuelve a abrir la puerta a la aplicación
#   sh operacion/migrar.sh --sellar    a una base de antes de las huellas, le anota las de lo ya aplicado
#
# Usa el migrador de lo publicado. La base tiene que estar levantada. Con migraciones pendientes,
# la aplicación tiene que estar detenida: el migrador se niega mientras siga conectada.
set -eu
umask 077
cd "$(dirname "$0")/.."

case "${1:-}" in
  "" | --revisar | --sellar) ;;
  *)
    echo "Uso: sh operacion/migrar.sh [--revisar | --sellar]" >&2
    exit 1
    ;;
esac

. operacion/candado.sh
. operacion/pasos.sh

# El conjunto vigente: con su migrador se migra.
lo_vigente() {
  configuracion=$(manifiesto vigente configuracion) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
  [ -n "$configuracion" ] || falla "Todavía no se ha publicado nada en esta instalación. La primera vez es: sh operacion/publicar.sh"
  conf="$PUBLICACIONES/$configuracion"
}

if [ "${1:-}" = --revisar ]; then
  # Solo mira: no cambia la instalación, y por eso no pide el candado.
  preparar_herramientas
  lo_vigente
  exec docker compose -f "$conf" run --rm --no-deps -T migracion node db/migrar.ts --revisar </dev/null
fi

# Lo que cambia algo toma primero el candado, y ya con él mira cuál es el conjunto vigente: si lo
# mirara antes, otra operación podría publicar entre una cosa y la otra, y se migraría con el
# migrador —y con la clave de la aplicación— de la versión de antes.
trap soltar_candado EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tomar_candado "migrar a mano" || exit 1
preparar_herramientas
pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
[ -z "$pendiente" ] || falla "Hay una publicación sin cerrar ($pendiente): no se migra a mano por encima de ella. Primero se recupera: sh operacion/publicar.sh --recuperar"
lo_vigente

if [ "${1:-}" = --sellar ]; then
  docker compose -f "$conf" run --rm --no-deps -T -e OPERACION_TURNO="$candado_turno" migracion node db/migrar.ts --sellar </dev/null
else
  migrar_con "$conf"
fi
