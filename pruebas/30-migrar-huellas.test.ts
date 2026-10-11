// Las huellas de las migraciones. El migrador guarda la huella de cada migración que aplica, y con
// eso se niega a migrar una base con una carpeta que no es la continuación de lo que la base ya
// tiene: una aplicada que cambió, una que la carpeta ya no trae, o una nueva que quiere entrar antes
// de la última. Lo comprueba con su candado tomado, justo antes de aplicar.
//
// Revisar dice todo eso sin aplicar ni escribir nada: es lo que una versión candidata le pregunta a
// la base que está atendiendo, antes de publicarse.
//
// Una base de antes de las huellas se sella una vez, a propósito y con los archivos de la versión
// que corre. Ese sello es confianza, no verificación, y por eso queda dicho cuáles son.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { comoApp, conBaseVacia, esperarQueEspere, pidDe, urlDe } from "./apoyo.ts";
import { migrar, revisar, sellar } from "../db/migrar.ts";
import { asegurarRol } from "../db/rol.ts";

const correr = promisify(execFile);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const MIGRACIONES = fileURLToPath(new URL("../db/migraciones", import.meta.url));
const DE_VERDAD = (await readdir(MIGRACIONES)).filter((a) => a.endsWith(".sql")).sort();
/** Un candado cualquiera, para detener una migración a la mitad. */
const BARRERA = 434343;

const huellaDe = async (carpeta: string, archivo: string): Promise<string> =>
  createHash("sha256").update(await readFile(join(carpeta, archivo))).digest("hex");

/** Las migraciones de verdad —menos las que se digan— más las que se den, en una carpeta aparte. */
async function migracionesCon(extras: Record<string, string>, sin: string[] = []): Promise<string> {
  const carpeta = await mkdtemp(join(tmpdir(), "huellas-"));
  await cp(MIGRACIONES, carpeta, { recursive: true });
  for (const archivo of sin) await rm(join(carpeta, archivo));
  for (const [archivo, sql] of Object.entries(extras)) await writeFile(join(carpeta, archivo), sql);
  return carpeta;
}

interface Base {
  base: string;
  /** La conexión de administración, que es la que migra. */
  db: pg.Client;
  /** Las carpetas que la prueba arme se borran al terminar. */
  carpeta(extras: Record<string, string>, sin?: string[]): Promise<string>;
  /** Lo que la base dice de cada migración aplicada. */
  registro(): Promise<Record<string, { huella: string | null; sellada: boolean }>>;
  hay(tabla: string): Promise<boolean>;
  /** La aplicación puede entrar: nadie le cerró la puerta. */
  laAplicacionEntra(): Promise<void>;
}

/** Una base ya migrada con las migraciones de verdad y con la aplicación pudiendo entrar. */
const conBaseEnMarcha = (prueba: (b: Base) => Promise<void>) =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    const carpetas: string[] = [];
    try {
      await migrar(db);
      await asegurarRol(db, "feruga_prueba", "prueba");
      await prueba({
        base, db,
        carpeta: async (extras, sin) => {
          const c = await migracionesCon(extras, sin);
          carpetas.push(c);
          return c;
        },
        registro: async () =>
          Object.fromEntries((await db.query("SELECT archivo, huella, sellada_en IS NOT NULL AS sellada FROM migracion")).rows.map((f) => [f.archivo, { huella: f.huella, sellada: f.sellada }])),
        hay: async (tabla) => (await db.query("SELECT to_regclass($1) IS NOT NULL AS hay", [`public.${tabla}`])).rows[0].hay,
        laAplicacionEntra: async () => (await comoApp(base)).end(),
      });
    } finally {
      await db.end();
      for (const c of carpetas) await rm(c, { recursive: true, force: true });
    }
  });

