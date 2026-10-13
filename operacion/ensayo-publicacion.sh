#!/bin/sh
# El ensayo de publicación en esta máquina.
#
#   sh operacion/ensayo-publicacion.sh
#
# Arma una instalación aparte (como operacion/ensayo.sh), publica en ella una primera versión, y
# después publica otras, interrumpiendo el guion de verdad —se le mata, sin que limpie— antes y
# después del efecto de cada paso. Comprueba lo que publicar promete:
#   · antes de cerrar no se altera lo que atiende;
#   · desde que se cierra hasta que se abre, el negocio está cerrado, pase lo que pase;
#   · desde que se decide abrir no se retrocede, y una apertura confirmada sigue atendiendo;
#   · una publicación que quedó sin cerrar detiene todo lo demás hasta que se recupera, y recuperar
#     hace lo único que toca en cada caso —o se detiene, si no puede saber cuál es—;
#   · de una que empezó a migrar y no decidió abrir se sale volviendo al respaldo que se tomó antes
#     de migrar: la base que falló se aparta, la versión anterior queda cerrada sobre la base
#     restaurada, y abrir es un paso expreso.
#   · si se pierde la máquina, en otra —sin nada local— se instala desde un respaldo, con la
#     versión que corría construida de su commit: del almacenamiento no viene nada que se ejecute.
#
# Al terminar no deja nada. Tarda: cada publicación construye, cierra, respalda, migra y comprueba.
# Solo necesita Docker y Git. Para dejarlo levantado y mirarlo: CONSERVAR=1 sh operacion/ensayo-publicacion.sh
set -eu
umask 077
cd "$(dirname "$0")/.."

PROYECTO=feruga_publicacion
BD_PUERTO=54349
WEB_PUERTO=3230
PROXY_HTTP=8580
PROXY_HTTPS=8543
. operacion/ensayo/comun.sh

preparar_la_instalacion
preparar_el_arnes

# ── con qué se mira ────────────────────────────────────────────────────────

# publicar [VARIABLE=valor…]: corre el guion y deja lo que dijo en $trabajo/salida. Devuelve su código.
publicar() { env "$@" sh operacion/publicar.sh >"$trabajo/salida" 2>&1; }
recuperar() { env "$@" sh operacion/publicar.sh --recuperar >"$trabajo/salida" 2>&1; }
dicho() { cat "$trabajo/salida" >&2; }
# Lo que dijo el último guion contiene eso.
dijo() { grep -q -- "$1" "$trabajo/salida"; }
# La carpeta de publicaciones, preguntada como la preguntan los guiones.
manifiesto() {
  mkdir -p publicaciones
  docker run --rm -i --network none --user "$(id -u):$(id -g)" -v "$PWD/publicaciones:/publicaciones" \
    --entrypoint node "$HERRAMIENTAS_DEL_ENSAYO" operacion/publicacion.ts /publicaciones "$@" </dev/null
}
# El sitio, por HTTPS y a través del proxy, dice eso de sí mismo.
dice() { por_fuera run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS comprobacion https proxy "$@" >"$trabajo/dice" 2>&1; }
# Lo que el negocio lleva asentado: si la base «no se tocó», esto no cambia. Es la huella de cada
# tabla del negocio —las cuentas con sus renglones, sus pesadas y sus comprobantes; el inventario;
# las jornadas y sus precios; el catálogo; los clientes y sus precios especiales; los envíos; las
# personas y los equipos—, y cuántas cuentas hay. Quedan fuera las que la operación misma mueve:
# la bitácora, el mantenimiento, las migraciones, la marca de la base, las restauraciones y las sesiones.
# (Lo encontró Codex en su décima revisión: antes solo miraba la tabla de cuentas, y una migración
# que alterara un renglón o un movimiento del inventario habría pasado por «no se tocó».)
DEL_NEGOCIO="operacion operacion_linea linea_pesada captura_peso captura_usada impresion movimiento_inventario transformacion conteo jornada reapertura lista_precios precio material familia instrumento sucursal cliente precio_especial envio envio_resultado usuario equipo"
huella_del_negocio() {
  consulta=""
  for tabla in $DEL_NEGOCIO; do
    consulta="$consulta${consulta:+ || }(SELECT md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) FROM $tabla x)"
  done
  printf 'md5(%s)' "$consulta"
}
asentado() { enlabase "SELECT $(huella_del_negocio) || ' ' || (SELECT count(*) FROM operacion)"; }
# El estado de la operación en la base: «abierta|publicación».
en_la_base() { enlabase "SELECT abierta || '|' || coalesce(publicacion, '') FROM mantenimiento"; }
# Una versión nueva: un commit que cambia algo. Con «migracion», trae además una migración, y la
# aplicación la espera; sin ella, no cambia nada de la aplicación y se construye en un momento.
numero=9000
version_nueva() {
  numero=$((numero + 1))
  (
    umask 022
    if [ "${1:-}" = migracion ]; then
      printf 'CREATE TABLE ensayo_%s (id int PRIMARY KEY);\nGRANT SELECT ON ensayo_%s TO feruga_app;\n' "$numero" "$numero" > "db/migraciones/${numero}_ensayo.sql"
      sed -i.sin "s/^export const ESQUEMA_ESPERADO = .*/export const ESQUEMA_ESPERADO = \"${numero}_ensayo.sql\";/" src/servidor/esquema.ts
      rm src/servidor/esquema.ts.sin
    else
      echo "Versión $numero del ensayo." > "operacion/ensayo/version-$numero.txt"
    fi
  )
  confirmar "La versión $numero"
}
# Lo que debe cumplirse cuando la instalación atiende con esa publicación, y nada quedó pendiente.
atiende_con() {
  [ -z "$(manifiesto pendiente)" ] || { dicho; falla "$2: quedó una publicación sin cerrar"; }
  [ "$(manifiesto vigente)" = "$1" ] || { dicho; falla "$2: lo vigente es $(manifiesto vigente), y debía ser $1"; }
  dice --abierta "--version=$1" "--base=$marca" || { dicho; cat "$trabajo/dice" >&2; falla "$2: el sitio no atiende abierto, con $1 y sobre su base"; }
  [ "$(en_la_base | cut -d'|' -f1)" = true ] || falla "$2: la operación no quedó abierta en la base"
  [ "$(estado respaldo Running)" = true ] || falla "$2: el servicio de respaldo no quedó repuesto"
  candado_libre || falla "$2: quedó tomado el candado de la instalación"
}
# Lo que debe cumplirse mientras hay una publicación sin cerrar: nada más entra.
nada_mas_entra() {
  for guion in levantar publicar migrar; do
    if sh "operacion/$guion.sh" >"$trabajo/otra.salida" 2>&1; then cat "$trabajo/otra.salida" >&2; falla "$1: $guion entró con una publicación sin cerrar"; fi
    grep -q "sin cerrar" "$trabajo/otra.salida" || { cat "$trabajo/otra.salida" >&2; falla "$1: $guion no dijo que hay una publicación sin cerrar"; }
  done
}

