# Lo que comparten los ensayos (operacion/ensayo.sh y operacion/ensayo-publicacion.sh). No es un
# guion: lo incluye cada uno, parado en la carpeta del proyecto.
#
# Un ensayo no toca esta carpeta ni lo que corre en esta máquina. Arma una instalación aparte:
# una copia del proyecto con su propio repositorio de Git —lo que se publica es un commit—, su
# propio proyecto de Compose, sus imágenes, sus puertos y sus volúmenes; con un dominio que no
# existe en internet, un almacenamiento de mentira para los respaldos y un vigilante que solo
# anota. Al terminar no deja nada.
#
# Quien lo incluye define antes PROYECTO (el nombre del proyecto de Compose) y los puertos.

DOMINIO=patio.test
HERRAMIENTAS_DEL_ENSAYO=feruga-ensayo-herramientas
OPERACION=docker-compose.yml:docker-compose.operacion.yml
trabajo=$(mktemp -d)
# La instalación del ensayo: la copia, con su repositorio.
copia="$trabajo/instalacion"
# Un proceso de mentira que, en algún paso, tiene el candado de la instalación mientras se le prueba.
otra=""
# Las imágenes de herramientas que ya había antes del ensayo: al terminar se quitan las demás, que son suyas.
herramientas_de_antes=$(docker image ls --format '{{.Repository}}:{{.Tag}}' | command grep '^feruga-herramientas:' || true)

paso() { printf '\n== %s\n' "$1"; }
falla() { printf '\nFALLÓ: %s\n' "$1" >&2; exit 1; }
# Lo que los ensayos buscan está en lo que dijeron los guiones, y eso a veces trae bytes que no son
# texto (un proceso que quedó huérfano y siguió escribiendo en el mismo archivo deja ceros). El grep
# de macOS, con acentos en lo que se busca, deja de encontrar en un archivo así. Se busca byte por
# byte y tratándolo como texto, que no depende de eso.
grep() { LC_ALL=C command grep -a "$@"; }
nodo() { docker run --rm -i --entrypoint node "$HERRAMIENTAS_DEL_ENSAYO" "$@"; }
# poner CLAVE valor [archivo]: deja esa variable con ese valor en el archivo de entorno.
poner() {
  archivo=${3:-$trabajo/.env}
  grep -v "^$1=" "$archivo" > "$archivo.nuevo" || true
  printf '%s=%s\n' "$1" "$2" >> "$archivo.nuevo"
  mv "$archivo.nuevo" "$archivo"
}
# Lo que no es de la operación sino del ensayo —el almacenamiento, el vigilante, la autoridad de los
# certificados, el navegador— se maneja con Compose a secas. Las imágenes de la operación no
# importan ahí: se ponen de relleno, y nunca se nombra un servicio de la operación.
arnes() {
  env IMAGEN_DB=relleno IMAGEN_ADMIN=relleno IMAGEN_WEB=relleno IMAGEN_RESPALDO=relleno IMAGEN_PROXY=relleno VERSION=relleno docker compose "$@"
}
# El Compose de lo publicado, como lo usa quien opera.
operacion() { sh operacion/compose.sh "$@"; }
# Lo mismo, saltándose el guion a propósito: para mirar o mover algo a media publicación —cuando el
# guion, con razón, no deja correr nada suelto— y para lo que el guion no hace, como recrear un servicio.
por_fuera() {
  docker compose -f "publicaciones/$(docker run --rm --network none --user "$(id -u):$(id -g)" -v "$PWD/publicaciones:/publicaciones" \
    --entrypoint node "$HERRAMIENTAS_DEL_ENSAYO" operacion/publicacion.ts /publicaciones vigente configuracion)" "$@"
}
# Nadie tiene el candado de la instalación: su archivo, si está, no dice de nadie.
candado_libre() { [ ! -s .operacion.candado ]; }
# Las imágenes de lo publicado, como variables de Compose: para quien, a propósito, se salta los guiones.
variables_de_lo_publicado() {
  docker run --rm --network none --user "$(id -u):$(id -g)" -v "$PWD/publicaciones:/publicaciones" \
    --entrypoint node "$HERRAMIENTAS_DEL_ENSAYO" operacion/publicacion.ts /publicaciones variables vigente
}

