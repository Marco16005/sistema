# Lo que comparten los guiones de la operación —publicar.sh, levantar.sh, volver.sh, migrar.sh,
# compose.sh—. No es un guion: lo incluye cada uno, ya parado en la carpeta de la instalación.
#
# Qué corre lo dice la carpeta de publicaciones: cada publicación tiene ahí su manifiesto y la
# configuración resuelta de su conjunto, con cada imagen por su identificador. Los guiones no leen
# esos archivos por su cuenta: le preguntan a las herramientas, que son de dos clases.
#   · Las del manifiesto solo leen y escriben esa carpeta. Corren en la imagen de herramientas de
#     ESTE commit —el mismo del guion que las llama—, sin red y sin el entorno.
#   · Las que le hablan a la base o al sitio corren como el servicio «comprobacion» de un conjunto,
#     con su red y su entorno.
#
# Una regla para todo lo de aquí: no poder preguntar no es una respuesta. Si falla el programa que
# iba a decir si la carpeta está limpia, qué huella tiene una configuración o si un contenedor
# sigue vivo, la función falla; nunca contesta «limpia», «iguales» o «no hay nadie». Y como estas
# funciones se llaman muchas veces con «||» —y ahí el guion no se detiene solo ante un fallo—, cada
# paso se comprueba aquí mismo.

PUBLICACIONES=publicaciones
# La imagen de herramientas de este commit. La deja lista preparar_herramientas.
HERRAMIENTAS=""
# Donde se trabaja: lo que se resuelve lleva claves. Está dentro de la instalación —no en la
# carpeta temporal de la máquina, que comparten otras instalaciones—, y es de quien tiene el candado.
TRABAJO=.operacion.trabajo

falla() {
  printf '\n%s\n' "$1" >&2
  exit 1
}

# Solo en un ensayo: morir de golpe, sin limpiar, justo en ese punto —así se prueba que cada
# interrupción se puede retomar—, o detenerse ahí mientras exista un archivo, para mirar cómo está
# todo a media publicación. En operación no hace nada.
punto() {
  [ "${ENSAYO:-}" = 1 ] || return 0
  if [ "${MORIR_EN:-}" = "$1" ]; then
    echo "(ensayo: el guion muere en «$1»)" >&2
    kill -9 $$
  fi
  if [ "${PAUSAR_EN:-}" = "$1" ] && [ -n "${PAUSA:-}" ]; then
    echo "(ensayo: el guion se detiene en «$1»)" >&2
    : >"$PAUSA.llego"
    while [ -e "$PAUSA" ]; do sleep 0.5; done
  fi
}

# Solo en un ensayo: lo que en el servidor está fuera —el almacenamiento de los respaldos, el
# vigilante— ahí corre junto, en la misma instalación, y hay que decir cuál es para que no cuente
# como un servicio de más. En operación no dice nada, y no hay nada de más.
opcion_del_ensayo() {
  if [ "${ENSAYO:-}" = 1 ] && [ -n "${ENSAYO_DE_FUERA:-}" ]; then
    printf -- '--de-fuera=%s\n' "$ENSAYO_DE_FUERA"
  fi
}

# Deja lista la carpeta de trabajo, vacía. Se llama con el candado ya tomado: lo que hubiera es de
# una operación que se interrumpió sin limpiar, y no es de nadie.
preparar_trabajo() {
  rm -rf "$TRABAJO" || return 1
  mkdir "$TRABAJO" || return 1
  chmod 700 "$TRABAJO" || return 1
}

# Un cambio de la clave de la base que quedó a medias (operacion/cambiar-clave-de-la-base.sh) deja el
# archivo de entorno nuevo junto al de siempre, con «.nueva». Mientras esté, no se sabe con cuál de las
# dos claves entra la base: no se levanta, no se publica y no se vuelve hasta terminarlo.
exigir_sin_clave_a_medias() {
  [ ! -e "${COMPOSE_ENV_FILES:-.env}.nueva" ] \
    || falla "Un cambio de la clave de la base quedó a medias (${COMPOSE_ENV_FILES:-.env}.nueva). Termínalo primero: sh operacion/cambiar-clave-de-la-base.sh. No se tocó nada."
}

