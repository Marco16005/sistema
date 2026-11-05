#!/bin/sh
set -eu
cd /tmp/feruga-codex-qa14
for rol in mostrador patio consulta responsable; do
 docker exec -e ZAP_MINUTOS=20 -e ZAP_REGLA_MINUTOS=5 codex-seguridad-zap-40 python /zap/wrk/zap-40.py "$rol" > "qa/seguridad-40/zap-$rol-continuacion-consola.txt" 2>&1
 python3 qa/seguridad-40/resumir-zap.py "$rol"
done
