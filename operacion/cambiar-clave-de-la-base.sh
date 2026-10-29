#!/bin/sh
# Cambia la clave de administración de la base (BD_CLAVE, la del dueño «feruga») en una instalación
# que ya existe: cuando alguien pudo verla —un .env que se filtró, alguien de soporte que se va—.
#
#   sh operacion/cambiar-clave-de-la-base.sh               una clave nueva, en la base y en el .env
#   sh operacion/cambiar-clave-de-la-base.sh --la-del-env  pone en la base la que ya dice el .env
#                                                          (si alguien cambió primero el .env)
#
# Cambiar solo el .env no cambia la clave de una base que ya existe: la base la guardó al crearse.
# Aquí va en este orden, para que la base y el .env nunca queden con claves distintas sin decirlo:
#   1. Se comprueba que la clave que dice el .env es la que tiene la base (con --la-del-env, no).
#   2. Se inventa la nueva —como entorno.sh— y se pone en la base por la entrada estándar, dentro de
#      su contenedor: nunca como argumento de un programa, y sin que la base la anote en su registro.
#   3. Se comprueba que con la nueva se entra, por la red, como entran los servicios; y con la de
#      antes ya no.
#   4. Se escribe en el .env, sin tocar ningún otro renglón. Si eso falla, la base vuelve a la de antes.
#   5. Se levanta lo publicado con el .env nuevo (levantar.sh): se recrea lo que usa la clave —la base
#      incluida, que se reinicia unos segundos: por eso se hace fuera de horario—, y la migración, que
#      entra como el dueño, comprueba que la nueva sirve. Lo levantado queda como la configuración de
#      lo publicado: la publicación siguiente la compara con eso, y no se niega.
# Al final hay que actualizar la copia del .env en el paquete de recuperación.
set -eu
umask 077
cd "$(dirname "$0")/.."

uso() { echo "Uso: sh operacion/cambiar-clave-de-la-base.sh [--la-del-env]" >&2; exit 2; }
la_del_env=0
case "$#:${1:-}" in
  0:) ;;
  1:--la-del-env) la_del_env=1 ;;
  *) uso ;;
esac

. operacion/candado.sh
. operacion/pasos.sh
privado=""
limpiar() {
  [ -z "$privado" ] || rm -rf "$privado"
  soltar_candado
}
trap limpiar EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tomar_candado "cambiar la clave de la base" || exit 1
preparar_trabajo || falla "No se pudo preparar la carpeta de trabajo ($TRABAJO). No se tocó nada."
privado=$TRABAJO
preparar_herramientas

pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
[ -z "$pendiente" ] || falla "Hay una publicación sin cerrar ($pendiente): primero sh operacion/publicar.sh --recuperar. No se tocó nada."
vigente=$(manifiesto vigente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
[ -n "$vigente" ] || falla "Todavía no se ha publicado nada: la base, al crearse, tomará la clave que diga el .env. No se tocó nada."
conf=$(manifiesto vigente configuracion) || falla "No se pudo leer la configuración de lo publicado. No se tocó nada."
conf="$PUBLICACIONES/$conf"
proyecto=$(proyecto_de "$conf") || falla "No se pudo leer el proyecto de lo publicado. No se tocó nada."
base=$(docker compose -f "$conf" ps -q db) || falla "No se pudo preguntar por la base. No se tocó nada."
[ -n "$base" ] || falla "La base no está corriendo: primero sh operacion/levantar.sh. No se tocó nada."

# El archivo de entorno es el que lee Compose: .env, o el que diga COMPOSE_ENV_FILES (si es uno solo).
entorno=${COMPOSE_ENV_FILES:-.env}
case "$entorno" in *,*) falla "Compose lee más de un archivo de entorno (COMPOSE_ENV_FILES): este guion cambia uno solo. No se tocó nada." ;; esac
[ -f "$entorno" ] || falla "Falta el archivo de entorno ($entorno). No se tocó nada."
[ "$(grep -c '^BD_CLAVE=' "$entorno")" = 1 ] || falla "El archivo de entorno no tiene un solo renglón BD_CLAVE. No se tocó nada."
del_env=$(sed -n 's/^BD_CLAVE=//p' "$entorno")