# El commit de esta carpeta, completo. Vacío: no es un repositorio con commits.
commit_actual() {
  git rev-parse --verify --quiet 'HEAD^{commit}' 2>/dev/null || true
}

# exigir_carpeta_limpia <por qué importa>: en esta carpeta no hay nada que no esté en su commit. Si
# no se pudo preguntar, también se detiene. (Si el repositorio abarca más que la instalación, lo de
# fuera de esta carpeta no cuenta.)
exigir_carpeta_limpia() {
  pasos_sueltos=$(git status --porcelain -- . 2>/dev/null) \
    || falla "No se pudo comprobar si en esta carpeta hay cambios sin commit (falló git status). No se tocó nada."
  [ -z "$pasos_sueltos" ] || falla "Hay cambios sin commit: $1. No se tocó nada."
}

# imagen_de_la_base <commit>: la imagen de la base de datos que pide ese commit, por su huella
# (docker/db.Dockerfile dice cuál). Se lee del commit, como todo lo que se publica: no de la
# carpeta, que alguien puede cambiar entre que se comprobó limpia y que se construye.
#   0: la dice · 1: no se pudo leer del commit · 2: el commit no la nombra por su huella
imagen_de_la_base() {
  pasos_dockerfile=$(git show "$1:docker/db.Dockerfile") || return 1
  pasos_imagen=$(printf '%s\n' "$pasos_dockerfile" | sed -n 's/^FROM \([^ ]*\).*$/\1/p' | head -1)
  case "$pasos_imagen" in *@sha256:*) ;; *) return 2 ;; esac
  printf '%s\n' "$pasos_imagen"
}

# construir_del_commit <commit> <etiqueta> <Dockerfile> [<etapa>]: construye esa imagen con lo que
# dice el commit, y con nada más. Lo que haya suelto en la carpeta —o lo que Git ignora, que
# «git status» no enseña— no entra: la imagen sale de una copia del commit, no de la carpeta.
construir_del_commit() {
  pasos_fuente=$(mktemp) || return 1
  if ! git archive --format=tar -o "$pasos_fuente" "$1"; then
    rm -f "$pasos_fuente"
    return 1
  fi
  pasos_codigo=0
  if [ -n "${4:-}" ]; then
    docker build -q -f "docker/$3" --target "$4" -t "$2" - <"$pasos_fuente" >/dev/null || pasos_codigo=$?
  else
    docker build -q -f "docker/$3" -t "$2" - <"$pasos_fuente" >/dev/null || pasos_codigo=$?
  fi
  rm -f "$pasos_fuente"
  return "$pasos_codigo"
}

# La carpeta de publicaciones, privada, y con su nombre asegurado en disco antes de usarla: sin
# eso, un apagón puede llevársela entera, con todo y lo que se aseguró dentro. Se asegura una vez
# por operación —al preparar las herramientas—, exista ya o no: que exista no dice que se haya
# alcanzado a asegurar la vez que se creó. (La herramienta del manifiesto no puede hacerlo: corre
# en un contenedor que solo ve esta carpeta, no la que la contiene.)
pasos_asegurada=""
asegurar_publicaciones() {
  [ -d "$PUBLICACIONES" ] || mkdir -p "$PUBLICACIONES" || return 1
  chmod 700 "$PUBLICACIONES" || return 1
  if [ -z "$pasos_asegurada" ]; then
    sync || return 1
    pasos_asegurada=1
  fi
}

# Deja lista la imagen de herramientas de este commit. Se construye una vez por commit, del commit.
preparar_herramientas() {
  pasos_commit=$(commit_actual)
  [ -n "$pasos_commit" ] || falla "Esta carpeta no es un repositorio de Git con commits: lo que corre en operación tiene que poder nombrarse por su commit."
  pasos_proyecto=$(nombre_del_proyecto) || falla "No se pudo identificar el proyecto de las herramientas."
  HERRAMIENTAS="$pasos_proyecto-herramientas:$(printf '%s' "$pasos_commit" | cut -c1-12)"
  if ! docker image inspect "$HERRAMIENTAS" >/dev/null 2>&1; then
    echo "Construyendo las herramientas de la operación…" >&2
    construir_del_commit "$pasos_commit" "$HERRAMIENTAS" respaldo.Dockerfile || falla "No se pudieron construir las herramientas de la operación."
  fi
  asegurar_publicaciones || falla "No se pudo preparar la carpeta de publicaciones."
}