# ── la primera publicación, y algo asentado ────────────────────────────────

paso "La primera publicación muere con la migración recién anotada, y otra vez recién migrada: recuperar la termina, porque no hay a qué volver ni datos que cuidar"
# Lo señaló Codex en su décima revisión: esa primera publicación quedaba sin salida —recuperar se
# detenía, publicar y levantar la veían pendiente, y volver no tenía respaldo previo—.
if publicar MORIR_EN=migrar:antes; then dicho; falla "se pidió morir en «migrar:antes» y la primera publicación terminó"; fi
dijo "el guion muere en «migrar:antes»" || { dicho; diagnostico; falla "la primera publicación falló antes de llegar a migrar"; }
v1=$(manifiesto pendiente)
[ -n "$v1" ] || falla "la primera publicación murió al empezar a migrar y no quedó pendiente"
nada_mas_entra "la primera, muerta al empezar a migrar"
# Volver no es salida: no hay respaldo previo ni versión anterior. Lo dice, y no toca nada.
if sh operacion/volver.sh <"$trabajo/llave.txt" >"$trabajo/salida" 2>&1; then dicho; falla "volvió al respaldo desde una primera publicación"; fi
dijo "es la primera de la instalación" || { dicho; falla "volver no dijo que es la primera publicación"; }
# Recuperar repite la migración; y si vuelve a morir —ya migrada, antes de anotar cuál es su base—, se retoma igual.
if recuperar MORIR_EN=migrar:despues; then dicho; falla "se pidió que recuperar muriera recién migrada la primera, y terminó"; fi
dijo "el guion muere en «migrar:despues»" || { dicho; diagnostico; falla "recuperar la primera publicación falló antes de migrar"; }
[ "$(enlabase "SELECT count(*) FROM migracion")" -gt 0 ] || falla "la primera publicación murió «recién migrada» sin haber migrado: el caso no se probó"
[ "$(manifiesto pendiente)" = "$v1" ] || falla "la primera publicación, a medio migrar, dejó de estar pendiente"
recuperar || { dicho; diagnostico; falla "no se pudo recuperar la primera publicación, que murió con la migración empezada"; }
dijo "Publicada: $v1" || { dicho; falla "recuperar la primera publicación no dijo que quedó publicada"; }
[ "$(manifiesto dato "$v1" cierre.como)" = publicada ] || falla "la primera publicación, recuperada, no quedó cerrada como publicada"
marca=$(enlabase "SELECT id FROM vida")
[ "$(manifiesto dato "$v1" base.marca)" = "$marca" ] || falla "la primera publicación, recuperada, no anotó cuál es su base"
atiende_con "$v1" "la primera publicación, recuperada"
recuperar || { dicho; falla "recuperar otra vez, sin nada pendiente, falló"; }
dijo "nada que recuperar" || { dicho; falla "recuperar otra vez no dijo que no había nada"; }

paso "Lo asentado se compara entero: un cambio en cualquier tabla del negocio se nota"
# Sin dejar rastro: dentro de una transacción que no se confirma.
antes_del_cambio=$(asentado)
con_cambio=$(enlabase "BEGIN; INSERT INTO cliente (nombre) VALUES ('Uno de prueba del ensayo'); SELECT $(huella_del_negocio); ROLLBACK" | grep -E '^[0-9a-f]{32}$' | head -1)
[ -n "$con_cambio" ] || falla "no se pudo calcular lo asentado con un cambio de prueba"
[ "$con_cambio" != "$(echo "$antes_del_cambio" | cut -d' ' -f1)" ] || falla "dar de alta un cliente no cambia «lo asentado»: no cuidaría nada fuera de las cuentas"
[ "$(asentado)" = "$antes_del_cambio" ] || falla "la prueba de «lo asentado» dejó un cambio en la base"
# Un equipo dado de alta y una compra, por el navegador: hay algo asentado que cuidar.
arnes --profile ensayo run --rm recorrido_operacion >"$trabajo/recorrido" 2>&1 || { cat "$trabajo/recorrido" >&2; falla "el recorrido por HTTPS no pasó"; }
habia=$(asentado)
[ "$(echo "$habia" | cut -d' ' -f2)" -ge 1 ] || falla "el recorrido no dejó nada asentado: el ensayo no cuidaría nada"

# ── publicar una versión con una migración, mirándola a la mitad ───────────

paso "Una versión nueva, con una migración: el camino entero, y cómo se ve a la mitad"
version_nueva migracion
: > "$trabajo/pausa"
publicar PAUSAR_EN=comprobar:despues PAUSA="$trabajo/pausa" &
publicando=$!
k=0
until [ -e "$trabajo/pausa.llego" ]; do
  k=$((k + 1)); [ "$k" -lt 600 ] || { dicho; falla "la publicación nunca llegó a comprobar la versión nueva"; }
  kill -0 "$publicando" 2>/dev/null || { dicho; falla "la publicación terminó antes de llegar a comprobar"; }
  sleep 1
done
v2=$(manifiesto pendiente)
[ -n "$v2" ] || falla "a media publicación no hay ninguna publicación sin cerrar"
# A la mitad: la versión nueva está levantada y comprobada, y el negocio sigue cerrado.
[ "$(en_la_base)" = "false|$v2" ] || falla "a media publicación la operación no está cerrada por esta publicación: $(en_la_base)"
dice --cerrada "--version=$v2" "--base=$marca" --rechaza-escribir || { cat "$trabajo/dice" >&2; falla "a media publicación el sitio no está cerrado con la versión nueva, o deja escribir"; }
[ "$(estado respaldo Running)" != true ] || falla "a media publicación el servicio de respaldo sigue corriendo"
[ "$(enlabase "SELECT to_regclass('ensayo_$numero') IS NOT NULL")" = t ] || falla "a media publicación la migración no está aplicada"
# Tiene anotado su respaldo, por su nombre, y está en el almacenamiento.
respaldo_previo=$(manifiesto dato "$v2" respaldo.nombre)
[ -n "$respaldo_previo" ] || falla "la publicación migró sin tener anotado su respaldo"
por_fuera run --rm --no-deps -T respaldo lista | grep -q "$respaldo_previo" || falla "el respaldo anotado no está en el almacenamiento"
[ "$(manifiesto dato "$v2" respaldo.vigia)" = true ] || falla "no quedó anotado que el vigilante supo del respaldo previo"
# Y nada más entra mientras tanto: ni por el candado, ni —si el candado no estuviera— por el manifiesto.
if sh operacion/levantar.sh >"$trabajo/otra.salida" 2>&1; then falla "levantar entró a media publicación"; fi
grep -q "Hay otra operación en curso" "$trabajo/otra.salida" || { cat "$trabajo/otra.salida" >&2; falla "levantar no dijo que hay una publicación en curso"; }
rm "$trabajo/pausa"
wait "$publicando" || { dicho; diagnostico; falla "la publicación de la versión con migración no terminó bien"; }
dijo "Publicada: $v2" || { dicho; falla "publicar no dijo qué publicó"; }
atiende_con "$v2" "la versión con migración"
[ "$(asentado)" = "$habia" ] || falla "publicar cambió lo que el negocio llevaba asentado"
# Las tres anotaciones de la apertura quedaron en la bitácora de la base, en su orden y una vez.
[ "$(enlabase "SELECT string_agg(detalle->>'paso', ',' ORDER BY id) FROM bitacora WHERE accion = 'mantenimiento' AND entidad_id = '$v2'")" = "cerrar,decidir,abrir" ] \
  || falla "la bitácora no dice cerrar, decidir y abrir, una vez cada una, para la publicación $v2"
