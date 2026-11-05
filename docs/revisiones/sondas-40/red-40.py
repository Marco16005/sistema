from pathlib import Path
import subprocess,json
p=Path('/tmp/feruga-codex-qa14/qa/seguridad-40')
n=json.loads(subprocess.check_output(['docker','network','inspect','feruga_qa40_default']))[0];(p/'red.json').write_text(json.dumps(n,indent=2))
targets=[]
for c in n['Containers'].values():
 if c['Name'] in ['codex-seguridad-'+s+'-40' for s in ['proxy','web','db','respaldo','autoridad','vigia','almacen-ensayo']]:targets.append(c['IPv4Address'].split('/')[0])
cmd=['docker','run','--rm','--name','codex-seguridad-nmap-40','--network','feruga_qa40_default','-v',str(p)+':/salida','instrumentisto/nmap@sha256:3cca6ece8de5a571c956022ec6c2cf343da8c4416fa36e1891e8c33623cfc845','-sT','-sV','--version-light','-Pn','-n','-p-','-T3','--max-retries','1','--host-timeout','240s','-oA','/salida/nmap',*targets]
(p/'nmap-orden.json').write_text(json.dumps(cmd));r=subprocess.run(cmd,stdout=(p/'nmap-consola.txt').open('w'),stderr=subprocess.STDOUT);(p/'nmap-rc.txt').write_text(str(r.returncode))