# Los topes de los contenedores de ayuda que los guiones corren sueltos (el manifiesto, la limpieza,
# el cambio de clave): en un servidor compartido, ni lo de paso queda sin tope (Codex, R44-03). Sin
# memoria de intercambio aparte, como los servicios.
TOPES_DE_AYUDA="--memory 256m --memory-swap 256m --cpus 0.5 --pids-limit 64"

# manifiesto <orden…>: le pregunta o le anota algo a la carpeta de publicaciones.
manifiesto() {
  manifiesto_con_entrada "$@" </dev/null
}

# Lo mismo, para las órdenes que reciben algo por la entrada estándar.
manifiesto_con_entrada() {
  asegurar_publicaciones || return 1
  # shellcheck disable=SC2086  # los topes, una opción por palabra
  docker run --rm -i $TOPES_DE_AYUDA --network none --user "$(id -u):$(id -g)" -v "$PWD/$PUBLICACIONES:/publicaciones" \
    --entrypoint node "$HERRAMIENTAS" operacion/publicacion.ts /publicaciones "$@"
}

# proyecto_de <configuración>: el nombre del proyecto de Compose de ese conjunto, como quedó en su
# configuración guardada —no como lo diga hoy el .env—. Con él se nombran sus contenedores.
proyecto_de() {
  pasos_resuelta=$(docker compose -f "$1" config) || return 1
  pasos_nombre=$(printf '%s\n' "$pasos_resuelta" | sed -n 's/^name: //p' | head -1)
  [ -n "$pasos_nombre" ] || return 1
  printf '%s\n' "$pasos_nombre"
}

# El nombre del proyecto de Compose de esta instalación, como lo dice hoy esta carpeta: con él se
# nombran las imágenes de una publicación nueva.
nombre_del_proyecto() {
  pasos_resuelta=$(env IMAGEN_DB=x IMAGEN_ADMIN=x IMAGEN_WEB=x IMAGEN_RESPALDO=x IMAGEN_PROXY=x VERSION=x docker compose config 2>/dev/null) || return 1
  pasos_nombre=$(printf '%s\n' "$pasos_resuelta" | sed -n 's/^name: //p' | head -1)
  [ -n "$pasos_nombre" ] || return 1
  printf '%s\n' "$pasos_nombre"
}

# resolver <IMAGEN_…=…> <VERSION=…>: la configuración de esta carpeta, con el .env como está ahora
# y con esas imágenes, resuelta. Lleva las claves puestas: va siempre a un archivo privado.
resolver() {
  env "$@" OPERACION_TURNO= docker compose --profile consola config --format json
}

# en_la_base <configuración> <orden…>: le habla a la base, con las herramientas de ese conjunto.
en_la_base() {
  pasos_conf=$1
  shift
  docker compose -f "$pasos_conf" run --rm --no-deps -T --entrypoint node comprobacion operacion/operacion.ts "$@" </dev/null
}

# en_el_servidor <configuración> <orden…>: le habla al servidor de la base —no a la base—: qué bases
# hay, y apartar la de la instalación. Con las herramientas de ese conjunto.
en_el_servidor() {
  pasos_conf=$1
  shift
  docker compose -f "$pasos_conf" run --rm --no-deps -T --entrypoint node comprobacion operacion/volver.ts "$@" </dev/null
}

# estado_de_la_base <configuración>: lo que dice la base, en una línea; o «no-contesta». Aquí no
# poder preguntar SÍ es una respuesta, y tiene nombre: quien la recibe decide qué hacer con ella.
estado_de_la_base() {
  en_la_base "$1" estado 2>/dev/null || echo no-contesta
}

# por_https <configuración> <qué se espera…>: le pregunta al sitio, por HTTPS, por donde lo diga la
# instalación (SITIO_POR): su proxy; o, si va detrás de otro, la dirección pública, por la que entra la gente.
por_https() {
  pasos_conf=$1
  shift
  docker compose -f "$pasos_conf" run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS comprobacion https "$@" </dev/null
}

