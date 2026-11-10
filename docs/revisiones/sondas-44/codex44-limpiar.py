import subprocess,json
from pathlib import Path

def names(args):
    return [s for s in subprocess.check_output(args,text=True).splitlines() if s.startswith('codex44-')]
containers=names(['docker','ps','-a','--format','{{.Names}}'])
if containers:subprocess.run(['docker','rm','-f',*containers],check=True)
volumes=names(['docker','volume','ls','--format','{{.Name}}'])
if volumes:subprocess.run(['docker','volume','rm',*volumes],check=True)
networks=names(['docker','network','ls','--format','{{.Name}}'])
if networks:subprocess.run(['docker','network','rm',*networks],check=True)
restan={
 'contenedores':names(['docker','ps','-a','--format','{{.Names}}']),
 'volumenes':names(['docker','volume','ls','--format','{{.Name}}']),
 'redes':names(['docker','network','ls','--format','{{.Name}}']),
}
resultado={'eliminados':{'contenedores':containers,'volumenes':volumes,'redes':networks},'restantes':restan}
Path('qa/codex44-limpieza.json').write_text(json.dumps(resultado,indent=2)+'\n')
print(json.dumps(restan));assert not any(restan.values())
