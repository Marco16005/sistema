#!/bin/sh
# Solo con las imágenes ya disponibles. No instala paquetes ni apunta a otros proyectos.
set -eu
cd /tmp/feruga-codex-qa14
CONSERVAR=1 sh qa/ensayo-40.sh > qa/seguridad-40/reconstruccion-consola.txt 2>&1
python3 qa/seguridad-40/red-continuacion.py > qa/seguridad-40/red-continuacion-consola.txt 2>&1
docker cp codex-seguridad-autoridad-40:/ca/raiz.crt qa/seguridad-40/raiz.crt
docker run -d --pull=never --name codex-seguridad-zap-40 --network feruga_qa40_default --dns 127.0.0.1 --memory=1400m -v /tmp/feruga-codex-qa14/qa/seguridad-40:/zap/wrk --entrypoint java zaproxy/zap-stable@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab -Xmx768m -jar /zap/zap-2.16.1.jar -daemon -host 127.0.0.1 -port 8080 -config api.disablekey=true -config autoupdate.checkOnStart=false -config autoupdate.downloadNewRelease=false -config autoupdate.installAddonUpdates=false
n=0
until docker exec codex-seguridad-zap-40 python -c "import requests;requests.get('http://127.0.0.1:8080/JSON/core/view/version/',timeout=2).raise_for_status()" >/dev/null 2>&1; do
 n=$((n+1)); [ "$n" -lt 60 ]; sleep 1
done
python3 qa/seguridad-40/preparar-datos.py > qa/seguridad-40/datos-continuacion.txt 2>&1
docker exec codex-seguridad-zap-40 python /zap/wrk/manual.py > qa/seguridad-40/manual-continuacion-consola.txt 2>&1
docker exec codex-seguridad-zap-40 python /zap/wrk/negocio.py > qa/seguridad-40/negocio-continuacion-consola.txt 2>&1
sh qa/seguridad-40/activos-continuacion.sh > qa/seguridad-40/activos-continuacion-consola.txt 2>&1
python3 qa/seguridad-40/preparar-visual.py
docker exec codex-seguridad-zap-40 python /zap/wrk/datos-visual.py
python3 qa/seguridad-40/visual-fixture.py
docker exec codex-seguridad-zap-40 python /zap/wrk/cuentas-visual.py
for script in browser-continuacion browser-alertas breach-navegador; do
 docker run --rm --pull=never --name codex-seguridad-browser-40 --network feruga_qa40_default --dns 127.0.0.1 -v /tmp/feruga-codex-qa14/qa/seguridad-40:/salida codex-seguridad-browser:40 node "/salida/$script.cjs" > "qa/seguridad-40/$script-consola.txt" 2>&1
done
docker exec codex-seguridad-zap-40 python /zap/wrk/breach-continuacion.py > qa/seguridad-40/breach-continuacion-consola.txt 2>&1
docker exec codex-seguridad-zap-40 python /zap/wrk/confirmar-alertas.py > qa/seguridad-40/confirmar-alertas-consola.txt 2>&1
python3 qa/seguridad-40/control-red.py > qa/seguridad-40/control-red-consola.txt 2>&1
# Revisar y guardar resultados antes de retirar con limpiar-continuacion.py.
