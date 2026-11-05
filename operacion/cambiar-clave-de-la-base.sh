#!/bin/sh
# Cambia la clave de administración de la base (BD_CLAVE, la del dueño «feruga») en una instalación
# que ya existe: cuando alguien pudo verla —un .env que se filtró, alguien de soporte que se va—.
#
#   sh operacion/cambiar-clave-de-la-base.sh               una clave nueva, en la base y en el .env
#   sh operacion/cambiar-clave-de-la-base.sh --la-del-env  pone en la base la que ya dice el .env
#                                                          (si alguien cambió primero el .env)
#
# Cambiar solo el .env no cambia la clave de una base que ya existe: la base la guardó al crearse.
# Aquí va en este orden, para que la base y el .env nunca queden con claves distintas sin que se sepa:
#   1. Se comprueba que la clave que dice el .env es la que tiene la base.
#   2. Se inventa la nueva —como entorno.sh— y ANTES de tocar la base se escribe el .env nuevo junto
#      al de siempre, como «.env.nueva» (solo para su dueño). Esa es la marca de que hay un cambio a
#      medias: si el guion se interrumpe —aunque sea de golpe—, ahí quedó la clave, levantar, publicar
#      y volver no entran, y correr este guion otra vez lo termina (o lo descarta, si no llegó a la base).
#   3. Se pone en la base como verificador SCRAM, calculado fuera de ella (operacion/scram.ts): la
#      clave no viaja en el SQL, y ningún registro de la base la puede anotar.
#   4. Se comprueba que con la nueva se entra, por la red, como entran los servicios; y con la de antes ya no.
#   5. «.env.nueva» pasa a ser el .env, de un golpe.
#   6. Se levanta lo publicado con el .env nuevo (levantar.sh): se recrea lo que usa la clave —la base
#      incluida, que se reinicia unos segundos: por eso se hace fuera de horario—, y la migración, que
#      entra como el dueño, comprueba que la nueva sirve. Lo levantado queda como la configuración de
#      lo publicado: la publicación siguiente la compara con eso, y no se niega.
# Al final hay que actualizar la copia del .env en el paquete de recuperación.
# (Los pasos 2 y 3 son así por la revisión de Codex del 3 de noviembre, H6 y H7.)
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

# El archivo de entorno es el que lee Compose: .env, o el que diga COMPOSE_ENV_FILES (si es uno solo).
entorno=${COMPOSE_ENV_FILES:-.env}
a_medias="$entorno.nueva"
privado=""
de_este=0
limpiar() {
  resultado=$?
  [ -z "$privado" ] || rm -rf "$privado"
  if [ "$resultado" != 0 ] && [ "$de_este" = 1 ] && [ -e "$a_medias" ]; then
    echo "El cambio de clave quedó a medias (${a_medias}). Vuelve a correr sh operacion/cambiar-clave-de-la-base.sh: lo termina. Mientras, levantar, publicar y volver no entran." >&2
  fi
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

case "$entorno" in *,*) falla "Compose lee más de un archivo de entorno (COMPOSE_ENV_FILES): este guion cambia uno solo. No se tocó nada." ;; esac
[ -f "$entorno" ] || falla "Falta el archivo de entorno ($entorno). No se tocó nada."
[ "$(grep -c '^BD_CLAVE=' "$entorno")" = 1 ] || falla "El archivo de entorno no tiene un solo renglón BD_CLAVE. No se tocó nada."
del_env=$(sed -n 's/^BD_CLAVE=//p' "$entorno")

# entra_con <clave>: con esa clave entra el dueño de la base por la red del fondo, como
# entran los servicios (dentro del contenedor de la base se entra sin clave, y eso no prueba nada).
# La clave va en el entorno del cliente de Docker, no en sus argumentos.
entra_con() {
  [ -n "$1" ] || return 1
  [ "$(PGPASSWORD="$1" docker run --rm -i --log-driver none --network "${proyecto}_fondo" -e PGPASSWORD \
    --entrypoint psql "$HERRAMIENTAS" -X -q -t -A -h db -U feruga -d postgres -c 'SELECT 1' </dev/null 2>/dev/null)" = 1 ]
}
# poner_en_la_base <clave>: el dueño de la base queda con esa clave. Va como verificador SCRAM,
# calculado en las herramientas (la clave les llega por la entrada estándar), y entra a la base por la
# entrada estándar de psql, en una sesión que no anota sus sentencias de ninguna manera.
poner_en_la_base() {
  verificador=$(printf '%s' "$1" | docker run --rm -i --log-driver none --network none --entrypoint node "$HERRAMIENTAS" operacion/scram.ts) || return 1
  case "$verificador" in 'SCRAM-SHA-256$'*) ;; *) return 1 ;; esac
  printf "SET log_statement = 'none';\nSET log_min_duration_statement = -1;\nSET log_min_duration_sample = -1;\nSET log_min_error_statement = panic;\nALTER ROLE feruga PASSWORD '%s';\n" "$verificador" \
    | docker exec -i "$base" psql -X -q -v ON_ERROR_STOP=1 -U feruga -d postgres >/dev/null 2>&1
}
# El archivo de entorno con otra BD_CLAVE, y nada más distinto, en <destino>.
con_otra_clave() {
  NUEVA="$1" awk 'BEGIN { c = ENVIRON["NUEVA"] } /^BD_CLAVE=/ { print "BD_CLAVE=" c; next } { print }' "$entorno" >"$2" \
    && [ "$(grep -c -v '^BD_CLAVE=' "$entorno")" = "$(grep -c -v '^BD_CLAVE=' "$2")" ]
}