# exigir_redes_de_fuera <configuración>: las redes que esa configuración usa sin crearlas —la que el
# proxy comparte con otro, si va detrás de él— existen, y son internas: solo sirven para que los dos
# proxies se hablen. Se mira antes de tocar nada; si faltara, el proxy no levantaría a media
# publicación, con el negocio ya cerrado.
exigir_redes_de_fuera() {
  # shellcheck disable=SC2094  # el mismo archivo, como configuración y como lo que se revisa; no se escribe
  pasos_redes=$(docker compose -f "$1" run --rm --no-deps -T comprobacion redes-de-fuera <"$1") || return 1
  for pasos_red in $pasos_redes; do
    if ! pasos_interna=$(docker network inspect -f '{{.Internal}}' "$pasos_red" 2>/dev/null); then
      printf 'No existe la red %s, la que el proxy comparte con el otro. Se crea así: docker network create --internal %s\n' "$pasos_red" "$pasos_red" >&2
      return 1
    fi
    if [ "$pasos_interna" != true ]; then
      printf 'La red %s no es interna: tiene que servir solo para que los dos proxies se hablen (ver la guía, 2.1 bis).\n' "$pasos_red" >&2
      return 1
    fi
  done
}

# esperar_el_sitio <configuración> <qué se espera…>: lo mismo, dándole tiempo. La primera vez el
# proxy tarda en conseguir su certificado.
esperar_el_sitio() {
  pasos_k=0
  until por_https "$@" >/dev/null 2>&1; do
    pasos_k=$((pasos_k + 1))
    if [ "$pasos_k" -ge "${ESPERA_DEL_SITIO:-40}" ]; then
      por_https "$@" || true
      return 1
    fi
    sleep 3
  done
}

# huella_de <configuración> <servicio>: la huella de la configuración de ese servicio.
huella_de() {
  pasos_linea=$(docker compose -f "$1" config --hash "$2") || return 1
  pasos_valor=${pasos_linea#* }
  [ -n "$pasos_linea" ] && [ "$pasos_valor" != "$pasos_linea" ] && [ -n "$pasos_valor" ] || return 1
  printf '%s\n' "$pasos_valor"
}

# misma_huella <configuración> <otra> <servicio>: ese servicio tiene la misma configuración en las dos.
#   0: la misma · 1: otra · 2: no se pudo saber
misma_huella() {
  pasos_una=$(huella_de "$1" "$3") || return 2
  pasos_otra=$(huella_de "$2" "$3") || return 2
  [ "$pasos_una" = "$pasos_otra" ]
}

# Lo que comparten las dos comprobaciones de abajo: compara contra el conjunto del manifiesto los
# contenedores cuyos identificadores recibe.
corre_estos() {
  pasos_modo=$1
  pasos_pub=$2
  pasos_cual=$3
  pasos_conf=$4
  pasos_ids=$5
  shift 5
  pasos_huellas=""
  for pasos_servicio in "$@"; do
    pasos_huella=$(huella_de "$pasos_conf" "$pasos_servicio") || return 1
    pasos_huellas="$pasos_huellas $pasos_servicio=$pasos_huella"
  done
  if [ -n "$pasos_ids" ]; then
    # shellcheck disable=SC2086  # identificadores: una palabra cada uno
    pasos_hay=$(docker inspect $pasos_ids) || return 1
  else
    pasos_hay='[]'
  fi
  # shellcheck disable=SC2046,SC2086  # opciones y pares servicio=huella: una palabra cada uno
  printf '%s\n' "$pasos_hay" | manifiesto_con_entrada corre "$pasos_pub" "$pasos_cual" $pasos_modo $(opcion_del_ensayo) $pasos_huellas
}

# corre <publicación> candidato|anterior <configuración> <servicio…>: lo que corre en la instalación
# es ese conjunto, completo: de cada uno de esos servicios un contenedor, andando, con la imagen del
# manifiesto y con la configuración que se guardó; y ningún otro contenedor corriendo. Si no, dice
# qué no coincide. (Los de un «run» no cuentan: no atienden nada.)
corre() {
  pasos_todos=$(docker compose -f "$3" ps -a -q) || return 1
  pasos_a=$1
  pasos_b=$2
  pasos_c=$3
  shift 3
  corre_estos --nada-mas "$pasos_a" "$pasos_b" "$pasos_c" "$pasos_todos" "$@"
}

# corre_al_menos <publicación> candidato|anterior <configuración> <servicio…>: lo mismo, mirando
# solo esos servicios. Es para el único paso en que se sabe que otro servicio del conjunto no quedó
# bien y hay que decirlo aparte: no acredita el conjunto completo.
corre_al_menos() {
  pasos_a=$1
  pasos_b=$2
  pasos_c=$3
  shift 3
  pasos_suyos=$(docker compose -f "$pasos_c" ps -a -q "$@") || return 1
  corre_estos "" "$pasos_a" "$pasos_b" "$pasos_c" "$pasos_suyos" "$@"
}

# arrancar <configuración> <servicio…>: los levanta —esos y nada más— y espera a que estén sanos.
arrancar() {
  pasos_conf=$1
  shift
  docker compose -f "$pasos_conf" up -d --wait --no-deps "$@"
}

# mayor_de_la_base <imagen>: la versión mayor de PostgreSQL de esa imagen de la base, como la dice la
# imagen oficial (PG_MAJOR). Si no se puede leer, o no es un número, falla: eso no es «la misma».
# Dentro de una misma versión mayor, PostgreSQL lee y escribe el mismo formato en disco, hacia
# adelante y hacia atrás; entre mayores, no (docs/planes/2026-11-10-cambiar-el-servidor-de-la-base.md).
mayor_de_la_base() {
  pasos_entorno=$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null) || return 1
  pasos_mayor=$(printf '%s\n' "$pasos_entorno" | sed -n 's/^PG_MAJOR=//p' | head -1)
  case "$pasos_mayor" in '' | *[!0-9]*) return 1 ;; esac
  printf '%s\n' "$pasos_mayor"
}

