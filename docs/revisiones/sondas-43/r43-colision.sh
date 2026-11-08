#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
cleanup() {
 docker rm -f codex43-otro >/dev/null 2>&1 || true
 docker compose -p codex43-colision -f qa/r43-colision.yml down >/dev/null 2>&1 || true
 docker network rm codex43-entrada >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Red preexistente, creada aparte; la etiqueta permite que Compose la reutilice también como fondo.
docker network create --internal --label com.docker.compose.network=fondo --label com.docker.compose.project=codex43-colision codex43-entrada
docker compose -p codex43-colision -f qa/r43-colision.yml config --format json > qa/r43-colision.json
sh qa/node.sh qa/r43-red.ts
docker compose -p codex43-colision -f qa/r43-colision.yml up -d
docker run --rm --name codex43-otro --network codex43-entrada --entrypoint sh caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5 -c 'wget -S -O /dev/null http://db:5432'
