#!/bin/sh
set -eu
case "$1" in preparar|cabeceras|limites|navegador|adicionales|tls-crudo) ;; *) exit 2;; esac
docker run --rm --pull=never --name "codex-seguridad-$1-42" --network feruga_qa40_default --dns 127.0.0.1 -e NODE_EXTRA_CA_CERTS=/salida/raiz.crt -v /tmp/feruga-codex-qa14/qa/seguridad-42:/salida codex-seguridad-browser:40 node "/salida/$1.cjs"