# La versión anterior sigue a la mano: sus imágenes, con su etiqueta, y su configuración guardada.
for imagen in web admin respaldo proxy db; do
  docker image inspect "$PROYECTO-$imagen:$v1" >/dev/null 2>&1 || falla "se perdió la imagen $imagen de la versión anterior"
done
[ -s "publicaciones/$v1/conjunto.json" ] || falla "se perdió la configuración guardada de la versión anterior"

# ── preparar que falla: nada se detuvo ni cambió ───────────────────────────

paso "Lo que impide publicar se dice al preparar, y no se toca nada"
antes=$(corriendo)
no_publica() {
  if publicar; then dicho; falla "$1: publicó"; fi
  dijo "$2" || { dicho; falla "$1: no dijo por qué"; }
  dijo "No se tocó nada" || { dicho; falla "$1: no dijo que no se tocó nada"; }
  [ "$antes" = "$(corriendo)" ] || falla "$1: se reemplazó o se detuvo un servicio"
  atiende_con "$v2" "$1"
}
version_nueva
# Con cambios sin commit.
echo "un cambio suelto" >> operacion/ensayo/version-$numero.txt
no_publica "con cambios sin commit" "cambios sin commit"
git checkout -q -- .
# Con el entorno mal puesto.
if publicar COMPOSE_ENV_FILES="$trabajo/roto.env"; then dicho; falla "con el entorno mal puesto: publicó"; fi
dijo "SESION_CLAVE" || { dicho; falla "con el entorno mal puesto: no dijo qué estaba mal"; }
[ "$antes" = "$(corriendo)" ] || falla "con el entorno mal puesto: se tocó algo"
atiende_con "$v2" "con el entorno mal puesto"
# Lo que corre no es lo que dejó la última publicación: alguien recreó la aplicación por su cuenta.
por_fuera up -d --force-recreate --no-deps respaldo >/dev/null 2>&1
por_fuera stop respaldo >/dev/null 2>&1
if publicar; then dicho; falla "con el servicio de respaldo detenido a mano: publicó"; fi
dijo "no es lo que dejó la última publicación" || { dicho; falla "con un servicio detenido a mano: no dijo que lo que corre no es lo publicado"; }
dijo "respaldo no está corriendo" || { dicho; falla "no dijo qué servicio no coincide"; }
[ "$antes" = "$(corriendo)" ] || falla "con un servicio detenido a mano: se tocó algo más"
# Se repone levantando lo publicado. La carpeta está en otro commit —el de la versión que se quería
# publicar—, y así levantar se niega: lo que resuelve tiene que ser lo publicado, tal cual.
if sh operacion/levantar.sh >"$trabajo/otra.salida" 2>&1; then falla "levantó lo publicado con la carpeta en otro commit"; fi
grep -q "esta carpeta está en otro" "$trabajo/otra.salida" || { cat "$trabajo/otra.salida" >&2; falla "levantar no dijo que la carpeta está en otro commit"; }
git checkout -q --detach "$(manifiesto vigente commit)"
sh operacion/levantar.sh >"$trabajo/otra.salida" 2>&1 || { cat "$trabajo/otra.salida" >&2; falla "levantar no repuso el servicio detenido a mano"; }
git checkout -q -
atiende_con "$v2" "después de reponer con levantar"
# Una migración ya aplicada que cambió, y una nueva que quiere entrar antes de la última.
(umask 022; echo "-- una nota" >> db/migraciones/0001_base.sql)
confirmar "Una migración aplicada, cambiada"
no_publica "con una migración aplicada que cambió" "0001_base.sql cambió después de aplicarse"
git reset -q --hard HEAD~1
(umask 022; echo "SELECT 1;" > db/migraciones/0000_tarde.sql)
confirmar "Una migración intercalada"
no_publica "con una migración que va antes de la última" "0000_tarde.sql va antes de la última aplicada"
git reset -q --hard HEAD~1
# Una versión que quiere cambiar el servidor de la base. (Otra imagen cualquiera que ya esté en la
# máquina, por su huella: la del proxy. No llega a arrancarse.)
(umask 022; sed -n 's/^FROM /FROM /p' docker/proxy.Dockerfile | head -1 > docker/db.Dockerfile)
confirmar "Otro servidor de base"
no_publica "con otro servidor de base de datos" "cambia el servidor de la base de datos"
git reset -q --hard HEAD~1
atiende_con "$v2" "después de los intentos que no debían publicar"
[ "$(find publicaciones -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 2 ] || falla "un intento que no debía publicar dejó escrita una publicación"

# ── morir antes de migrar: recuperar restablece la versión anterior ────────

# interrumpida <punto>: publica la versión que hay en la carpeta, matando el guion en ese punto. Deja en $pub la publicación sin cerrar.
interrumpida() {
  if publicar MORIR_EN="$1"; then dicho; falla "se pidió morir en «$1» y la publicación terminó: ese punto no existe o no se pasó por él"; fi
  dijo "el guion muere en «$1»" || { dicho; falla "la publicación falló antes de llegar a «$1»"; }
  pub=$(manifiesto pendiente)
  [ -n "$pub" ] || falla "murió en «$1» y no quedó ninguna publicación sin cerrar"
  nada_mas_entra "muerta en «$1»"
}
# no_publicada <punto>: recuperar la restableció a la versión anterior, y la base no se tocó.
no_publicada() {
  recuperar || { dicho; diagnostico; falla "muerta en «$1»: no se pudo recuperar"; }
  dijo "No se publicó: $pub" || { dicho; falla "muerta en «$1»: recuperar no dijo que no se publicó"; }
  [ "$(manifiesto dato "$pub" cierre.como)" = "no publicada" ] || falla "muerta en «$1»: el manifiesto no quedó cerrado como no publicada"
  atiende_con "$v2" "muerta en «$1» y recuperada"
  [ "$(asentado)" = "$habia" ] || falla "muerta en «$1»: recuperar cambió lo asentado"
  # Recuperar otra vez no revive nada.
  recuperar || { dicho; falla "muerta en «$1»: recuperar por segunda vez falló"; }
  dijo "nada que recuperar" || { dicho; falla "muerta en «$1»: recuperar por segunda vez no dijo que no había nada"; }
  atiende_con "$v2" "muerta en «$1», recuperada dos veces"
}

paso "Muere después de escribir el manifiesto y antes de cerrar: el negocio sigue atendiendo, y recuperar no supone que ya estaba cerrado"
interrumpida manifiesto:despues
# Sigue abierto, por la publicación anterior: eso no es señal de esta.
[ "$(en_la_base)" = "true|$v2" ] || falla "murió antes de cerrar y la operación ya no está abierta por la anterior: $(en_la_base)"
dice --abierta "--version=$v2" || falla "murió antes de cerrar y el sitio ya no atiende con la versión anterior"
no_publicada manifiesto:despues

for donde in cerrar:despues drenar:despues respaldar:despues anotar-respaldo:despues; do
  paso "Muere en «${donde}»: el negocio queda cerrado, y recuperar restablece la versión anterior"
  interrumpida "$donde"
  [ "$(en_la_base)" = "false|$pub" ] || falla "muerta en «${donde}»: la operación no quedó cerrada por esta publicación: $(en_la_base)"
  if [ "$donde" = cerrar:despues ]; then
    # La aplicación de antes sigue en pie, y dice que está cerrada: no atiende.
    dice --cerrada "--version=$v2" --rechaza-escribir || { cat "$trabajo/dice" >&2; falla "cerrada y con la aplicación en pie, el sitio no rechaza escribir"; }
  fi
  if [ "$donde" = respaldar:despues ]; then
    [ -z "$(manifiesto dato "$pub" respaldo.nombre)" ] || falla "murió antes de anotar el respaldo y está anotado"
  fi
  no_publicada "$donde"
done

paso "Recuperar también puede morir: se retoma donde quedó, y dos a la vez no entran"
interrumpida drenar:despues
# Muere al desistir, y después con la decisión de abrir la versión anterior ya anotada en el manifiesto.
if recuperar MORIR_EN=desistir:despues; then dicho; falla "se pidió que recuperar muriera al desistir, y terminó"; fi
[ -n "$(manifiesto dato "$pub" marcas.noSePublica)" ] || falla "recuperar murió al desistir sin dejarlo anotado"
if recuperar MORIR_EN=decidir:manifiesto; then dicho; falla "se pidió que recuperar muriera al decidir, y terminó"; fi
[ -n "$(manifiesto dato "$pub" marcas.seDecidioAbrir)" ] || falla "recuperar murió al decidir sin dejarlo anotado"
[ "$(en_la_base | cut -d'|' -f1)" = false ] || falla "con la decisión solo en el manifiesto, la operación ya abrió"
# Dos a la vez: entra una.
sh operacion/publicar.sh --recuperar >"$trabajo/a.salida" 2>&1 &
a=$!
sh operacion/publicar.sh --recuperar >"$trabajo/b.salida" 2>&1 &
b=$!
entraron=0
if wait "$a"; then entraron=$((entraron + 1)); fi
if wait "$b"; then entraron=$((entraron + 1)); fi
[ "$entraron" = 1 ] || { cat "$trabajo/a.salida" "$trabajo/b.salida" >&2; falla "de dos recuperaciones a la vez, terminaron bien $entraron"; }
cat "$trabajo/a.salida" "$trabajo/b.salida" | grep -q "Hay otra operación en curso" || falla "a la recuperación que no entró no se le dijo por qué"
cat "$trabajo/a.salida" "$trabajo/b.salida" | grep -q "Ya se había decidido volver a abrir la versión anterior" || falla "con la decisión ya anotada, recuperar no terminó hacia adelante"
[ "$(manifiesto dato "$pub" cierre.como)" = "no publicada" ] || falla "la recuperación retomada no cerró el manifiesto como no publicada"
atiende_con "$v2" "una recuperación que murió dos veces"
[ "$(asentado)" = "$habia" ] || falla "una recuperación que murió dos veces cambió lo asentado"

# ── morir ya decidido abrir: recuperar termina hacia adelante ──────────────

for donde in decidir:manifiesto decidir:base abrir:despues abierta:manifiesto respaldo:despues cerrar-manifiesto:antes; do
  paso "Muere en «${donde}», ya decidido abrir: recuperar termina hacia adelante, y nunca ofrece el respaldo"
  version_nueva
  interrumpida "$donde"
  case "$donde" in
    decidir:manifiesto | decidir:base)
      [ "$(en_la_base | cut -d'|' -f1)" = false ] || falla "muerta en «${donde}»: la operación ya abrió" ;;
    *)
      # Ya abrió: el negocio atiende con la versión nueva aunque el guion haya muerto.
      [ "$(en_la_base)" = "true|$pub" ] || falla "muerta en «${donde}»: la operación no quedó abierta por esta publicación"
      dice --abierta "--version=$pub" "--base=$marca" || { cat "$trabajo/dice" >&2; falla "muerta en «${donde}»: el sitio no atiende con la versión nueva"; }
      ;;
  esac
  recuperar || { dicho; diagnostico; falla "muerta en «${donde}»: no se pudo terminar hacia adelante"; }
  dijo "Publicada: $pub" || { dicho; falla "muerta en «${donde}»: recuperar no dijo que quedó publicada"; }
  if dijo "respaldo que se tomó antes"; then dicho; falla "muerta en «${donde}»: recuperar ofreció volver al respaldo"; fi
  [ "$(manifiesto dato "$pub" cierre.como)" = publicada ] || falla "muerta en «${donde}»: el manifiesto no quedó cerrado como publicada"
  atiende_con "$pub" "muerta en «${donde}» y terminada"
  [ "$(asentado)" = "$habia" ] || falla "muerta en «${donde}»: terminar hacia adelante cambió lo asentado"
  [ "$(enlabase "SELECT string_agg(detalle->>'paso', ',' ORDER BY id) FROM bitacora WHERE accion = 'mantenimiento' AND entidad_id = '$pub'")" = "cerrar,decidir,abrir" ] \
    || falla "muerta en «${donde}»: la bitácora no dice cerrar, decidir y abrir una vez cada una"
  vigente=$pub
