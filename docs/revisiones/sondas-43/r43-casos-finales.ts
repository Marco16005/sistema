import {readFileSync} from 'node:fs';
import {faltasDeRed,redesQueDebenExistir} from '../operacion/comprobar.ts';
for(const label of ['normal','consola','todos','espacios','con-espacios']) {
const c=JSON.parse(readFileSync(`qa/r43-compose-${label}.json`,'utf8'));
const o={entrada:c.services.comprobacion.environment.RED_DE_ENTRADA};
console.log(label,JSON.stringify(faltasDeRed(c,o)), 'redesDeFuera',JSON.stringify(redesQueDebenExistir(c)));
}
const c=JSON.parse(readFileSync('qa/r43-compose-normal.json','utf8')); const o={entrada:'codex43-entrada'};
const b=structuredClone(c);delete b.services.db.networks;b.services.db.network_mode='bridge';console.log('DB bridge',JSON.stringify(faltasDeRed(b,o)));
const n=structuredClone(c);delete n.services.db.networks;n.services.db.network_mode='none';console.log('DB none',JSON.stringify(faltasDeRed(n,o)));
const a=structuredClone(c);a.services.proxy.networks.entrada.aliases=['otro-alias'];console.log('Alias personalizado',JSON.stringify(faltasDeRed(a,o)));
const p=structuredClone(c);p.services.proxy.ports=[{host_ip:'127.0.0.1',published:'12345',target:80}];console.log('entrada y local no permite puertos',JSON.stringify(faltasDeRed(p,{...o,local:true})));
