#!/bin/sh
# «docker compose», sobre lo publicado: para consultar, y para lo administrativo de todos los días.
#
#   sh operacion/compose.sh ps
#   sh operacion/compose.sh logs --tail 50 web
#   sh operacion/compose.sh run --rm consola persona alta "Luis" mostrador
#   sh operacion/compose.sh run --rm --no-deps respaldo lista
#
# En operación `docker compose` a secas no arranca: le faltan las imágenes, que las pone cada
# publicación. Este guion le pasa la configuración resuelta del conjunto vigente, con cada imagen
# por su identificador: lo que se consulta o se corre es lo que está publicado, no lo que diga hoy
# la carpeta.
#
# Hace tres cosas, y nada más:
#   · Consultar (ps, logs, top, images, config, port, events): no cambia nada, y pasa siempre.
#   · Correr algo suelto (run, exec): la consola, un respaldo a mano. Eso sí toca la instalación:
#     pide el mismo candado que publicar y levantar, y no entra si hay una publicación sin cerrar.
#   · Lo que cambia qué corre —up, down, stop, start, restart, rm…— no pasa por aquí: se hace con
#     levantar.sh, publicar.sh o volver.sh, que toman el candado y comprueban antes de tocar.
set -eu
cd "$(dirname "$0")/.."
. operacion/candado.sh
. operacion/pasos.sh

case "${1:-}" in
  ps | logs | top | images | config | port | events) clase=consulta ;;
  run | exec) clase=suelto ;;
  "")
    echo "Uso: sh operacion/compose.sh ps | logs … | run --rm consola … | run --rm --no-deps respaldo lista | …" >&2
    exit 1
    ;;
  *)
    falla "«docker compose $1» cambia lo que corre, y eso no se hace por aquí: levantar lo publicado es sh operacion/levantar.sh; cambiar de versión, sh operacion/publicar.sh. Esos toman el candado de la instalación y comprueban antes de tocar."
    ;;
esac

# Lo que se corre suelto se corre a la vista: hasta que termina, y con el candado tomado todo ese
# tiempo. Desacoplado (-d) el cliente vuelve enseguida, el candado se suelta, y lo lanzado sigue
# corriendo sin él. Por eso las opciones de Compose —las que van antes del servicio— se miran una
# por una, y solo pasan las que este guion conoce: una que no conoce podría ser otra forma de lo
# mismo. Lo que va después del servicio es de lo que se corre, y no se toca.
opciones_de_lo_suelto() {
  orden=$1
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --rm | --no-deps | --quiet-pull | -T | --no-TTY | -i | --interactive | -t | --tty | -iT | -Ti | -it | -ti) shift ;;
      -e | --env | --entrypoint | -u | --user | -w | --workdir | --index)
        [ "$#" -ge 2 ] || falla "A «$1» le falta su valor. No se corrió nada."
        shift 2
        ;;
      --env=* | --entrypoint=* | --user=* | --workdir=* | --index=*) shift ;;
      -d | -d* | --detach | --detach=* | -[!-]*d*)
        falla "Por aquí no se corre nada desacoplado («$1»): seguiría corriendo después de soltar el candado de la instalación, junto a la operación que entrara. Córrelo sin esa opción, y espera a que termine."
        ;;
      -*) falla "«sh operacion/compose.sh ${orden}» no conoce la opción «$1». Las que pasan: --rm, --no-deps, -T, -i, -e, --entrypoint, -u, -w (y --index, con exec). No se corrió nada." ;;
      *) return 0 ;;
    esac
  done
  falla "Falta decir sobre qué servicio: sh operacion/compose.sh ${orden} [opciones] <servicio> …"
}

if [ "$clase" = suelto ]; then
  opciones_de_lo_suelto "$@"
  trap soltar_candado EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  tomar_candado "compose.sh $1" || exit 1
fi
preparar_herramientas
if [ "$clase" = suelto ]; then
  pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones. No se corrió nada."
  [ -z "$pendiente" ] || falla "Hay una publicación sin cerrar ($pendiente): mientras no se recupere no se corre nada sobre la instalación. Primero: sh operacion/publicar.sh --recuperar"
fi
configuracion=$(manifiesto vigente configuracion) || falla "No se pudo leer la carpeta de publicaciones."
[ -n "$configuracion" ] || falla "Todavía no se ha publicado nada en esta instalación. La primera vez es: sh operacion/publicar.sh"
if [ "$clase" = consulta ]; then
  exec docker compose -f "$PUBLICACIONES/$configuracion" "$@"
fi
# Como hijo, no en lugar de este guion: al terminar se suelta el candado, y queda dicho que se soltó.
codigo=0
docker compose -f "$PUBLICACIONES/$configuracion" "$@" || codigo=$?
exit "$codigo"
