#!/bin/sh
# Volver al respaldo que se tomó antes de migrar.
#
#   sh operacion/volver.sh < llave-privada.txt   restaura ese respaldo y levanta la versión anterior, CERRADA
#   sh operacion/volver.sh --abrir               abre, cuando ya se vio que todo está bien
#
# Es la salida de una publicación que empezó a migrar y no llegó a decidir abrir: el negocio estuvo
# cerrado desde antes de tomar ese respaldo, así que no se pierde nada; después, la versión
# corregida se publica como cualquier otra. No es una rama de la publicación: es un camino propio,
# y lo recorre el dueño, con su llave. Como restaurar crea otra historia —la base restaurada tiene
# otra marca y un bloque nuevo de folios—, el manifiesto de esa publicación se cierra como
# «restaurada» y no se continúa nunca.
#
# Los pasos, cada uno anotado antes y después en su propio registro (publicaciones/<publicación>/vuelta.json):
#   1. Detener lo que corra, y comprobar que no queda nadie en la base.
#   2. Apartar la base que falló con otro nombre, sin borrarla.
#   3. Restaurar el respaldo de esa publicación —ese, por su nombre— con el programa de la versión
#      ANTERIOR, no con el de la que falló: lo audita, registra la restauración, y solo entonces le
#      da a la base su nombre.
#   4. Levantar la versión anterior y comprobar, por HTTPS, que quien contesta es la base
#      restaurada —su marca nueva—, lista y cerrada.
# Abrir es un paso aparte, y expreso: --abrir.
#
# Si muere a la mitad, se vuelve a correr y sigue desde donde quedó: lo dice el servidor de la base
# —qué bases hay, con qué nombre y con qué marca—. La base apartada se borra a mano, después,
# cuando ya no haga falta.
set -eu
umask 077
cd "$(dirname "$0")/.."

modo=volver
case "${1:-}" in
  "") ;;
  --abrir) modo=abrir ;;
  *)
    echo "Uso: sh operacion/volver.sh < llave-privada.txt   |   sh operacion/volver.sh --abrir" >&2
    exit 1
    ;;
esac

. operacion/candado.sh
. operacion/pasos.sh

# El nombre de la base de la instalación, como lo dice el Compose.
BASE=feruga

privado=""
limpiar() {
  [ -z "$privado" ] || rm -rf "$privado"
  soltar_candado
}
trap limpiar EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tomar_candado "volver al respaldo" || exit 1
preparar_trabajo || falla "No se pudo preparar la carpeta de trabajo ($TRABAJO). No se tocó nada."
privado=$TRABAJO
preparar_herramientas

paso() { printf '\n== %s\n' "$1"; }

# En qué va lo dice el servidor de la base: qué bases hay, con qué nombre y con qué marca. Deja
# dicho si está la de la instalación (y su marca) y si está la apartada.
hay_suya=no
la_suya=""
hay_apartada=no
mirar_las_bases() {
  hay=$(en_el_servidor "$conf" bases) || falla "El servidor de la base no contesta: no se sabe en qué quedó. $1"
  hay_suya=no
  la_suya=""
  hay_apartada=no
  while read -r nombre su_marca; do
    if [ "$nombre" = "$BASE" ]; then
      hay_suya=si
      la_suya=$su_marca
    fi
    [ "$nombre" != "$apartada" ] || hay_apartada=si
  done <<FIN
$hay
FIN
}