# entra_con <clave>: con esa clave entra el dueño de la base por la red de la instalación, como
# entran los servicios (dentro del contenedor de la base se entra sin clave, y eso no prueba nada).
# La clave va en el entorno del cliente de Docker, no en sus argumentos.
entra_con() {
  [ "$(PGPASSWORD="$1" docker run --rm -i --log-driver none --network "${proyecto}_default" -e PGPASSWORD \
    --entrypoint psql "$HERRAMIENTAS" -X -q -t -A -h db -U feruga -d postgres -c 'SELECT 1' </dev/null 2>/dev/null)" = 1 ]
}
# poner_en_la_base <clave>: el dueño de la base queda con esa clave. Por la entrada estándar de psql,
# dentro del contenedor de la base; esta sesión no anota sus órdenes en el registro.
poner_en_la_base() {
  printf "SET log_statement = 'none';\nSET log_min_duration_statement = -1;\nALTER ROLE feruga PASSWORD '%s';\n" "$1" \
    | docker exec -i "$base" psql -X -q -v ON_ERROR_STOP=1 -U feruga -d postgres >/dev/null
}

if [ "$la_del_env" = 1 ]; then
  case "$del_env" in *[!A-Za-z0-9]*|'') falla "La BD_CLAVE del .env debe llevar solo letras y números. No se tocó nada." ;; esac
  [ "${#del_env}" -ge 20 ] || falla "La BD_CLAVE del .env debe tener 20 caracteres o más. No se tocó nada."
  if entra_con "$del_env"; then
    echo "La base ya tiene la clave que dice el .env."
  else
    poner_en_la_base "$del_env" || falla "No se pudo poner la clave en la base. No se tocó nada."
    entra_con "$del_env" || falla "Se puso la clave del .env en la base, pero con ella no se entra. Revisa con soporte."
    echo "La base quedó con la clave que dice el .env."
  fi
else
  entra_con "$del_env" || falla "La clave del .env no es la que tiene la base (¿alguien cambió el .env primero?). Para poner en la base la del .env: sh operacion/cambiar-clave-de-la-base.sh --la-del-env. No se tocó nada."
  nueva=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
  [ "${#nueva}" -eq 32 ] || falla "No se pudo inventar la clave nueva. No se tocó nada."
  poner_en_la_base "$nueva" || falla "No se pudo cambiar la clave en la base. No se tocó nada."
  if ! entra_con "$nueva" || entra_con "$del_env"; then
    poner_en_la_base "$del_env" || true
    falla "La clave nueva no quedó bien en la base; se dejó la de antes. No se tocó el .env."
  fi
  # El .env, con solo ese renglón cambiado. Se escribe aparte y se pone en su lugar de un golpe.
  if ! NUEVA="$nueva" awk 'BEGIN { c = ENVIRON["NUEVA"] } /^BD_CLAVE=/ { print "BD_CLAVE=" c; next } { print }' "$entorno" >"$privado/env" \
    || [ "$(grep -c -v '^BD_CLAVE=' "$entorno")" != "$(grep -c -v '^BD_CLAVE=' "$privado/env")" ] \
    || ! mv "$privado/env" "$entorno"; then
    if poner_en_la_base "$del_env" && entra_con "$del_env"; then
      falla "No se pudo escribir el .env; la base volvió a la clave de antes. No cambió nada."
    fi
    falla "No se pudo escribir el .env, y la base no volvió a la clave de antes: quedaron distintas. Para que la base tome la del .env: sh operacion/cambiar-clave-de-la-base.sh --la-del-env"
  fi
  echo "La clave nueva quedó en la base y en el .env. Con la de antes ya no se entra."
fi

# Lo que corre se levanta con el .env como está ahora; levantar.sh pide su propio candado. Lo de
# este guion se quita antes de soltarlo: después, esa carpeta ya es de quien lo tome.
rm -rf "$privado"
privado=""
soltar_candado
echo "Levantando lo publicado con la clave nueva (la base se reinicia unos segundos)…"
if ! sh operacion/levantar.sh; then
  echo >&2
  echo "La base y el .env tienen la misma clave, pero lo que corre no quedó al día: los respaldos van a fallar y va a llegar su aviso. Arregla lo que dice arriba y corre sh operacion/levantar.sh" >&2
  exit 1
fi
echo
echo "Listo. Actualiza la copia del .env en el paquete de recuperación: la de antes ya no sirve."
