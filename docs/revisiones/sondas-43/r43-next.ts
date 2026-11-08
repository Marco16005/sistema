import {readFileSync} from 'node:fs';
const root='node_modules/next/';
console.log('VERSION',JSON.parse(readFileSync(root+'package.json','utf8')).version);
for(const file of ['dist/server/base-server.js','dist/server/next-server.js','dist/server/lib/router-server.js','dist/server/app-render/action-handler.js','dist/server/web/next-url.js','dist/shared/lib/get-hostname.js','dist/server/web/spec-extension/adapters/next-request.js']) {
 const lines=readFileSync(root+file,'utf8').split('\n');
 console.log('\nFILE '+file);
 const selected = new Set<number>();
 for(let i=0;i<lines.length;i++) if(/x-forwarded|initProtocol|initURL|fetchHostname|trustHostHeader/.test(lines[i])) for(let j=Math.max(0,i-3);j<Math.min(lines.length,i+5);j++) selected.add(j);
 for(const j of selected) console.log((j+1)+': '+lines[j]);
}
