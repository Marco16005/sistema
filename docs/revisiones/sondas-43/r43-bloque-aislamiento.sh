#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
PROYECTO=codex43-aislamiento
DETRAS=1
RED_DE_ENTRADA_DEL_ENSAYO=codex43-aislamiento-entrada
DOMINIO=patio.test
trabajo=qa/r43-aislamiento
mkdir -p "$trabajo"
paso() { echo "$*"; }
falla() { echo "FALLO: $*"; exit 1; }
operacion() { docker inspect -f '{{.Id}}' "codex43-aislamiento-$3"; }
otro_proxy() { docker inspect -f '{{.Id}}' codex43-aislamiento-otro; }
ip_de_la_base=$(docker inspect -f '{{(index .NetworkSettings.Networks "codex43-aislamiento_fondo").IPAddress}}' codex43-aislamiento-db)
if [ -n "$DETRAS" ]; then
  paso "Detrás de otro proxy: el otro solo alcanza al de feruga, que le contesta por HTTP, sin redirigir y con sus cabeceras"
  otro=$(otro_proxy ps -q proxy)
  [ -n "$otro" ] || falla "no está corriendo el otro proxy del ensayo"
  # La red que comparten es interna, y de feruga solo tiene al proxy.
  [ "$(docker network inspect -f '{{.Internal}}' "$RED_DE_ENTRADA_DEL_ENSAYO")" = true ] || falla "la red que comparten los dos proxies no es interna"
  en_la_entrada=$(docker network inspect -f '{{range $id, $c := .Containers}}{{$id}} {{end}}' "$RED_DE_ENTRADA_DEL_ENSAYO" | tr ' ' '\n' | grep . | sort | tr '\n' ' ')
  esperados=$(for c in "$(operacion ps -q proxy)" "$otro"; do docker inspect -f '{{.Id}}' "$c"; done | sort | tr '\n' ' ')
  [ "$en_la_entrada" = "$esperados" ] || falla "en la red que comparten los dos proxies hay algo más que ellos"
  # Desde el otro: llega al de feruga por su nombre propio; ni el nombre de la base ni el de la
  # aplicación existen, y por su dirección tampoco les llega.
  docker exec "$otro" nc -z -w 3 feruga-proxy 80 || falla "el otro proxy no llega al de feruga por «feruga-proxy»"
  for nombre in db web; do
    if docker exec "$otro" nslookup "$nombre" >/dev/null 2>&1; then falla "desde el otro proxy se resuelve «$nombre»"; fi
  done
  ip_de_la_web=$(docker inspect -f "{{(index .NetworkSettings.Networks \"${PROYECTO}_frente\").IPAddress}}" "$(operacion ps -q web)")
  [ -n "$ip_de_la_web" ] || falla "no se supo la dirección de la aplicación en el frente"
  if docker exec "$otro" nc -z -w 3 "$ip_de_la_web" 3000 >/dev/null 2>&1; then falla "desde el otro proxy se llega a la aplicación sin pasar por el de feruga"; fi
  if docker exec "$otro" nc -z -w 3 "$ip_de_la_base" 5432 >/dev/null 2>&1; then falla "desde el otro proxy se llega al puerto de la base"; fi
  # El de feruga contesta lo del dominio por HTTP —sin redirigir a HTTPS, que sería un ciclo— y con HSTS,
  # que el otro entrega por HTTPS. (La primera respuesta es la suya: si redirigiera, sería un 30x.)
  docker exec "$otro" wget -S -O /dev/null --header "Host: $DOMINIO" http://feruga-proxy/api/salud >"$trabajo/salida" 2>&1 \
    || { cat "$trabajo/salida" >&2; falla "el proxy de feruga no le contestó al otro por HTTP"; }
  grep "HTTP/1.1 " "$trabajo/salida" | head -1 | grep -q "HTTP/1.1 200" || { cat "$trabajo/salida" >&2; falla "el proxy de feruga no contestó 200 por HTTP: si redirige a HTTPS, con el otro delante hace un ciclo"; }
  grep -qi "strict-transport-security: max-age=31536000" "$trabajo/salida" || { cat "$trabajo/salida" >&2; falla "el proxy de feruga no pone HSTS detrás del otro"; }
fi
