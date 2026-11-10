import {open} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {destinoRclone,huellaDe} from '../operacion/destino.ts';
const f=await open('/trabajo/multipart.bin','w');const bloque=randomBytes(1024*1024);for(let i=0;i<256;i++)await f.write(bloque);await f.close();
const d=destinoRclone('codex44:codex44-respaldo/multipart',{}, {sello:null});
await d.subir('/trabajo/multipart.bin','prueba.bin');
await d.bajar('prueba.bin','/trabajo/multipart-vuelto.bin');
const a=await huellaDe('/trabajo/multipart.bin');const b=await huellaDe('/trabajo/multipart-vuelto.bin');
if(a.sha256!==b.sha256)throw Error('huella distinta');console.log('MULTIPART',a);