# la_base_corre <configuración>: si el contenedor de la base de ese conjunto está corriendo.
#   0: corre · 1: no corre · 2: no se pudo preguntar —eso no es «no corre» (Codex, R45-06)—
la_base_corre() {
  pasos_ids=$(docker compose -f "$1" ps -q --status running db 2>/dev/null) || return 2
  [ -n "$pasos_ids" ] || return 1
}

# sistema_de_la_base <imagen>: sobre qué sistema está hecha esa imagen de la base (el ID de su
# /etc/os-release: alpine, debian…). Si no se puede leer, falla.
sistema_de_la_base() {
  # shellcheck disable=SC2086  # los topes, una opción por palabra
  pasos_os=$(docker run --rm $TOPES_DE_AYUDA --network none --entrypoint cat "$1" /etc/os-release 2>/dev/null) || return 1
  pasos_id=$(printf '%s\n' "$pasos_os" | sed -n 's/^ID=//p' | tr -d '"' | head -1)
  case "$pasos_id" in '' | *[!a-z0-9._-]*) return 1 ;; esac
  printf '%s\n' "$pasos_id"
}

# cambio_de_la_base <configuración> <la de lo publicado> <imagen de la base nueva> <la de lo publicado>:
# si esta versión cambia el servidor de la base, y si eso se puede publicar. Se llama así:
#   mayor=$(cambio_de_la_base …) || exit 1
# No dice nada si no cambia. Si cambia y se puede, dice la versión mayor: la misma de PostgreSQL y el
# mismo sistema de la imagen. Otra mayor cambia el formato de los datos; otro sistema trae otras
# bibliotecas, y con ellas otro orden de las letras, que puede dejar mal los índices (Codex, R45-03).
# Si no se puede, o no se sabe, se detiene, diciendo por qué.
cambio_de_la_base() {
  pasos_codigo=0
  misma_huella "$1" "$2" db || pasos_codigo=$?
  [ "$pasos_codigo" -ne 2 ] || falla "No se pudo comparar el servidor de la base de datos de esta versión con el que corre. No se tocó nada."
  [ "$pasos_codigo" -eq 1 ] || return 0
  pasos_mayor_nueva=$(mayor_de_la_base "$3") || pasos_mayor_nueva=""
  pasos_mayor_ant=$(mayor_de_la_base "$4") || pasos_mayor_ant=""
  if [ -z "$pasos_mayor_nueva" ] || [ -z "$pasos_mayor_ant" ]; then
    falla "Esta versión cambia el servidor de la base de datos, y no se pudo saber de qué versión mayor de PostgreSQL es su imagen (no dice PG_MAJOR). No se publica a ciegas. No se tocó nada."
  fi
  [ "$pasos_mayor_nueva" = "$pasos_mayor_ant" ] \
    || falla "Esta versión cambia el servidor de la base de datos de PostgreSQL ${pasos_mayor_ant} a ${pasos_mayor_nueva}: otra versión mayor cambia el formato de los datos, y eso no se hace publicando. Necesita su propio procedimiento (respaldo y restauración en un servidor nuevo), que está por escribirse. No se tocó nada."
  pasos_sistema_nuevo=$(sistema_de_la_base "$3") || pasos_sistema_nuevo=""
  pasos_sistema_ant=$(sistema_de_la_base "$4") || pasos_sistema_ant=""
  if [ -z "$pasos_sistema_nuevo" ] || [ -z "$pasos_sistema_ant" ]; then
    falla "Esta versión cambia el servidor de la base de datos, y no se pudo saber sobre qué sistema está hecha su imagen. No se publica a ciegas. No se tocó nada."
  fi
  [ "$pasos_sistema_nuevo" = "$pasos_sistema_ant" ] \
    || falla "Esta versión cambia el sistema sobre el que está hecho el servidor de la base (de ${pasos_sistema_ant} a ${pasos_sistema_nuevo}): trae otras bibliotecas, y con ellas otro orden de las letras, que puede dejar mal los índices. Eso no se hace publicando. No se tocó nada."
  printf '%s\n' "$pasos_mayor_nueva"
}