done

paso "Muere con el manifiesto ya cerrado: no hay nada que recuperar"
version_nueva
if publicar MORIR_EN=cerrar-manifiesto:despues; then dicho; falla "se pidió morir con el manifiesto cerrado, y terminó"; fi
vigente=$(manifiesto vigente)
recuperar || { dicho; falla "con el manifiesto ya cerrado, recuperar falló"; }
dijo "nada que recuperar" || { dicho; falla "con el manifiesto ya cerrado, recuperar no dijo que no había nada"; }
atiende_con "$vigente" "muerta con el manifiesto ya cerrado"

# ── el manifiesto no está, no se lee, o habla de otra base ─────────────────

paso "Si el manifiesto no se lee, o habla de otra base, todo se detiene: no significa «no hay nada pendiente»"
version_nueva
interrumpida cerrar:despues
cp "publicaciones/$pub/manifiesto.json" "$trabajo/manifiesto.bueno"
se_detiene() {
  for intento in "publicar.sh --recuperar" levantar.sh publicar.sh; do
    # shellcheck disable=SC2086  # el guion y su orden
    if sh operacion/$intento >"$trabajo/salida" 2>&1; then dicho; falla "$1: $intento siguió adelante"; fi
    dijo "$2" || { dicho; falla "$1: $intento no dijo por qué se detiene"; }
  done
  [ "$(en_la_base)" = "false|$pub" ] || falla "$1: se tocó la operación: $(en_la_base)"
}
echo "{ dañado" > "publicaciones/$pub/manifiesto.json"
se_detiene "con el manifiesto dañado" "no se entiende"
rm "publicaciones/$pub/manifiesto.json"
se_detiene "sin el manifiesto" "no tiene manifiesto"
# Habla de otra base: su marca no es la de la base que contesta.
sed 's/"marca": "[0-9a-f-]*"/"marca": "00000000-0000-4000-8000-000000000000"/' "$trabajo/manifiesto.bueno" > "publicaciones/$pub/manifiesto.json"
if recuperar; then dicho; falla "con un manifiesto de otra base, recuperar siguió adelante"; fi
dijo "otra base" || { dicho; falla "con un manifiesto de otra base, recuperar no dijo por qué se detiene"; }
[ "$(en_la_base)" = "false|$pub" ] || falla "con un manifiesto de otra base se tocó la operación"
cp "$trabajo/manifiesto.bueno" "publicaciones/$pub/manifiesto.json"
no_publicada_sobre() {
  recuperar || { dicho; diagnostico; falla "$1: no se pudo recuperar"; }
  [ "$(manifiesto dato "$pub" cierre.como)" = "no publicada" ] || falla "$1: el manifiesto no quedó cerrado como no publicada"
  atiende_con "$vigente" "$1"
}
no_publicada_sobre "con el manifiesto otra vez en su lugar"

