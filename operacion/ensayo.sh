#!/bin/sh
# El ensayo de la operación en esta máquina.
#
#   sh operacion/ensayo.sh
#
# Arma una instalación aparte —una copia del proyecto con su propio repositorio, bajo otro nombre
# de proyecto y con un dominio que no existe en internet—, publica en ella esta versión con el
# mismo Compose y los mismos guiones que irán al servidor, y comprueba lo que una instalación de
# verdad debe cumplir: que con el entorno mal puesto nada se publica ni se toca, el orden de
# arranque, que cada servicio corre con la imagen de su manifiesto, que a la red solo sale el
# proxy, que el sitio atiende por HTTPS con un certificado que se valida, que se respalda y el
# vigilante se entera, que una sola operación a la vez toca la instalación, y que el certificado
# sobrevive a recrear el proxy. Al terminar no deja nada.
#
# Publicar una segunda versión, y lo que pasa cuando una publicación se interrumpe, lo prueba
# operacion/ensayo-publicacion.sh.
#
# Solo necesita Docker y Git. Para dejarlo levantado y mirarlo: CONSERVAR=1 sh operacion/ensayo.sh
set -eu
umask 077
cd "$(dirname "$0")/.."

PROYECTO=feruga_ensayo
BD_PUERTO=54339
WEB_PUERTO=3220
PROXY_HTTP=8480
PROXY_HTTPS=8443
. operacion/ensayo/comun.sh

preparar_la_instalacion
preparar_el_arnes

paso "Con el entorno mal puesto no se publica nada: lo dice antes de tocar"
if COMPOSE_ENV_FILES="$trabajo/roto.env" sh operacion/publicar.sh >"$trabajo/salida" 2>&1; then falla "publicó con una clave de sesión corta"; fi
grep -q "SESION_CLAVE" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "la comprobación no dijo qué estaba mal"; }
grep -q "No se tocó nada" "$trabajo/salida" || falla "no dijo que no se tocó nada"
[ -z "$(de_la_operacion)" ] || falla "quedó algo creado aunque el entorno no pasó la comprobación"
[ -z "$(find publicaciones -mindepth 1 -type d 2>/dev/null)" ] || falla "quedó escrita una publicación aunque el entorno no pasó la comprobación"
candado_libre || falla "publicar no soltó el candado de la instalación"
# Y a secas, sin los guiones, Compose ni siquiera arranca en operación: le faltan las imágenes, que las pone la publicación.
if docker compose up -d >"$trabajo/salida" 2>&1; then falla "Compose levantó a secas, sin publicación"; fi
grep -q "operacion/compose.sh" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "Compose a secas no dijo qué usar en su lugar"; }
[ -z "$(de_la_operacion)" ] || falla "Compose a secas creó algo"
# Tampoco hay nada que levantar todavía, y se dice cómo se empieza.
if sh operacion/levantar.sh >"$trabajo/salida" 2>&1; then falla "levantó sin que hubiera nada publicado"; fi
grep -q "operacion/publicar.sh" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "levantar no dijo que primero se publica"; }

paso "La primera publicación: base, migración, aplicación y proxy, en ese orden; y abre"
# Un archivo que Git ignora: «git status» no lo enseña, la carpeta pasa por limpia, y está ahí al construir.
echo "export const SOLO_DE_ESTA_MAQUINA = 'no debe publicarse';" > src/servidor/solo-de-esta-maquina.ts
echo "src/servidor/solo-de-esta-maquina.ts" >> .git/info/exclude
[ -z "$(git status --porcelain)" ] || falla "el archivo ignorado se ve en git status: aquí no se probaría nada"
sh operacion/publicar.sh >"$trabajo/publicar.salida" 2>&1 || { cat "$trabajo/publicar.salida" >&2; diagnostico; falla "no se pudo publicar la primera versión"; }
pub=$(sed -n 's/^Publicada: //p' "$trabajo/publicar.salida")
[ -n "$pub" ] || { cat "$trabajo/publicar.salida" >&2; falla "publicar no dijo qué publicó"; }
# Las imágenes salen del commit, no de la carpeta: ese archivo no está en ninguna de las que copian esa parte.
for imagen in "$PROYECTO-admin:$pub" "$PROYECTO-respaldo:$pub" "feruga-herramientas:$(git rev-parse HEAD | cut -c1-12)"; do
  docker run --rm --network none --entrypoint sh "$imagen" -c 'test -e src/servidor/esquema.ts' \
    || falla "no se pudo mirar dentro de la imagen $imagen"
  docker run --rm --network none --entrypoint sh "$imagen" -c 'test ! -e src/servidor/solo-de-esta-maquina.ts' \
    || falla "la imagen $imagen trae un archivo que no está en el commit"