# asegurar_que_la_base_corra <configuración> <la que toca>: el primer tiempo de recuperar y de volver
# cuando la publicación cambia el servidor de la base (Codex, R45-01, R45-02 y R45-06). Que la base
# corra y conteste antes de que nadie le pregunte nada:
#   · no corre: se arranca, con la que toca (detenida, nada la usa);
#   · corre y contesta: no se toca (cambiarla, si hace falta, va después de esperar lo que quedó);
#   · corre y no contesta: se le da tiempo (puede estar arrancando); si sigue sin contestar y no queda
#     nada de una operación interrumpida que pudiera usarla, se le pone la que toca;
#   · no se pudo preguntar: se detiene. Eso no es «no corre», y arrancarla podría cortarle la base a
#     quien la esté usando.
asegurar_que_la_base_corra() {
  pasos_codigo=0
  la_base_corre "$1" || pasos_codigo=$?
  case "$pasos_codigo" in
    2) falla "No se pudo preguntar si la base está corriendo. No se tocó nada; vuelve a correr esto." ;;
    1)
      echo "La base no está corriendo: se arranca, con el servidor que le toca, antes de preguntarle nada."
      arrancar "$2" db || falla "No se pudo arrancar la base. Corregido lo que haya sido, vuelve a correr esto."
      return 0
      ;;
    *) ;;
  esac
  pasos_k=0
  while [ "$(estado_de_la_base "$1")" = no-contesta ]; do
    pasos_k=$((pasos_k + 1))
    if [ "$pasos_k" -ge "${ESPERA_DE_LA_BASE:-30}" ]; then
      for pasos_servicio in migracion comprobacion respaldo; do
        pasos_vivos=$(de_un_run_vivos "$1" "$pasos_servicio") || falla "No se pudo preguntar qué quedó corriendo de una operación interrumpida. No se sigue."
        [ -z "$pasos_vivos" ] \
          || falla "La base no contesta, y sigue corriendo algo de una operación interrumpida que podría usarla ($pasos_servicio): no se le cambia el servidor debajo. Mira qué es (docker ps) y vuelve a correr esto."
      done
      echo "La base corre pero no contesta, y nada la usa: se le pone el servidor que le toca."
      arrancar "$2" db || falla "No se pudo poner el servidor que le toca a la base. Corregido lo que haya sido, vuelve a correr esto."
      [ "$(estado_de_la_base "$1")" != no-contesta ] \
        || falla "Con el servidor que le toca, la base sigue sin contestar. No se sigue: hace falta que una persona vea qué pasa (sh operacion/compose.sh logs db)."
      return 0
    fi
    sleep 2
  done
}