# ── el guion muere, y el migrador que lanzó sigue corriendo ────────────────

paso "Muere a media migración y el migrador sigue corriendo: recuperar no decide nada hasta que ese migrador ya no está"
version_nueva migracion
# Se retiene la migración: alguien más tiene el candado con que el migrador se asegura de ser el único.
docker exec -d "$(docker ps -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=db" | head -1)" \
  psql -U feruga -d feruga -c "SELECT pg_advisory_lock(7150); SELECT pg_sleep(900)"
k=0
until [ "$(enlabase "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 7150 AND granted")" = 1 ]; do
  k=$((k + 1)); [ "$k" -lt 50 ] || falla "no se pudo retener la migración"
  sleep 0.2
done
publicar &
publicando=$!
# El migrador de la publicación llega a esperar su turno; ahí se mata el guion, sin que limpie.
k=0
until [ "$(enlabase "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 7150 AND NOT granted")" = 1 ]; do
  k=$((k + 1)); [ "$k" -lt 900 ] || { dicho; falla "la migración de la publicación nunca llegó a esperar su turno"; }
  kill -0 "$publicando" 2>/dev/null || { dicho; falla "la publicación terminó antes de migrar"; }
  sleep 0.5
done
# El guion de publicar es hijo de este; su proceso es el del «sh operacion/publicar.sh».
pkill -9 -f "sh operacion/publicar.sh" || falla "no se encontró el guion de publicar para matarlo"
wait "$publicando" 2>/dev/null || true
pub=$(manifiesto pendiente)
[ -n "$pub" ] || falla "murió a media migración y no quedó ninguna publicación sin cerrar"
[ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=migracion")" ] \
  || falla "el migrador murió con el guion: aquí no se probaría que recuperar lo espera"
# Recuperar le da un plazo, lo detiene, y comprueba que su sesión en la base ya no está. Después decide.
codigo=0
recuperar ESPERA_DEL_MIGRADOR=5 || codigo=$?
dijo "El migrador de la publicación interrumpida sigue corriendo" || { dicho; falla "recuperar no dijo que el migrador seguía corriendo"; }
[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=migracion")" ] || falla "después de recuperar, el migrador sigue corriendo"
[ "$(enlabase "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 7150 AND NOT granted")" = 0 ] || falla "después de recuperar, la sesión del migrador sigue esperando en la base"
# Empezó a migrar —quedó anotado antes de arrancar— y no se decidió abrir: se queda cerrado.
[ "$codigo" = 2 ] || { dicho; falla "con la migración empezada y sin decidir abrir, recuperar salió con $codigo y no con 2"; }
[ "$(en_la_base)" = "false|$pub" ] || falla "recuperar tocó la operación: $(en_la_base)"
[ "$(enlabase "SELECT to_regclass('ensayo_$numero') IS NULL")" = t ] || falla "la migración retenida quedó aplicada"
# Se suelta lo que la retenía, y se sale de ahí volviendo al respaldo previo, y abriendo.
enlabase "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(900)%' AND pid <> pg_backend_pid()" >/dev/null
sh operacion/volver.sh <"$trabajo/llave.txt" >"$trabajo/salida" 2>&1 || { dicho; diagnostico; falla "no se pudo volver al respaldo previo después de una migración retenida"; }
sh operacion/volver.sh --abrir >"$trabajo/salida" 2>&1 || { dicho; diagnostico; falla "no se pudo abrir después de volver al respaldo"; }
marca=$(enlabase "SELECT id FROM vida")
atiende_con "$vigente" "después de una migración que se quedó esperando"
[ "$(asentado)" = "$habia" ] || falla "volver de una migración retenida cambió lo asentado"
# La carpeta queda en el commit de esa versión, sin publicar: la siguiente la publica, entera.

# ── empezó la migración y no se decidió abrir: se queda cerrado ────────────

paso "Muere ya migrando y sin decidir abrir: el negocio se queda cerrado, y recuperar no repite la migración ni vuelve solo"
version_nueva migracion
interrumpida migrar:despues
[ "$(en_la_base)" = "false|$pub" ] || falla "muerta después de migrar: la operación no quedó cerrada"
[ "$(enlabase "SELECT to_regclass('ensayo_$numero') IS NOT NULL")" = t ] || falla "muerta después de migrar: la migración no quedó aplicada, y el caso no se probó"
respaldo_previo=$(manifiesto dato "$pub" respaldo.nombre)
for vez in 1 2; do
  codigo=0
  recuperar || codigo=$?
  [ "$codigo" = 2 ] || { dicho; falla "ya migrando y sin decidir abrir, recuperar (vez $vez) salió con $codigo y no con 2"; }
  dijo "El negocio se queda cerrado" || { dicho; falla "recuperar no dijo que el negocio se queda cerrado"; }
  dijo "$respaldo_previo" || { dicho; falla "recuperar no dijo cuál es el respaldo previo, por su nombre"; }
  [ "$(en_la_base)" = "false|$pub" ] || falla "recuperar (vez $vez) abrió o tocó la operación: $(en_la_base)"
  [ "$(manifiesto pendiente)" = "$pub" ] || falla "recuperar (vez $vez) cerró el manifiesto"