done
rm src/servidor/solo-de-esta-maquina.ts
candado_libre || falla "publicar no soltó el candado de la instalación"
# Lo publicado es lo vigente, y no quedó nada pendiente. Compose, sobre lo publicado, lo ve corriendo.
[ "$(operacion ps --status running --services | sort | tr '\n' ' ')" = "almacen-ensayo autoridad db proxy respaldo vigia web " ] \
  || { operacion ps -a >&2; falla "no corre lo que debía correr después de publicar"; }
# El orden lo dicen las horas: la base antes que la última migración; la aplicación, cuando ya
# estaba migrada; el proxy, después de la aplicación.
nodo -e '
  const [base, migro, web, proxy] = process.argv.slice(1).map((t) => Date.parse(t));
  const orden = base <= migro && migro <= web && web <= proxy;
  if (!orden || [base, migro, web, proxy].some(Number.isNaN)) process.exit(1);
' "$(estado db StartedAt)" "$(enlabase "SELECT to_char(max(aplicada_en) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM migracion")" "$(estado web StartedAt)" "$(estado proxy StartedAt)" \
  || falla "los servicios no arrancaron en orden"
# Cada servicio corre con una imagen nombrada por su identificador, no por una etiqueta que puede moverse.
for servicio in db web proxy respaldo; do
  imagen=$(docker inspect -f '{{.Config.Image}}' "$(operacion ps -q "$servicio")")
  case "$imagen" in sha256:*) ;; *) falla "$servicio corre con «${imagen}», y debía ir por el identificador de su imagen";; esac
done
# El proxy lleva su configuración adentro: no monta nada de la carpeta del proyecto.
docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$(operacion ps -q proxy)" | grep -q "/etc/caddy/Caddyfile" \
  && falla "el proxy sigue montando su configuración desde la carpeta del proyecto"
# En esta máquina, ni el proxy sale a la red. Se mira cada contenedor: cada puerto que publica, en
# qué dirección de la máquina, y que ninguno use la red de la máquina.
# shellcheck disable=SC2046,SC2016  # una lista de identificadores, uno por palabra; y lo de entre comillas es JavaScript
docker inspect $(operacion ps -q) | nodo -e '
  let texto = "";
  process.stdin.on("data", (t) => (texto += t)).on("end", () => {
    const fuera = [];
    for (const c of JSON.parse(texto)) {
      if (c.HostConfig.NetworkMode === "host") fuera.push(`${c.Name} usa la red de la máquina`);
      for (const [puerto, donde] of Object.entries(c.NetworkSettings.Ports ?? {})) {
        for (const d of donde ?? []) if (!(d.HostIp.startsWith("127.") || d.HostIp === "::1")) fuera.push(`${c.Name} publica ${puerto} en ${d.HostIp || "todas las direcciones"}`);
      }
    }
    if (fuera.length > 0) { console.error(fuera.join("\n")); process.exit(1); }
  });
' || falla "algo del ensayo quedó publicado a la red"

paso "El sitio atiende por HTTPS, y solo con un certificado en el que se confía"
atiende >/dev/null 2>&1 || falla "el sitio no atiende por HTTPS"
if operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS= comprobacion https proxy >/dev/null 2>&1; then
  falla "se dio por bueno un certificado de una autoridad en la que no se confía"
fi

paso "El recorrido en el navegador, por HTTPS"
arnes --profile ensayo run --rm recorrido_operacion || falla "el recorrido por HTTPS no pasó"

paso "En mantenimiento: la operación se cierra y se abre en la base, sin reiniciar nada"
# El comprobador pregunta por HTTPS, a través del proxy, y distingue «lista» de «abierta».
dice() { operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS comprobacion https proxy "$@" >"$trabajo/salida" 2>&1; }
dice --abierta || { cat "$trabajo/salida" >&2; falla "recién publicado, el sitio no dice que la operación está abierta"; }
if dice --cerrada; then falla "se dio por cerrada una operación abierta"; fi
# Sabe qué versión contesta —la publicación— y sobre qué base: su marca. A otro que no tenga el entorno de esta instalación no se lo dice.
marca=$(enlabase "SELECT id FROM vida")
dice --abierta "--base=$marca" "--version=$pub" || { cat "$trabajo/salida" >&2; falla "el comprobador no reconoció la versión o la base con que contesta el sitio"; }
if dice "--base=00000000-0000-4000-8000-000000000000"; then falla "se dio por buena otra base"; fi
if dice "--version=20200101T000000Z-000000000000-000000"; then falla "se dio por buena otra versión"; fi
if operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS -e SESION_CLAVE=otra-clave-que-no-es-la-de-esta-instalacion-0123 comprobacion https proxy "--base=$marca" >/dev/null 2>&1; then
  falla "el sitio le dijo su base a quien no tiene la clave de la instalación"
