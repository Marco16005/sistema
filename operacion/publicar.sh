#!/bin/sh
# Publica la versión que está en esta carpeta: su commit.
#
#   sh operacion/publicar.sh               publica
#   sh operacion/publicar.sh --recuperar   retoma una publicación que quedó sin cerrar
#   sh operacion/publicar.sh --desde-respaldo[=<respaldo>] < llave-privada.txt
#                                          en una máquina donde no hay nada: instala desde un respaldo
#
# Lo que se promete, exactamente. Antes de cerrar no se altera lo que atiende. Desde que se cierra
# hasta que se abre, el negocio está cerrado, pase lo que pase. Desde que se decide abrir no se
# retrocede; y una apertura confirmada sigue atendiendo aunque este guion muera después.
#
# La secuencia es lineal y sin ramas, y antes de cada paso queda escrito en el manifiesto de la
# publicación (publicaciones/<publicación>/manifiesto.json) que se va a dar:
#   1. Preparar, sin tocar nada: el commit, sin cambios sueltos; construir sus imágenes, del
#      commit; comprobar el entorno y qué sale a la red; que lo que corre sea lo que dejó la última
#      publicación; y que el migrador de esta versión, sin aplicar nada, diga que puede con la base
#      que hay.
#   2. Escribir el manifiesto.
#   3. Cerrar: mantenimiento, detener la aplicación y el servicio de respaldo, y esperar a que no
#      quede ninguna sesión de la aplicación en la base.
#   4. Respaldar, comprobado, y anotar su nombre exacto. Sin eso no se migra.
#   5. Migrar. Antes de arrancar se anota que la migración empezó.
#   6. Levantar la versión nueva con la operación cerrada, y comprobarla por HTTPS a través del
#      proxy: lista, cerrada, esta versión, esta base, cada contenedor con la imagen del
#      manifiesto, y un intento de escribir que debe rechazarse.
#   7. Decidir abrir: se anota en el manifiesto, se anota en la base, y solo entonces se abre. De
#      la primera de esas anotaciones en adelante no hay vuelta.
#   8. Terminar: reponer el servicio de respaldo, comprobar otra vez qué corre, y cerrar el manifiesto.
#
# Si muere a la mitad, la publicación queda sin cerrar y nada más se publica ni se levanta hasta
# recuperarla. Recuperar lee el manifiesto y la base, y hace lo único que toca:
#   · se decidió abrir o ya abrió —lo diga el manifiesto o la base—: termina hacia adelante;
#   · empezó la migración y no hay señal de apertura: se queda cerrado, y dice la salida: volver al
#     respaldo previo (el negocio estuvo cerrado desde antes de tomarlo: no se pierde nada) y
#     después publicar la versión corregida como cualquier otra;
#   · ni lo uno ni lo otro: restablece la versión anterior, la comprueba y la abre. La base no se tocó.
# Si la identidad no coincide o falta evidencia, no elige el caso más cómodo: se detiene.
#
# La primera publicación de una instalación es distinta en una cosa: si murió con la migración
# empezada, no hay respaldo previo ni versión anterior a los que volver —y tampoco hay datos que
# cuidar: nunca abrió—. Esa se termina hacia adelante: se repite la migración, que aplica lo que
# falte, y se sigue.
#
# Instalar desde un respaldo es para cuando se perdió la máquina. No hay nada local, y eso no se
# deduce: se dice. Parte del respaldo —el último, o el que se nombre—, que dice qué publicación
# corría cuando se tomó, y con ella de qué commit era. La carpeta tiene que estar en ese commit:
# las imágenes se construyen aquí, de él, como en cualquier publicación. Del almacenamiento se baja
# el respaldo —cifrado para el dueño, y auditado al restaurarlo— y nada que se vaya a ejecutar: lo
# que se confía es el repositorio. Restaurado, sigue como cualquier publicación —levantar con la
# operación cerrada, comprobar, abrir—. Lo hace el dueño, con su llave. Lo que se asentó después de
# ese respaldo no está: eso se concilia aparte.
set -eu
umask 077
cd "$(dirname "$0")/.."

modo=publicar
respaldo_pedido=""
case "${1:-}" in
  "") ;;
  --recuperar) modo=recuperar ;;
  --desde-respaldo) modo="instalar desde un respaldo" ;;
  --desde-respaldo=?*)
    modo="instalar desde un respaldo"
    respaldo_pedido=${1#--desde-respaldo=}
    ;;
  *)
    echo "Uso: sh operacion/publicar.sh [--recuperar | --desde-respaldo[=<respaldo>] < llave-privada.txt]" >&2
    exit 1
    ;;
esac

. operacion/candado.sh
. operacion/pasos.sh

# La limpieza queda puesta desde antes: lo que se resuelve lleva claves, y no debe quedarse. Si a
# este guion se le mata sin dejarlo limpiar, lo que quede lo quita la operación que siga, al entrar.
privado=""
limpiar() {
  [ -z "$privado" ] || rm -rf "$privado"
  soltar_candado
}
trap limpiar EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tomar_candado "$modo" || exit 1
preparar_trabajo || falla "No se pudo preparar la carpeta de trabajo ($TRABAJO). No se tocó nada."
privado=$TRABAJO

