// La operación, vista desde la base, como la usa quien publica una versión: en qué estado está,
// cerrarla, esperar a que no quede nadie de la aplicación adentro, y abrirla en sus dos pasos.
//
// «Drenar» es lo que separa lo de antes de cerrar de lo de después: lo que entró antes de cerrar
// puede terminar, y el respaldo se toma cuando ya se comprobó que no queda ninguna sesión de la
// aplicación en la base. Pasado el plazo, las que queden se terminan y se vuelve a comprobar.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { comoApp, conBase, conBaseVacia, una, urlDe } from "./apoyo.ts";
import { migrar } from "../db/migrar.ts";
import { drenar, esperarAlMigrador, estadoDeLaBase } from "../operacion/operacion.ts";
import { ESQUEMA_ESPERADO } from "../src/servidor/esquema.ts";

const correr = promisify(execFile);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const MIGRACIONES = fileURLToPath(new URL("../db/migraciones", import.meta.url));
const PUB = "20261006T211000Z-fedcba987654-000002";
const marca = async (db: pg.Client): Promise<string> => (await una(db, "SELECT id FROM vida")).id;
const callado = { decir: () => {} };

test("el estado, como lo dice la base: su marca, su esquema, si está abierta, por cuál publicación, y cuántas sesiones tiene la aplicación", () =>
  conBase(async (db, base) => {
    const laMarca = await marca(db);
    const nueva = { base: { marca: laMarca, abierta: true, publicacion: null, decidida: false, abrio: false }, esquema: ESQUEMA_ESPERADO, motivo: null, sesiones: 0 };
    assert.deepEqual(await estadoDeLaBase(urlDe(base)), nueva);
    const app = await comoApp(base);
    try {
      assert.deepEqual(await estadoDeLaBase(urlDe(base)), { ...nueva, sesiones: 1 });
    } finally {
      await app.end();
    }
    await db.query("SELECT cerrar_operacion('Publicar una versión', $1)", [PUB]);
    const cerrada = { base: { marca: laMarca, abierta: false, publicacion: PUB, decidida: false, abrio: false }, esquema: ESQUEMA_ESPERADO, motivo: "Publicar una versión", sesiones: 0 };
    assert.deepEqual(await estadoDeLaBase(urlDe(base)), cerrada);
    await db.query("SELECT decidir_abrir($1)", [PUB]);
    assert.deepEqual(await estadoDeLaBase(urlDe(base)), { ...cerrada, base: { ...cerrada.base, decidida: true } });
    await db.query("SELECT abrir_operacion($1, $2)", [PUB, laMarca]);
    assert.deepEqual(await estadoDeLaBase(urlDe(base)), { ...nueva, base: { ...nueva.base, publicacion: PUB, decidida: true, abrio: true } });
  }));

test("una base que no existe, o que nunca se migró, es «no hay»; un servidor que no contesta no es lo mismo: falla", () =>
  conBaseVacia(async (base) => {
    assert.deepEqual(await estadoDeLaBase(urlDe(base)), { base: "no hay" });
    // Y un dato suelto de una base que no hay es vacío, no un error.
    assert.equal((await orden(base, "estado", "marca")).stdout.trim(), "");
    assert.deepEqual(await estadoDeLaBase(urlDe("una_base_que_no_existe_0001")), { base: "no hay" });
    const sinServidor = new URL(urlDe(base));
    sinServidor.port = "1";
    await assert.rejects(estadoDeLaBase(sinServidor.toString(), 2000), /no contesta/);
    const otraClave = new URL(urlDe(base));
    otraClave.password = "no-es-la-clave";
    await assert.rejects(estadoDeLaBase(otraClave.toString(), 2000), /no contesta/);
  }));

test("una base de antes del mantenimiento lo dice: tiene historia, y todavía no tiene dónde cerrarse", () =>
  conBaseVacia(async (base) => {
    const hasta25 = await mkdtemp(join(tmpdir(), "hasta25-"));
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      await cp(MIGRACIONES, hasta25, { recursive: true });
      for (const archivo of await readdir(hasta25)) if (archivo >= "0026") await rm(join(hasta25, archivo));
      await migrar(db, hasta25);
      assert.deepEqual(await estadoDeLaBase(urlDe(base)), { base: "sin mantenimiento", esquema: "0025_precio_especial.sql" });
    } finally {
      await db.end();
      await rm(hasta25, { recursive: true, force: true });
    }
  }));