fi
# Abierta, un intento de escribir no se rechaza «por mantenimiento»: el comprobador lo distingue.
if dice --rechaza-escribir; then falla "con la operación abierta se dio por rechazado, por mantenimiento, un intento de escribir"; fi
antes=$(corriendo)
enlabase "SELECT cerrar_operacion('Ensayo de mantenimiento', 'ensayo-de-mantenimiento')" >/dev/null
dice --cerrada "--base=$marca" --rechaza-escribir || { cat "$trabajo/salida" >&2; falla "cerrada en la base, el sitio no lo dice o no rechaza escribir"; }
if dice --abierta; then falla "el sitio dice abierta una operación cerrada"; fi
# Cerrada, la aplicación sigue lista: su contenedor está sano y nadie se reinició.
[ "$(estado web Health.Status)" = healthy ] || falla "con la operación cerrada, el contenedor de la aplicación dejó de estar sano"
[ "$antes" = "$(corriendo)" ] || falla "cerrar la operación reinició algo"
enlabase "SELECT decidir_abrir('ensayo-de-mantenimiento')" >/dev/null
dice --cerrada || falla "decidir abrir abrió"
enlabase "SELECT abrir_operacion('ensayo-de-mantenimiento', '$marca')" >/dev/null
dice --abierta || { cat "$trabajo/salida" >&2; falla "abierta en la base, el sitio no lo dice"; }
[ "$antes" = "$(corriendo)" ] || falla "abrir la operación reinició algo"

paso "Respaldar, con el vigilante enterado"
# El servicio que respalda a su hora está en pie, y al arrancar sin ningún respaldo ya tomó el primero.
[ "$(estado respaldo Running)" = true ] || falla "el servicio que respalda a su hora no está corriendo"
respaldos() { operacion run --rm --no-deps -T respaldo lista | grep -c '\.dump\.age' || true; }
k=0
until [ "$(respaldos)" -ge 1 ]; do
  k=$((k + 1)); [ "$k" -lt 20 ] || falla "el servicio no tomó el primer respaldo al arrancar"
  sleep 1
done
habia=$(respaldos)
# Uno a mano, como el que se toma antes de publicar una versión.
operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS respaldo ahora > "$trabajo/respaldo.salida" || falla "no se pudo respaldar"
[ "$(respaldos)" -eq $((habia + 1)) ] || falla "el respaldo no aparece en la lista"
# Dice su nombre, para quien necesite volver justo a ese; y los avisos que recibió el vigilante son los de ESTA corrida.
grep -q '^respaldo: .*\.dump\.age$' "$trabajo/respaldo.salida" || falla "el respaldo no dijo su nombre"
grep -q '^vigia: avisado$' "$trabajo/respaldo.salida" || falla "el respaldo no dijo que el vigilante se enteró"
corrida=$(sed -n 's/^Respaldo \([0-9a-f-]*\): hecho y comprobado\.$/\1/p' "$trabajo/respaldo.salida")
[ -n "$corrida" ] || falla "no se supo qué corrida fue"
registro=$(operacion exec -T vigia wget -qO- http://127.0.0.1:8080/registro)
case "$registro" in *"POST /ping/respaldo/start?rid=$corrida"*) ;; *) falla "el vigilante no supo del inicio de este respaldo";; esac
case "$registro" in *"POST /ping/respaldo?rid=$corrida"*) ;; *) falla "el vigilante no supo del final de este respaldo";; esac

paso "El respaldo diario, que se guarda un año: uno por día, en su propio depósito"
# El primer respaldo del día —el que tomó el servicio al arrancar— quedó también en el depósito de
# los diarios; el que se tomó a mano después, no: el día ya tenía el suyo.
# (Cada respaldo sale en un renglón con su tamaño; el renglón final, que repite el nombre del último, no cuenta.)
diarios() { operacion run --rm --no-deps -T respaldo lista --diario | grep -c ' bytes .*\.dump\.age' || true; }
if [ "$(diarios)" -ne 1 ]; then
  operacion logs --no-log-prefix --tail 20 respaldo >&2 || true
  falla "en el depósito de los diarios debía haber un respaldo: el primero del día, y solo ese"
