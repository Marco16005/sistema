#!/bin/sh
# Lo que se hace FUERA del servidor —en la computadora del dueño o de soporte, o en la máquina con
# que se ensaya restaurar—, con solo Docker y este repositorio: nada se instala en la máquina.
# Corre en la imagen de herramientas de esta carpeta (la misma con que el servidor respalda),
# construida aquí mismo.
#
#   sh operacion/fuera.sh llave > llave-privada.txt               una llave nueva, y lo que va al .env
#   sh operacion/fuera.sh sello [--hasta=<momento>] < llave-privada.txt
#   sh operacion/fuera.sh version [<respaldo>] < llave-privada.txt
#   sh operacion/fuera.sh ensayo [--diario[=<respaldo>] | --remoto=<respaldo>] [--como-estaba=<momento>] < llave-privada.txt
#
# «version» y «ensayo» llegan al almacenamiento con la credencial de RECUPERACIÓN, que está en
# recuperacion.env (o en el archivo que diga FUERA_ENTORNO): RESPALDO_DESTINO, RESPALDO_DESTINO_DIARIO,
# los RCLONE_CONFIG_… de cada depósito y ENSAYO_VIGIA_URL. Ese archivo va en el paquete de
# recuperación, nunca en el servidor.
#
# La llave privada entra siempre por la entrada estándar, desde su archivo: nunca como argumento,
# nunca a un disco de la máquina ni del contenedor.
#
# Solo para el ensayo de la operación: FUERA_RED=<red de Docker> une estos contenedores a la red
# donde están el almacenamiento y el vigilante de mentira.
set -eu
cd "$(dirname "$0")/.."
falla() { echo "$*" >&2; exit 1; }
uso() { sed -n 's/^#   \(sh operacion\/fuera\.sh .*\)$/\1/p' operacion/fuera.sh >&2; exit 2; }
[ "$#" -ge 1 ] || uso
orden=$1
shift
case "$orden" in llave|sello|version|ensayo) ;; *) uso ;; esac
command -v docker >/dev/null 2>&1 || falla "Hace falta Docker."
docker info >/dev/null 2>&1 || falla "Docker no contesta: ¿está encendido?"

# Al salir, pase lo que pase, se borra lo desechable del ensayo: su base y, si es suya, su red.
base=""
propia=""
limpiar() {
  resultado=$?
  trap - 0
  if [ -n "$base" ]; then docker rm -f "$base" >/dev/null 2>&1 || true; fi
  if [ -n "$propia" ] && [ -z "$red" ]; then docker network rm "$propia" >/dev/null 2>&1 || true; fi
  exit "$resultado"
}

# La llave se lee de un archivo; si la entrada es la terminal, alguien la teclearía o la pegaría.
llave_de_archivo() {
  [ ! -t 0 ] || falla "La llave privada entra desde su archivo: sh operacion/fuera.sh $orden … < llave-privada.txt"
}

red=${FUERA_RED:-}
if [ -n "$red" ]; then
  docker network inspect "$red" >/dev/null 2>&1 || falla "No existe la red $red (FUERA_RED)."
fi

# La imagen de herramientas de esta carpeta. Se construye cada vez; Docker reutiliza lo que no cambió.
imagen="feruga-fuera:$(git rev-parse --short=12 HEAD 2>/dev/null || echo local)"
echo "Preparando las herramientas (la primera vez tarda unos minutos)…" >&2
docker build -q -f docker/respaldo.Dockerfile -t "$imagen" . >/dev/null || falla "No se pudieron construir las herramientas."

# Lo que se corre en ella: sin red, salvo lo que tiene que llegar al almacenamiento.
herramienta() {
  docker run --rm -i --log-driver none --network none --entrypoint node "$imagen" "$@"
}

# La credencial de recuperación. Lo que es de la base del servidor no va aquí: el ensayo hace la suya.
entorno_de_recuperacion() {
  entorno=${FUERA_ENTORNO:-recuperacion.env}
  [ -f "$entorno" ] || falla "Falta $entorno: la credencial de recuperación del almacenamiento (ver docs/operacion.md, sección 1). Con otro nombre: FUERA_ENTORNO=<archivo>."
  if grep -Eq '^(DATABASE_URL|BD_CLAVE|WEB_BD_CLAVE|WEB_BD_USUARIO)=' "$entorno"; then
    falla "$entorno trae datos de la base del servidor (DATABASE_URL, BD_CLAVE…): ahí solo va lo del almacenamiento y el vigilante de los ensayos."
  fi
}