/** La base, como la dejaba el migrador de antes: sin dónde guardar huellas. */
const comoAntesDeLasHuellas = (db: pg.Client) => db.query("ALTER TABLE migracion DROP COLUMN huella, DROP COLUMN sellada_en");
const columnasDelRegistro = async (db: pg.Client): Promise<string[]> =>
  (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'migracion' ORDER BY 1")).rows.map((c) => c.column_name);

test("al aplicar, el migrador guarda la huella de cada migración: la de sus bytes, tal cual estaban", () =>
  conBaseEnMarcha(async (b) => {
    const registro = await b.registro();
    assert.deepEqual(Object.keys(registro).sort(), DE_VERDAD);
    for (const archivo of DE_VERDAD) {
      assert.deepEqual(registro[archivo], { huella: await huellaDe(MIGRACIONES, archivo), sellada: false }, archivo);
    }
    // Y las que entran después, igual.
    const carpeta = await b.carpeta({ "9998_una.sql": "CREATE TABLE una (id int);\n" });
    assert.deepEqual(await migrar(b.db, carpeta), ["9998_una.sql"]);
    assert.deepEqual((await b.registro())["9998_una.sql"], { huella: await huellaDe(carpeta, "9998_una.sql"), sellada: false });
  }));

test("una migración ya aplicada que cambió —aunque sea un comentario— detiene al migrador: no aplica las pendientes ni le cierra la puerta a la aplicación", () =>
  conBaseEnMarcha(async (b) => {
    const carpeta = await b.carpeta({ "9998_una.sql": "CREATE TABLE una (id int);\n" });
    await migrar(b.db, carpeta);
    await asegurarRol(b.db, "feruga_prueba", "prueba");
    await appendFile(join(carpeta, "9998_una.sql"), "-- una nota que no cambia nada\n");
    // Sin pendientes también: la base no es la que esta carpeta dice.
    await assert.rejects(migrar(b.db, carpeta), /9998_una\.sql cambió después de aplicarse.*No se aplicó nada/s);
    await writeFile(join(carpeta, "9999_dos.sql"), "CREATE TABLE dos (id int);\n");
    await assert.rejects(migrar(b.db, carpeta), /9998_una\.sql cambió después de aplicarse.*No se aplicó nada/s);
    assert.equal(await b.hay("dos"), false);
    assert.equal("9999_dos.sql" in (await b.registro()), false);
    await b.laAplicacionEntra();
    // Con el archivo como estaba, sigue.
    await writeFile(join(carpeta, "9998_una.sql"), "CREATE TABLE una (id int);\n");
    assert.deepEqual(await migrar(b.db, carpeta), ["9999_dos.sql"]);
  }));

test("si la base tiene aplicada una migración que la carpeta no trae, es de otra versión: el migrador se niega", () =>
  conBaseEnMarcha(async (b) => {
    await migrar(b.db, await b.carpeta({ "9998_una.sql": "CREATE TABLE una (id int);\n" }));
    await asegurarRol(b.db, "feruga_prueba", "prueba");
    // La carpeta de verdad no trae la 9998: ni sin pendientes, ni con una, se migra.
    await assert.rejects(migrar(b.db), /9998_una\.sql está aplicada en la base y esta versión no la trae.*No se aplicó nada/s);
    const conOtra = await b.carpeta({ "9999_dos.sql": "CREATE TABLE dos (id int);\n" });
    await assert.rejects(migrar(b.db, conOtra), /9998_una\.sql está aplicada en la base y esta versión no la trae.*No se aplicó nada/s);
    assert.equal(await b.hay("dos"), false);
    await b.laAplicacionEntra();
  }));

test("una migración pendiente que va antes de la última aplicada no entra, ni deja entrar a las que sí van después", () =>
  conBaseEnMarcha(async (b) => {
    await migrar(b.db, await b.carpeta({ "9998_una.sql": "CREATE TABLE una (id int);\n" }));
    await asegurarRol(b.db, "feruga_prueba", "prueba");
    const carpeta = await b.carpeta({
      "9998_una.sql": "CREATE TABLE una (id int);\n",
      "9997_tarde.sql": "CREATE TABLE tarde (id int);\n",
      "9999_dos.sql": "CREATE TABLE dos (id int);\n",
    });
    await assert.rejects(migrar(b.db, carpeta), /9997_tarde\.sql va antes de la última aplicada \(9998_una\.sql\).*No se aplicó nada/s);
    assert.deepEqual([await b.hay("tarde"), await b.hay("dos")], [false, false]);
    await b.laAplicacionEntra();
    // También un hueco en medio de las de verdad: la base tiene una posterior a la que falta.
    const laPenultima = DE_VERDAD.at(-2)!;
    await b.db.query("DELETE FROM migracion WHERE archivo = $1", [laPenultima]);
    await assert.rejects(migrar(b.db, carpeta), new RegExp(`${laPenultima.replace(".", "\\.")} va antes de la última aplicada`));
  }));

test("revisar dice lo que haría el migrador sin aplicar ni escribir nada, con la aplicación conectada", () =>
  conBaseEnMarcha(async (b) => {
    const app = await comoApp(b.base);
    try {
      // Una sesión que no puede escribir: si revisar intentara escribir algo, fallaría aquí.
      await b.db.query("SET default_transaction_read_only = on");
      assert.deepEqual(await revisar(b.db), { pendientes: [], sinHuella: [], impedimentos: [] });
      const conDos = await b.carpeta({ "9998_una.sql": "CREATE TABLE una (id int);\n", "9999_dos.sql": "CREATE TABLE dos (id int);\n" });
      assert.deepEqual(await revisar(b.db, conDos), { pendientes: ["9998_una.sql", "9999_dos.sql"], sinHuella: [], impedimentos: [] });
      assert.deepEqual([await b.hay("una"), await b.hay("dos")], [false, false]);
      assert.equal((await app.query("SELECT 1 AS uno")).rows[0].uno, 1);
      await b.laAplicacionEntra();

      // Todo lo que impide migrar, de una vez y no solo lo primero.
      const [primera, segunda] = [DE_VERDAD[0]!, DE_VERDAD[1]!];
      const mala = await b.carpeta({ "0000_tarde.sql": "SELECT 1;\n" }, [primera]);
      await appendFile(join(mala, segunda), "-- cambiada\n");
      const revision = await revisar(b.db, mala);
      assert.deepEqual(revision.pendientes, ["0000_tarde.sql"]);
      assert.equal(revision.impedimentos.length, 3, revision.impedimentos.join(" | "));
      assert.match(revision.impedimentos.join("\n"), new RegExp(`${primera.replace(".", "\\.")} está aplicada en la base y esta versión no la trae`));
      assert.match(revision.impedimentos.join("\n"), new RegExp(`${segunda.replace(".", "\\.")} cambió después de aplicarse`));
      assert.match(revision.impedimentos.join("\n"), /0000_tarde\.sql va antes de la última aplicada/);
    } finally {
      await app.end();
    }
  }));

test("revisar una base vacía dice que todo está pendiente, y la deja vacía", () =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      assert.deepEqual(await revisar(db), { pendientes: DE_VERDAD, sinHuella: [], impedimentos: [] });
      assert.equal((await db.query("SELECT to_regclass('public.migracion') AS t")).rows[0].t, null);
    } finally {
      await db.end();
    }
  }));

