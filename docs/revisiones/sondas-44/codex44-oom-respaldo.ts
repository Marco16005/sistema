import { existsSync,readdirSync,statSync,writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { respaldar } from '../operacion/respaldar.ts';
import { destinoRclone,claveDeSello } from '../operacion/destino.ts';
import { identidadDe } from '../operacion/llave.ts';
const llave=await readFile('/trabajo/llave.txt','utf8');
const destino=destinoRclone('codex44:codex44-respaldo/oom',{}, {sello:claveDeSello(llave)});
if(existsSync('/tmp/codex44-intento')){
 console.log('REINICIO carpetas',readdirSync('/tmp').filter(n=>n.startsWith('feruga-respaldo-')).map(n=>({carpeta:n,archivos:readdirSync('/tmp/'+n).map(f=>({f,bytes:statSync('/tmp/'+n+'/'+f).size}))})));
 console.log('REMOTO',JSON.stringify(await destino.listar()));
}else{
 writeFileSync('/tmp/codex44-intento','1');
 const original=destino.subir;
 destino.subir=async(...args)=>{
   console.log('SUBIDA_INICIADA',args[1]);
   const pendiente=original(...args);
   setTimeout(()=>{console.log('INYECTANDO_OOM');const b=[];for(;;)b.push(Buffer.alloc(8*1024*1024,0x44));},1000);
   await pendiente;
 };
 await respaldar({base:process.env.DATABASE_URL!,llavePublica:identidadDe(llave).publica,destino,decir:console.log,vigia:{inicio:async()=>console.log('VIGIA inicio'),bien:async()=>console.log('VIGIA bien'),fallo:async()=>console.log('VIGIA fallo')}});
}
