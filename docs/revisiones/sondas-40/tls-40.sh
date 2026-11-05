#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' codex-seguridad-proxy-40)
docker run --rm --name codex-seguridad-testssl-40 --network feruga_qa40_default -v /tmp/feruga-codex-qa14/qa/seguridad-40:/salida drwetter/testssl.sh@sha256:64bab3c1fd8eee440f68d5e020dd633c1f2d375fe0ae593bdfec2725110a7e29 --warnings batch --color 0 --nodns none --ip "$IP" --add-ca /salida/raiz.crt --jsonfile-pretty /salida/testssl.json --htmlfile /salida/testssl.html --logfile /salida/testssl.log https://patio.test > qa/seguridad-40/testssl-consola.txt 2>&1