fi
primero=$(operacion run --rm --no-deps -T respaldo lista | grep -o '[^ ]*\.dump\.age' | head -1)
operacion run --rm --no-deps -T respaldo lista --diario | grep -q "$primero" || falla "el diario no es el primer respaldo del día"
# Y avisó por su propia señal, no por la del respaldo de cada hora.
case "$registro" in *"POST /ping/diario?rid="*) ;; *) falla "el vigilante del respaldo diario no recibió su aviso";; esac
case "$registro" in *"POST /ping/diario/fail"*) falla "el respaldo diario avisó de un fallo";; *) ;; esac

paso "Publicar otra vez lo mismo no hace nada, y lo dice"
antes=$(corriendo)
sh operacion/publicar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "publicar lo mismo otra vez falló"; }
grep -q "ya es la que está publicada" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "publicar lo mismo otra vez no dijo que no había nada que hacer"; }
[ "$antes" = "$(corriendo)" ] || falla "publicar lo mismo otra vez reemplazó un servicio"
[ "$(find publicaciones -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 1 ] || falla "publicar lo mismo otra vez escribió otra publicación"
dice --abierta "--version=$pub" || falla "publicar lo mismo otra vez cerró la operación o cambió la versión"

paso "Levantar otra vez sin cambios no reinicia nada"
sh operacion/levantar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "no volvió a levantar sin cambios"; }
[ "$antes" = "$(corriendo)" ] || falla "levantar sin cambios reemplazó un servicio"
grep -q "La operación está abierta" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "levantar no dijo en qué quedó la operación"; }
candado_libre || falla "levantar no soltó el candado de la instalación"
# Con cambios sin commit en la carpeta no se levanta: lo que corre es lo publicado, tal cual.
echo "# un cambio suelto" >> operacion/Caddyfile
if sh operacion/levantar.sh >"$trabajo/salida" 2>&1; then falla "levantó con cambios sin commit en la carpeta"; fi
grep -q "cambios sin commit" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "no dijo que había cambios sin commit"; }
git checkout -q -- operacion/Caddyfile
[ "$antes" = "$(corriendo)" ] || falla "se tocó algo con cambios sin commit en la carpeta"

paso "Una operación a la vez: publicar, levantar y migrar a mano piden el mismo candado"
# Otra operación, viva, lo tiene. Ninguna entra, y dicen cuál es.
sh -c '. operacion/candado.sh; tomar_candado "una publicación de mentira" && exec sleep 600' &
otra=$!
k=0
until [ -s .operacion.candado ]; do
  k=$((k + 1)); [ "$k" -lt 50 ] || falla "la operación de mentira no tomó el candado"
  sleep 0.2
done
for guion in levantar publicar migrar; do
  if sh "operacion/$guion.sh" >"$trabajo/salida" 2>&1; then falla "$guion entró con otra operación en curso"; fi
  grep -q "una publicación de mentira" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "$guion no dijo cuál operación tiene el candado"; }
done
[ "$antes" = "$(corriendo)" ] || falla "se tocó algo con otra operación en curso"
# Mirar sí se puede: no cambia nada, y no pide el candado.
sh operacion/migrar.sh --revisar >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "no dejó revisar las migraciones con otra operación en curso"; }
grep -q "ninguna pendiente" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "revisar no dijo que la base está al día"; }

# Esa operación muere sin soltarlo. No hay nada que destrabar: el sistema ya lo soltó, la siguiente entra, y dice de quién había quedado.
kill -9 "$otra"
wait "$otra" 2>/dev/null || true
otra=""
[ -s .operacion.candado ] || falla "matar la operación borró lo que decía el candado: aquí no se probaría que la siguiente lo dice"
sh operacion/migrar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "no entró después de que murió la operación que tenía el candado"; }
grep -q "había quedado de «una publicación de mentira»" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "entró sin decir de quién había quedado el candado"; }
grep -q "la base ya estaba al día" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "migrar a mano no dijo que la base ya estaba al día"; }
candado_libre || falla "migrar a mano no soltó el candado"