paso() { printf '\n== %s\n' "$1"; }

# La publicación en curso. Los pasos de abajo trabajan sobre ella.
pub=""
# Su configuración resuelta —la candidata— y la del conjunto que corría. Vacía la segunda: es la primera publicación.
conf=""
conf_ant=""

# De aquí en adelante un fallo deja la publicación sin cerrar: se dice, y cómo retomarla.
retomar="sh operacion/publicar.sh --recuperar"
sin_cerrar() {
  printf '\n%s\n' "$1" >&2
  printf 'La publicación %s quedó sin cerrar. Para retomarla: %s\n' "$pub" "$retomar" >&2
  exit 1
}

# La marca de la base de esta publicación, como quedó escrita en su manifiesto.
marca_de_la_base() {
  manifiesto dato "$pub" base.marca
}

# ── los pasos ──────────────────────────────────────────────────────────────

# Las imágenes salen del commit, no de la carpeta: lo que Git ignora —y por eso «git status» no
# enseña— no entra en ellas, ni lo que alguien cambie mientras se construyen.
construir() {
  proyecto=$(nombre_del_proyecto) || falla "No se pudo saber el nombre del proyecto de Compose de esta instalación. No se tocó nada."
  # La base de datos no se construye: es la imagen oficial, por su huella (docker/db.Dockerfile, en
  # el commit, dice cuál). Así su identificador es siempre el mismo, y se nota si una versión
  # quiere cambiarla.
  codigo=0
  base_de_datos=$(imagen_de_la_base "$commit") || codigo=$?
  case "$codigo" in
    0) ;;
    2) falla "docker/db.Dockerfile no nombra la imagen de la base de datos por su huella. No se tocó nada." ;;
    *) falla "No se pudo leer del commit cuál es la imagen de la base de datos. No se tocó nada." ;;
  esac
  docker image inspect "$base_de_datos" >/dev/null 2>&1 || docker pull -q "$base_de_datos" >/dev/null || falla "No se pudo traer la imagen de la base de datos. No se tocó nada."
  docker tag "$base_de_datos" "$proyecto-db:$pub" || falla "No se pudo etiquetar la imagen de la base de datos. No se tocó nada."
  identificador=$(docker image inspect -f '{{.Id}}' "$base_de_datos") || falla "No se pudo leer el identificador de la imagen de la base de datos. No se tocó nada."
  [ -n "$identificador" ] || falla "No se pudo leer el identificador de la imagen de la base de datos. No se tocó nada."
  variables="IMAGEN_DB=$identificador"
  for imagen in "ADMIN web.Dockerfile admin" "WEB web.Dockerfile web" "RESPALDO respaldo.Dockerfile -" "PROXY proxy.Dockerfile -"; do
    # shellcheck disable=SC2086  # tres palabras: la variable, su Dockerfile y su etapa
    set -- $imagen
    etiqueta="$proyecto-$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]'):$pub"
    if [ "$3" = - ]; then
      construir_del_commit "$commit" "$etiqueta" "$2" || falla "No se pudo construir la imagen de $2. No se tocó nada."
    else
      construir_del_commit "$commit" "$etiqueta" "$2" "$3" || falla "No se pudo construir la imagen de $2 ($3). No se tocó nada."
    fi
    # Lo que corre se nombra por el identificador de la imagen, que no cambia; la etiqueta solo la conserva.
    identificador=$(docker image inspect -f '{{.Id}}' "$etiqueta") || falla "No se pudo leer el identificador de la imagen de $2. No se tocó nada."
    [ -n "$identificador" ] || falla "No se pudo leer el identificador de la imagen de $2. No se tocó nada."
    variables="$variables IMAGEN_$1=$identificador"
  done
}

cerrar_y_drenar() {
  paso "3. Cerrar: la operación entra en mantenimiento"
  punto cerrar:antes
  en_la_base "$conf" cerrar "$pub" "Publicar una versión" || sin_cerrar "No se pudo cerrar la operación."
  punto cerrar:despues
  # El servicio de respaldo, al detenerse, termina el que tenga a medias.
  detener "$conf_ant" web respaldo || sin_cerrar "No se pudieron detener la aplicación y el servicio de respaldo. La operación quedó cerrada."
  punto detener:despues
  en_la_base "$conf" drenar "${PLAZO_DE_DRENADO:-60}" || sin_cerrar "Quedaron sesiones de la aplicación en la base. La operación quedó cerrada, y no se respaldó ni se migró."
  punto drenar:despues
}