terminado=0
if [ -e "$a_medias" ]; then
  # Un cambio que quedó a medias: lo que diga la base decide si se termina o se descarta.
  [ "$(grep -c '^BD_CLAVE=' "$a_medias")" = 1 ] || falla "El cambio a medias (${a_medias}) no tiene un solo renglón BD_CLAVE: revísalo con soporte. No se tocó nada."
  la_de_entonces=$(sed -n 's/^BD_CLAVE=//p' "$a_medias")
  if [ "$la_del_env" = 1 ]; then
    rm -f "$a_medias" || falla "No se pudo quitar el cambio a medias (${a_medias})."
    echo "Se descartó el cambio de clave que había quedado a medias: la base va a tener la del .env."
  elif entra_con "$la_de_entonces"; then
    mv "$a_medias" "$entorno" || falla "La base ya tiene la clave del cambio que quedó a medias, pero no se pudo poner en el archivo de entorno. Vuelve a correr este guion."
    echo "Se terminó un cambio de clave que había quedado a medias: la base y el archivo de entorno ya tienen la nueva."
    terminado=1
  elif entra_con "$del_env"; then
    rm -f "$a_medias" || falla "No se pudo quitar el cambio a medias (${a_medias})."
    echo "Un cambio de clave que había quedado a medias no llegó a la base: se descartó. Va uno nuevo."
  else
    falla "Ni la clave del archivo de entorno ni la del cambio a medias (${a_medias}) entran a la base. Para poner en la base la del archivo de entorno: sh operacion/cambiar-clave-de-la-base.sh --la-del-env"
  fi
fi

if [ "$terminado" = 1 ]; then
  :
elif [ "$la_del_env" = 1 ]; then
  case "$del_env" in *[!A-Za-z0-9]*|'') falla "La BD_CLAVE del .env debe llevar solo letras y números. No se tocó nada." ;; esac
  [ "${#del_env}" -ge 20 ] || falla "La BD_CLAVE del .env debe tener 20 caracteres o más. No se tocó nada."
  if entra_con "$del_env"; then
    echo "La base ya tiene la clave que dice el .env."
  else
    poner_en_la_base "$del_env" || true
    entra_con "$del_env" || falla "No se pudo poner en la base la clave del .env. Revisa con soporte."
    echo "La base quedó con la clave que dice el .env."
  fi
else
  entra_con "$del_env" || falla "La clave del .env no es la que tiene la base (¿alguien cambió el .env primero?). Para poner en la base la del .env: sh operacion/cambiar-clave-de-la-base.sh --la-del-env. No se tocó nada."
  nueva=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
  [ "${#nueva}" -eq 32 ] || falla "No se pudo inventar la clave nueva. No se tocó nada."
  # La marca, con la clave, antes de tocar la base; y en el disco de verdad, no solo en la memoria.
  de_este=1
  if ! con_otra_clave "$nueva" "$a_medias" || ! sync; then
    rm -f "$a_medias"
    falla "No se pudo escribir el archivo de entorno nuevo. No se tocó nada."
  fi
  # Si la base no contestó bien, puede haberlo hecho igual: lo dice la base, no la respuesta.
  poner_en_la_base "$nueva" || true
  if entra_con "$nueva" && ! entra_con "$del_env"; then
    :
  elif entra_con "$del_env" && ! entra_con "$nueva"; then
    rm -f "$a_medias"
    de_este=0
    falla "No se pudo cambiar la clave en la base: sigue la de antes. No se tocó nada."
  else
    falla "No se pudo saber qué clave quedó en la base."
  fi
  mv "$a_medias" "$entorno" || falla "La base ya tiene la clave nueva, y no se pudo poner en el archivo de entorno."
  de_este=0
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
