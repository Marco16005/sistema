#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
img=caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
cleanup() {
 for c in proxy web db otro; do docker rm -f "codex43-aislamiento-$c" >/dev/null 2>&1 || true; done
 for r in codex43-aislamiento-entrada codex43-aislamiento_frente codex43-aislamiento_fondo; do docker network rm "$r" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
for r in codex43-aislamiento-entrada codex43-aislamiento_frente codex43-aislamiento_fondo; do docker network create --internal "$r" >/dev/null; done
docker run -d --name codex43-aislamiento-web --network codex43-aislamiento_frente --network-alias web node:24-alpine node -e 'require("http").createServer((q,s)=>s.end("ok")).listen(3000)' >/dev/null
docker network connect codex43-aislamiento_fondo codex43-aislamiento-web
docker run -d --name codex43-aislamiento-db --network codex43-aislamiento_fondo --network-alias db node:24-alpine node -e 'require("http").createServer((q,s)=>s.end("ok")).listen(5432)' >/dev/null
docker run -d --name codex43-aislamiento-proxy --network codex43-aislamiento_frente --tmpfs /data --tmpfs /config -e DOMINIO=patio.test -v "$PWD/operacion:/etc/caddy:ro" "$img" caddy run --config /etc/caddy/Caddyfile.detras >/dev/null
docker network connect --alias feruga-proxy codex43-aislamiento-entrada codex43-aislamiento-proxy
docker run -d --name codex43-aislamiento-otro --network codex43-aislamiento-entrada --tmpfs /data --tmpfs /config --entrypoint sh "$img" -c 'sleep 300' >/dev/null
sh qa/r43-bloque-aislamiento.sh && echo 'BASE AISLADA: PASA'
docker network connect codex43-aislamiento_frente codex43-aislamiento-otro
if sh qa/r43-bloque-aislamiento.sh; then echo 'MUTANTE FRENTE: FALSO POSITIVO'; else echo 'MUTANTE FRENTE: RECHAZADO'; fi
# Comprobar directamente que la prueba por IP también detecta el frente abierto.
ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "codex43-aislamiento_frente").IPAddress}}' codex43-aislamiento-web)
docker exec codex43-aislamiento-otro nc -z -w 3 "$ip" 3000 && echo 'MUTANTE FRENTE: nc por IP detecta conexión'
docker network disconnect codex43-aislamiento_frente codex43-aislamiento-otro
docker network connect codex43-aislamiento-entrada codex43-aislamiento-db
if sh qa/r43-bloque-aislamiento.sh; then echo 'MUTANTE DB: FALSO POSITIVO'; else echo 'MUTANTE DB: RECHAZADO'; fi
