import { readFile } from 'node:fs/promises';
const {persona,clave,codigo}=JSON.parse(await readFile('/trabajo/web-acceso.json','utf8'));
const base='http://codex44-proxy:8080';let cookie='';
async function post(url,data){const r=await fetch(base+url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});const texto=await r.text();if(r.status!==200)throw Error(r.status+':'+texto);cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;}
await post('/api/equipo/alta',{codigo});await post('/api/sesion/entrar',{persona,clave});
const rutas=['/panel','/panel/ganancia','/panel/dias','/panel/bitacora','/mostrador','/api/panel?desde=2025-11-10&hasta=2026-11-09','/api/panel/ganancia?desde=2025-11-10&hasta=2026-11-09&agrupar=mes','/api/historial','/api/bitacora','/api/inventario'];
const resultados=[];
for(const ruta of rutas){const t=Date.now();const r=await fetch(base+ruta,{headers:{Cookie:cookie}});const text=await r.text();resultados.push({ruta,status:r.status,bytes:Buffer.byteLength(text),ms:Date.now()-t});if(r.status!==200)throw Error(JSON.stringify(resultados)+text.slice(0,300));}
console.log('RUTAS',JSON.stringify(resultados));
const latencias=[];const errores=[];let bytes=0;
await Promise.all(Array.from({length:10},async(_,i)=>{for(let k=0;k<20;k++){const ruta=rutas[(k+i)%rutas.length];const t=Date.now();const r=await fetch(base+ruta,{headers:{Cookie:cookie}});bytes+=(await r.arrayBuffer()).byteLength;latencias.push(Date.now()-t);if(r.status!==200)errores.push({ruta,status:r.status});}}));
latencias.sort((a,b)=>a-b);console.log('CARGA',JSON.stringify({peticiones:latencias.length,concurrencia:10,p50:latencias[Math.floor(latencias.length*.5)],p95:latencias[Math.floor(latencias.length*.95)],max:latencias.at(-1),bytes,errores}));
