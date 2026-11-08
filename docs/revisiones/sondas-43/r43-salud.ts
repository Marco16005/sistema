import {createServer as https} from 'node:https';
import {createServer as http} from 'node:http';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {estadoPorHttps} from '../operacion/comprobar.ts';
import {revisarSitio,latir} from '../operacion/avisos.ts';
const ca=readFileSync('qa/r43-tls.crt','utf8');
let status=200,body=''; let recibida:any; let proxyCache=false; let cache=''; let origenConsultas=0;
const origen=http((q,s)=>{origenConsultas++; s.setHeader('Cache-Control','private, no-store'); s.end(JSON.stringify({bien:true,abierta:true,version:'pub43',base:'marca43',esquema:'esquema43'}));});
await new Promise<void>(r=>origen.listen(0,'127.0.0.1',r)); const port=(origen.address() as any).port;
const proxy=https({cert:ca,key:readFileSync('qa/r43-tls.key')},async(q,s)=>{
 recibida=q.headers;
 if(proxyCache) { if(!cache) cache=await (await fetch(`http://127.0.0.1:${port}`)).text(); s.setHeader('Age','86400'); s.end(cache); }
 else { s.statusCode=status; s.end(body); }
});
await new Promise<void>(r=>proxy.listen(443,'127.0.0.1',r));
const opts={dominio:'patio.test',maquina:'127.0.0.1',ca,plazo:500};
const check=async(label:string,o=opts)=>{try {const x=await estadoPorHttps(o); console.log(label,'ACEPTADA',JSON.stringify({abierta:x.abierta,version:x.version,base:x.base}));}catch(e){console.log(label,'RECHAZADA',(e as Error).message)}};
try {
 for(const [label,s,b] of [['502',502,'Bad Gateway'],['HTML 200',200,'<html>Otra app</html>'],['JSON ajeno',200,'{"ok":true}'],['Salud mínima de otra instancia',200,'{"bien":true,"abierta":true}']] as const){status=s;body=b;await check(label);}
 console.log('Última petición de latido SIN x-comprobador:',!recibida['x-comprobador']);
 await latir(()=>revisarSitio({estado:()=>estadoPorHttps(opts),disco:async()=>({libre:50e9,total:100e9})}),{bien:async()=>{console.log('LATIDO BIEN con salud mínima ajena')},fallo:async(_,why)=>{console.log('LATIDO FALLO',why)}},'sonda43',{reintentarEn:0});
 await check('Certificado para otro host',{...opts,dominio:'ajeno.test'});
 await check('DNS inexistente',{...opts,maquina:'codex43-no-existe.invalid'});
 proxyCache=true;
 await check('Llenar caché');
 await new Promise<void>(r=>origen.close(()=>r()));
 await check('Origen apagado, copia vieja, con credencial',{...opts,clave:'clave-falsa-de-sonda'} as any);
 const result=await new Promise<{code:number|null,out:string}>(r=>{
 const p=spawn(process.execPath,['operacion/comprobar.ts','https','--abierta','--version=pub43','--base=marca43'],{env:{PATH:process.env.PATH,DOMINIO:'patio.test',SITIO_POR:'127.0.0.1',SESION_CLAVE:'clave-falsa-de-sonda',NODE_EXTRA_CA_CERTS:'/app/qa/r43-tls.crt'}});
 let out='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>out+=x);p.on('exit',code=>r({code,out}));
 }); console.log('CLI origen apagado',JSON.stringify(result));
 console.log('Origen consultas totales',origenConsultas,'petición autenticada:',!!recibida['x-comprobador']);
} finally {await new Promise<void>(r=>proxy.close(()=>r())); origen.close();}