volver() {
  # La llave privada entra por la entrada estándar, desde un archivo. No se teclea ni se pasa como argumento.
  [ ! -t 0 ] || falla "La llave privada entra por la entrada estándar, desde un archivo: sh operacion/volver.sh < llave-privada.txt"
  # Se queda en la memoria de este guion, y de ahí pasa a quien restaura: no se copia a ningún archivo.
  llave=$(cat) || falla "No se pudo leer la llave privada. No se tocó nada."
  [ -n "$llave" ] || falla "No llegó la llave privada: sh operacion/volver.sh < llave-privada.txt. No se tocó nada."

  no_se_leyo="No se pudo leer el manifiesto de la publicación sin cerrar. No se tocó nada."
  pub=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones: no se sigue."
  [ -n "$pub" ] || falla "No hay ninguna publicación sin cerrar: no hay de dónde volver. No se tocó nada."
  de_commit=$(manifiesto dato "$pub" commit) || falla "$no_se_leyo"
  [ "$de_commit" = "$(commit_actual)" ] \
    || falla "La publicación sin cerrar ($pub) es del commit $de_commit, y esta carpeta está en otro. Ponla en ese commit (git checkout $de_commit) y vuelve a correr esto."
  conf="$PUBLICACIONES/$pub/conjunto.json"
  anterior=$(manifiesto dato "$pub" anterior.configuracion) || falla "$no_se_leyo"
  [ -n "$anterior" ] || falla "La publicación $pub es la primera de la instalación: no hay versión anterior ni respaldo previo al cual volver. No se tocó nada."
  conf_ant="$PUBLICACIONES/$anterior"
  version=$(manifiesto dato "$pub" anterior.publicacion) || falla "$no_se_leyo"
  respaldo=$(manifiesto dato "$pub" respaldo.nombre) || falla "$no_se_leyo"
  [ -n "$respaldo" ] || falla "La publicación $pub no tiene anotado su respaldo previo. No se tocó nada."
  marca_de_antes=$(manifiesto dato "$pub" base.marca) || falla "$no_se_leyo"
  numero=$(manifiesto dato "$pub" numero) || falla "$no_se_leyo"
  [ -n "$version" ] && [ -n "$marca_de_antes" ] && [ -n "$numero" ] || falla "$no_se_leyo"
  apartada="${BASE}_fallida_$numero"
  echo "Se vuelve al respaldo previo de la publicación $pub: $respaldo"

  # Que el guion de esa publicación haya muerto —o un intento anterior de volver— no dice nada de lo
  # que dejó corriendo. Antes de mover una base, se espera a su migrador y a lo demás: un migrador
  # que siguiera vivo podría conectarse después a la base restaurada.
  esperar_al_migrador "$conf"
  esperar_lo_que_quedo "$conf"

  mirar_las_bases "No se tocó nada."

  if [ "$hay_suya" = si ] && [ "$hay_apartada" = no ] && [ "$la_suya" = "$marca_de_antes" ]; then
    # Desde el principio. Solo se vuelve de una publicación que empezó a migrar y no decidió abrir.
    estado=$(estado_de_la_base "$conf")
    codigo=0
    decision=$(manifiesto decidir "$pub" "$estado") || codigo=$?
    [ "$codigo" -eq 0 ] || falla "No se puede saber en qué quedó la publicación $pub. No se tocó nada."
    [ "$decision" = 2 ] || falla "La publicación $pub no está a medio migrar: lo que toca es sh operacion/publicar.sh --recuperar. De aquí no se vuelve al respaldo. No se tocó nada."

    paso "1. Detener lo que corra, y comprobar que no queda nadie en la base"
    manifiesto vuelta "$pub" detener antes || falla "No se pudo anotar el paso. No se tocó nada."
    detener "$conf" web respaldo || falla "No se pudo detener lo que corre."
    en_la_base "$conf" drenar "${PLAZO_DE_DRENADO:-60}" || falla "Quedaron sesiones de la aplicación en la base."
    manifiesto vuelta "$pub" detener despues || falla "No se pudo anotar el paso."
    punto vuelta:detenida

    paso "2. Apartar la base que falló: queda como «${apartada}», sin borrarla"
    manifiesto vuelta "$pub" apartar antes "$apartada" || falla "No se pudo anotar el paso."
    en_el_servidor "$conf" apartar "$apartada" || falla "No se pudo apartar la base que falló. Sigue con su nombre."
    manifiesto vuelta "$pub" apartar despues || falla "La base quedó apartada, y no se pudo anotar. Vuelve a correr esto: sigue desde ahí."
    punto vuelta:apartada
    hay_suya=no
    hay_apartada=si
  fi

  if [ "$hay_suya" = no ] && [ "$hay_apartada" = si ]; then
    paso "3. Restaurar el respaldo previo, con el programa de la versión anterior"
    manifiesto vuelta "$pub" restaurar antes || falla "No se pudo anotar el paso."
    # La llave entra por la entrada estándar del programa que restaura, y por ningún otro lado.
    printf '%s\n' "$llave" | docker compose -f "$conf_ant" run --rm --no-deps -T --entrypoint node comprobacion operacion/restaurar.ts \
      "--remoto=$respaldo" "--nota=Vuelta al respaldo previo de la publicación $pub" \
      || falla "No se pudo restaurar el respaldo. La base que falló sigue apartada como «${apartada}», y el negocio sigue cerrado. Corregido lo que haya sido, vuelve a correr esto."
    punto vuelta:restaurada
    mirar_las_bases "La base ya está restaurada; vuelve a correr esto."
  fi

  if [ "$hay_suya" = si ] && [ "$hay_apartada" = si ] && [ -n "$la_suya" ] && [ "$la_suya" != "$marca_de_antes" ]; then
    marca=$la_suya
    manifiesto vuelta "$pub" restaurar despues "$marca" || falla "La base quedó restaurada, y no se pudo anotar. Vuelve a correr esto: sigue desde ahí."

    paso "4. Levantar la versión anterior, y comprobar que contesta sobre la base restaurada, cerrada"
    manifiesto vuelta "$pub" levantar antes || falla "No se pudo anotar el paso."
    arrancar "$conf_ant" web || falla "La aplicación de la versión anterior no levantó. La base ya está restaurada; vuelve a correr esto."
    arrancar "$conf_ant" proxy || falla "El proxy no levantó. La base ya está restaurada; vuelve a correr esto."
    esperar_el_sitio "$conf_ant" --cerrada "--version=$version" "--base=$marca" --rechaza-escribir \
      || falla "Lo que se levantó no pasa la comprobación por HTTPS sobre la base restaurada. El negocio sigue cerrado."
    corre "$pub" anterior "$conf_ant" db web proxy || falla "Lo que corre no es el conjunto de la versión anterior. El negocio sigue cerrado."
    manifiesto vuelta "$pub" levantar despues || falla "No se pudo anotar el paso."
    punto vuelta:levantada
    manifiesto cerrar "$pub" restaurada "$marca" || falla "No se pudo cerrar el manifiesto de la publicación."
    cat <<FIN

Se volvió al respaldo previo. Corre la versión anterior ($version) sobre la base restaurada.
  · La publicación $pub quedó cerrada como «restaurada».
  · La base que falló sigue en el servidor como «${apartada}». Se borra a mano cuando ya no haga falta.
  · Quien estaba adentro tiene que volver a entrar: las sesiones de antes ya no valen.
EL NEGOCIO SIGUE CERRADO. Cuando hayas visto que todo está bien: sh operacion/volver.sh --abrir
FIN
    return 0
  fi

  falla "No se entiende en qué quedó la vuelta al respaldo: la base «${BASE}» $([ "$hay_suya" = si ] && echo "existe (marca ${la_suya:-ninguna})" || echo "no existe"), y la apartada «${apartada}» $([ "$hay_apartada" = si ] && echo existe || echo "no existe"). No se tocó nada: hace falta que una persona lo vea."
}