# La limpieza queda puesta desde ahora: la carpeta lleva claves, y no debe quedarse si algo falla pronto.
limpiar() {
  codigo=$?
  [ -z "$otra" ] || kill -9 "$otra" 2>/dev/null || true
  if [ "${CONSERVAR:-}" = 1 ]; then
    printf '\nSe conserva el ensayo, en %s. Para quitarlo:\n  docker compose -p %s down --volumes --remove-orphans\n  y borrar esa carpeta.\n' "$copia" "$PROYECTO"
  else
    # Por su nombre, sin los archivos de Compose: la limpieza corre aunque el ensayo haya fallado pronto.
    (cd / && env -u COMPOSE_FILE -u COMPOSE_ENV_FILES docker compose -p "$PROYECTO" down --volumes --remove-orphans >/dev/null 2>&1) || true
    # Las imágenes que construyeron sus publicaciones, y las herramientas de sus commits. Por su
    # nombre, nunca por su identificador: una imagen sin cambios sobre su base comparte el de la base.
    for imagen in $(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$PROYECTO-*"); do
      docker image rm "$imagen" >/dev/null 2>&1 || true
    done
    # Las herramientas, una imagen por commit: también las de los commits que el ensayo hizo y deshizo.
    for imagen in $(docker image ls --format '{{.Repository}}:{{.Tag}}' | command grep '^feruga-herramientas:' || true); do
      case " $(printf '%s' "$herramientas_de_antes" | tr '\n' ' ') " in
        *" $imagen "*) ;;
        *) docker image rm "$imagen" >/dev/null 2>&1 || true ;;
      esac
    done
    rm -rf "$trabajo"
  fi
  exit "$codigo"
}
trap limpiar EXIT
# También si al ensayo se le interrumpe: que no deje su instalación levantada ni sus imágenes.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Deja en la copia un commit con lo que haya ahí. Lo que se publica es un commit, entero.
confirmar() {
  git -C "$copia" add -A
  git -C "$copia" -c user.name=ensayo -c user.email=ensayo@localhost commit -q -m "$1"
}

# Arma la instalación del ensayo: la copia con su repositorio, y su entorno como se genera en un servidor nuevo.
preparar_la_instalacion() {
  paso "La instalación del ensayo: una copia del proyecto, con su propio repositorio"
  mkdir "$copia"
  tar -cf - --exclude ./node_modules --exclude ./.next --exclude ./.git --exclude ./.env --exclude ./publicaciones \
    --exclude './.operacion.candado*' --exclude ./.operacion.trabajo --exclude ./test-results --exclude ./playwright-report --exclude ./recorrido/capturas \
    --exclude ./docs --exclude '*.log' . | tar -xf - -C "$copia"
  git -C "$copia" init -q
  confirmar "La versión que se ensaya"
  cd "$copia" || exit 1

  paso "El entorno, como se genera en un servidor nuevo"
  (cd "$trabajo" && sh "$copia/operacion/entorno.sh" "$DOMINIO" >/dev/null)
  docker build -q -f docker/respaldo.Dockerfile -t "$HERRAMIENTAS_DEL_ENSAYO" . >/dev/null
  # Recién generado le falta lo del respaldo, y Compose se niega diciendo qué.
  if arnes --env-file "$trabajo/.env" config >/dev/null 2>"$trabajo/queja"; then
    falla "Compose aceptó un entorno sin lo del respaldo"
  fi
  grep -q "RESPALDO_" "$trabajo/queja" || falla "Compose no dijo qué variable del respaldo falta"

  # La llave del respaldo se genera fuera del servidor; aquí, en un contenedor aparte, y sin que Docker
  # guarde su salida en su registro. (Es una llave de prueba; la de verdad no se genera así: ver la guía.)
  docker run --rm --log-driver none --entrypoint age-keygen "$HERRAMIENTAS_DEL_ENSAYO" > "$trabajo/llave.txt" 2>/dev/null
  # La llave pública y el sello de los respaldos salen juntos de la llave privada, también fuera del
  # servidor, y al servidor van solo esos dos renglones: con el sello sella cada respaldo, y quien
  # restaura lo comprueba con la llave. La pública que dice sello.ts es la que dijo age-keygen.
  docker run --rm -i --log-driver none --entrypoint node "$HERRAMIENTAS_DEL_ENSAYO" operacion/sello.ts < "$trabajo/llave.txt" > "$trabajo/del-sello" \
    || falla "no se pudieron sacar la llave pública y el sello de la llave del ensayo"
  publica=$(sed -n 's/^RESPALDO_LLAVE_PUBLICA=//p' "$trabajo/del-sello")
  [ -n "$publica" ] && [ "$publica" = "$(grep -o 'age1[0-9a-z]*' "$trabajo/llave.txt" | head -1)" ] \
    || falla "la llave pública que saca sello.ts no es la que dijo age-keygen"
  poner RESPALDO_LLAVE_PUBLICA "$publica"
  poner RESPALDO_SELLO "$(sed -n 's/^RESPALDO_SELLO=//p' "$trabajo/del-sello")"
  rm -f "$trabajo/del-sello"
  poner RESPALDO_DESTINO "respaldo:ensayo/feruga"
  poner RCLONE_CONFIG_RESPALDO_PROVIDER Minio
  poner RCLONE_CONFIG_RESPALDO_ENDPOINT http://almacen-ensayo:9000
  poner RCLONE_CONFIG_RESPALDO_REGION us-east-1
  poner RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID servidor
  poner RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY "$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)"
  poner RESPALDO_VIGIA_URL "https://vigia.test/ping/respaldo"
  # El respaldo diario, que se guarda un año: otro depósito, otra credencial, otra señal.
  poner RESPALDO_DESTINO_DIARIO "diario:ensayo-diario/feruga"
  poner RCLONE_CONFIG_DIARIO_PROVIDER Minio
  poner RCLONE_CONFIG_DIARIO_ENDPOINT http://almacen-ensayo:9000
  poner RCLONE_CONFIG_DIARIO_REGION us-east-1
  poner RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID diario
  poner RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY "$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)"
  poner RESPALDO_VIGIA_DIARIO_URL "https://vigia.test/ping/diario"
  # El latido del sitio, apurado: en el servidor va cada 5 minutos.
  poner LATIDO_VIGIA_URL "https://vigia.test/ping/latido"
  poner LATIDO_CADA 5

  paso "A la red, solo el proxy: la configuración de operación tal como irá al servidor"
  # Con solo el .env generado, Compose toma los dos archivos de operación sin que se le diga a mano.
  arnes --env-file "$trabajo/.env" config --services > "$trabajo/servicios"
  if ! grep -qx proxy "$trabajo/servicios" || ! grep -qx respaldo "$trabajo/servicios"; then
    falla "con solo el .env, Compose no tomó el archivo de operación"
  fi
  arnes --env-file "$trabajo/.env" config --format json | nodo operacion/comprobar.ts red \
    || falla "la configuración de operación publica algo de más, o no publica el proxy"

  # De aquí en adelante, el proyecto del ensayo: el Compose de operación más la capa que pone lo que
  # aquí no puede ser de verdad. Y otros puertos, para no chocar con lo que ya corre en esta máquina.
  export COMPOSE_PROJECT_NAME="$PROYECTO"
  export COMPOSE_FILE="$OPERACION:docker-compose.ensayo.yml"
  export COMPOSE_ENV_FILES="$trabajo/.env"
  export ENSAYO=1
  # Lo que en el servidor está fuera y aquí corre junto, en la misma instalación: se dice cuál es,
  # para que no cuente como un servicio de más al guardar la configuración ni al comprobar qué corre.
  export ENSAYO_DE_FUERA=autoridad,vigia,almacen-ensayo,almacen_listo,recorrido_operacion
  export NODE_EXTRA_CA_CERTS=/ca/raiz.crt
  poner BD_PUERTO "$BD_PUERTO"
  poner WEB_PUERTO "$WEB_PUERTO"
  poner PROXY_HTTP "127.0.0.1:$PROXY_HTTP"
  poner PROXY_HTTPS "127.0.0.1:$PROXY_HTTPS"
  cp "$trabajo/.env" "$trabajo/roto.env"
  poner SESION_CLAVE corta "$trabajo/roto.env"
}

