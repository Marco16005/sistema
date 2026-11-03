"""Rotación original, PostgreSQL 17 real desechable y barreras en ejecutables.
El manifiesto/Compose se simulan; psql y el candado son reales. Solo claves ficticias.
"""
import os, pathlib, shutil, subprocess, time, signal, json, re, fcntl
ROOT=pathlib.Path.cwd(); Q=ROOT/'qa'; F=Q/'rotacion-36'; F.mkdir(exist_ok=True)
D=shutil.which('docker'); N=shutil.which('node'); C='feruga-qa36-rotacion'; OLD='ClaveAnteriorFicticiaSoloQA36'; NEW='ClaveDelEnvFicticiaSoloQA36'
def run(a,**kw): return subprocess.run(a,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
image=re.search(r'(?m)^FROM (\S+)',(ROOT/'docker/db.Dockerfile').read_text()).group(1)
env={**os.environ,'POSTGRES_PASSWORD':OLD}
run([D,'run','-d','--name',C,'--log-driver','json-file','--network','none','-e','POSTGRES_PASSWORD','-e','POSTGRES_USER=feruga','-e','POSTGRES_DB=postgres',image,'-c','log_min_duration_sample=0','-c','log_statement_sample_rate=1'],env=env)
try:
 for _ in range(120):
  p=subprocess.run([D,'exec',C,'pg_isready','-h','127.0.0.1','-U','feruga','-d','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if p.returncode==0:break
  time.sleep(.5)
 else:raise RuntimeError('PostgreSQL no arrancó')
 run([D,"exec",C,"sh","-c",'sed -i "/^host/s/trust/scram-sha-256/" "$PGDATA/pg_hba.conf"'])
 run([D,'exec',C,'psql','-U','feruga','-d','postgres','-c','SELECT pg_reload_conf()'])
 wrapper=r'''#!NODE
import fs from 'node:fs'; import cp from 'node:child_process'; import path from 'node:path';
const cmd=path.basename(process.argv[1]), a=process.argv.slice(2), e=process.env, root=e.QA_FIX;
const log=x=>fs.appendFileSync(root+'/llamadas',JSON.stringify(x)+'\n');
const pause=async(p)=>{if(e.QA_PUNTO===p){fs.writeFileSync(root+'/llego',p);while(!fs.existsSync(root+'/seguir'))await new Promise(r=>setTimeout(r,20));}};
function real(c,args,input){const r=cp.spawnSync(c,args,{input,encoding:'utf8',env:e});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);return r.status??1;}
(async()=>{
 log([cmd,...a]);let rc=0;
 if(cmd==='git') {console.log('abcdef0123456789abcdef0123456789abcdef0123');}
 else if(cmd==='sh'&&a[0]==='operacion/levantar.sh'){await pause('antes-levantar');console.log('levantar simulado');}
 else if(cmd==='awk'){rc=real('/usr/bin/awk',a);await pause('despues-temporal');}
 else if(cmd==='mv'){await pause('antes-mv');rc=real('/bin/mv',a);await pause('despues-mv');}
 else if(cmd==='docker') {
  if(a[0]==='image'){}
  else if(a[0]==='compose'){if(a.includes('ps'))console.log(e.QA_DB);else console.log('name: qa36');}
  else if(a.includes('operacion/publicacion.ts')){if(a.at(-1)==='configuracion')console.log('vigente.json');else if(a.at(-1)==='vigente')console.log('pub36');}
  else if(a[0]==='exec'){
   const sql=fs.readFileSync(0,'utf8');await pause('antes-alter');
   let alters=+(fs.existsSync(root+'/alters')?fs.readFileSync(root+'/alters','utf8'):0)+1;fs.writeFileSync(root+'/alters',String(alters));
   if(e.QA_FALLO==='rollback'&&alters===2){process.exitCode=1;return;}
   const clave=/PASSWORD '([^']+)'/.exec(sql)?.[1];
   if(clave)fs.writeFileSync(root+'/ultima-clave',clave);
   rc=real(e.QA_DOCKER,['exec','-i',e.QA_DB,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','feruga','-d','postgres'],sql);
   await pause('despues-alter');if(e.QA_FALLO==='respuesta-perdida')rc=1;
  } else if(a.includes('psql')){
   let n=+(fs.existsSync(root+'/contador')?fs.readFileSync(root+'/contador','utf8'):0)+1;fs.writeFileSync(root+'/contador',String(n));
   if(e.QA_FALLO==='rollback'&&n===2){process.exitCode=1;return;}
   rc=real(e.QA_DOCKER,['exec','-e','PGPASSWORD',e.QA_DB,'psql','-X','-q','-t','-A','-h','127.0.0.1','-U','feruga','-d','postgres','-c','SELECT 1']);
   if(n===2)await pause('despues-verificar-nueva');if(n===3)await pause('despues-verificar-vieja');
  } else throw Error('Docker inesperado');
 } else rc=real('/bin/'+cmd,a);
 process.exitCode=rc;
})().catch(e=>{console.error(e.message);process.exitCode=99});
'''.replace('NODE',N)
 b=F/'bin'; b.mkdir(exist_ok=True)
 for c in ['docker','git','awk','mv','sh']:
  (b/c).write_text(wrapper);(b/c).chmod(0o755)
 op=F/'operacion';op.mkdir(exist_ok=True)
 for f in ['cambiar-clave-de-la-base.sh','candado.sh','pasos.sh'] : shutil.copyfile(ROOT/'operacion'/f,op/f)
 def sql(s):return run([D,'exec','-i',C,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','feruga','-d','postgres'],input=s).stdout
 def acepta(clave):
  p=subprocess.run([D,'exec','-e','PGPASSWORD',C,'psql','-X','-q','-t','-A','-h','127.0.0.1','-U','feruga','-d','postgres','-c','SELECT 1'],env={**os.environ,'PGPASSWORD':clave},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  return p.returncode==0 and p.stdout.strip()=='1'
 assert acepta(OLD) and not acepta('IncorrectaFicticia36'), 'autenticación de prueba no exige contraseña'
 puntos=['antes-alter','despues-alter','despues-verificar-nueva','despues-verificar-vieja','despues-temporal','antes-mv','despues-mv','antes-levantar']
 resultados=[]
 for senal in [signal.SIGTERM,signal.SIGKILL]:
  for punto in puntos:
   for f in ['llego','seguir','contador','ultima-clave','llamadas','alters']:(F/f).unlink(missing_ok=True)
   sql("SET log_min_duration_sample=-1; ALTER ROLE feruga PASSWORD '"+OLD+"';")
   (F/'.env').write_text('BD_CLAVE='+OLD+'\nOTRA=conservar\n')
   e={**os.environ,'PATH':str(b)+':'+os.environ['PATH'],'QA_FIX':str(F),'QA_DOCKER':D,'QA_DB':C,'QA_PUNTO':punto}
   e.pop('COMPOSE_ENV_FILES',None)
   p=subprocess.Popen(['/bin/sh','operacion/cambiar-clave-de-la-base.sh'],cwd=F,env=e,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   deadline=time.time()+25
   while not (F/'llego').exists():
    if p.poll() is not None:raise RuntimeError('terminó antes de barrera '+punto+str(p.communicate()))
    if time.time()>deadline:p.kill();raise RuntimeError('no llegó a barrera '+punto)
    time.sleep(.03)
   p.send_signal(senal);(F/'seguir').touch();out,err=p.communicate(timeout=15)
   time.sleep(.1)
   vigente=re.search(r'^BD_CLAVE=(.*)$',(F/'.env').read_text(),re.M).group(1)
   igual=acepta(vigente); ultima=(F/'ultima-clave').read_text() if (F/'ultima-clave').exists() else ''
   aviso=bool(re.search('quedaron distintas|--la-del-env|incomplet|recuper',out+err))
   filtrada=bool(ultima and ultima in (out+err+(F/'llamadas').read_text()))
   r={'punto':punto,'senal':senal.name,'env_autentica':igual,'advierte_desajuste':aviso,'clave_en_argumentos_o_salida':filtrada,'codigo':p.returncode}
   resultados.append(r);print(json.dumps(r),flush=True)
   (F/(punto+'-'+senal.name+'.salida')).write_text(out+err)
 # Errores posteriores al ALTER: retorno ambiguo y reversión fallida.
 for modo in ['rollback','respuesta-perdida']:
  for f in ['llego','seguir','contador','alters']:(F/f).unlink(missing_ok=True)
  sql("SET log_min_duration_sample=-1; ALTER ROLE feruga PASSWORD '"+OLD+"';")
  (F/'.env').write_text('BD_CLAVE='+OLD+'\nOTRA=conservar\n');e['QA_PUNTO']='';e['QA_FALLO']=modo
  p=subprocess.run(['/bin/sh','operacion/cambiar-clave-de-la-base.sh'],cwd=F,env=e,text=True,capture_output=True)
  assert p.returncode!=0 and not acepta(OLD)
  afirma=('se dejó la de antes' in p.stderr or 'No se tocó nada' in p.stderr)
  assert afirma
  print(json.dumps({'caso':modo,'env_autentica':False,'afirma_que_no_cambio':afirma}),flush=True)
  (F/(modo+'.salida')).write_text(p.stdout+p.stderr)
 e.pop('QA_FALLO',None)
 # Candado real: el script no debe llamar a Docker cuando otra operación lo tiene.
 with (F/'.operacion.candado').open('w+') as lock:
  lock.write('que=otra operacion QA36\ndesde=ahora\n');lock.flush();fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  (F/'llamadas').write_text('')
  p=subprocess.run(['/bin/sh','operacion/cambiar-clave-de-la-base.sh'],cwd=F,env=e,text=True,capture_output=True)
  assert p.returncode!=0 and 'otra operación' in p.stderr and not (F/'llamadas').read_text()
 print('Candado real ocupado: rechaza antes de Docker',flush=True)
 # Recuperación --la-del-env y ejecución idempotente. Levantar simulado; ensayo integral lo verifica.
 for f in ['llego','seguir','contador']:(F/f).unlink(missing_ok=True)
 (F/'.env').write_text('BD_CLAVE='+NEW+'\nOTRA=conservar\n');e['QA_PUNTO']=''
 for _ in range(2):
  r=run(['/bin/sh','operacion/cambiar-clave-de-la-base.sh','--la-del-env'],cwd=F,env=e);assert acepta(NEW)
 print('--la-del-env: recuperación e idempotencia aprobadas',flush=True)
 # El registro de PostgreSQL está configurado para muestrear todas las sentencias.
 logs=run([D,'logs',C]);clave_en_log=NEW in (logs.stdout+logs.stderr)
 print(json.dumps({'log_min_duration_sample':0,'log_statement_sample_rate':1,'clave_nueva_en_log_postgresql_y_docker':clave_en_log}),flush=True)
 assert clave_en_log
 (Q/'resultado-rotacion-36.json').write_text(json.dumps(resultados,indent=2))
finally:
 subprocess.run([D,'rm','-f',C],check=False,stdout=subprocess.DEVNULL)