abrir() {
  pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones: no se sigue."
  [ -z "$pendiente" ] || falla "Hay una publicación sin cerrar ($pendiente): todavía no se terminó de volver al respaldo. No se abrió."
  vigente=$(manifiesto vigente) || falla "No se pudo leer la carpeta de publicaciones: no se sigue."
  [ -n "$vigente" ] || falla "No hay nada publicado en esta instalación. No se abrió."
  conf=$(manifiesto vigente configuracion) || falla "No se pudo leer la configuración de lo publicado. No se abrió."
  conf="$PUBLICACIONES/$conf"
  marca=$(manifiesto vigente marca) || falla "No se pudo leer la marca de la base de lo publicado. No se abrió."
  [ -n "$marca" ] || falla "No se pudo leer la marca de la base de lo publicado. No se abrió."
  esta_abierta=$(en_la_base "$conf" estado abierta) || falla "No se pudo preguntar a la base si la operación está abierta. No se tocó nada."
  if [ "$esta_abierta" != true ]; then
    # Esto abre solo lo que dejó cerrado una vuelta al respaldo: la publicación que cerró la base
    # quedó «restaurada», y la base que contesta es la restaurada.
    por=$(en_la_base "$conf" estado publicacion) || falla "No se pudo preguntar a la base qué publicación la cerró. No se abrió."
    como=$(manifiesto dato "$por" cierre.como 2>/dev/null || true)
    de_cual=$(manifiesto dato "$por" cierre.marca 2>/dev/null || true)
    la_que_contesta=$(en_la_base "$conf" estado marca) || falla "No se pudo preguntar a la base cuál es. No se abrió."
    [ "$como" = restaurada ] && [ "$de_cual" = "$marca" ] && [ "$la_que_contesta" = "$marca" ] \
      || falla "La operación está cerrada, pero no la dejó así una vuelta al respaldo (la cerró «${por}»). Esto no la abre: hace falta saber por qué está cerrada."
    # El servicio de respaldo puede estar ya en pie —si se levantó lo publicado, que lo levanta cerrado— o
    # todavía no: aquí se mira lo que atiende. El conjunto completo se comprueba abajo, ya con el respaldo.
    corre_al_menos "$vigente" candidato "$conf" db web proxy || falla "Lo que corre no es la versión vigente ($vigente). Levántala primero: sh operacion/levantar.sh. No se abrió."
    esperar_el_sitio "$conf" --cerrada "--version=$vigente" "--base=$marca" --rechaza-escribir || falla "El sitio no pasa la comprobación por HTTPS. No se abrió."
    en_la_base "$conf" decidir "$por" || falla "No se pudo anotar la decisión de abrir."
    punto vuelta:decidida
    en_la_base "$conf" abrir "$por" "$marca" || falla "No se pudo abrir la operación."
    punto vuelta:abierta
  else
    # Ya había abierto —este paso se repite porque antes no terminó—. No basta con decirlo: falta
    # lo que venía después de abrir, y eso se termina aquí.
    echo "La operación ya estaba abierta: se termina lo que faltaba."
  fi
  arrancar "$conf" respaldo || falla "LA OPERACIÓN YA ABRIÓ, pero el servicio de respaldo no arrancó: no se está respaldando a su hora. Levántalo: sh operacion/levantar.sh"
  corre "$vigente" candidato "$conf" db web proxy respaldo || falla "La operación está abierta, pero lo que corre no es la versión vigente ($vigente) completa. Levántala: sh operacion/levantar.sh"
  por_https "$conf" --abierta "--version=$vigente" "--base=$marca" >/dev/null || falla "La operación abrió en la base, pero el sitio no lo dice."
  printf '\nAbierta. Atiende la versión %s, con su servicio de respaldo en pie.\n' "$vigente"
}

if [ "$modo" = abrir ]; then abrir; else volver; fi