test("una base de antes de las huellas no se migra hasta sellarla; el sello se pone una sola vez, y queda dicho que es un sello", () =>
  conBaseEnMarcha(async (b) => {
    await comoAntesDeLasHuellas(b.db);
    const conUna = await b.carpeta({ "9999_una.sql": "CREATE TABLE una (id int);\n" });
    // Revisar lo dice, y no le agrega nada a la base.
    assert.deepEqual(await revisar(b.db, conUna), { pendientes: ["9999_una.sql"], sinHuella: DE_VERDAD, impedimentos: [] });
    assert.deepEqual(await columnasDelRegistro(b.db), ["aplicada_en", "archivo"]);
    // Migrar se niega, y dice con qué se arregla.
    await assert.rejects(migrar(b.db, conUna), /no tienen huella.*--sellar.*No se aplicó nada/s);
    assert.equal(await b.hay("una"), false);
    assert.deepEqual(await columnasDelRegistro(b.db), ["aplicada_en", "archivo"]);
    await b.laAplicacionEntra();

    assert.deepEqual(await sellar(b.db), DE_VERDAD);
    const registro = await b.registro();
    for (const archivo of DE_VERDAD) assert.deepEqual(registro[archivo], { huella: await huellaDe(MIGRACIONES, archivo), sellada: true }, archivo);
    // Sellada, ya migra; y la que aplica ahora no es un sello: su huella se guardó al aplicarla.
    assert.deepEqual(await migrar(b.db, conUna), ["9999_una.sql"]);
    assert.deepEqual((await b.registro())["9999_una.sql"], { huella: await huellaDe(conUna, "9999_una.sql"), sellada: false });

    // Sellar otra vez no hace nada: ni con la misma carpeta, ni con una donde una aplicada cambió.
    assert.deepEqual(await sellar(b.db, conUna), []);
    const primera = DE_VERDAD[0]!;
    await appendFile(join(conUna, primera), "-- cambiada después del sello\n");
    await assert.rejects(sellar(b.db, conUna), new RegExp(`${primera.replace(".", "\\.")} cambió después de aplicarse`));
    assert.equal((await b.registro())[primera]!.huella, await huellaDe(MIGRACIONES, primera), "sellar volvió a sellar una que ya tenía huella");
    await assert.rejects(migrar(b.db, conUna), new RegExp(`${primera.replace(".", "\\.")} cambió después de aplicarse`));
  }));

