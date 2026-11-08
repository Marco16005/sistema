#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
cleanup() {
 for red in 'codex43-a codex43-b' codex43-a codex43-b; do command docker network rm "$red" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
command docker network create --internal codex43-a >/dev/null
command docker network create --internal codex43-b >/dev/null
command docker network create 'codex43-a codex43-b' >/dev/null
cat > qa/r43-espacios.json <<'JSON'
{"services":{"proxy":{"networks":{"entrada":{}}}},"networks":{"entrada":{"name":"codex43-a codex43-b","external":true}}}
JSON
# Se sustituye SOLO la ejecución del contenedor que imprime la lista; las inspecciones son reales.
docker() {
 case "$*" in compose*'comprobacion redes-de-fuera') printf '%s\n' 'codex43-a codex43-b';; *) command docker "$@";; esac
}
. operacion/pasos.sh
exigir_redes_de_fuera qa/r43-espacios.json
printf 'exigir_redes_de_fuera: exit=%s\n' "$?"
command docker network inspect -f 'Red real: {{.Name}} Internal={{.Internal}}' 'codex43-a codex43-b'
