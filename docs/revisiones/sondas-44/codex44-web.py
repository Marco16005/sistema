import subprocess
from pathlib import Path

def run(a,**k):return subprocess.run(a,check=True,**k)
pwd=str(Path.cwd())
c=['docker','compose','-f','qa/codex44-compose.yml','-f','qa/codex44-s3.yml']
run(c+['run','--rm','--no-deps','-T','--name','codex44-web-setup','-e','DATABASE_URL=postgres://codex44:codex44-solo-prueba@db:5432/codex44-365','herramienta','qa/codex44-web-setup.ts'])
run(['docker','run','-d','--name','codex44-web','--network','codex44-red','--network-alias','web','--memory','768m','--memory-swap','768m','--cpus','1.5','--pids-limit','128','--entrypoint','node','-e','MODO=desarrollo','-e','DATABASE_URL=postgres://codex44_web:codex44-solo-prueba@db:5432/codex44-365','-e','SESION_CLAVE=codex44-clave-de-prueba-local-muy-larga','-e','COOKIE_SEGURA=0','-e','ORIGEN=http://codex44-proxy:8080','-v',pwd+'/qa:/app/qa','feruga-web:latest','qa/codex44-medidor.mjs','codex44-web','node','server.js'])
run(['docker','run','-d','--name','codex44-proxy','--network','codex44-red','--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','128','-v',pwd+'/qa/codex44-Caddyfile:/etc/caddy/Caddyfile:ro','-v',pwd+'/operacion/sitio.caddy:/etc/caddy/sitio.caddy:ro','feruga-escaneo-proxy:latest'])
run(['docker','cp','qa/codex44-db-monitor.sh','codex44-proxy:/tmp/codex44-db-monitor.sh'])
with open('qa/codex44-proxy-metricas.log','w') as f:
    mon=subprocess.Popen(['docker','exec','codex44-proxy','sh','/tmp/codex44-db-monitor.sh'],stdout=f)
    try:
        run(c+['run','-d','--no-deps','--name','codex44-web-carga','herramienta','qa/codex44-medidor.mjs','codex44-web-carga','node','qa/codex44-web-carga.ts'])
        run(['python3','qa/codex44-seguir.py','codex44-web-carga'])
    finally:
        run(['docker','exec','codex44-proxy','touch','/tmp/codex44-stop'])
        mon.wait()
        run(['docker','stop','-t','10','codex44-web','codex44-proxy'])
Path('qa/codex44-web-servidor.log').write_bytes(subprocess.check_output(['docker','logs','codex44-web'],stderr=subprocess.STDOUT))