# Las dos a la vez: entra una.
sh operacion/levantar.sh >"$trabajo/a.salida" 2>&1 &
a=$!
sh operacion/migrar.sh >"$trabajo/b.salida" 2>&1 &
b=$!
entraron=0
if wait "$a"; then entraron=$((entraron + 1)); fi
if wait "$b"; then entraron=$((entraron + 1)); fi
[ "$entraron" = 1 ] || { cat "$trabajo/a.salida" "$trabajo/b.salida" >&2; falla "de levantar y migrar a mano a la vez, entraron $entraron"; }
cat "$trabajo/a.salida" "$trabajo/b.salida" | grep -q "Hay otra operación en curso" || falla "a la que no entró no se le dijo por qué"
[ "$antes" = "$(corriendo)" ] || falla "levantar y migrar a mano a la vez cambiaron lo que corre"
candado_libre || falla "quedó el candado tomado"

# Lo que cambia qué corre no pasa por el Compose de lo publicado: eso es de los guiones que comprueban antes de tocar.
for orden in "up -d" "stop web" "down" "restart web"; do
  # shellcheck disable=SC2086  # la orden y sus argumentos
  if operacion $orden >"$trabajo/salida" 2>&1; then falla "el Compose de lo publicado aceptó «${orden}»"; fi
  grep -q "operacion/levantar.sh" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "al rechazar «${orden}» no dijo qué usar en su lugar"; }
done
[ "$antes" = "$(corriendo)" ] || falla "una orden rechazada cambió lo que corre"
# Ni corre nada desacoplado: seguiría corriendo después de soltar el candado (lo encontró Codex al verificar su décima revisión).
for orden in "run -d --rm --no-deps respaldo lista" "run --rm --no-deps -dT respaldo lista" "exec --detach db true"; do
  # shellcheck disable=SC2086  # la orden y sus argumentos
  if operacion $orden >"$trabajo/salida" 2>&1; then falla "el Compose de lo publicado aceptó, desacoplado, «${orden}»"; fi
  grep -q "desacoplado" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "al rechazar «${orden}» no dijo por qué"; }
done
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.oneoff=True")" ] || falla "una orden desacoplada rechazada dejó algo creado"
candado_libre || falla "una orden rechazada dejó el candado tomado"
# Y lo que corre algo suelto —la consola, un respaldo a mano— pide el candado: con otra operación en curso, no entra.
sh -c '. operacion/candado.sh; tomar_candado "otra de mentira" && exec sleep 600' &
otra=$!
k=0
until [ -s .operacion.candado ]; do
  k=$((k + 1)); [ "$k" -lt 50 ] || falla "la segunda operación de mentira no tomó el candado"
  sleep 0.2
done
if operacion run --rm --no-deps -T respaldo lista >"$trabajo/salida" 2>&1; then falla "corrió algo suelto con otra operación en curso"; fi
grep -q "otra de mentira" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "al no correr no dijo cuál operación tiene el candado"; }
operacion ps >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "consultar no debe pedir el candado"; }
kill -9 "$otra"
wait "$otra" 2>/dev/null || true
otra=""

# Si quedó el candado de una versión anterior de estos guiones —una carpeta—, se dice, y no se entra.
rm -f .operacion.candado
mkdir .operacion.candado
if sh operacion/levantar.sh >"$trabajo/salida" 2>&1; then falla "levantó con el candado de antes, que era una carpeta"; fi
grep -q "bórrala" "$trabajo/salida" || falla "no dijo qué hacer con el candado de antes"
rmdir .operacion.candado

# Y a secas, sin pasar por un guion que tenga el candado, el migrador no corre en operación.
if operacion run --rm --no-deps -T migracion >"$trabajo/salida" 2>&1; then falla "el migrador corrió a secas, sin el candado de la instalación"; fi
grep -q "candado de la instalación" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "el migrador a secas no dijo por qué no corre"; }
[ "$antes" = "$(corriendo)" ] || falla "se tocó algo al probar el candado"

paso "Cambiar el entorno y levantar: entra lo nuevo, ya comprobado, y solo donde cambió"
base_antes=$(operacion ps -q db)
web_antes=$(operacion ps -q web)
cp "$trabajo/.env" "$trabajo/bueno.env"
poner NEGOCIO_NOMBRE "Recicladora del Ensayo"
sh operacion/levantar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; diagnostico; falla "no levantó con el entorno cambiado"; }
[ "$base_antes" = "$(operacion ps -q db)" ] || falla "cambiar el nombre del negocio reinició la base"
[ "$web_antes" != "$(operacion ps -q web)" ] || falla "la aplicación no tomó el entorno nuevo"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(operacion ps -q web)" | grep -q "^NEGOCIO_NOMBRE=Recicladora del Ensayo$" || falla "la aplicación no corre con el entorno nuevo"
dice --abierta "--version=$pub" "--base=$marca" || { cat "$trabajo/salida" >&2; falla "después de cambiar el entorno el sitio no contesta como debe"; }
# Y publicar ahora «lo mismo» tampoco hace nada: la configuración guardada es la que se acaba de levantar.
sh operacion/publicar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "publicar lo mismo, después de levantar con otro entorno, falló"; }
grep -q "ya es la que está publicada" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "después de levantar con otro entorno, publicar creyó que había algo nuevo"; }

