import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const dir='/app/qa/r43-proceso-ajeno';mkdirSync(dir+'/operacion',{recursive:true});writeFileSync(dir+'/operacion/publicar.sh','#!/bin/sh\nsleep 30\nexit 0\n');
const p=spawn('sh',['operacion/publicar.sh'],{cwd:dir,detached:true});
try { await new Promise(r=>setTimeout(r,200)); const q=spawnSync('pgrep',['-f','sh operacion/publicar.sh'],{encoding:'utf8'});console.log('pgrep exit:',q.status,'incluye al proceso de otra instalación:',q.stdout.trim().split(/\s+/).includes(String(p.pid))); }
finally {process.kill(-p.pid!,'SIGTERM');}
console.log('No se ejecutó pkill; solo se terminó por grupo al proceso de sonda propio.');
