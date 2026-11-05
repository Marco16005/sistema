#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
CONSERVAR=1 sh qa/ensayo-40.sh > qa/seguridad-41/instalacion.txt 2>&1
trap 'python3 qa/seguridad-41/limpiar.py' EXIT
python3 qa/seguridad-41/red.py > qa/seguridad-41/red-consola.txt 2>&1
python3 qa/seguridad-41/preparar.py > qa/seguridad-41/preparar-consola.txt 2>&1
docker cp codex-seguridad-autoridad-40:/ca/raiz.crt qa/seguridad-41/raiz.crt
sonda() {
 docker run --rm --pull=never --name codex-seguridad-browser-41 --network feruga_qa40_default --dns 127.0.0.1 -e NODE_EXTRA_CA_CERTS=/salida/raiz.crt -v /tmp/feruga-codex-qa14/qa/seguridad-41:/salida codex-seguridad-browser:40 node "/salida/$1.cjs"
}
sonda preparar
sonda cabeceras
python3 qa/seguridad-41/precios.py
sonda navegador
sonda limites
docker run -d --pull=never --name codex-seguridad-zap-41 --network feruga_qa40_default --dns 127.0.0.1 --memory=1400m -v /tmp/feruga-codex-qa14/qa/seguridad-41:/zap/wrk --entrypoint java zaproxy/zap-stable@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab -Xmx768m -jar /zap/zap-2.16.1.jar -daemon -host 127.0.0.1 -port 8080 -config api.disablekey=true -config autoupdate.checkOnStart=false -config autoupdate.downloadNewRelease=false -config autoupdate.installAddonUpdates=false
n=0
until docker exec codex-seguridad-zap-41 python -c "import requests;requests.get('http://127.0.0.1:8080/JSON/core/view/version/',timeout=2).raise_for_status()" >/dev/null 2>&1; do
 n=$((n+1)); [ "$n" -lt 60 ]; sleep 1
done
docker exec codex-seguridad-zap-41 python /zap/wrk/zap-pasivo.py