done
[ "$(estado web Running)" != true ] || falla "ya migrando y sin decidir abrir, recuperar levantó la aplicación"
nada_mas_entra "ya migrando y sin decidir abrir"
[ "$(asentado)" = "$habia" ] || falla "la publicación a medio migrar cambió lo asentado"
# Su respaldo sigue siendo el suyo aunque después haya otro más nuevo.
por_fuera run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS respaldo ahora >/dev/null 2>&1 || falla "no se pudo tomar otro respaldo"
[ "$(manifiesto dato "$pub" respaldo.nombre)" = "$respaldo_previo" ] || falla "el respaldo previo de la publicación cambió por uno más nuevo"

# ── la salida de ahí: volver al respaldo previo ────────────────────────────

paso "Volver al respaldo previo: la base que falló se aparta, se restaura el respaldo de esa publicación, y la versión anterior queda levantada y cerrada"
volver() { env "$@" sh operacion/volver.sh >"$trabajo/salida" 2>&1; }
# Las bases que hay en el servidor, como las ve la vuelta: «nombre marca» por renglón.
bases() { por_fuera run --rm --no-deps -T --entrypoint node comprobacion operacion/volver.ts bases; }
fallida="feruga_fallida_$(manifiesto dato "$pub" numero)"
# Sin la llave no se toca nada.
if volver </dev/null; then dicho; falla "volvió al respaldo sin la llave"; fi
dijo "No llegó la llave privada" || { dicho; falla "sin la llave, no dijo qué faltaba"; }
[ "$(en_la_base)" = "false|$pub" ] || falla "sin la llave se tocó la operación"
# Con una llave que no es la del respaldo: la base que falló queda apartada, no se pierde, y se puede volver a intentar.
docker run --rm --log-driver none --entrypoint age-keygen "$HERRAMIENTAS_DEL_ENSAYO" > "$trabajo/otra-llave.txt" 2>/dev/null
if volver <"$trabajo/otra-llave.txt"; then dicho; falla "restauró con una llave que no es la del respaldo"; fi
dijo "No se pudo restaurar el respaldo" || { dicho; falla "con otra llave, no dijo que no se pudo restaurar"; }
# Y no llegó ni a bajarlo: para esa llave, el respaldo no lleva su sello.
dijo "no lleva el sello de este negocio" || { dicho; falla "con otra llave, no se detuvo en el sello del respaldo"; }
bases > "$trabajo/bases"
grep -q "^$fallida $marca\$" "$trabajo/bases" || { cat "$trabajo/bases" >&2; falla "la base que falló no quedó apartada con su marca"; }
[ -z "$(awk '$1 == "feruga"' "$trabajo/bases")" ] || { cat "$trabajo/bases" >&2; falla "con una llave equivocada quedó una base con el nombre definitivo"; }
[ -n "$(manifiesto pendiente)" ] || falla "con una llave equivocada se cerró el manifiesto"
# Con la suya, y muriendo a la mitad —recién restaurada la base—: se vuelve a correr y sigue desde ahí.
if volver MORIR_EN=vuelta:restaurada <"$trabajo/llave.txt"; then dicho; falla "se pidió que la vuelta muriera recién restaurada la base, y terminó"; fi
dijo "el guion muere en «vuelta:restaurada»" || { dicho; diagnostico; falla "la vuelta falló antes de restaurar"; }
nada_mas_entra "a media vuelta al respaldo"
# La llave pasó por el guion que murió sin limpiar: no quedó escrita en su carpeta de trabajo, ni en ningún otro lado de la instalación.
secreto=$(grep -o 'AGE-SECRET-KEY-[0-9A-Z]*' "$trabajo/llave.txt" | head -1)
[ -n "$secreto" ] || falla "no se pudo leer la llave del ensayo para buscarla"
if grep -rIlF "$secreto" . >"$trabajo/con-la-llave" 2>/dev/null; then
  cat "$trabajo/con-la-llave" >&2
  falla "la llave privada quedó escrita en la instalación después de morir el guion"
fi
# Quedó corriendo algo de aquel intento —una restauración que no había terminado, digamos; aquí, su
# contenedor—: el que retoma no arranca otra encima. Lo espera, y sigue. Y lo mismo con un migrador.
conf_pendiente="publicaciones/$pub/conjunto.json"
# (Dura bastante más que el migrador de mentira: a ese se le espera primero, y esta tiene que seguir ahí cuando le toque.)
docker compose -f "$conf_pendiente" run -d --no-deps --entrypoint sleep comprobacion 25 >/dev/null 2>&1 || falla "no se pudo dejar corriendo el contenedor de una restauración de mentira"
docker compose -f "$conf_pendiente" run -d --no-deps --entrypoint sleep migracion 6 >/dev/null 2>&1 || falla "no se pudo dejar corriendo un migrador de mentira"
# Y uno más, creado y sin arrancar: el de un cliente que murió entre crearlo y arrancarlo. Ese no se
# espera —no corre—: se quita, para que ya no pueda arrancar (lo encontró Codex al verificar su décima revisión).
sin_arrancar=$(docker create --label "com.docker.compose.project=$PROYECTO" --label com.docker.compose.service=migracion --label com.docker.compose.oneoff=True \
  --entrypoint sleep "$HERRAMIENTAS_DEL_ENSAYO" 600) || falla "no se pudo dejar un migrador creado sin arrancar"