# Lo que en un servidor de verdad está fuera: el almacenamiento de los respaldos y el vigilante. Y
# quien saca la raíz de la autoridad del proxy a donde la lean los que van a confiar en ella: se
# queda esperando a que el proxy la genere, la primera vez que arranca.
preparar_el_arnes() {
  paso "Lo que en el servidor está fuera: el almacenamiento, el vigilante y la autoridad de los certificados"
  arnes up -d --wait --no-deps almacen-ensayo >/dev/null 2>&1 || falla "no levantó el almacenamiento del ensayo"
  arnes run --rm --no-deps almacen_listo >/dev/null 2>&1 || falla "no se pudo preparar el almacenamiento del ensayo"
  arnes up -d --no-deps vigia autoridad >/dev/null 2>&1 || falla "no levantaron el vigilante y la autoridad del ensayo"
}

# El estado de un contenedor de la operación: estado <servicio> <campo de State>.
estado() { docker inspect -f "{{.State.$2}}" "$(docker ps -a -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=$1" --filter "label=com.docker.compose.oneoff=False" | head -1)" 2>/dev/null || echo "no existe"; }
# Los contenedores de la operación que hay, creados o corriendo, sin contar los del arnés.
de_la_operacion() {
  for servicio in db migracion web respaldo proxy; do
    docker ps -a -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=$servicio"
  done
}
# Los que atienden, por su identificador: si alguno se reemplaza, cambia.
corriendo() {
  for servicio in db web proxy; do
    docker ps -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=$servicio" --filter "label=com.docker.compose.oneoff=False"
  done | tr '\n' ' '
}
# Una consulta a la base, directo en su contenedor: sirve también cuando la carpeta de publicaciones
# no se puede leer y, por eso, los guiones se detienen.
enlabase() {
  docker exec "$(docker ps -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=db" | head -1)" psql -U feruga -d "${2:-feruga}" -Atc "$1"
}
# El sitio contesta por HTTPS, validando su certificado contra la autoridad del ensayo.
atiende() { por_fuera run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS comprobacion https proxy; }
esperar_que_atienda() {
  k=0
  until atiende >/dev/null 2>&1; do
    k=$((k + 1)); [ "$k" -lt 30 ] || falla "$1"
    sleep 1
  done
}
diagnostico() {
  # Para saber por qué no levantó: el estado de cada pieza y lo último que dijo la que terminó.
  docker ps -a --filter "label=com.docker.compose.project=$PROYECTO" --format '{{.Label "com.docker.compose.service"}}: {{.Status}}' >&2
  for contenedor in $(docker ps -a -q --filter "label=com.docker.compose.project=$PROYECTO" --filter status=exited); do
    printf '\n-- %s --\n' "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$contenedor")" >&2
    docker logs --tail 15 "$contenedor" >&2 || true
  done
}