# detener <configuración> <servicio…>
detener() {
  pasos_conf=$1
  shift
  docker compose -f "$pasos_conf" stop "$@"
}

# migrar_con <configuración>: aplica las migraciones pendientes de ese conjunto y deja listo el
# usuario de la aplicación. El migrador, en operación, solo corre para quien tiene el candado.
#
# Va en dos tiempos. Crearlo y arrancarlo, con el candado de la instalación en las manos de quien
# lo crea: mientras ese cliente de Docker viva —aunque el guion ya no—, nadie más entra; y cuando
# ya no vive, el migrador o quedó creado, y quien retoma lo encuentra, o ya no lo va a crear nadie.
# Seguirlo —lo que dice, y cómo termina—, ya sin el candado (9>&-): un migrador puede quedarse
# esperando en la base sin plazo, y quien retoma tiene que poder entrar para esperarlo, detenerlo y
# comprobar que ya no está (esperar_al_migrador). No poder preguntar cómo terminó no es «bien».
migrar_con() {
  # shellcheck disable=SC2154  # el turno lo pone candado.sh, que incluye el mismo guion
  pasos_migrador=$(docker compose -f "$1" run -d --no-deps -T -e OPERACION_TURNO="$candado_turno" migracion </dev/null) || return 1
  pasos_migrador=$(printf '%s\n' "$pasos_migrador" | tail -1)
  [ -n "$pasos_migrador" ] || return 1
  docker logs -f "$pasos_migrador" 9>&- || true
  pasos_codigo=$(docker wait "$pasos_migrador" 9>&-) || return 1
  case "$pasos_codigo" in '' | *[!0-9]*) return 1 ;; esac
  docker rm "$pasos_migrador" >/dev/null 2>&1 9>&- || true
  return "$pasos_codigo"
}

# de_un_run_vivos <configuración> <servicio>: los contenedores sueltos de ese servicio —los de un
# «run»: un migrador, una restauración, una consulta— que siguen corriendo en ese conjunto, por el
# proyecto de su configuración guardada. Vacío: ninguno. Si no se pudo preguntar, falla: eso no es
# «ninguno».
de_un_run_vivos() {
  pasos_proyecto=$(proyecto_de "$1") || return 1
  docker ps -q --filter "label=com.docker.compose.project=$pasos_proyecto" --filter "label=com.docker.compose.service=$2" \
    --filter "label=com.docker.compose.oneoff=True"
}

# de_un_run_quietos <configuración> <servicio>: los contenedores sueltos de ese servicio que NO
# están corriendo: creados sin arrancar, o ya terminados. Si no se pudo preguntar, falla.
de_un_run_quietos() {
  pasos_proyecto=$(proyecto_de "$1") || return 1
  docker ps -aq --filter "label=com.docker.compose.project=$pasos_proyecto" --filter "label=com.docker.compose.service=$2" \
    --filter "label=com.docker.compose.oneoff=True" --filter status=created --filter status=exited --filter status=dead
}

