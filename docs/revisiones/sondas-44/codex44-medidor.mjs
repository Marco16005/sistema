import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const nombre=process.argv[2]; const comando=process.argv.slice(3); const inicio=Date.now();
const leer=f=>readFileSync('/sys/fs/cgroup/'+f,'utf8').trim();
const pares=s=>Object.fromEntries(s.split('\n').map(l=>l.split(' ')).map(([k,v])=>[k,Number(v)]));
const max={memory:0,anon:0,file:0,shmem:0,inactive_file:0,pids:0,swap:0};
const antes=pares(leer('memory.events')); const cpuAntes=pares(leer('cpu.stat'));
function muestra(){try{const s=pares(leer('memory.stat')); const m={memory:Number(leer('memory.current')),anon:s.anon,file:s.file,shmem:s.shmem,inactive_file:s.inactive_file,pids:Number(leer('pids.current')),swap:Number(leer('memory.swap.current'))};for(const k in max)max[k]=Math.max(max[k],m[k]);}catch{}}
muestra();const reloj=setInterval(muestra,25);
const hijo=spawn(comando[0],comando.slice(1),{stdio:'inherit'});
process.on('SIGTERM',()=>hijo.kill('SIGTERM'));
hijo.on('exit',(code,signal)=>{clearInterval(reloj);muestra();const events=pares(leer('memory.events'));const cpu=pares(leer('cpu.stat'));const r={nombre,comando,segundos:(Date.now()-inicio)/1000,code,signal,max,memoryPeak:Number(leer('memory.peak')),pidsPeak:Number(leer('pids.peak')),events:Object.fromEntries(Object.keys(events).map(k=>[k,events[k]-antes[k]])),cpu:Object.fromEntries(Object.keys(cpu).map(k=>[k,cpu[k]-cpuAntes[k]]))};writeFileSync('/app/qa/'+nombre+'.json',JSON.stringify(r,null,2)+'\n');console.log('METRICAS',JSON.stringify(r));process.exitCode=code??1;});
