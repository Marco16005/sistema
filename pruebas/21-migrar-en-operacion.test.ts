// No se migra con la aplicación atendiendo. Con migraciones pendientes, el migrador se niega si la
// aplicación tiene conexiones abiertas, le cierra la puerta de la base antes de aplicar la primera,
// y solo se la vuelve a abrir el paso que deja listo su usuario, que corre cuando todas entraron.
// Si una falla a la mitad, la aplicación se queda fuera hasta que se resuelva.
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { comoApp, conBaseVacia, esperarQueEspere, pidDe, rechaza, urlDe } from "./apoyo.ts";
import { migrar } from "../db/migrar.ts";
import { asegurarRol } from "../db/rol.ts";

const MIGRACIONES = fileURLToPath(new URL("../db/migraciones", import.meta.url));
/** Lo que contesta la base a quien no tiene permiso de entrar a ella. */
const SIN_ENTRADA = "42501";
/** Un candado cualquiera, para detener una migración a la mitad. */
const BARRERA = 424242;

/** Las migraciones de verdad más las que se den, en una carpeta aparte. */
async function migracionesCon(extras: Record<string, string>): Promise<string> {
  const carpeta = await mkdtemp(join(tmpdir(), "migraciones-"));
  await cp(MIGRACIONES, carpeta, { recursive: true });
  for (const [archivo, sql] of Object.entries(extras)) await writeFile(join(carpeta, archivo), sql);
  return carpeta;
}

interface Base {
  base: string;
  /** La conexión de administración, que es la que migra. */
  db: pg.Client;
  aplicadas(): Promise<string[]>;
}

/** Una base ya migrada y con la aplicación pudiendo entrar: el estado de un sistema en marcha. */
const conBaseEnMarcha = (prueba: (b: Base) => Promise<void>) =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      await migrar(db);
      await asegurarRol(db, "feruga_prueba", "prueba");
      await prueba({
        base, db,
        aplicadas: async () => (await db.query("SELECT archivo FROM migracion WHERE archivo >= '9000' ORDER BY 1")).rows.map((f) => f.archivo),
      });
    } finally {
      await db.end();
    }
  });

test("una base recién migrada queda cerrada para la aplicación hasta que su usuario queda listo", () =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      await migrar(db);
      await rechaza(comoApp(base), SIN_ENTRADA);
      await asegurarRol(db, "feruga_prueba", "prueba");
      await (await comoApp(base)).end();
    } finally {
      await db.end();
    }
  }));

test("con migraciones pendientes y la aplicación conectada, el migrador se niega y no aplica nada", () =>
  conBaseEnMarcha(async (b) => {
    const app = await comoApp(b.base);
    const carpeta = await migracionesCon({ "9999_extra.sql": "CREATE TABLE extra (id int);" });
    try {
      await assert.rejects(migrar(b.db, carpeta), /sigue conectada.*No se aplicó nada/s);
      assert.deepEqual(await b.aplicadas(), []);
      assert.equal((await b.db.query("SELECT to_regclass('extra') AS t")).rows[0].t, null);
      // No le cerró la puerta: la aplicación sigue pudiendo entrar.
      await (await comoApp(b.base)).end();
      // Detenida la aplicación, ya migra.
      await app.end();
      assert.deepEqual(await migrar(b.db, carpeta), ["9999_extra.sql"]);
    } finally {
      await app.end().catch(() => {});
      await rm(carpeta, { recursive: true });
    }
  }));

test("mientras se migra la aplicación no puede entrar, y sigue sin poder hasta que su usuario queda listo", () =>
  conBaseEnMarcha(async (b) => {
    const vigia = new pg.Client({ connectionString: urlDe(b.base) });
    await vigia.connect();
    const carpeta = await migracionesCon({
      "9999_lenta.sql": `SELECT pg_advisory_lock(${BARRERA}); SELECT pg_advisory_unlock(${BARRERA}); CREATE TABLE extra (id int);`,
    });
    try {
      await vigia.query("SELECT pg_advisory_lock($1)", [BARRERA]);
      const migrando = migrar(b.db, carpeta);
      await esperarQueEspere(vigia, await pidDe(b.db));
      await rechaza(comoApp(b.base), SIN_ENTRADA);
      await vigia.query("SELECT pg_advisory_unlock($1)", [BARRERA]);
      assert.deepEqual(await migrando, ["9999_lenta.sql"]);
      await rechaza(comoApp(b.base), SIN_ENTRADA);
      await asegurarRol(b.db, "feruga_prueba", "prueba");
      await (await comoApp(b.base)).end();
    } finally {
      await vigia.end();
      await rm(carpeta, { recursive: true });
    }
  }));

test("si una migración falla a la mitad, las anteriores quedan, la aplicación sigue fuera, y al corregirla sigue desde ahí", () =>
  conBaseEnMarcha(async (b) => {
    const carpeta = await migracionesCon({
      "9997_una.sql": "CREATE TABLE una (id int);",
      "9998_dos.sql": "CREATE TABLE dos (id int);",
      "9999_rota.sql": "CREAT TABLE tres (id int);",
    });
    try {
      await assert.rejects(migrar(b.db, carpeta), /9999_rota\.sql.*sigue cerrada/s);
      assert.deepEqual(await b.aplicadas(), ["9997_una.sql", "9998_dos.sql"]);
      await rechaza(comoApp(b.base), SIN_ENTRADA);
      await writeFile(join(carpeta, "9999_rota.sql"), "CREATE TABLE tres (id int);");
      assert.deepEqual(await migrar(b.db, carpeta), ["9999_rota.sql"]);
      await rechaza(comoApp(b.base), SIN_ENTRADA);
      await asegurarRol(b.db, "feruga_prueba", "prueba");
      await (await comoApp(b.base)).end();
    } finally {
      await rm(carpeta, { recursive: true });
    }
  }));

test("sin migraciones pendientes el migrador no toca nada, aunque la aplicación esté conectada", () =>
  conBaseEnMarcha(async (b) => {
    const app = await comoApp(b.base);
    try {
      assert.deepEqual(await migrar(b.db), []);
      await (await comoApp(b.base)).end();
      assert.equal((await app.query("SELECT 1 AS uno")).rows[0].uno, 1);
    } finally {
      await app.end();
    }
  }));