respaldar_antes() {
  paso "4. Respaldar, con la operación cerrada"
  punto respaldar:antes
  if ! docker compose -f "$conf_ant" run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS respaldo ahora >"$privado/respaldo.salida" 2>"$privado/respaldo.queja" </dev/null; then
    cat "$privado/respaldo.queja" >&2
    sin_cerrar "No se pudo respaldar. La operación quedó cerrada, y no se migró."
  fi
  cat "$privado/respaldo.queja" >&2
  punto respaldar:despues
  nombre=$(sed -n 's/^respaldo: //p' "$privado/respaldo.salida" | head -1)
  [ -n "$nombre" ] || sin_cerrar "El respaldo no dijo su nombre. La operación quedó cerrada, y no se migró."
  manifiesto respaldo "$pub" "$nombre" || sin_cerrar "El respaldo quedó hecho ($nombre), pero no se pudo anotar en el manifiesto. Sin eso no se migra."
  echo "Respaldo previo: $nombre"
  # Que el vigilante se haya enterado se anota aparte: si no le llegó el aviso, el respaldo vale igual.
  case "$(sed -n 's/^vigia: //p' "$privado/respaldo.salida" | head -1)" in
    avisado) manifiesto vigia "$pub" si || true ;;
    "sin avisar")
      manifiesto vigia "$pub" no || true
      echo "(El vigilante no recibió el aviso de este respaldo, y va a alertar. El respaldo está hecho y comprobado.)"
      ;;
    *) ;;
  esac
  punto anotar-respaldo:despues
}

migrar_la_base() {
  paso "5. Migrar"
  manifiesto marcar "$pub" empezoLaMigracion || sin_cerrar "No se pudo anotar que empieza la migración. No se migró."
  punto migrar:antes
  if ! migrar_con "$conf"; then
    [ -n "$conf_ant" ] || sin_cerrar "La migración falló. Es la primera publicación de esta instalación y nunca abrió: no hay datos que cuidar. Corregido lo que haya fallado, retomarla repite la migración. Si lo que falla es la versión misma, la instalación se desecha entera y se instala la corregida (ver la guía)."
    sin_cerrar "La migración falló. El negocio queda cerrado: la base ya pudo cambiar, y no se vuelve sola."
  fi
  punto migrar:despues
  if [ -z "$conf_ant" ]; then
    # La primera publicación: la base acaba de nacer, abierta. Se anota cuál es y se cierra, para
    # que lo que sigue —levantar cerrada, comprobar, abrir— sea lo mismo que en todas las demás.
    marca=$(en_la_base "$conf" estado marca) || sin_cerrar "Se migró, pero la base no dijo su marca."
    [ -n "$marca" ] || sin_cerrar "Se migró, pero la base no dijo su marca."
    manifiesto base "$pub" "$marca" || sin_cerrar "No se pudo anotar la marca de la base."
    en_la_base "$conf" cerrar "$pub" "Primera publicación" || sin_cerrar "No se pudo cerrar la operación de la base recién creada."
    punto primera:despues
  fi
}

# levantar_cerrada <cuál> <configuración> <versión>: levanta ese conjunto con la operación cerrada, y lo comprueba.
levantar_cerrada() {
  paso "6. Levantar con la operación cerrada, y comprobar"
  arrancar "$2" web || sin_cerrar "La aplicación no levantó. El negocio queda cerrado."
  arrancar "$2" proxy || sin_cerrar "El proxy no levantó. El negocio queda cerrado."
  punto levantar:despues
  marca=$(marca_de_la_base) || sin_cerrar "No se pudo leer el manifiesto."
  esperar_el_sitio "$2" --cerrada "--version=$3" "--base=$marca" --rechaza-escribir \
    || sin_cerrar "Lo que se levantó no pasa la comprobación por HTTPS. El negocio queda cerrado."
  corre "$pub" "$1" "$2" db web proxy || sin_cerrar "Lo que corre no es el conjunto del manifiesto. El negocio queda cerrado."
  punto comprobar:despues
}

# abrir_la_operacion <cuál> <configuración>: las tres anotaciones, en su orden.
abrir_la_operacion() {
  paso "7. Abrir"
  manifiesto marcar "$pub" seDecidioAbrir || sin_cerrar "No se pudo anotar la decisión de abrir. El negocio queda cerrado."
  punto decidir:manifiesto
  en_la_base "$conf" decidir "$pub" || sin_cerrar "No se pudo anotar en la base la decisión de abrir. El negocio queda cerrado; ya no hay vuelta: se termina hacia adelante."
  punto decidir:base
  # Abrir comprueba: en la base, que la publicación y la base son las que se comprobaron; aquí, que
  # el conjunto que corre sigue siendo ese.
  marca=$(marca_de_la_base) || sin_cerrar "No se pudo leer el manifiesto."
  corre "$pub" "$1" "$2" db web proxy || sin_cerrar "Lo que corre ya no es el conjunto que se comprobó. El negocio queda cerrado; se termina hacia adelante."
  en_la_base "$conf" abrir "$pub" "$marca" || sin_cerrar "No se pudo abrir la operación. El negocio queda cerrado; se termina hacia adelante."
  punto abrir:despues
  manifiesto marcar "$pub" abierta || sin_cerrar "La operación ya abrió, y no se pudo anotar en el manifiesto."
  punto abierta:manifiesto
}