test("drenar: con la operación abierta se niega; cerrada y sin nadie adentro, termina enseguida", () =>
  conBase(async (db, base) => {
    const app = await comoApp(base);
    try {
      await assert.rejects(drenar(db, { plazo: 50, pausa: 10, ...callado }), /está abierta/);
      assert.equal((await app.query("SELECT 1 AS uno")).rows[0].uno, 1, "drenó con la operación abierta");
    } finally {
      await app.end();
    }
    await db.query("SELECT cerrar_operacion('Publicar una versión', $1)", [PUB]);
    assert.deepEqual(await drenar(db, { plazo: 5000, pausa: 10, ...callado }), { terminadas: 0 });
  }));

test("drenar espera a quien todavía está adentro: lo que entró antes de cerrar puede terminar", () =>
  conBase(async (db, base) => {
    const app = await comoApp(base);
    await db.query("SELECT cerrar_operacion('Publicar una versión', $1)", [PUB]);
    // Tiene algo a medias: una transacción abierta. Termina sola, un momento después.
    await app.query("BEGIN");
    await app.query("SELECT 1");
    const termina = new Promise<void>((listo) => setTimeout(async () => {
      await app.query("COMMIT");
      await app.end();
      listo();
    }, 400));
    const dicho: string[] = [];
    const empezo = Date.now();
    assert.deepEqual(await drenar(db, { plazo: 10_000, pausa: 20, decir: (l) => dicho.push(l) }), { terminadas: 0 });
    assert.ok(Date.now() - empezo >= 350, "no esperó a que terminara");
    assert.match(dicho.join("\n"), /1 sesión de la aplicación/);
    assert.doesNotMatch(dicho.join("\n"), /Se terminaron/);
    await termina;
  }));

test("drenar, pasado el plazo, termina las sesiones de la aplicación que queden y comprueba que no quedó ninguna; las de administración no se tocan", () =>
  conBase(async (db, base) => {
    const [uno, dos] = [await comoApp(base), await comoApp(base)];
    const admin = new pg.Client({ connectionString: urlDe(base) });
    await admin.connect();
    uno.on("error", () => {});
    dos.on("error", () => {});
    try {
      await db.query("SELECT cerrar_operacion('Publicar una versión', $1)", [PUB]);
      await uno.query("BEGIN");
      const dicho: string[] = [];
      const empezo = Date.now();
      assert.deepEqual(await drenar(db, { plazo: 300, pausa: 20, decir: (l) => dicho.push(l) }), { terminadas: 2 });
      assert.ok(Date.now() - empezo >= 300, "no les dio el plazo");
      assert.match(dicho.join("\n"), /Se terminaron 2 sesiones/);
      assert.equal((await una(db, "SELECT count(*)::int AS n FROM pg_stat_activity a JOIN pg_roles r ON r.rolname = a.usename WHERE a.datname = current_database() AND NOT r.rolsuper")).n, 0);
      await assert.rejects(uno.query("SELECT 1"));
      await assert.rejects(dos.query("SELECT 1"));
      assert.equal((await admin.query("SELECT 1 AS uno")).rows[0].uno, 1, "terminó una sesión de administración");
    } finally {
      await Promise.all([uno.end().catch(() => {}), dos.end().catch(() => {}), admin.end()]);
    }
  }));

test("drenar no da por hecho que terminarlas bastó: si después sigue habiendo alguna, falla", async () => {
  // Una base de mentira donde la sesión de la aplicación no se va nunca, ni terminándola.
  const pedidas: string[] = [];
  const terca = {
    query: async (sql: string) => {
      pedidas.push(sql);
      if (/FROM mantenimiento/.test(sql)) return { rows: [{ abierta: false }], rowCount: 1 };
      if (/pg_terminate_backend/.test(sql)) return { rows: [{ pg_terminate_backend: true }], rowCount: 1 };
      return { rows: [{ n: 1 }], rowCount: 1 };
    },
  } as unknown as Pick<pg.Client, "query">;
  await assert.rejects(drenar(terca, { plazo: 30, pausa: 5, gracia: 60, ...callado }), /Sigue habiendo 1 sesión de la aplicación/);
  assert.equal(pedidas.filter((sql) => /pg_terminate_backend/.test(sql)).length, 1);
});

