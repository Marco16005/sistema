// Arma la base plantilla: una base recién migrada de la que cada prueba saca su propia copia.
import pg from "pg";
import { migrar } from "./migrar.ts";

const ADMIN = process.env.PG_ADMIN_URL ?? "postgres://feruga:desarrollo@localhost:54329/postgres";
// Con otro nombre, dos corridas de la batería conviven en el mismo servidor sin pisarse la plantilla.
const PLANTILLA = process.env.PG_PLANTILLA ?? "feruga_plantilla";
if (!/^[a-z][a-z0-9_]{2,40}$/.test(PLANTILLA)) throw new Error(`Nombre de plantilla no válido: ${PLANTILLA}`);
const destino = new URL(ADMIN);
destino.pathname = "/" + PLANTILLA;

const admin = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 10_000 });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${PLANTILLA} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${PLANTILLA}`);
const db = new pg.Client({ connectionString: destino.toString(), connectionTimeoutMillis: 10_000 });
await db.connect();
try {
  const aplicadas = await migrar(db);
  console.log(`plantilla lista: ${aplicadas.length} migraciones`);
} finally {
  await db.end();
  await admin.end();
}