case "$orden" in
  llave)
    [ "$#" -eq 0 ] || uso
    [ ! -t 1 ] || falla "La llave va a un archivo, no a la pantalla: sh operacion/fuera.sh llave > llave-privada.txt"
    # Se genera dentro del contenedor y pasa por la memoria de este guion: al archivo, y a sello.ts
    # para decir los dos renglones del .env. No toca ningún disco más que el archivo que se pidió.
    nueva=$(docker run --rm --log-driver none --network none --entrypoint age-keygen "$imagen" 2>/dev/null) \
      || falla "No se pudo generar la llave."
    printf '%s\n' "$nueva"
    renglones=$(printf '%s\n' "$nueva" | herramienta operacion/sello.ts) || falla "La llave quedó en el archivo, pero no se pudo sacar su sello: sh operacion/fuera.sh sello < llave-privada.txt"
    {
      echo "La llave quedó en el archivo. Guárdala en el paquete de recuperación y en ningún otro lado."
      echo "Al .env del servidor van estos dos renglones:"
      printf '%s\n' "$renglones"
    } >&2
    ;;
  sello)
    for a do case "$a" in --hasta=*) ;; *) uso ;; esac; done
    llave_de_archivo
    herramienta operacion/sello.ts "$@"
    ;;
  version)
    [ "$#" -le 1 ] || uso
    case "${1:-}" in -*) uso ;; esac
    llave_de_archivo
    entorno_de_recuperacion
    docker run --rm -i --log-driver none ${red:+--network "$red"} --env-file "$entorno" \
      --entrypoint node "$imagen" operacion/version-del-respaldo.ts "$@"
    ;;
  ensayo)
    cual=--remoto
    for a do
      case "$a" in
        --diario|--diario=*|--remoto=*) cual= ;;
        --como-estaba=*) ;;
        *) uso ;;
      esac
    done
    llave_de_archivo
    entorno_de_recuperacion
    # Una base de PostgreSQL desechable, de la misma imagen que la del servidor (por su huella), en
    # una red propia y sin publicar ningún puerto. Sus claves se inventan aquí y mueren con ella.
    imagen_bd=$(sed -n 's/^FROM \([^ ]*@sha256:[0-9a-f]\{64\}\).*$/\1/p' docker/db.Dockerfile | head -1)
    [ -n "$imagen_bd" ] || falla "docker/db.Dockerfile no dice la imagen de la base por su huella."
    clave() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32; }
    bd_clave=$(clave)
    web_clave=$(clave)
    base="feruga-fuera-base-$$"
    propia="feruga-fuera-red-$$"
    trap limpiar 0
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [ -z "$red" ]; then
      docker network create "$propia" >/dev/null || falla "No se pudo crear la red del ensayo."
      red_del_ensayo=$propia
    else
      red_del_ensayo=$red
    fi
    docker run -d --name "$base" --network "$red_del_ensayo" --log-driver none \
      -e POSTGRES_USER=feruga -e POSTGRES_PASSWORD="$bd_clave" -e POSTGRES_DB=postgres "$imagen_bd" >/dev/null \
      || falla "No se pudo arrancar la base desechable del ensayo."
    # Lista cuando contesta por la red: mientras se inicializa, solo escucha por dentro.
    n=0
    until docker exec "$base" pg_isready -q -h 127.0.0.1 -U feruga -d postgres >/dev/null 2>&1; do
      n=$((n + 1))
      [ "$n" -le 120 ] || falla "La base desechable del ensayo no arrancó en dos minutos."
      sleep 1
    done
    echo "Restaurando en una base desechable. Se mide cuánto tarda." >&2
    inicio=$(date +%s)
    codigo=0
    docker run --rm -i --log-driver none --network "$red_del_ensayo" --env-file "$entorno" \
      -e DATABASE_URL="postgres://feruga:$bd_clave@$base:5432/feruga" \
      -e WEB_BD_USUARIO=feruga_web -e WEB_BD_CLAVE="$web_clave" \
      --entrypoint node "$imagen" operacion/restaurar.ts ${cual:+"$cual"} --ensayo "$@" || codigo=$?
    fin=$(date +%s)
    minutos=$(( (fin - inicio + 59) / 60 ))
    case "$codigo" in
      0) echo "El ensayo pasó: el respaldo se abrió, se restauró y se auditó en $minutos min. La base desechable se borra." ;;
      3) echo "Se restauró bien en $minutos min, pero el vigilante de los ensayos no recibió el aviso: va a alertar como si no se hubiera hecho. Revisa ENSAYO_VIGIA_URL." >&2 ;;
      *) echo "El ensayo NO pasó (lo de arriba dice por qué). Ese respaldo no se pudo restaurar: avisa a soporte." >&2 ;;
    esac
    exit "$codigo"
    ;;
esac