# esperar_al_migrador <configuración>: que el guion de una publicación haya muerto no dice nada de
# lo que dejó corriendo. Se espera a que su migrador termine; si no termina a tiempo, se le detiene,
# y se comprueba que de verdad ya no está. Uno que quedó creado sin arrancar ya no lo arranca nadie
# —quien lo iba a arrancar tenía el candado en las manos, y ya no vive—, pero no se deja ahí: se
# quita, igual que el que ya terminó, y se vuelve a mirar. Después, lo mismo con su sesión en la
# base, si la base existe: pudo quedar una instrucción corriendo aunque el proceso ya no exista.
esperar_al_migrador() {
  pasos_plazo=${ESPERA_DEL_MIGRADOR:-60}
  pasos_k=0
  pasos_dicho=""
  while :; do
    pasos_vivos=$(de_un_run_vivos "$1" migracion) || falla "No se pudo preguntar si el migrador de la operación interrumpida sigue corriendo. No se sigue."
    pasos_quietos=$(de_un_run_quietos "$1" migracion) || falla "No se pudo preguntar si el migrador de la operación interrumpida quedó creado sin arrancar. No se sigue."
    [ -n "$pasos_vivos$pasos_quietos" ] || break
    pasos_k=$((pasos_k + 1))
    [ "$pasos_k" -lt $((pasos_plazo + 15)) ] || falla "El migrador de la operación interrumpida sigue ahí y no se le pudo detener ni quitar. No se sigue."
    if [ -n "$pasos_quietos" ]; then
      # Si alguno no se deja —arrancó entre tanto—, la vuelta siguiente lo ve corriendo.
      # shellcheck disable=SC2086  # una lista de identificadores
      docker rm $pasos_quietos >/dev/null 2>&1 || true
    fi
    if [ -n "$pasos_vivos" ]; then
      [ -n "$pasos_dicho" ] || echo "El migrador de la operación interrumpida sigue corriendo: se le espera."
      pasos_dicho=si
      if [ "$pasos_k" -ge "$pasos_plazo" ]; then
        [ "$pasos_k" -gt "$pasos_plazo" ] || echo "El migrador no terminó a tiempo: se le detiene."
        # shellcheck disable=SC2086  # una lista de identificadores
        docker kill $pasos_vivos >/dev/null 2>&1 || true
      fi
    fi
    sleep 1
  done
  pasos_estado=$(estado_de_la_base "$1")
  case "$pasos_estado" in
    no-contesta) falla "La base no contesta: no se puede comprobar que el migrador terminó en ella. No se sigue." ;;
    '{"base":"no hay"}') ;;
    *) en_la_base "$1" migrador "$pasos_plazo" || falla "No se pudo comprobar que el migrador terminó en la base. No se sigue." ;;
  esac
}

# esperar_lo_que_quedo <configuración>: lo demás que una operación interrumpida pudo dejar
# corriendo —una restauración, un respaldo, una consulta a la base—. A eso no se le detiene: se le
# espera, y si no termina se dice. Dos restauraciones a la vez sobre la misma base no caben.
esperar_lo_que_quedo() {
  pasos_plazo=${ESPERA_DE_LO_QUE_QUEDO:-1800}
  pasos_k=0
  while :; do
    pasos_vivos=""
    for pasos_servicio in comprobacion respaldo; do
      pasos_suyos=$(de_un_run_vivos "$1" "$pasos_servicio") || falla "No se pudo preguntar si quedó corriendo algo de una operación interrumpida. No se sigue."
      pasos_vivos="$pasos_vivos$pasos_suyos"
    done
    [ -n "$pasos_vivos" ] || break
    [ "$pasos_k" -gt 0 ] || echo "Sigue corriendo algo que dejó una operación interrumpida (una restauración, un respaldo o una consulta a la base): se le espera."
    pasos_k=$((pasos_k + 1))
    [ "$pasos_k" -lt "$pasos_plazo" ] || falla "Lo que dejó corriendo una operación interrumpida no termina. Mira qué es (docker ps) y, cuando ya no esté, vuelve a correr esto."
    sleep 1
  done
}

# levantar_conjunto <publicación> <configuración> <marca de la base>: levanta el conjunto ya
# publicado, por partes y en orden —base, migración, aplicación, proxy, respaldo—, y comprueba que
# lo que quedó corriendo es ese conjunto y que el sitio contesta por HTTPS con esa versión y sobre
# esa base. No abre ni cierra la operación: eso no es levantar.
levantar_conjunto() {
  arrancar "$2" db || return 1
  migrar_con "$2" || return 1
  arrancar "$2" web || return 1
  arrancar "$2" proxy || return 1
  arrancar "$2" respaldo || return 1
  corre "$1" candidato "$2" db web proxy respaldo || return 1
  esperar_el_sitio "$2" "--version=$1" "--base=$3"
}