# terminar <cuál> <configuración> <versión> <cómo se cierra>
terminar() {
  paso "8. Terminar"
  servicio_de_respaldo=bien
  arrancar "$2" respaldo || servicio_de_respaldo=mal
  punto respaldo:despues
  marca=$(marca_de_la_base) || sin_cerrar "No se pudo leer el manifiesto. El negocio ya abrió."
  if [ "$servicio_de_respaldo" = bien ]; then
    corre "$pub" "$1" "$2" db web proxy respaldo || sin_cerrar "Lo que corre no es el conjunto del manifiesto. El negocio ya abrió."
  else
    # El servicio de respaldo no quedó bien, y así se va a decir: aquí se mira lo demás, no el conjunto completo.
    corre_al_menos "$pub" "$1" "$2" db web proxy || sin_cerrar "Lo que corre no es el conjunto del manifiesto. El negocio ya abrió."
  fi
  por_https "$2" --abierta "--version=$3" "--base=$marca" >/dev/null || sin_cerrar "El sitio no dice que la operación está abierta con esta versión. El negocio ya abrió en la base."
  punto cerrar-manifiesto:antes
  if [ "$servicio_de_respaldo" = bien ]; then
    manifiesto cerrar "$pub" "$4" || sin_cerrar "No se pudo cerrar el manifiesto. El negocio ya abrió."
  elif [ "$4" = publicada ]; then
    manifiesto cerrar "$pub" "publicada, con el respaldo sin arrancar" || sin_cerrar "No se pudo cerrar el manifiesto. El negocio ya abrió."
  else
    manifiesto cerrar "$pub" "$4" || sin_cerrar "No se pudo cerrar el manifiesto. El negocio ya abrió."
  fi
  punto cerrar-manifiesto:despues
  if [ "$servicio_de_respaldo" = mal ]; then
    printf '\nEL SERVICIO DE RESPALDO NO ARRANCÓ. El negocio ya abrió y así se queda, pero no se está respaldando a su hora.\n' >&2
    printf 'Mira por qué (sh operacion/compose.sh logs respaldo) y vuelve a levantarlo: sh operacion/levantar.sh\n' >&2
    exit 1
  fi
}

# ── publicar ───────────────────────────────────────────────────────────────