test("sellar no adivina: con una carpeta que no trae todo lo aplicado, o que trae de más, no sella ninguna", () =>
  conBaseEnMarcha(async (b) => {
    await comoAntesDeLasHuellas(b.db);
    const primera = DE_VERDAD[0]!;
    const leFalta = await b.carpeta({}, [primera]);
    await assert.rejects(sellar(b.db, leFalta), new RegExp(`${primera.replace(".", "\\.")} está aplicada en la base y esta versión no la trae`));
    assert.deepEqual((await revisar(b.db)).sinHuella, DE_VERDAD);
    // Se sella con la versión que corre, que no trae nada pendiente: una que trae de más es una candidata.
    const candidata = await b.carpeta({ "9999_una.sql": "CREATE TABLE una (id int);\n" });
    await assert.rejects(sellar(b.db, candidata), /9999_una\.sql.*no es la versión que está corriendo/s);
    assert.deepEqual((await revisar(b.db)).sinHuella, DE_VERDAD);
    assert.deepEqual(await columnasDelRegistro(b.db), ["aplicada_en", "archivo"]);
    // Y si algo falla a la mitad —aquí, al llegar a la última—, no queda sellada ninguna.
    await b.db.query(
      `CREATE FUNCTION tropieza() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN IF NEW.archivo = '${DE_VERDAD.at(-1)}' THEN RAISE EXCEPTION 'tropiezo a la mitad'; END IF; RETURN NEW; END $$`,
    );
    await b.db.query("CREATE TRIGGER tropieza BEFORE UPDATE ON migracion FOR EACH ROW EXECUTE FUNCTION tropieza()");
    await assert.rejects(sellar(b.db), /tropiezo a la mitad/);
    assert.deepEqual((await revisar(b.db)).sinHuella, DE_VERDAD);
    assert.deepEqual(await columnasDelRegistro(b.db), ["aplicada_en", "archivo"]);
    // Quitado el tropiezo, sella.
    await b.db.query("DROP TRIGGER tropieza ON migracion");
    assert.deepEqual(await sellar(b.db), DE_VERDAD);
  }));

test("sin pendientes, una base sin huellas no se toca y el migrador lo dice; donde se le permite —en desarrollo— las sella él", () =>
  conBaseEnMarcha(async (b) => {
    await comoAntesDeLasHuellas(b.db);
    const app = await comoApp(b.base);
    try {
      const dicho: string[] = [];
      assert.deepEqual(await migrar(b.db, MIGRACIONES, { decir: (l) => dicho.push(l) }), []);
      assert.match(dicho.join("\n"), /no tienen huella.*--sellar/s);
      assert.deepEqual(await columnasDelRegistro(b.db), ["aplicada_en", "archivo"]);
      assert.equal((await app.query("SELECT 1 AS uno")).rows[0].uno, 1);

      dicho.length = 0;
      assert.deepEqual(await migrar(b.db, MIGRACIONES, { sellarLoQueFalte: true, decir: (l) => dicho.push(l) }), []);
      assert.match(dicho.join("\n"), new RegExp(`selló ${DE_VERDAD.length} migraciones`));
      assert.deepEqual((await revisar(b.db)).sinHuella, []);
      assert.equal(Object.values(await b.registro()).every((f) => f.sellada && f.huella), true);
      // Ya selladas, no vuelve a decir nada.
      dicho.length = 0;
      assert.deepEqual(await migrar(b.db, MIGRACIONES, { sellarLoQueFalte: true, decir: (l) => dicho.push(l) }), []);
      assert.deepEqual(dicho, []);
    } finally {
      await app.end();
    }
  }));

