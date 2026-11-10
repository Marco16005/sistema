import pg from 'pg';
const cs=Array.from({length:100},()=>new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000}));
try{
 await Promise.all(cs.map(c=>c.connect()));
 await Promise.all(cs.map(c=>c.query('SELECT 1')));
 console.log('CONEXIONES', (await cs[0].query("SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend'")).rows);
 await new Promise(r=>setTimeout(r,1000));
}finally{await Promise.all(cs.map(c=>c.end().catch(()=>{})));}