paso "Si el entorno cambia a media operación, se levanta lo que se comprobó"
antes=$(corriendo)
# Un intermediario con el nombre de docker: justo antes del «up», alguien cambia el archivo de entorno.
intermediario="$trabajo/intermediario"
mkdir "$intermediario"
verdadero=$(command -v docker)
cat > "$intermediario/docker" <<FIN
#!/bin/sh
case " \$* " in *" up "*)
  if [ -e "$intermediario/cambiar" ]; then
    rm "$intermediario/cambiar"
    cp "$trabajo/.env" "$trabajo/bueno.env"
    cp "$trabajo/roto.env" "$trabajo/.env"
  fi;;
esac
exec "$verdadero" "\$@"
FIN
chmod +x "$intermediario/docker"
: > "$intermediario/cambiar"
PATH="$intermediario:$PATH" sh operacion/levantar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; falla "no levantó lo que había comprobado"; }
[ ! -e "$intermediario/cambiar" ] || falla "la barrera no llegó a dispararse: el caso no se probó"
cp "$trabajo/bueno.env" "$trabajo/.env"
[ "$antes" = "$(corriendo)" ] || falla "se reemplazó un servicio con el entorno que cambió después de comprobar"
atiende >/dev/null 2>&1 || falla "el sitio dejó de atender por un cambio de entorno a media operación"

paso "Con servicios ya corriendo, un entorno mal puesto no toca nada"
antes=$(corriendo)
if COMPOSE_ENV_FILES="$trabajo/roto.env" sh operacion/levantar.sh >"$trabajo/salida" 2>&1; then falla "levantó con el entorno mal puesto"; fi
[ "$antes" = "$(corriendo)" ] || falla "se reemplazó un servicio aunque el entorno no pasó la comprobación"
atiende >/dev/null 2>&1 || falla "el sitio dejó de atender por un intento de levantar con el entorno mal puesto"

paso "A secas, «docker compose up» no quita la aplicación que atiende: en operación ni arranca"
# Antes, Compose reemplazaba lo que había cambiado antes de comprobar nada, y el sitio se caía.
if COMPOSE_ENV_FILES="$trabajo/roto.env" docker compose up -d >"$trabajo/salida" 2>&1; then falla "Compose levantó a secas con el entorno mal puesto"; fi
[ "$antes" = "$(corriendo)" ] || falla "Compose a secas reemplazó un servicio"
atiende >/dev/null 2>&1 || falla "el sitio dejó de atender por un «docker compose up» a secas"

paso "Saltándose la comprobación, la aplicación arranca pero no atiende"
# A propósito y con las imágenes de lo publicado a mano: quien se salta los guiones, y con el entorno mal puesto.
# shellcheck disable=SC2046  # una palabra por variable
env $(variables_de_lo_publicado) COMPOSE_ENV_FILES="$trabajo/roto.env" docker compose up -d --no-deps web >/dev/null 2>&1 || true
k=0
until atiende 2>&1 | grep -q "contestó 503"; do
  k=$((k + 1)); [ "$k" -lt 30 ] || falla "la aplicación atendió con el entorno mal puesto, o no dijo 503"
  sleep 1
done
sh operacion/levantar.sh >"$trabajo/salida" 2>&1 || { cat "$trabajo/salida" >&2; diagnostico; falla "no volvió a levantar con el entorno bueno"; }
atiende >/dev/null 2>&1 || falla "después de levantar con el entorno bueno el sitio no atiende"

paso "El certificado sobrevive a recrear el proxy"
huella() { operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS comprobacion certificado proxy | cut -d' ' -f1; }
anterior=$(huella)
[ -n "$anterior" ] || falla "no se pudo leer el certificado"
por_fuera up -d --force-recreate --no-deps proxy >/dev/null 2>&1
esperar_que_atienda "el proxy no volvió"
[ "$anterior" = "$(huella)" ] || falla "al recrear el proxy se emitió otro certificado: el volumen no lo conservó"

printf '\nEl ensayo pasó.\n'