test("donde se le permite sellar, el migrador sella y sigue con las pendientes; pero no sella lo que la carpeta no trae", () =>
  conBaseEnMarcha(async (b) => {
    await comoAntesDeLasHuellas(b.db);
    const leFalta = await b.carpeta({ "9999_una.sql": "CREATE TABLE una (id int);\n" }, [DE_VERDAD[0]!]);
    await assert.rejects(migrar(b.db, leFalta, { sellarLoQueFalte: true }), /esta versión no la trae.*No se aplicó nada/s);
    assert.deepEqual(await columnasDelRegistro(b.db), ["aplicada_en", "archivo"]);
    const conUna = await b.carpeta({ "9999_una.sql": "CREATE TABLE una (id int);\n" });
    assert.deepEqual(await migrar(b.db, conUna, { sellarLoQueFalte: true }), ["9999_una.sql"]);
    const registro = await b.registro();
    assert.equal(DE_VERDAD.every((a) => registro[a]!.sellada && registro[a]!.huella), true);
    assert.deepEqual(registro["9999_una.sql"], { huella: await huellaDe(conUna, "9999_una.sql"), sellada: false });
  }));

test("lo comprueba con el candado tomado: lo que valía antes de esperar su turno ya no vale si otro migrador aplicó algo mientras", () =>
  conBaseEnMarcha(async (b) => {
    const [otro, vigia] = [1, 2].map(() => new pg.Client({ connectionString: urlDe(b.base) })) as [pg.Client, pg.Client];
    await Promise.all([otro.connect(), vigia.connect()]);
    const lenta = `SELECT pg_advisory_lock(${BARRERA}); SELECT pg_advisory_unlock(${BARRERA}); CREATE TABLE lenta (id int);\n`;
    const delPrimero = await b.carpeta({ "9998_lenta.sql": lenta });
    // Para el segundo, al empezar, las dos están pendientes y en orden. Cuando le toque, la 9998 ya entró.
    const delSegundo = await b.carpeta({ "9997_otra.sql": "CREATE TABLE otra (id int);\n", "9998_lenta.sql": lenta });
    try {
      await vigia.query("SELECT pg_advisory_lock($1)", [BARRERA]);
      // Quién es cada uno se pregunta antes: una sesión que espera un candado ya no contesta.
      const [elPrimero, elSegundo] = [await pidDe(b.db), await pidDe(otro)];
      const primero = migrar(b.db, delPrimero);
      await esperarQueEspere(vigia, elPrimero);
      const segundo = migrar(otro, delSegundo);
      const fallo = assert.rejects(segundo, /9997_otra\.sql va antes de la última aplicada \(9998_lenta\.sql\).*No se aplicó nada/s);
      await esperarQueEspere(vigia, elSegundo);
      await vigia.query("SELECT pg_advisory_unlock($1)", [BARRERA]);
      assert.deepEqual(await primero, ["9998_lenta.sql"]);
      await fallo;
      assert.equal(await b.hay("otra"), false);
    } finally {
      await Promise.all([otro.end(), vigia.end()]);
    }
  }));

// ── por la línea de órdenes, como se usa ───────────────────────────────────

/**
 * Un entorno de operación: claves con forma de verdad (la dirección sigue siendo la de la base de
 * pruebas), y el turno que le pasa el guion que tiene el candado de la instalación.
 */
const deOperacion = (base: string): Record<string, string | undefined> => ({
  PATH: process.env.PATH, DATABASE_URL: urlDe(base), BD_CLAVE: "Qw8Er5Ty2Ui9Op3As6Df1Gh4", WEB_BD_CLAVE: "Zx7Cv4Bn1Mq8We5Rt2Yu9Io6",
  OPERACION_TURNO: "4242-1790000000-0a1b2c3d",
});
const orden = (args: string[], env: Record<string, string | undefined>) => correr("node", ["db/migrar.ts", ...args], { cwd: RAIZ, env });

test("migrar --revisar: sale bien si la base se puede migrar con esta versión, y si no, sale mal diciendo por qué; no aplica nada", () =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      const vacia = await orden(["--revisar"], deOperacion(base));
      assert.match(vacia.stdout, new RegExp(`Pendientes \\(${DE_VERDAD.length}\\): 0001`));
      assert.equal((await db.query("SELECT to_regclass('public.migracion') AS t")).rows[0].t, null, "revisar aplicó algo");

      assert.match((await orden([], deOperacion(base))).stdout, /aplicadas: 0001/);
      assert.match((await orden(["--revisar"], deOperacion(base))).stdout, new RegExp(`${DE_VERDAD.length} migraciones aplicadas, ninguna pendiente`));

      // La base trae una que esta versión no conoce.
      await db.query("INSERT INTO migracion (archivo, huella) VALUES ('9999_de_otra_version.sql', 'x')");
      await assert.rejects(orden(["--revisar"], deOperacion(base)), (e: any) => e.code === 1 && /9999_de_otra_version\.sql está aplicada en la base y esta versión no la trae/.test(e.stderr));
      await assert.rejects(orden([], deOperacion(base)), (e: any) => e.code === 1 && /9999_de_otra_version\.sql/.test(e.stderr));
    } finally {
      await db.end();
    }
  }));

