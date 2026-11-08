#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
img=caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
cleanup() {
 docker rm -f codex43-caddy codex43-web codex43-peticion >/dev/null 2>&1 || true
 docker network rm codex43-caddy-entrada codex43-caddy-frente >/dev/null 2>&1 || true
}
trap cleanup EXIT
for red in codex43-caddy-entrada codex43-caddy-frente; do docker network create --internal "$red" >/dev/null; done
docker run --rm --name codex43-adapt --network none --tmpfs /data --tmpfs /config -e DOMINIO=patio.test -v "$PWD/operacion:/etc/caddy:ro" "$img" caddy adapt --config /etc/caddy/Caddyfile.detras --pretty > qa/r43-caddy-adapt.json 2>qa/r43-caddy-adapt.log
docker run -d --name codex43-web --network codex43-caddy-frente --network-alias web node:24-alpine node -e 'require("http").createServer((q,s)=>{s.setHeader("Content-Type","application/json");s.end(JSON.stringify(q.headers))}).listen(3000)' >/dev/null
docker run -d --name codex43-caddy --network codex43-caddy-frente --tmpfs /data --tmpfs /config -e DOMINIO=patio.test -v "$PWD/operacion:/etc/caddy:ro" "$img" caddy run --config /etc/caddy/Caddyfile.detras >/dev/null
docker network connect codex43-caddy-entrada codex43-caddy
for red in codex43-caddy-entrada codex43-caddy-frente; do
 printf '\nPetición desde %s\n' "$red"
 docker run --rm --name codex43-peticion --network "$red" --tmpfs /data --tmpfs /config --entrypoint sh "$img" -c 'wget -S -O - --header "Host: patio.test" --header "X-Forwarded-Host: ajeno.test" --header "X-Forwarded-Proto: https" --header "X-Forwarded-For: 1.2.3.4" http://codex43-caddy/api/salud; if nc -z -w 1 codex43-caddy 443; then echo "443 ABIERTO"; else echo "443 CERRADO"; fi; if nc -z -w 1 codex43-caddy 2019; then echo "2019 ABIERTO"; else echo "2019 CERRADO"; fi'
done
docker logs codex43-caddy
docker exec codex43-caddy sh -c 'find /data -type f'
