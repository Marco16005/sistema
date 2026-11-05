#!/bin/sh
cd /tmp/feruga-codex-qa14
sleep 8
for rol in responsable mostrador patio consulta; do
 if [ -f "qa/seguridad-40/zap-$rol-consola.txt" ]; then cp "qa/seguridad-40/zap-$rol-consola.txt" "qa/seguridad-40/zap-$rol-intento-inicial.txt"; fi
 docker exec codex-seguridad-zap-40 python /zap/wrk/zap-40.py "$rol" > "qa/seguridad-40/zap-$rol-consola.txt" 2>&1 || echo "FALLO ZAP $rol"
done
