import subprocess
from pathlib import Path

def run(a,**k): return subprocess.run(a,check=True,**k)
run(['docker','wait','codex44-anual'])
state=subprocess.check_output(['docker','inspect','codex44-anual','--format','{{.State.ExitCode}}'],text=True).strip()
assert state=='0',state
c=['docker','compose','-f','qa/codex44-compose.yml','-f','qa/codex44-s3.yml']
run(c+['up','-d','s3'])
run(c+['run','--rm','--no-deps','-T','--name','codex44-init','--entrypoint','sh','herramienta','-c','age-keygen -o /trabajo/llave.txt 2>/dev/null; rclone --config /dev/null mkdir codex44:codex44-respaldo'])
def fase(nombre,cmd,extra=[]):
    run(c+extra+['run','-d','--no-deps','--name',nombre,'-e','DATABASE_URL=postgres://codex44:codex44-solo-prueba@db:5432/codex44-365','-e','PGDATABASE=codex44-365','herramienta','qa/codex44-medidor.mjs',nombre,*cmd])
    run(['python3','qa/codex44-seguir.py',nombre])
    assert subprocess.check_output(['docker','inspect',nombre,'--format','{{.State.ExitCode}}'],text=True).strip()=='0'
fase('codex44-respaldo',['node','qa/codex44-respaldo.ts'])
fase('codex44-pipeline',['sh','qa/codex44-pipeline.sh'],['-f','qa/codex44-sin-swap.yml'])
run(['docker','exec','codex44-db','createdb','-U','codex44','codex44-restaurada'])
fase('codex44-restaurar',['sh','qa/codex44-restaurar.sh'],['-f','qa/codex44-sin-swap.yml'])