volver <"$trabajo/llave.txt" || { dicho; diagnostico; falla "no se pudo terminar de volver al respaldo"; }
dijo "El migrador de la operación interrumpida sigue corriendo: se le espera" || { dicho; falla "volver no esperó al migrador que seguía corriendo"; }
dijo "Sigue corriendo algo que dejó una operación interrumpida" || { dicho; falla "volver no esperó a lo que seguía corriendo de un intento anterior"; }
[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.oneoff=True")" ] || falla "volver terminó con algo de un intento anterior todavía corriendo"
[ -z "$(docker ps -aq --filter "id=$sin_arrancar")" ] || falla "volver dejó ahí al migrador que había quedado creado sin arrancar"
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=migracion")" ] || falla "volver dejó contenedores del migrador, corriendo o no"
dijo "EL NEGOCIO SIGUE CERRADO" || { dicho; falla "volver al respaldo no dijo que el negocio sigue cerrado"; }
# La publicación quedó cerrada como restaurada, y lo vigente es la versión anterior sobre la base restaurada.
[ -z "$(manifiesto pendiente)" ] || falla "volver al respaldo no cerró el manifiesto"
[ "$(manifiesto dato "$pub" cierre.como)" = restaurada ] || falla "el manifiesto no quedó cerrado como restaurada"
[ "$(manifiesto vigente)" = "$vigente" ] || falla "después de volver, lo vigente no es la versión anterior"
bases > "$trabajo/bases"
nueva=$(sed -n 's/^feruga //p' "$trabajo/bases")
[ -n "$nueva" ] && [ "$nueva" != "$marca" ] || { cat "$trabajo/bases" >&2; falla "la base restaurada no tiene una marca nueva"; }
[ "$(manifiesto vigente marca)" = "$nueva" ] || falla "lo vigente no habla de la base restaurada"
grep -q "^$fallida $marca\$" "$trabajo/bases" || falla "la base que falló ya no está apartada"
# La restaurada es la de antes de migrar: no tiene lo que la migración creó; la apartada sí lo conserva.
[ "$(enlabase "SELECT to_regclass('ensayo_$numero') IS NULL")" = t ] || falla "la base restaurada trae lo que creó la migración que falló"
[ "$(enlabase "SELECT to_regclass('ensayo_$numero') IS NOT NULL" "$fallida")" = t ] || falla "la base apartada no conserva lo que tenía"
# Lo asentado antes de cerrar está, idéntico; y la restauración quedó registrada: los folios siguen en otro bloque.
[ "$(asentado)" = "$habia" ] || falla "lo asentado antes de cerrar no es lo que trae la base restaurada"
[ "$(enlabase "SELECT count(*) FROM restauracion")" = 2 ] || falla "la restauración no quedó registrada (debía haber dos: la de la migración retenida, y esta)"
[ "$(enlabase "SELECT (SELECT max(folio_despues) FROM restauracion) >= (SELECT coalesce(max(folio), 0) FROM operacion)")" = t ] || falla "los folios no siguen después de lo restaurado"
# Cerrada: el sitio lo dice, sobre la base nueva y con la versión anterior; no abre por levantar otra vez.
[ "$(en_la_base)" = "false|$pub" ] || falla "la base restaurada no quedó cerrada: $(en_la_base)"
dice --cerrada "--version=$vigente" "--base=$nueva" --rechaza-escribir || { cat "$trabajo/dice" >&2; falla "después de volver, el sitio no está cerrado sobre la base restaurada"; }
git checkout -q --detach "$(manifiesto vigente commit)"
sh operacion/levantar.sh >"$trabajo/otra.salida" 2>&1 || { cat "$trabajo/otra.salida" >&2; falla "después de volver, levantar falló"; }
grep -q "LA OPERACIÓN ESTÁ CERRADA" "$trabajo/otra.salida" || { cat "$trabajo/otra.salida" >&2; falla "levantar no dijo que la operación sigue cerrada"; }
[ "$(en_la_base)" = "false|$pub" ] || falla "levantar abrió la operación"
git checkout -q -
# Ni se publica encima de una operación cerrada sin saber por qué.
if publicar; then dicho; falla "publicó sobre una operación cerrada"; fi
dijo "está cerrada" || { dicho; falla "no dijo que la operación está cerrada"; }

paso "Abrir, después de volver al respaldo, es un paso expreso; y si muere recién abierta, repetirlo termina lo que faltaba"
# Lo encontró Codex en su décima revisión: repetido, decía «ya está abierta» y salía bien, con el
# servicio de respaldo sin arrancar.
# Levantar —arriba— dejó en pie el servicio de respaldo. Volver, a secas, no lo deja: se detiene por
# fuera, para que el caso sea ese, el de quien vuelve y abre sin haber levantado.
por_fuera stop respaldo >/dev/null 2>&1 || falla "no se pudo detener el servicio de respaldo para preparar el caso"
if env MORIR_EN=vuelta:abierta sh operacion/volver.sh --abrir >"$trabajo/salida" 2>&1; then dicho; falla "se pidió que abrir muriera recién abierta la operación, y terminó"; fi
dijo "el guion muere en «vuelta:abierta»" || { dicho; diagnostico; falla "abrir después de volver falló antes de abrir"; }
marca=$nueva
[ "$(en_la_base | cut -d'|' -f1)" = true ] || falla "murió «recién abierta» sin haber abierto: el caso no se probó"
[ "$(estado respaldo Running)" != true ] || falla "el servicio de respaldo ya corría antes de terminar de abrir: el caso no se probó"
sh operacion/volver.sh --abrir >"$trabajo/salida" 2>&1 || { dicho; diagnostico; falla "no se pudo terminar de abrir después de volver al respaldo"; }
dijo "ya estaba abierta: se termina lo que faltaba" || { dicho; falla "repetir abrir no dijo que terminaba lo que faltaba"; }
atiende_con "$vigente" "después de volver al respaldo y abrir"
[ "$(asentado)" = "$habia" ] || falla "abrir después de volver cambió lo asentado"
sh operacion/volver.sh --abrir >"$trabajo/salida" 2>&1 || { dicho; falla "abrir otra vez, ya abierta y completa, falló"; }
atiende_con "$vigente" "después de abrir por tercera vez"

paso "Sobre la base restaurada se publica otra vez, como siempre"
publicar || { dicho; diagnostico; falla "no se pudo publicar sobre la base restaurada"; }
ultima=$(sed -n 's/^Publicada: //p' "$trabajo/salida")
atiende_con "$ultima" "publicada sobre la base restaurada"
[ "$(enlabase "SELECT to_regclass('ensayo_$numero') IS NOT NULL")" = t ] || falla "la versión publicada sobre la base restaurada no aplicó su migración"
[ "$(asentado)" = "$habia" ] || falla "publicar sobre la base restaurada cambió lo asentado"

# ── se perdió la máquina ───────────────────────────────────────────────────

paso "Se perdió la máquina: en otra, sin nada local, se instala desde un respaldo, con la versión construida de su commit"
# Cada respaldo dice qué publicación corría cuando se tomó, y con ella de qué commit era.
# Lo dice su manifiesto, y solo se le cree con el sello de la llave del dueño: la llave entra por la entrada estándar.
version_con() { de_quien=$1; shift; por_fuera run --rm --no-deps -T --entrypoint node comprobacion operacion/version-del-respaldo.ts "$@" <"$de_quien"; }
version_de() { version_con "$trabajo/llave.txt" "$@"; }
de_entonces=$(git rev-parse HEAD)
web_de_entonces=$(docker inspect -f '{{.Image}}' "$(operacion ps -q web)")
# Un respaldo de ahora, con todo lo asentado.
operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS respaldo ahora >"$trabajo/respaldo.salida" 2>&1 || { cat "$trabajo/respaldo.salida" >&2; falla "no se pudo tomar el respaldo"; }
el_respaldo=$(sed -n 's/^respaldo: //p' "$trabajo/respaldo.salida")
[ "$(version_de "$el_respaldo")" = "$el_respaldo $ultima $(printf '%s' "$de_entonces" | cut -c1-12)" ] || falla "el respaldo no dice qué publicación corría cuando se tomó, ni de qué commit"
# Con la llave de otro, ese respaldo no lleva su sello: no se le cree nada de lo que dice, ni por su nombre ni como «el último».
if version_con "$trabajo/otra-llave.txt" "$el_respaldo" >"$trabajo/salida" 2>&1; then dicho; falla "se le creyó a un respaldo sin comprobar su sello con la llave"; fi
dijo "no lleva el sello de este negocio" || { dicho; falla "con otra llave, no dijo que el respaldo no lleva su sello"; }
if version_con "$trabajo/otra-llave.txt" >"$trabajo/salida" 2>&1; then dicho; falla "con otra llave, dio por bueno el último respaldo"; fi
if version_con /dev/null "$el_respaldo" >"$trabajo/salida" 2>&1; then dicho; falla "sin la llave dijo de qué versión es el respaldo"; fi

