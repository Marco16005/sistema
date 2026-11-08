import {createRequire} from 'node:module';
import {rutaSinBase} from '../src/servidor/ruta.ts';
const require=createRequire(import.meta.url);
const NextServer=require('next/dist/server/next-server.js').default;
const {getRequestMeta}=require('next/dist/server/request-meta.js');
for(const proto of ['http','https']) {
 const req={url:'/api/salud',headers:{host:'patio.test','x-forwarded-host':'ajeno.test','x-forwarded-proto':proto}};
 NextServer.prototype.attachRequestMeta.call({fetchHostname:'0.0.0.0',port:3000,nextConfig:{experimental:{}}},req,{query:{}},true);
 console.log('Next proto',proto,'initURL',getRequestMeta(req,'initURL'));
}
process.env.ORIGEN='https://patio.test';
const ruta=rutaSinBase(async()=>({bien:true}));
for(const origin of ['https://ajeno.test','https://patio.test']) {
 const req=new Request('http://0.0.0.0:3000/api/sonda',{method:'POST',headers:{origin,host:'patio.test','x-forwarded-host':'ajeno.test','x-forwarded-proto':'http','content-type':'application/json'},body:'{}'});
 const r=await ruta(req);console.log('ORIGEN',origin,'con X-Forwarded falsos:',r.status);
}