publicar() {
  commit=$(commit_actual)
  exigir_carpeta_limpia "lo que se publica es un commit, entero"
  pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
  [ -z "$pendiente" ] || falla "Hay una publicación sin cerrar ($pendiente). Primero se recupera: sh operacion/publicar.sh --recuperar. No se tocó nada."
  vigente=$(manifiesto vigente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
  de_commit=""
  [ -z "$vigente" ] || de_commit=$(manifiesto vigente commit) || falla "No se pudo leer de qué commit es lo publicado. No se tocó nada."
  if [ -n "$vigente" ] && [ "$de_commit" = "$commit" ]; then
    # Este commit ya está publicado. No se construye otra vez: reconstruir da imágenes con otro
    # identificador, y no serían «lo mismo». Lo único que pudo cambiar es el entorno.
    ya=$(manifiesto vigente configuracion) || falla "No se pudo leer la configuración de lo publicado. No se tocó nada."
    ya="$PUBLICACIONES/$ya"
    variables=$(manifiesto variables vigente) || falla "No se pudo leer con qué imágenes corre lo publicado. No se tocó nada."
    # shellcheck disable=SC2086  # una palabra por variable
    resolver $variables >"$privado/igual.json" || falla "La configuración no se pudo resolver: revisa el .env. No se tocó nada."
    for servicio in db migracion web respaldo proxy; do
      codigo=0
      misma_huella "$privado/igual.json" "$ya" "$servicio" || codigo=$?
      [ "$codigo" -ne 2 ] || falla "No se pudo comparar la configuración de ahora con la publicada. No se tocó nada."
      [ "$codigo" -eq 0 ] \
        || falla "Esta versión ya está publicada ($vigente), pero el entorno cambió desde entonces. Eso no se publica: se levanta, que comprueba antes de tocar: sh operacion/levantar.sh"
    done
    echo "Esta versión ya es la que está publicada ($vigente), con la misma configuración. No hay nada que hacer."
    return 0
  fi
  pub=$(manifiesto identificador "$commit") || falla "No se pudo dar nombre a la publicación. No se tocó nada."

  paso "1. Preparar la versión $(printf '%s' "$commit" | cut -c1-12), sin tocar lo que corre"
  construir
  # shellcheck disable=SC2086  # una palabra por variable
  resolver $variables "VERSION=$pub" >"$privado/conjunto.json" || falla "La configuración no se pudo resolver: revisa el .env. No se tocó nada."
  conf="$privado/conjunto.json"
  docker compose -f "$conf" run --rm --no-deps -T comprobacion entorno </dev/null || falla "El entorno no pasa la comprobación. No se tocó nada."
  # ENSAYO=1 lo pone solo el ensayo en una máquina de desarrollo, donde ni el proxy sale a la red.
  # shellcheck disable=SC2094  # el mismo archivo se lee dos veces —como configuración y como lo que se revisa—; no se escribe
  docker compose -f "$conf" run --rm --no-deps -T comprobacion red ${ENSAYO:+--local} <"$conf" || falla "La configuración publica de más a la red. No se tocó nada."

  if [ -z "$vigente" ]; then
    # La primera publicación de la instalación. No hay nada que cerrar ni que respaldar.
    arrancar "$conf" db || falla "La base de datos no levantó. No se publicó nada."
    estado=$(estado_de_la_base "$conf")
    [ "$estado" = '{"base":"no hay"}' ] || falla "Esta instalación no tiene ninguna publicación, y su base no está vacía (o no contesta): publicar no la adopta. Si es una instalación de antes de que se publicara así, ver la guía. No se publicó nada."
  else
    conf_ant=$(manifiesto vigente configuracion) || falla "No se pudo leer la configuración de lo publicado. No se tocó nada."
    conf_ant="$PUBLICACIONES/$conf_ant"
    estado=$(estado_de_la_base "$conf")
    [ "$estado" != no-contesta ] || falla "La base no contesta. No se tocó nada."
    corre "$vigente" candidato "$conf_ant" db web proxy respaldo \
      || falla "Lo que corre no es lo que dejó la última publicación ($vigente). No se publica encima: primero se averigua por qué. No se tocó nada."
    codigo=0
    misma_huella "$conf" "$conf_ant" db || codigo=$?
    [ "$codigo" -ne 2 ] || falla "No se pudo comparar el servidor de la base de datos de esta versión con el que corre. No se tocó nada."
    [ "$codigo" -eq 0 ] \
      || falla "Esta versión cambia el servidor de la base de datos (su imagen o su configuración). Eso no se hace publicando: tiene su propio procedimiento. No se tocó nada."
    # El migrador de esta versión revisa, sin aplicar: lo ya aplicado está aquí con el mismo contenido, y lo pendiente va después.
    docker compose -f "$conf" run --rm --no-deps -T migracion node db/migrar.ts --revisar </dev/null \
      || falla "El migrador de esta versión no puede con la base que hay. No se tocó nada."
  fi
  punto preparar:despues

  paso "2. El manifiesto de la publicación $pub"
  # shellcheck disable=SC2046  # una opción, o ninguna
  manifiesto_con_entrada crear "$pub" "$commit" "$estado" $(opcion_del_ensayo) <"$conf" || falla "No se pudo escribir el manifiesto de la publicación. No se tocó nada."
  # De aquí en adelante manda lo guardado, no lo que se resolvió en la carpeta de trabajo.
  conf="$PUBLICACIONES/$pub/conjunto.json"
  punto manifiesto:despues

  if [ -n "$conf_ant" ]; then
    cerrar_y_drenar
    respaldar_antes
  fi
  migrar_la_base
  levantar_cerrada candidato "$conf" "$pub"
  abrir_la_operacion candidato "$conf"
  terminar candidato "$conf" "$pub" publicada
  printf '\nPublicada: %s\n' "$pub"
}

# ── recuperar ──────────────────────────────────────────────────────────────

# Se decidió abrir o ya abrió: se termina hacia adelante, con ese conjunto. Nunca se ofrece el respaldo previo.
hacia_adelante() {
  version=$3
  manifiesto marcar "$pub" seDecidioAbrir || sin_cerrar "No se pudo anotar la decisión de abrir."
  esta_abierta=$(en_la_base "$conf" estado abierta) || sin_cerrar "No se pudo preguntar a la base si la operación ya abrió."
  la_abrio=$(en_la_base "$conf" estado publicacion) || sin_cerrar "No se pudo preguntar a la base qué publicación la cerró o la abrió."
  if [ "$esta_abierta" = true ] && [ "$la_abrio" = "$pub" ]; then
    echo "La operación ya había abierto con esta publicación: se termina lo que faltaba."
    arrancar "$2" web || sin_cerrar "La aplicación no está corriendo, y la operación ya abrió."
    arrancar "$2" proxy || sin_cerrar "El proxy no está corriendo, y la operación ya abrió."
    manifiesto marcar "$pub" abierta || sin_cerrar "La operación ya abrió, y no se pudo anotar en el manifiesto."
  else
    levantar_cerrada "$1" "$2" "$version"
    abrir_la_operacion "$1" "$2"
  fi
  if [ "$1" = candidato ]; then terminar "$1" "$2" "$version" publicada; else terminar "$1" "$2" "$version" "no publicada"; fi
}

# Ni se decidió abrir ni empezó la migración: se restablece el conjunto anterior. La base no se tocó.
volver_al_anterior() {
  manifiesto marcar "$pub" noSePublica || sin_cerrar "No se pudo anotar que esta publicación no se publica."
  punto desistir:despues
  if [ -z "$conf_ant" ]; then
    # Era la primera: no hay versión anterior que restablecer, ni base con historia.
    manifiesto cerrar "$pub" "no publicada" || sin_cerrar "No se pudo cerrar el manifiesto."
    printf '\nNo se publicó: %s. No había versión anterior: la instalación queda como estaba, sin nada publicado.\n' "$pub"
    return 0
  fi
  version=$(manifiesto dato "$pub" anterior.publicacion) || sin_cerrar "No se pudo leer el manifiesto."
  [ -n "$version" ] || sin_cerrar "El manifiesto no dice cuál es la versión anterior."
  # El negocio pudo seguir atendiendo —murió antes de cerrar—: primero se cierra y se drena.
  cerrar_y_drenar
  levantar_cerrada anterior "$conf_ant" "$version"
  abrir_la_operacion anterior "$conf_ant"
  terminar anterior "$conf_ant" "$version" "no publicada"
  printf '\nNo se publicó: %s. Quedó atendiendo la versión anterior (%s). La base no se tocó.\n' "$pub" "$version"
}

recuperar() {
  pub=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones: eso no significa que no haya nada pendiente. No se sigue."
  if [ -z "$pub" ]; then
    echo "No hay ninguna publicación sin cerrar: nada que recuperar."
    return 0
  fi
  de_commit=$(manifiesto dato "$pub" commit) || falla "No se pudo leer el manifiesto de la publicación $pub. No se tocó nada."
  [ "$de_commit" = "$(commit_actual)" ] \
    || falla "La publicación sin cerrar ($pub) es del commit $de_commit, y esta carpeta está en otro. Ponla en ese commit (git checkout $de_commit) y vuelve a correr --recuperar."
  conf="$PUBLICACIONES/$pub/conjunto.json"
  anterior=$(manifiesto dato "$pub" anterior.configuracion) || falla "No se pudo leer el manifiesto de la publicación $pub. No se tocó nada."
  [ -z "$anterior" ] || conf_ant="$PUBLICACIONES/$anterior"
  # Una instalación desde un respaldo que quedó a medias se retoma por su propio camino —necesita la
  # llave—, salvo que ya se hubiera decidido abrir: eso se termina aquí, como cualquier otra.
  decidida=$(manifiesto dato "$pub" marcas.seDecidioAbrir) || falla "No se pudo leer el manifiesto de la publicación $pub. No se tocó nada."
  if [ -f "$PUBLICACIONES/$pub/desde-respaldo" ] && [ -z "$decidida" ]; then
    falla "La publicación sin cerrar ($pub) es una instalación desde un respaldo que quedó a medias. Se retoma con la llave: sh operacion/publicar.sh --desde-respaldo < llave-privada.txt"
  fi
  echo "Se retoma la publicación $pub."

  # Que aquel guion haya muerto no dice nada de lo que dejó corriendo: primero se espera a eso.
  esperar_al_migrador "$conf"
  esperar_lo_que_quedo "$conf"
  estado=$(estado_de_la_base "$conf")
  codigo=0
  decision=$(manifiesto decidir "$pub" "$estado") || codigo=$?
  if [ "$codigo" -ne 0 ]; then
    printf '\nNo se recupera sola: hace falta que una persona vea qué pasó. No se tocó nada.\n' >&2
    exit 1
  fi
  case "$decision" in
    "1 candidato")
      paso "Ya se había decidido abrir: se termina hacia adelante"
      hacia_adelante candidato "$conf" "$pub"
      printf '\nPublicada: %s\n' "$pub"
      ;;
    "1 anterior")
      paso "Ya se había decidido volver a abrir la versión anterior: se termina"
      version=$(manifiesto dato "$pub" anterior.publicacion) || sin_cerrar "No se pudo leer el manifiesto."
      [ -n "$version" ] || sin_cerrar "El manifiesto no dice cuál es la versión anterior."
      hacia_adelante anterior "$conf_ant" "$version"
      printf '\nNo se publicó: %s. Quedó atendiendo la versión anterior.\n' "$pub"
      ;;
    2)
      if [ -z "$conf_ant" ]; then
        # La primera publicación: no hay respaldo previo ni versión anterior a los que volver, ni
        # datos que cuidar —nunca abrió—. Repetir la migración aplica lo que falte; y de ahí se sigue.
        paso "Es la primera publicación y nunca abrió: se repite la migración, y se sigue"
        migrar_la_base
        levantar_cerrada candidato "$conf" "$pub"
        abrir_la_operacion candidato "$conf"
        terminar candidato "$conf" "$pub" publicada
        printf '\nPublicada: %s\n' "$pub"
        return 0
      fi
      cat >&2 <<FIN

