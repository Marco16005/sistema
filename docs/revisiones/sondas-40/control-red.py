from pathlib import Path
import subprocess,json
p=Path(__file__).parent;t=Path((p/'trabajo.txt').read_text().strip());conf=next((t/'instalacion/publicaciones').glob('*/conjunto.json'))
cmd=['docker','compose','-p','feruga_qa40','-f',str(conf),'-f',str((p/'control-red-sin-puerto.yml').resolve()),'up','-d','--no-deps','--wait','db']
(p/'control-red-orden.json').write_text(json.dumps(cmd));r=subprocess.run(cmd,capture_output=True,text=True);(p/'control-red-recrear.txt').write_text(r.stdout+r.stderr);assert r.returncode==0
s=(p/'red-continuacion.py').read_text().replace('red-continuacion','red-control-sin-puerto').replace('## Revalidación R40-01: separación de redes','## Control R40-01: misma base y redes, sin publicar 5432 en el host')
(p/'red-control-sin-puerto.py').write_text(s)
subprocess.run(['python3',str(p/'red-control-sin-puerto.py')],check=True)