test("migrar --sellar, y lo que hace el migrador con una base sin huellas: en operación avisa o se niega; en desarrollo las sella", () =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    const sinHuella = async (): Promise<number> => (await revisar(db)).sinHuella.length;
    try {
      await migrar(db);
      await comoAntesDeLasHuellas(db);
      // En operación: sin pendientes, migrar no la toca y lo avisa; revisar sale mal, porque así no se publica.
      const aviso = await orden([], deOperacion(base));
      assert.match(aviso.stdout, /la base ya estaba al día/);
      assert.match(aviso.stderr, /no tienen huella.*--sellar/s);
      assert.equal(await sinHuella(), DE_VERDAD.length);
      await assert.rejects(orden(["--revisar"], deOperacion(base)), (e: any) => e.code === 1 && /no tienen huella.*--sellar/s.test(e.stderr));

      const sello = await orden(["--sellar"], deOperacion(base));
      assert.match(sello.stdout, new RegExp(`selló ${DE_VERDAD.length} migraciones`));
      assert.match(sello.stdout, /confianza/);
      assert.equal(await sinHuella(), 0);
      assert.match((await orden(["--sellar"], deOperacion(base))).stdout, /no había nada que sellar/i);
      assert.match((await orden(["--revisar"], deOperacion(base))).stdout, /ninguna pendiente/);
      assert.match((await orden(["--revisar"], deOperacion(base))).stdout, new RegExp(`${DE_VERDAD.length} con la huella sellada después`));

      // En desarrollo, el migrador las sella solo.
      await comoAntesDeLasHuellas(db);
      const enDesarrollo = await orden([], { PATH: process.env.PATH, DATABASE_URL: urlDe(base), WEB_BD_CLAVE: "desarrollo_web", MODO: "desarrollo" });
      assert.match(enDesarrollo.stderr, new RegExp(`selló ${DE_VERDAD.length} migraciones`));
      assert.match(enDesarrollo.stdout, /la base ya estaba al día/);
      assert.equal(await sinHuella(), 0);
    } finally {
      await db.end();
    }
  }));

test("en operación el migrador no corre a secas: migrar y sellar piden el turno de quien tiene el candado de la instalación; revisar, no", () =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    const aSecas = { ...deOperacion(base), OPERACION_TURNO: undefined };
    try {
      for (const args of [[], ["--sellar"]]) {
        await assert.rejects(orden(args, aSecas), (e: any) => e.code === 1 && /candado de la instalación/.test(e.stderr) && /operacion\/migrar\.sh/.test(e.stderr), args.join(" "));
        await assert.rejects(orden(args, { ...aSecas, OPERACION_TURNO: "" }), (e: any) => /candado de la instalación/.test(e.stderr), args.join(" "));
      }
      assert.equal((await db.query("SELECT to_regclass('public.migracion') AS t")).rows[0].t, null, "migró a secas");
      // Mirar no cambia nada, y no lo pide.
      assert.match((await orden(["--revisar"], aSecas)).stdout, /Pendientes/);
      // En desarrollo no hay instalación que cuidar.
      assert.match((await orden([], { PATH: process.env.PATH, DATABASE_URL: urlDe(base), WEB_BD_CLAVE: "desarrollo_web", MODO: "desarrollo" })).stdout, /aplicadas: 0001/);
    } finally {
      await db.end();
    }
  }));

test("una orden que el migrador no conoce no migra: se detiene antes de tocar la base", () =>
  conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      for (const args of [["--revizar"], ["--revisar", "--sellar"], ["revisar"]]) {
        await assert.rejects(orden(args, deOperacion(base)), (e: any) => e.code === 1 && /--revisar/.test(e.stderr) && /--sellar/.test(e.stderr), args.join(" "));
      }
      assert.equal((await db.query("SELECT to_regclass('public.migracion') AS t")).rows[0].t, null);
    } finally {
      await db.end();
    }
  }));
