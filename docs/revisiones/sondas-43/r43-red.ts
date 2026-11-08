import { faltasDeRed } from '../operacion/comprobar.ts';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const normal = { services: { proxy: { networks: { entrada: {}, frente: {} } }, web: { networks: { frente: {} } }, db: { networks: { fondo: {} } } }, networks: { entrada: { name: 'codex43-entrada', external: true }, frente: { name: 'codex43-frente' }, fondo: { name: 'codex43-fondo' } } };
function caso(nombre: string, config: any, entrada: string | undefined = 'codex43-entrada') {
 console.log(nombre, JSON.stringify(faltasDeRed(config, { entrada })), 'local:', JSON.stringify(faltasDeRed(config, { entrada, local: true })));
}
caso('normal', normal);
const duplicada = structuredClone(normal); duplicada.networks.fondo.name = 'codex43-entrada';
caso('misma red por clave no external', duplicada);
const external = structuredClone(duplicada); (external.networks.fondo as any).external = true;
caso('misma red ambas external', external);
const invertida = {...duplicada, networks: {fondo: duplicada.networks.fondo, entrada: duplicada.networks.entrada, frente: duplicada.networks.frente}};
caso('mismo contenido invertido', invertida);
for(const modo of ['host','bridge','none','service:proxy','container:codex43-otro']) caso('network_mode '+modo,{...normal, services: {...normal.services, db: {network_mode: modo}}});
for(const entrada of ['', ' ', ' codex43-entrada ', undefined]) caso('entrada '+JSON.stringify(entrada),normal,entrada);
for(const [args, env] of [ [['--entrada=codex43-entrada'], {RED_DE_ENTRADA:'otra'}], [['--entrada=otra'], {RED_DE_ENTRADA:'codex43-entrada'}], [['--entrada='],{RED_DE_ENTRADA:'codex43-entrada'}] ] as const){
const r=spawnSync(process.execPath,['operacion/comprobar.ts','red',...args], {input: JSON.stringify(normal),encoding:'utf8',env:{PATH:process.env.PATH,...env}}); console.log('CLI',args,env,'exit',r.status, r.stdout.trim(),r.stderr.trim());
}
try {caso('Compose resuelto real', JSON.parse(readFileSync('qa/r43-colision.json','utf8')))} catch {}