La migración de la publicación $pub empezó, y no llegó a decidirse abrir.
El negocio se queda cerrado. La migración no se repite a ciegas ni se vuelve sola: la base ya pudo cambiar.
La salida es volver al respaldo que se tomó antes de migrar: $(manifiesto dato "$pub" respaldo.nombre)
  Lo hace el dueño, con su llave: sh operacion/volver.sh < llave-privada.txt
  El negocio estuvo cerrado desde antes de tomarlo: trae todo lo que se capturó. La base que falló
  no se borra. Después, la versión corregida se publica como cualquier otra.
FIN
      exit 2
      ;;
    3)
      paso "No se había migrado ni decidido abrir: se restablece la versión anterior"
      volver_al_anterior
      ;;
    *) falla "No se entendió qué hacer con la publicación $pub («${decision}»). No se tocó nada." ;;
  esac
}

# ── instalar desde un respaldo ─────────────────────────────────────────────

instalar() {
  retomar="sh operacion/publicar.sh --desde-respaldo < llave-privada.txt"
  # La llave privada entra por la entrada estándar, desde un archivo. No se teclea ni se pasa como argumento.
  [ ! -t 0 ] || falla "La llave privada entra por la entrada estándar, desde un archivo: sh operacion/publicar.sh --desde-respaldo < llave-privada.txt"
  # Se queda en la memoria de este guion, y de ahí pasa a quien restaura: no se copia a ningún archivo.
  llave=$(cat) || falla "No se pudo leer la llave privada. No se tocó nada."
  [ -n "$llave" ] || falla "No llegó la llave privada: sh operacion/publicar.sh --desde-respaldo < llave-privada.txt. No se tocó nada."
  commit=$(commit_actual)
  exigir_carpeta_limpia "lo que se instala es un commit, entero"
  vigente=$(manifiesto vigente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
  [ -z "$vigente" ] || falla "Esta instalación ya tiene publicaciones ($vigente): instalar desde un respaldo es para una máquina donde todavía no hay nada. No se tocó nada."
  pendiente=$(manifiesto pendiente) || falla "No se pudo leer la carpeta de publicaciones. No se tocó nada."
  proyecto=$(nombre_del_proyecto) || falla "No se pudo saber el nombre del proyecto de Compose de esta instalación. No se tocó nada."

  if [ -n "$pendiente" ]; then
    # Una instalación que quedó a medias: se sigue desde donde quedó.
    [ -f "$PUBLICACIONES/$pendiente/desde-respaldo" ] \
      || falla "Hay una publicación sin cerrar ($pendiente) que no es una instalación desde un respaldo. Primero se recupera: sh operacion/publicar.sh --recuperar. No se tocó nada."
    pub=$pendiente
    de_commit=$(manifiesto dato "$pub" commit) || falla "No se pudo leer el manifiesto de la instalación a medias ($pub). No se tocó nada."
    [ "$de_commit" = "$commit" ] || falla "La instalación a medias ($pub) es de otro commit que el de esta carpeta. No se tocó nada."
    respaldo=$(cut -d' ' -f1 "$PUBLICACIONES/$pub/desde-respaldo") || falla "No se pudo leer de qué respaldo era la instalación a medias ($pub). No se tocó nada."
    [ -n "$respaldo" ] || falla "No se pudo leer de qué respaldo era la instalación a medias ($pub). No se tocó nada."
    conf="$PUBLICACIONES/$pub/conjunto.json"
    echo "Se retoma la instalación desde el respaldo $respaldo (publicación $pub)."
    # Que aquel guion haya muerto no dice nada de lo que dejó corriendo: una restauración, por ejemplo.
    esperar_lo_que_quedo "$conf"
    decidida=$(manifiesto dato "$pub" marcas.seDecidioAbrir) || falla "No se pudo leer el manifiesto de la instalación a medias ($pub). No se tocó nada."
    if [ -n "$decidida" ]; then
      paso "Ya se había decidido abrir: se termina hacia adelante"
      hacia_adelante candidato "$conf" "$pub"
      printf '\nInstalada desde el respaldo %s. Publicada: %s\n' "$respaldo" "$pub"
      return 0
    fi
  else
    paso "1. Preparar: el respaldo, y la versión que corría cuando se tomó"
    # Todavía no hay conjunto con qué hablarle al almacenamiento: se usa la imagen de herramientas
    # de este commit en el lugar de todas. De aquí no se levanta ningún servicio.
    resolver "IMAGEN_DB=$HERRAMIENTAS" "IMAGEN_ADMIN=$HERRAMIENTAS" "IMAGEN_WEB=$HERRAMIENTAS" "IMAGEN_RESPALDO=$HERRAMIENTAS" "IMAGEN_PROXY=$HERRAMIENTAS" VERSION=arranque \
      >"$privado/arranque.json" || falla "La configuración no se pudo resolver: revisa el .env. No se tocó nada."
    docker compose -f "$privado/arranque.json" run --rm --no-deps -T comprobacion entorno </dev/null || falla "El entorno no pasa la comprobación. No se tocó nada."
    # Lo que el respaldo dice de sí —qué publicación corría, de qué commit— solo se cree con el sello
    # de esta llave: por eso la llave entra también aquí, por la entrada estándar y por ningún otro lado.
    # shellcheck disable=SC2086  # el nombre del respaldo, o nada
    de=$(printf '%s\n' "$llave" | docker compose -f "$privado/arranque.json" run --rm --no-deps -T --entrypoint node comprobacion operacion/version-del-respaldo.ts $respaldo_pedido) \
      || falla "No se pudo saber qué versión tomó el respaldo: no está, o no lleva el sello de esta llave. No se tocó nada."
    respaldo=${de%% *}
    resto=${de#* }
    de_pub=${resto%% *}
    de_commit=${resto##* }
    [ -n "$respaldo" ] && [ -n "$de_pub" ] && [ -n "$de_commit" ] && [ "$de_pub" != "$de_commit" ] || falla "No se entendió qué versión tomó el respaldo. No se tocó nada."
    echo "El respaldo: $respaldo. Lo tomó la publicación $de_pub, del commit $de_commit."
    # La versión se vuelve a armar de su commit, que es lo que se confía: lo que haya en el
    # almacenamiento no decide qué corre en esta máquina.
    case "$commit" in
      "$de_commit"*) ;;
      *) falla "Ese respaldo lo tomó la versión del commit $de_commit, y esta carpeta está en otro. Ponla en ese commit (git checkout $de_commit) y vuelve a correr esto. No se tocó nada." ;;
    esac
    pub=$(manifiesto identificador "$commit") || falla "No se pudo dar nombre a la publicación. No se tocó nada."
    echo "Construyendo las imágenes de esa versión, de su commit…"
    construir
    # shellcheck disable=SC2086  # una palabra por variable
    resolver $variables "VERSION=$pub" >"$privado/conjunto.json" || falla "La configuración no se pudo resolver: revisa el .env. No se tocó nada."
    conf="$privado/conjunto.json"
    # shellcheck disable=SC2094  # el mismo archivo se lee dos veces; no se escribe
    docker compose -f "$conf" run --rm --no-deps -T comprobacion red ${ENSAYO:+--local} <"$conf" || falla "La configuración publica de más a la red. No se tocó nada."
    arrancar "$conf" db || falla "La base de datos no levantó. No se instaló nada."
    estado=$(estado_de_la_base "$conf")
    [ "$estado" = '{"base":"no hay"}' ] || falla "En esta máquina ya hay una base con datos (o no contesta): instalar desde un respaldo es para una máquina donde todavía no hay nada. No se instaló nada."
    punto preparar:despues

    paso "2. El manifiesto de la publicación $pub"
    # shellcheck disable=SC2046  # una opción, o ninguna
    manifiesto_con_entrada crear "$pub" "$commit" "$estado" $(opcion_del_ensayo) <"$conf" || falla "No se pudo escribir el manifiesto de la publicación. No se instaló nada."
    printf '%s %s\n' "$respaldo" "$de_pub" >"$PUBLICACIONES/$pub/desde-respaldo" || sin_cerrar "No se pudo anotar de qué respaldo se instala."
    conf="$PUBLICACIONES/$pub/conjunto.json"
    punto manifiesto:despues
  fi

  paso "3. Restaurar el respaldo"
  estado=$(estado_de_la_base "$conf")
  [ "$estado" != no-contesta ] || sin_cerrar "La base de datos no contesta."
  if [ "$estado" = '{"base":"no hay"}' ]; then
    manifiesto marcar "$pub" empezoLaMigracion || sin_cerrar "No se pudo anotar que empieza la restauración. No se restauró."
    punto restaurar:antes
    # En una máquina nueva el servidor nace con la base ya creada, vacía; y nunca se restaura encima
    # de una base que existe. Se quita esa —solo si de verdad está vacía— para dejar libre su nombre.
    en_el_servidor "$conf" quitar-vacia || sin_cerrar "La base de esta máquina no se pudo dejar libre para restaurar."
    # Con el programa de esa misma versión. La llave entra por su entrada estándar, y por ningún otro lado.
    printf '%s\n' "$llave" | docker compose -f "$conf" run --rm --no-deps -T --entrypoint node comprobacion operacion/restaurar.ts \
      "--remoto=$respaldo" "--nota=Instalación desde un respaldo, publicación $pub" \
      || sin_cerrar "No se pudo restaurar el respaldo. No quedó ninguna base a medias."
    punto restaurar:despues
  fi
  marca=$(en_la_base "$conf" estado marca) || sin_cerrar "La base restaurada no dijo su marca."
  [ -n "$marca" ] || sin_cerrar "La base restaurada no dijo su marca."
  manifiesto base "$pub" "$marca" || sin_cerrar "No se pudo anotar la marca de la base restaurada."
  # La operación vuelve como estaba en el respaldo, y aquí tiene que quedar cerrada por ESTA
  # publicación. Si venía cerrada por otra —el respaldo se tomó a media publicación—, ese cierre se
  # termina primero: con la aplicación sin levantar, no entra nadie entre una cosa y la otra.
  esta_abierta=$(en_la_base "$conf" estado abierta) || sin_cerrar "No se pudo preguntar a la base restaurada si la operación está abierta."
  if [ "$esta_abierta" = false ]; then
    de_antes=$(en_la_base "$conf" estado publicacion) || sin_cerrar "No se pudo preguntar a la base restaurada qué publicación la cerró."
    [ -n "$de_antes" ] || sin_cerrar "La base restaurada está cerrada y no dice por cuál publicación."
    if [ "$de_antes" != "$pub" ]; then
      en_la_base "$conf" decidir "$de_antes" || sin_cerrar "No se pudo terminar el cierre que traía el respaldo."
      en_la_base "$conf" abrir "$de_antes" "$marca" || sin_cerrar "No se pudo terminar el cierre que traía el respaldo."
    fi
  fi
  en_la_base "$conf" cerrar "$pub" "Instalación desde un respaldo" || sin_cerrar "No se pudo cerrar la operación de la base restaurada."
  punto instalar:cerrada

  levantar_cerrada candidato "$conf" "$pub"
  abrir_la_operacion candidato "$conf"
  terminar candidato "$conf" "$pub" publicada
  printf '\nInstalada desde el respaldo %s. Publicada: %s\n' "$respaldo" "$pub"
  echo "Lo que se asentó después de ese respaldo no está. Quien estaba adentro tiene que volver a entrar."
}

preparar_herramientas
case "$modo" in
  recuperar) recuperar ;;
  "instalar desde un respaldo") instalar ;;
  *) publicar ;;
esac
