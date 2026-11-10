import pg from 'pg';
import {migrar} from '../db/migrar.ts';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
if(process.argv.includes('--oom')){
 const query=db.query.bind(db);
 db.query=(...args)=>{
   if(typeof args[0]==='string'&&args[0].includes('CREATE TABLE codex44_marca'))setTimeout(()=>{console.log('OOM EN MIGRACION');const b=[];for(;;)b.push(Buffer.alloc(8*1024*1024,0x44));},500);
   return query(...args);
 };
}
console.log('APLICADAS',await migrar(db,'/app/qa/codex44-migraciones'));
await db.end();
