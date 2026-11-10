import subprocess,sys
from pathlib import Path
name=sys.argv[1]
assert name.startswith('codex44-')
with open('qa/'+name+'-db.log','w') as f:
    monitor=subprocess.Popen(['docker','exec','codex44-db','sh','/tmp/codex44-db-monitor.sh'],stdout=f)
    code=subprocess.check_output(['docker','wait',name],text=True).strip()
    subprocess.run(['docker','exec','codex44-db','touch','/tmp/codex44-stop'],check=True)
    monitor.wait()
    subprocess.run(['docker','exec','codex44-db','rm','/tmp/codex44-stop'],check=True)
Path('qa/'+name+'.log').write_bytes(subprocess.check_output(['docker','logs',name],stderr=subprocess.STDOUT))
print(name,'exit',code)
print(Path('qa/'+name+'.log').read_text()[-3500:])