# La máquina se pierde: lo que corría, la base, las imágenes y la carpeta de publicaciones. Queda
# lo de fuera —el almacenamiento, con los respaldos—, el repositorio y el entorno. (El volumen de
# los certificados se conserva: en el ensayo, quienes confían en la autoridad del proxy ya leyeron
# su raíz, y una nueva no la conocerían.)
for servicio in db web proxy respaldo; do
  # shellcheck disable=SC2046  # una lista de contenedores
  docker rm -f $(docker ps -a -q --filter "label=com.docker.compose.project=$PROYECTO" --filter "label=com.docker.compose.service=$servicio") >/dev/null 2>&1 || true
done
docker volume rm "${PROYECTO}_datos" >/dev/null || falla "no se pudo quitar la base para simular la pérdida"
rm -rf publicaciones
for imagen in $(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "^$PROYECTO-(db|admin|web|respaldo|proxy):"); do
  docker image rm "$imagen" >/dev/null 2>&1 || true
done
if docker image inspect "$web_de_entonces" >/dev/null 2>&1; then falla "la imagen de la aplicación sigue en la máquina: no se probaría que se vuelve a construir"; fi

instalar() { env "$@" sh operacion/publicar.sh --desde-respaldo >"$trabajo/salida" 2>&1; }
# Sin la llave no se toca nada; y con otra que no es la del respaldo, no queda ninguna base a medias.
if instalar </dev/null; then dicho; falla "instaló desde un respaldo sin la llave"; fi
dijo "No llegó la llave privada" || { dicho; falla "sin la llave, no dijo qué faltaba"; }
[ -z "$(find publicaciones -mindepth 1 -type d 2>/dev/null)" ] || falla "sin la llave quedó escrita una publicación"
# Con la carpeta en otro commit que el de la versión que tomó el respaldo, tampoco: lo que se instala
# es esa versión, construida de su commit. Lo dice, con el commit en que hay que ponerla.
version_nueva
if instalar <"$trabajo/llave.txt"; then dicho; falla "instaló desde un respaldo con la carpeta en otro commit que el de la versión que lo tomó"; fi
dijo "Ponla en ese commit (git checkout $(printf '%s' "$de_entonces" | cut -c1-12))" || { dicho; falla "con la carpeta en otro commit, no dijo en cuál hay que ponerla"; }
[ -z "$(find publicaciones -mindepth 1 -type d 2>/dev/null)" ] || falla "con la carpeta en otro commit quedó escrita una publicación"
git checkout -q --detach "$de_entonces"
# Con la suya, y muriendo recién restaurada la base: se vuelve a correr y sigue desde ahí.
if instalar MORIR_EN=restaurar:despues <"$trabajo/llave.txt"; then dicho; falla "se pidió que la instalación muriera recién restaurada la base, y terminó"; fi
dijo "el guion muere en «restaurar:despues»" || { dicho; diagnostico; falla "la instalación falló antes de restaurar"; }
pub=$(manifiesto pendiente)
[ -n "$pub" ] || falla "la instalación murió y no quedó ninguna publicación sin cerrar"
# A medias, recuperar no la toma por una publicación cualquiera: manda a retomarla con la llave.
if recuperar; then dicho; falla "recuperar siguió adelante con una instalación desde un respaldo a medias"; fi
dijo "instalación desde un respaldo que quedó a medias" || { dicho; falla "recuperar no dijo que es una instalación a medias"; }
instalar <"$trabajo/llave.txt" || { dicho; diagnostico; falla "no se pudo terminar de instalar desde el respaldo"; }
dijo "Instalada desde el respaldo $el_respaldo" || { dicho; falla "no dijo de qué respaldo instaló"; }
dijo "Publicada: $pub" || { dicho; falla "no dijo qué publicación quedó"; }

# Es otra instalación: otra publicación, otra base —otra marca—, y la misma versión: el mismo commit,
# con sus imágenes construidas aquí. Del almacenamiento no vino nada que se ejecute.
[ "$pub" != "$ultima" ] || falla "la instalación nueva lleva el identificador de la de antes"
[ "$(manifiesto dato "$pub" commit)" = "$de_entonces" ] || falla "la instalación nueva no es del commit de la versión que tomó el respaldo"
[ -n "$(docker image ls -q "$PROYECTO-web:$pub")" ] || falla "la imagen de la aplicación no se construyó en la máquina nueva"
nueva=$(enlabase "SELECT id FROM vida")
[ "$nueva" != "$marca" ] || falla "la base restaurada tiene la marca de la de antes"
marca=$nueva
atiende_con "$pub" "instalada desde un respaldo"
[ "$(docker inspect -f '{{.Image}}' "$(operacion ps -q web)")" = "$(docker image ls -q --no-trunc "$PROYECTO-web:$pub")" ] || falla "la aplicación no corre con la imagen construida para esta instalación"
# Lo asentado está, idéntico; y la restauración quedó registrada.
[ "$(asentado)" = "$habia" ] || falla "lo asentado no es lo que traía el respaldo"
[ "$(enlabase "SELECT count(*) FROM restauracion")" = 3 ] || falla "la restauración no quedó registrada (debía haber tres: las dos de volver al respaldo, y esta)"
# El siguiente respaldo dice ya la publicación de esta instalación.
operacion run --rm --no-deps -T -e NODE_EXTRA_CA_CERTS respaldo ahora >"$trabajo/respaldo.salida" 2>&1 || { cat "$trabajo/respaldo.salida" >&2; falla "no se pudo respaldar en la instalación nueva"; }
[ "$(version_de | cut -d' ' -f2)" = "$pub" ] || falla "el respaldo de la instalación nueva no dice su publicación"
# Y de ahí se sigue como siempre: levantar, y publicar lo que venga.
sh operacion/levantar.sh >"$trabajo/otra.salida" 2>&1 || { cat "$trabajo/otra.salida" >&2; falla "después de instalar desde un respaldo, levantar falló"; }
version_nueva
publicar || { dicho; diagnostico; falla "no se pudo publicar sobre la instalación hecha desde un respaldo"; }
atiende_con "$(sed -n 's/^Publicada: //p' "$trabajo/salida")" "publicada sobre la instalación hecha desde un respaldo"
[ "$(asentado)" = "$habia" ] || falla "publicar sobre la instalación nueva cambió lo asentado"

printf '\nEl ensayo de publicación pasó.\n'
