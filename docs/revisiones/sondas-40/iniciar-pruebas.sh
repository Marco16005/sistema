#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
while [ ! -f qa/seguridad-40/trabajo.txt ]; do sleep 2; done
docker cp codex-seguridad-autoridad-40:/ca/raiz.crt qa/seguridad-40/raiz.crt
python3 qa/seguridad-40/preparar-datos.py > qa/seguridad-40/datos.txt 2>&1
docker exec codex-seguridad-zap-40 python /zap/wrk/manual.py > qa/seguridad-40/manual-consola.txt 2>&1
docker exec codex-seguridad-zap-40 python /zap/wrk/zap-40.py anonimo > qa/seguridad-40/zap-anonimo-consola.txt 2>&1
for rol in responsable mostrador patio consulta; do
 docker exec codex-seguridad-zap-40 python /zap/wrk/zap-40.py "$rol" > "qa/seguridad-40/zap-$rol-consola.txt" 2>&1 || echo "FALLO ZAP $rol"
done
