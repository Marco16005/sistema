const fs=require('fs'), assert=require('assert');const {request}=require('/app/node_modules/playwright');
(async()=>{const p='/salida',c=JSON.parse(fs.readFileSync(p+'/credenciales.json'));const ctx=await request.newContext({baseURL:'https://patio.test',extraHTTPHeaders:{Origin:'https://patio.test','X-Persona':c.id}});
async function r(path,data){const res=data===undefined?await ctx.get(path):await ctx.post(path,{data});assert.equal(res.status(),200,path+' '+await res.text());return res.json()}
await r('/api/equipo/alta',{codigo:c.codigo});await r('/api/sesion/entrar',{persona:c.id,clave:c.clave});await r('/api/arranque/terminar',{saldos:[]});await r('/api/jornada/abrir',{});
const state=await ctx.storageState();fs.writeFileSync(p+'/estado.json',JSON.stringify(state));fs.writeFileSync(p+'/sesion.json',JSON.stringify({id:c.id,cookie:'feruga='+state.cookies.find(x=>x.name==='feruga').value}));
const payloads=['<img src=x onerror=alert(40)>','<script>alert(40)</script>','<b>QA40 HTML</b>'],cases=[];
for(const payload of payloads){const cliente=(await r('/api/clientes',{nombre:payload+' V40'})).cliente;const material=(await r('/api/materiales',{familia:1,nombre:payload+' V40',nombreCorto:'<b>V40 '+cases.length+'</b>',frecuente:true})).material;cases.push({payload,cliente,material})}
fs.writeFileSync(p+'/visual-casos.json',JSON.stringify(cases,null,2));await ctx.dispose();console.log('Sesión responsable y tres pares de nombres preparados');})().catch(e=>{console.error(e);process.exit(1)});