// ── el migrador de una publicación que se interrumpió ──────────────────────

/** Una sesión que tiene el candado del migrador, como lo tendría uno a media migración. */
async function migrando(base: string): Promise<pg.Client> {
  const sesion = new pg.Client({ connectionString: urlDe(base) });
  sesion.on("error", () => {});
  await sesion.connect();
  await sesion.query("SELECT pg_advisory_lock(7150)");
  return sesion;
}

test("antes de recuperar se espera al migrador que quedó corriendo: que el guion haya muerto no dice nada de la instrucción que dejó en la base", () =>
  conBase(async (db, base) => {
    // Nadie migra: no hay nada que esperar.
    assert.deepEqual(await esperarAlMigrador(db, { plazo: 5000, pausa: 10, ...callado }), { terminadas: 0 });
    // Uno migra, y termina solo dentro del plazo: se le espera, y no se le corta.
    const uno = await migrando(base);
    const termina = new Promise<void>((listo) => setTimeout(() => uno.end().then(listo), 400));
    const dicho: string[] = [];
    const empezo = Date.now();
    assert.deepEqual(await esperarAlMigrador(db, { plazo: 10_000, pausa: 20, decir: (l) => dicho.push(l) }), { terminadas: 0 });
    assert.ok(Date.now() - empezo >= 350, "no esperó al migrador");
    assert.match(dicho.join("\n"), /migrador.*sigue/);
    assert.doesNotMatch(dicho.join("\n"), /Se termin/);
    await termina;
  }));

test("si el migrador no termina en el plazo, se termina su sesión y se comprueba que soltó; a las demás sesiones no se les toca", () =>
  conBase(async (db, base) => {
    const terco = await migrando(base);
    // Otro migrador esperando su turno detrás del primero: también es del migrador.
    const enFila = new pg.Client({ connectionString: urlDe(base) });
    enFila.on("error", () => {});
    await enFila.connect();
    const esperando = enFila.query("SELECT pg_advisory_lock(7150)").then(() => "tomó el candado", (e) => (e as Error).message);
    // Y una sesión de administración que no tiene que ver: con otros candados, aunque se parezcan.
    const ajena = new pg.Client({ connectionString: urlDe(base) });
    await ajena.connect();
    await ajena.query("SELECT pg_advisory_lock(7152), pg_advisory_lock(0, 7150), pg_advisory_lock(4294967296 + 7150)");
    try {
      const dicho: string[] = [];
      assert.deepEqual(await esperarAlMigrador(db, { plazo: 300, pausa: 20, decir: (l) => dicho.push(l) }), { terminadas: 2 });
      assert.match(dicho.join("\n"), /Se terminó la sesión del migrador|Se terminaron 2 sesiones del migrador/);
      await assert.rejects(terco.query("SELECT 1"));
      assert.match(await esperando, /terminat|administrator|conexión|Connection/i);
      assert.equal((await ajena.query("SELECT 1 AS uno")).rows[0].uno, 1, "terminó una sesión que no era del migrador");
      // El candado quedó libre: otro lo toma sin esperar.
      assert.equal((await una(db, "SELECT pg_try_advisory_lock(7150) AS libre")).libre, true);
      await db.query("SELECT pg_advisory_unlock(7150)");
      // El migrador de OTRA base, en el mismo servidor, no es asunto de esta: ni se le espera ni se le toca.
      await conBase(async (_otraDb, otraBase) => {
        const deOtra = await migrando(otraBase);
        try {
          assert.deepEqual(await esperarAlMigrador(db, { plazo: 5000, pausa: 10, ...callado }), { terminadas: 0 });
          assert.equal((await deOtra.query("SELECT 1 AS uno")).rows[0].uno, 1);
        } finally {
          await deOtra.end();
        }
      });
    } finally {
      await Promise.all([terco.end().catch(() => {}), enFila.end().catch(() => {}), ajena.end()]);
    }
  }));

test("esperar al migrador no da por hecho que terminar su sesión bastó: si sigue ahí, falla", async () => {
  const terco = {
    query: async (sql: string) => (/pg_terminate_backend/.test(sql) ? { rows: [{}], rowCount: 1 } : { rows: [{ n: 1 }], rowCount: 1 }),
  } as unknown as Pick<pg.Client, "query">;
  await assert.rejects(esperarAlMigrador(terco, { plazo: 30, pausa: 5, gracia: 60, ...callado }), /El migrador sigue en la base/);
});

