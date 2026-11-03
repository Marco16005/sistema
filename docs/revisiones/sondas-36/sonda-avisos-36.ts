// Sonda adversaria; cada caso se ejecuta secuencialmente. Solo claves inventadas.
import assert from 'node:assert/strict';
import { createServer as tcp } from 'node:net';
import { createServer as tls, createSecureContext, TLSSocket, setDefaultCACertificates, getCACertificates } from 'node:tls';
import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { estadoPorHttps } from '../operacion/comprobar.ts';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { enviarCorreo } from '../operacion/correo.ts';
import { revisarSitio, latir, canalTelegram, avisarPendientes } from '../operacion/avisos.ts';
const carpeta=mkdtempSync(resolve('qa/certificado-36-'));
const CLAVE='ClaveFicticiaSoloSonda36';
const base={de:'a@b.mx',para:['c@d.mx'],asunto:'Tema\r\nBcc: intruso@x.mx',texto:'primero\r\n.\r\nMAIL FROM:<intruso@x.mx>\r\nBcc: intruso@x.mx',plazo:120};
try {
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',carpeta+'/key','-out',carpeta+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 const cert=readFileSync(carpeta+'/cert','utf8'), key=readFileSync(carpeta+'/key');
 setDefaultCACertificates([...getCACertificates('default'),cert]);
 for(const modo of ['smtps','starttls','eco-clave','eco-auth','espera-saludo','espera-auth','espera-datos','espera-quit','inyeccion-parcial']) {
  let comandos:string[]=[], datos='', enDatos=false, terminadores=0; const sockets=new Set<any>();
  function hablar(s:any, cifrado:boolean, saludo=true) {
   sockets.add(s);s.on('error',()=>{});let cola='';
   if(saludo&&modo!=='espera-saludo') s.write('220 listo\r\n');
   const recibir=(b:Buffer)=>{cola+=b.toString();let i;
    while((i=cola.indexOf('\r\n'))>=0){const l=cola.slice(0,i);cola=cola.slice(i+2);
     if(enDatos){if(l==='.') {terminadores++;enDatos=false;if(modo!=='espera-datos')s.write('250 recibido\r\n');}else datos+=l+'\r\n';continue;}
     comandos.push((cifrado?'TLS ':'PLANO ')+l);
     if(l.startsWith('EHLO'))s.write(cifrado?'250 AUTH PLAIN\r\n':'250-STARTTLS\r\n250 listo\r\n');
     else if(l==='STARTTLS'){
      if(modo==='inyeccion-parcial'){s.write('220 listo\r\n250');continue;}
      s.write('220 listo\r\n');s.off('data',recibir);const t=new TLSSocket(s,{isServer:true,secureContext:createSecureContext({key,cert})});hablar(t,true,false);return;
     } else if(l.startsWith('AUTH')) {
      assert.ok(cifrado,'AUTH sin TLS');
      if(modo==='eco-clave')s.write('535 contraseña rechazada '+CLAVE+'\r\n');
      else if(modo==='eco-auth')s.write('535 orden rechazada '+l+'\r\n');
      else if(modo!=='espera-auth')s.write('235 bien\r\n');
     } else if(l.startsWith('MAIL')||l.startsWith('RCPT'))s.write('250 bien\r\n');
     else if(l==='DATA'){enDatos=true;s.write('354 adelante\r\n');}
     else if(l==='QUIT'&&modo!=='espera-quit')s.end('221 adiós\r\n');
    }
   };s.on('data',recibir);
  }
  const plano=modo==='starttls'||modo==='inyeccion-parcial';
  const servidor=plano?tcp(s=>hablar(s,false)):tls({key,cert},s=>hablar(s,true));
  servidor.on('tlsClientError',()=>{});servidor.listen(0);await once(servidor,'listening');
  let error='';const inicio=Date.now();
  try {await enviarCorreo({...base,url:`${plano?'smtp':'smtps'}://usuario:${CLAVE}@localhost:${(servidor.address() as any).port}`});} catch(e){error=(e as Error).message;}
  finally {for(const s of sockets)s.destroy();servidor.close();}
  const ms=Date.now()-inicio;assert.ok(ms<2000);
  if(modo==='eco-clave')assert.ok(error.includes(CLAVE),'no se reprodujo fuga de clave');
  else if(modo==='eco-auth')assert.ok(error.includes(Buffer.from('\0usuario\0'+CLAVE).toString('base64')),'no se reprodujo fuga AUTH');
  else if(modo==='inyeccion-parcial')assert.match(error,/antes de cifrar/);
  else if(modo.startsWith('espera-')&&modo!=='espera-quit')assert.match(error,/a tiempo/);
  else {assert.equal(error,'');assert.equal(terminadores,1);assert.ok(!/^Bcc:/m.test(datos));assert.equal(Buffer.from(datos.split('\r\n\r\n')[1]!.replace(/\r\n/g,''),'base64').toString(),base.texto);}
  console.log(JSON.stringify({caso:modo,ms,fuga:modo.startsWith('eco-'),authPlano:comandos.some(x=>x.startsWith('PLANO AUTH')),terminadores}));
 }
 const ahora=new Date('2026-11-03T00:00:00Z'), DIA=86400000;
 const sano={desde:new Date(+ahora-10*DIA),hasta:new Date(+ahora+80*DIA)};
 for(const [nombre,disco,certificado,esperado] of [
  ['5 GB y 10% exactos',{libre:5e9,total:50e9},sano,'bien'],
  ['un byte menos de 5 GB',{libre:5e9-1,total:20e9},sano,'fallo'],
  ['un byte menos de 10%',{libre:10e9-1,total:100e9},sano,'fallo'],
  ['disco NaN',{libre:NaN,total:100e9},sano,'bien'],
  ['disco infinito',{libre:Infinity,total:100e9},sano,'bien'],
  ['libre mayor que total',{libre:40e9,total:20e9},sano,'bien'],
  ['total cero con libre positivo',{libre:40e9,total:0},sano,'bien'],
  ['certificado ausente',{libre:40e9,total:100e9},null,'bien'],
  ['certificado fecha inválida',{libre:40e9,total:100e9},{desde:new Date(NaN),hasta:new Date(NaN)},'bien'],
  ['certificado todavía no válido',{libre:40e9,total:100e9},{desde:new Date(+ahora+DIA),hasta:new Date(+ahora+91*DIA)},'bien'],
  ['un sexto exacto',{libre:40e9,total:100e9},{desde:new Date(+ahora-75*DIA),hasta:new Date(+ahora+15*DIA)},'bien'],
  ['un ms menos de un sexto',{libre:40e9,total:100e9},{desde:new Date(+ahora-75*DIA),hasta:new Date(+ahora+15*DIA-1)},'fallo'],
  ['certificado vencido',{libre:40e9,total:100e9},{desde:new Date(+ahora-90*DIA),hasta:ahora},'fallo'],
 ] as const) {
  let resultado='';await latir(()=>revisarSitio({estado:async()=>({certificado}),disco:async()=>disco,ahora:()=>ahora}),{bien:async()=>{resultado='bien'},fallo:async()=>{resultado='fallo'}});
  assert.equal(resultado,esperado);console.log(JSON.stringify({caso:nombre,latido:resultado}));
 }
 const token='123456:TokenFicticioSonda36';
 const servidor=http((q,r)=>r.writeHead(401).end(token));servidor.listen(0);await once(servidor,'listening');
 await assert.rejects(canalTelegram(token,'chat',{base:`http://localhost:${(servidor.address() as any).port}`,plazo:100}).enviar('texto'),(e:Error)=>!e.message.includes(token));servidor.close();
 console.log('Telegram: error HTTP sin token aunque el cuerpo lo contiene');
 let actualizados=0; const db={query:async(sql:string)=> {if(sql.startsWith('UPDATE')){actualizados++;return {rows:[]};}return {rows:[{id:'1',clase:'corte',fecha:'2026-11-03',diferencia:'-1',quien:'Prueba',hora:'12:00'}]};}};
 await avisarPendientes(db,[{nombre:'bien',enviar:async()=>{}},{nombre:'falla',enviar:async()=>{throw Error('falla')}}],'QA');assert.equal(actualizados,0);
 console.log('Canal fallido: sin UPDATE de enviado_en');
 // El latido usa timeout de inactividad: un servidor puede gotear sin terminar nunca.
 let conexion:any; let goteo:any;
 const lento=https({key,cert},(q,r)=>{conexion=q.socket;r.writeHead(200);r.write(' ');goteo=setInterval(()=>r.write(' '),20);});
 lento.listen(0);await once(lento,'listening');
 let termino=false;
 const consulta=estadoPorHttps({dominio:'localhost',maquina:'localhost',puerto:(lento.address() as any).port,plazo:70}).then(()=>{termino=true},()=>{termino=true});
 await new Promise(r=>setTimeout(r,350));
 console.log(JSON.stringify({caso:'HTTPS goteando',plazo:70,transcurrido:350,termino}));assert.equal(termino,false);
 clearInterval(goteo);conexion?.destroy();lento.close();
 await new Promise(r=>setTimeout(r,100));console.log(JSON.stringify({caso:'HTTPS respuesta truncada',termino}));

} finally {rmSync(carpeta,{recursive:true,force:true});}