// ── por la línea de órdenes, como la usa el guion ──────────────────────────

const orden = (base: string, ...args: string[]) =>
  correr("node", ["operacion/operacion.ts", ...args], { cwd: RAIZ, env: { PATH: process.env.PATH, DATABASE_URL: urlDe(base), MODO: "desarrollo" } });

test("por la línea de órdenes: el estado sale en una línea de JSON; cerrar, drenar, decidir y abrir hacen lo suyo, y repetirlos no cambia nada", () =>
  conBase(async (db, base) => {
    const laMarca = await marca(db);
    const estado = async (): Promise<any> => {
      const { stdout } = await orden(base, "estado");
      assert.equal(stdout.trim().split("\n").length, 1, "el estado no salió en una sola línea");
      return JSON.parse(stdout);
    };
    assert.deepEqual((await estado()).base, { marca: laMarca, abierta: true, publicacion: null, decidida: false, abrio: false });
    // Un dato suelto, para el guion, que no trae con qué leer JSON.
    const dato = async (cual: string): Promise<string> => (await orden(base, "estado", cual)).stdout.trim();
    assert.deepEqual([await dato("marca"), await dato("abierta"), await dato("publicacion"), await dato("esquema")], [laMarca, "true", "", ESQUEMA_ESPERADO]);
    assert.match((await orden(base, "migrador", "5")).stdout, /No hay ningún migrador corriendo/);
    for (let vez = 0; vez < 2; vez++) await orden(base, "cerrar", PUB, "Publicar la versión de octubre");
    assert.deepEqual([await dato("abierta"), await dato("publicacion")], ["false", PUB]);
    assert.deepEqual([(await estado()).base.abierta, (await estado()).motivo], [false, "Publicar la versión de octubre"]);
    assert.match((await orden(base, "drenar", "5")).stdout, /No queda ninguna sesión de la aplicación/);
    // El plazo es el que se le pide, en segundos: a quien termina dentro de él no se le corta.
    const app = await comoApp(base);
    await app.query("BEGIN");
    const termina = new Promise<string>((listo) => setTimeout(() => app.query("COMMIT").then(() => app.end()).then(() => listo("terminó sola"), (e) => listo(`se le cortó: ${(e as Error).message}`)), 600));
    const drenado = await orden(base, "drenar", "20");
    assert.equal(await termina, "terminó sola");
    assert.doesNotMatch(drenado.stdout, /Se terminaron/);
    // Abrir sin haber decidido, o con otra marca: no, y lo dice.
    await assert.rejects(orden(base, "abrir", PUB, laMarca), (e: any) => e.code === 1 && /no se ha decidido abrir/.test(e.stderr));
    for (let vez = 0; vez < 2; vez++) await orden(base, "decidir", PUB);
    await assert.rejects(orden(base, "abrir", PUB, "00000000-0000-4000-8000-000000000000"), (e: any) => e.code === 1 && /su marca es otra/.test(e.stderr));
    assert.equal((await estado()).base.abierta, false);
    for (let vez = 0; vez < 2; vez++) await orden(base, "abrir", PUB, laMarca);
    assert.deepEqual((await estado()).base, { marca: laMarca, abierta: true, publicacion: PUB, decidida: true, abrio: true });
    // Cada paso quedó una vez en la bitácora.
    assert.deepEqual((await db.query("SELECT detalle->>'paso' AS paso FROM bitacora WHERE accion = 'mantenimiento' ORDER BY id")).rows.map((f) => f.paso), ["cerrar", "decidir", "abrir"]);
  }));

test("por la línea de órdenes: una orden que no existe o a la que le falta algo no hace nada, y dice cómo se usa", () =>
  conBase(async (db, base) => {
    for (const args of [[], ["cerrar"], ["cerrar", PUB], ["abrir", PUB], ["decidir"], ["drenar", "pronto"], ["abre", PUB, "x"], ["estado", "de más"], ["estado", "marca", "y más"], ["migrador", "ya"]]) {
      await assert.rejects(orden(base, ...args), (e: any) => e.code === 2 && /Uso:/.test(e.stderr), args.join(" "));
    }
    assert.equal((await una(db, "SELECT abierta FROM mantenimiento")).abierta, true);
  }));
