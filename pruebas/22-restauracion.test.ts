// Volver de un respaldo. El respaldo trae los folios que había cuando se tomó; los que se emitieron
// después se perdieron con el servidor, pero están impresos y en manos de clientes. Registrar la
// restauración abre un bloque nuevo de folios, de modo que ninguno se repita, cierra las sesiones
// que venían abiertas en el respaldo y deja constancia. Y mientras una base restaurada no tenga
// ese registro, la aplicación no atiende sobre ella.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  abrirCuenta, agregarMaterial, comoApp, compraDe, conApp, conBase, conBaseVacia, conectar, contar as cuantos, equipoDeAlta, personaConClave,
  rechaza, una, urlApp, urlDe,
} from "./apoyo.ts";
import { LIMPIO, administradorConClave, basesCon, conDestino, conPatio, correr, llaves, procesos, respaldoCifrado, retrato, urlEn } from "./patio.ts";
import type { Proceso } from "./patio.ts";
import { Navegador } from "./navegador.ts";
import { migrar } from "../db/migrar.ts";
import { restaurar } from "../operacion/restaurar.ts";
import { GET as salud } from "../src/app/api/salud/route.ts";
import { crearBd, usarBd } from "../src/servidor/bd.ts";
import { SQL_DE_VIDA } from "../src/servidor/esquema.ts";

const BLOQUE = 100_000;
const AYER = "2026-10-02T20:00:00-06:00";

const folioDe = async (db: pg.Client, operacion: string): Promise<number> =>
  Number((await una(db, "SELECT folio FROM operacion WHERE id = $1", [operacion])).folio);

const registrar = (db: pg.Client, respaldoDe: string = AYER, nota: string | null = "Se perdió el servidor") =>
  una(db, "SELECT * FROM registrar_restauracion($1, $2)", [respaldoDe, nota]);

// ── el bloque nuevo de folios ──────────────────────────────────────────────

test("registrar una restauración abre un bloque nuevo de folios: ninguno emitido antes se puede repetir", () =>
  conApp(async (_app, db, e) => {
    const carton = e.mat["Cartón"];
    const antes = [await compraDe(db, e, carton, 10), await compraDe(db, e, carton, 20)];
    const ultimo = await folioDe(db, antes[1]!);
    assert.ok(ultimo < BLOQUE);

    const r = await registrar(db);
    assert.deepEqual(
      { antes: Number(r.folio_antes), despues: Number(r.folio_despues), nota: r.nota },
      { antes: ultimo, despues: BLOQUE, nota: "Se perdió el servidor" },
    );
    // Aunque después del respaldo se hubieran emitido miles, el siguiente cae fuera de su alcance.
    assert.equal(await folioDe(db, await compraDe(db, e, carton, 30)), BLOQUE + 1);
    assert.equal(await folioDe(db, await compraDe(db, e, carton, 40)), BLOQUE + 2);

    // Otra restauración, otro bloque.
    const otra = await registrar(db, AYER, null);
    assert.deepEqual({ antes: Number(otra.folio_antes), despues: Number(otra.folio_despues) }, { antes: BLOQUE + 2, despues: 2 * BLOQUE });
    assert.equal(await folioDe(db, await compraDe(db, e, carton, 50)), 2 * BLOQUE + 1);

    assert.equal(await cuantos(db, "restauracion"), 2);
    assert.equal(await cuantos(db, "bitacora", "accion = 'registrar_restauracion'"), 2);
  }));

test("una base que nunca ha emitido un folio también salta de bloque al restaurarse", () =>
  conApp(async (_app, db, e) => {
    const r = await registrar(db);
    assert.deepEqual({ antes: Number(r.folio_antes), despues: Number(r.folio_despues) }, { antes: 0, despues: BLOQUE });
    assert.equal(await folioDe(db, await compraDe(db, e, e.mat["Cartón"], 10)), BLOQUE + 1);
  }));

test("registrar la restauración cierra las sesiones que venían abiertas en el respaldo", () =>
  conApp(async (app, db) => {
    const huella = await equipoDeAlta(db);
    const luis = await personaConClave(db, "Luis del respaldo", "mostrador", "4815");
    const sesion = (await una(app, "SELECT entrar($1, $2, $3) AS s", [huella, luis, "4815"])).s;
    assert.ok(sesion);
    await registrar(db);
    assert.deepEqual(
      await una(db, "SELECT cerrada_en IS NOT NULL AS cerrada, motivo_cierre FROM sesion WHERE id = $1", [sesion]),
      { cerrada: true, motivo_cierre: "restauracion" },
    );
    // Con su clave, vuelve a entrar.
    assert.ok((await una(app, "SELECT entrar($1, $2, $3) AS s", [huella, luis, "4815"])).s);
  }));

test("el registro de restauraciones no se edita, pide el momento del respaldo, y la aplicación no puede registrar una", () =>
  conApp(async (app, db) => {
    await rechaza(app.query("SELECT registrar_restauracion($1, NULL)", [AYER]), "42501");
    await rechaza(app.query("SELECT estrenar_vida()"), "42501");
    await rechaza(db.query("SELECT registrar_restauracion(NULL, 'x')"), "RC005");
    await rechaza(db.query("SELECT registrar_restauracion(clock_timestamp() + interval '1 day', 'x')"), "RC005");
    await registrar(db);
    await rechaza(db.query("UPDATE restauracion SET nota = 'otra'"), "RC001");
    await rechaza(db.query("DELETE FROM restauracion"), "RC001");
    assert.equal(await cuantos(db, "restauracion"), 1);
  }));

// ── la marca que no viaja en el volcado ────────────────────────────────────

/** ¿La base está emparejada? Preguntado en una conexión nueva, que es como lo ve la aplicación al arrancar. */
async function vigente(base: string): Promise<boolean> {
  const app = await comoApp(base);
  try {
    return (await una(app, "SELECT vida_vigente() AS v")).v;
  } finally {
    await app.end();
  }
}

test("una base recién instalada nace emparejada; una copia de otra, no, hasta que se registra su restauración", async () => {
  // Recién instalada: la migración la deja emparejada.
  await conBaseVacia(async (base) => {
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      await migrar(db);
      await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
      assert.equal(await vigente(base), true);
    } finally {
      await db.end();
    }
  });
  // Una copia —como la que deja restaurar un volcado— trae la marca de la tabla, no la del servidor.
  await conBase(async (db, base) => {
    assert.equal(await cuantos(db, "vida"), 1);
    assert.equal(await vigente(base), false);
    await registrar(db);
    assert.equal(await vigente(base), true);
    // Y también lo ve la conexión que la registró, sin tener que reconectarse.
    assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
  });
  // Una conexión de la aplicación que YA estaba abierta cuando se registró —las del pozo— lo ve
  // también, sin reconectarse: si no, la aplicación se quedaría cerrada hasta que alguien la reiniciara.
  await conBase(async (db, base) => {
    const abierta = await comoApp(base);
    try {
      assert.equal((await una(abierta, "SELECT vida_vigente() AS v")).v, false);
      await registrar(db);
      assert.equal((await una(abierta, "SELECT vida_vigente() AS v")).v, true);
    } finally {
      await abierta.end();
    }
  });
});

test("la marca de la base no viaja en el volcado, tampoco si se restaura creando la base desde él", () =>
  conBase(async (db, base) => {
    // Una base emparejada, como la de operación.
    await db.query("SELECT estrenar_vida()");
    assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
    const carpeta = await mkdtemp(join(tmpdir(), "marca-"));
    const limpio = new pg.Client({ connectionString: LIMPIO });
    await limpio.connect();
    try {
      const volcado = join(carpeta, "base.dump");
      await correr("pg_dump", ["--format=custom", "--file", volcado, urlDe(base)]);
      // En otro servidor, a mano, y pidiéndole a pg_restore que cree la base con sus propiedades.
      await correr("pg_restore", ["--create", "--exit-on-error", "--dbname", LIMPIO, volcado]);
      const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, base) });
      await restaurada.connect();
      try {
        assert.equal((await una(restaurada, "SELECT vida_vigente() AS v")).v, false, "una base restaurada a mano quedó emparejada sin registrar su restauración");
        assert.equal(await cuantos(restaurada, "restauracion"), 0);
        // Registrar la restauración, ahí sí, la empareja.
        await registrar(restaurada);
        assert.equal((await una(restaurada, "SELECT vida_vigente() AS v")).v, true);
      } finally {
        await restaurada.end();
      }
    } finally {
      await limpio.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
      await limpio.end();
      await rm(carpeta, { recursive: true, force: true });
    }
    // Y en el mismo servidor, renombrarla no la desempareja: restaurar renombra al final.
    assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
  }));

test("restaurar un volcado ENCIMA de la misma base, a mano, tampoco la deja emparejada", () =>
  conBase(async (db, base) => {
    await db.query("SELECT estrenar_vida()");
    await db.query("SELECT nextval('folio_operacion')");                     // el folio 1, antes del respaldo
    const carpeta = await mkdtemp(join(tmpdir(), "encima-"));
    try {
      const volcado = join(carpeta, "base.dump");
      await correr("pg_dump", ["--format=custom", "--file", volcado, urlDe(base)]);
      await db.query("SELECT nextval('folio_operacion')");                   // el folio 2, que el respaldo no trae
      // Sin crear otra base: se reemplaza lo que hay. El servidor y la base son los mismos de siempre.
      await correr("pg_restore", ["--clean", "--if-exists", "--exit-on-error", "--dbname", urlDe(base), volcado]);
      const otra = await conectar(base);
      try {
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, false, "la base volvió a un estado anterior y sigue pasando por buena: repetiría folios");
        assert.equal(await cuantos(otra, "restauracion"), 0);
        await registrar(otra);
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, true);
        // Y con el registro, el siguiente folio ya no repite ninguno.
        assert.ok(Number((await una(otra, "SELECT nextval('folio_operacion') AS n")).n) > BLOQUE);
      } finally {
        await otra.end();
      }
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

test("restaurar ENCIMA de la misma base todo menos la tabla de la marca tampoco la deja emparejada", () =>
  conBase(async (db, base) => {
    await db.query("SELECT estrenar_vida()");
    await db.query("SELECT nextval('folio_operacion')");                     // el folio 1, antes del respaldo
    const carpeta = await mkdtemp(join(tmpdir(), "sin-vida-"));
    try {
      // Un volcado que deja fuera la tabla de la marca: al restaurarlo, esa tabla ni se toca.
      const volcado = join(carpeta, "sin-vida.dump");
      await correr("pg_dump", ["--format=custom", "--exclude-table=public.vida", "--file", volcado, urlDe(base)]);
      await db.query("SELECT nextval('folio_operacion')");                   // el folio 2, que el respaldo no trae
      await correr("pg_restore", ["--clean", "--if-exists", "--exit-on-error", "--dbname", urlDe(base), volcado]);
      const otra = await conectar(base);
      try {
        assert.equal(await cuantos(otra, "vida"), 1, "la tabla de la marca debió quedar como estaba");
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, false, "las demás tablas volvieron a un estado anterior y la base sigue pasando por buena");
        // Ponerla al día no la empareja: migrar agrega a la marca lo que crea, pero solo en una base que ya lo estaba.
        const todas = join(fileURLToPath(new URL("..", import.meta.url)), "db/migraciones");
        const conMas = join(carpeta, "con-mas");
        await mkdir(conMas);
        for (const archivo of await readdir(todas)) await copyFile(join(todas, archivo), join(conMas, archivo));
        await writeFile(join(conMas, "9001_de_despues.sql"), "CREATE TABLE de_despues (n int);");
        assert.deepEqual(await migrar(otra, conMas), ["9001_de_despues.sql"]);
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, false, "migrar emparejó una base restaurada sin registrar");
        await registrar(otra);
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, true);
        assert.ok(Number((await una(otra, "SELECT nextval('folio_operacion') AS n")).n) > BLOQUE);
      } finally {
        await otra.end();
      }
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

/** La carpeta de migraciones de verdad, más las que la prueba agregue. */
async function migracionesCon(extra: Record<string, string>): Promise<string> {
  const todas = join(fileURLToPath(new URL("..", import.meta.url)), "db/migraciones");
  const carpeta = await mkdtemp(join(tmpdir(), "con-mas-"));
  for (const archivo of await readdir(todas)) await copyFile(join(todas, archivo), join(carpeta, archivo));
  for (const [nombre, sql] of Object.entries(extra)) await writeFile(join(carpeta, nombre), sql);
  return carpeta;
}

/** Lo que pregunta la aplicación en cada petición, con su propio código y como su usuario. */
async function atiende(base: string): Promise<boolean> {
  const app = await comoApp(base);
  try {
    return (await una(app, SQL_DE_VIDA)).vigente;
  } finally {
    await app.end();
  }
}

test("las tablas que llegan con una migración posterior quedan cubiertas por la marca: recrear una, o que desaparezca, la rompe", async () => {
  const conMas = await migracionesCon({ "9001_de_despues.sql": "CREATE TABLE de_despues (n int); CREATE TABLE de_paso (n int); CREATE SEQUENCE de_paso_serie;" });
  try {
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db);                                                    // recién instalada: emparejada
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        assert.deepEqual(await migrar(db, conMas), ["9001_de_despues.sql"]);
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true, "una migración que agrega tablas no desempareja");
        // Cambiarle el nombre no la hace otra tabla.
        await db.query("ALTER TABLE de_paso RENAME TO de_paso_2");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        // Una que se quita y se vuelve a crear —lo que hace una restauración— sí.
        await db.query("BEGIN; DROP TABLE de_despues; CREATE TABLE de_despues (n int)");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false, "la tabla nueva no estaba cubierta por la marca");
        await db.query("ROLLBACK");
        // Y una que desaparece, también: lo que la marca conoció tiene que seguir ahí. Lo mismo una secuencia.
        for (const quitar of ["DROP TABLE de_paso_2", "DROP SEQUENCE de_paso_serie"]) {
          await db.query("BEGIN; " + quitar);
          assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false, quitar);
          await db.query("ROLLBACK");
        }
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        // Lo mismo dice la aplicación, con su propio código, cuando de verdad falta una.
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), true);
        await db.query("DROP SEQUENCE de_paso_serie");
        assert.equal(await atiende(base), false, "falta una secuencia que la marca conocía, y la aplicación atendería");
      } finally {
        await db.end();
      }
    });
  } finally {
    await rm(conMas, { recursive: true, force: true });
  }
});

test("una tabla recreada por una restauración no vuelve buena a la base porque después una migración le cambie el nombre", async () => {
  const conMas = await migracionesCon({ "9001_de_despues.sql": "CREATE TABLE de_despues (n int);" });
  const conDos = await migracionesCon({
    "9001_de_despues.sql": "CREATE TABLE de_despues (n int);",
    "9002_otro_nombre.sql": "ALTER TABLE de_despues RENAME TO con_otro_nombre; CREATE TABLE mas_nueva (n int);",
  });
  try {
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db, conMas);
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), true);
        // Lo que deja una restauración de esa tabla encima de la base: la misma tabla, creada de nuevo.
        await db.query("DROP TABLE de_despues; CREATE TABLE de_despues (n int)");
        assert.equal(await atiende(base), false);
        // La migración siguiente le cambia el nombre: el nombre que no coincidía ya no está, pero la tabla que la marca conoció tampoco.
        assert.deepEqual(await migrar(db, conDos), ["9002_otro_nombre.sql"]);
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), false, "migrar dejó pasar por buena una base con una tabla restaurada sin registrar");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false);
        await registrar(db);
        assert.equal(await atiende(base), true);
      } finally {
        await db.end();
      }
    });
  } finally {
    await rm(conMas, { recursive: true, force: true });
    await rm(conDos, { recursive: true, force: true });
  }
});

test("una migración que tiene que quitar o volver a crear una tabla cubierta lo dice; si no lo dice, la base queda sin emparejar", async () => {
  const base1 = { "9001_de_despues.sql": "CREATE TABLE de_despues (n int);" };
  const calladas = await migracionesCon({ ...base1, "9002_quita.sql": "DROP TABLE de_despues;", "9003_crea.sql": "CREATE TABLE de_despues (m text);" });
  const dichas = await migracionesCon({
    ...base1,
    "9002_quita.sql": "SELECT vida_retirar('de_despues'); DROP TABLE de_despues;",
    "9003_crea.sql": "CREATE TABLE de_despues (m text);",
  });
  const soloLaPrimera = await migracionesCon(base1);
  try {
    // Sin decirlo: quitar en una migración y crear en la siguiente no deja la base emparejada.
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db, soloLaPrimera);
        assert.deepEqual(await migrar(db, calladas), ["9002_quita.sql", "9003_crea.sql"]);
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false, "se perdió de vista la tabla que la marca conocía");
      } finally {
        await db.end();
      }
    });
    // Diciéndolo: sigue emparejada, y la tabla nueva queda cubierta.
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db, soloLaPrimera);
        assert.deepEqual(await migrar(db, dichas), ["9002_quita.sql", "9003_crea.sql"]);
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        await db.query("DROP TABLE de_despues; CREATE TABLE de_despues (m text)");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false);
      } finally {
        await db.end();
      }
    });
    // En una base que no está emparejada, retirar no hace nada: no es una forma de arreglarla.
    await conBase(async (db) => {
      assert.equal((await una(db, "SELECT vida_retirar('operacion') AS hecho")).hecho, false);
      assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false);
    });
  } finally {
    for (const carpeta of [calladas, dichas, soloLaPrimera]) await rm(carpeta, { recursive: true, force: true });
  }
});

test("un volcado viejo y parcial, que repone la comprobación de antes, no engaña a la aplicación ni al migrador", async () => {
  // Las migraciones hasta la 0022 (la marca todavía no miraba las tablas) y hasta la 0023.
  const todas = join(fileURLToPath(new URL("..", import.meta.url)), "db/migraciones");
  const hasta22 = await mkdtemp(join(tmpdir(), "hasta22-"));
  const hasta23 = await mkdtemp(join(tmpdir(), "hasta23-"));
  const carpeta = await mkdtemp(join(tmpdir(), "parcial-"));
  for (const archivo of await readdir(todas)) {
    if (archivo <= "0022_vida_del_servidor.sql") await copyFile(join(todas, archivo), join(hasta22, archivo));
    if (archivo <= "0023_vida_de_las_tablas.sql") await copyFile(join(todas, archivo), join(hasta23, archivo));
  }
  await copyFile(join(hasta23, "0023_vida_de_las_tablas.sql"), join(carpeta, "0023_vida_de_las_tablas.sql"));
  try {
    await conBaseVacia(async (base) => {
      const volcado = join(carpeta, "parcial.dump");
      const db = await conectar(base);
      try {
        await migrar(db, hasta22);
        await db.query("SELECT nextval('folio_operacion')");                 // el folio 1
        // Un volcado que deja fuera la marca y la lista de migraciones: al restaurarlo, esas dos se quedan como estén.
        await correr("pg_dump", ["--format=custom", "--exclude-table=public.vida", "--exclude-table=public.migracion", "--file", volcado, urlDe(base)]);
        await migrar(db, hasta23);
        await db.query("SELECT estrenar_vida()");                            // la instalación de siempre, emparejada como se debe
        await db.query("SELECT nextval('folio_operacion')");                 // el folio 2, que el volcado no trae
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), true);
      } finally {
        await db.end();
      }

      await correr("pg_restore", ["--clean", "--if-exists", "--exit-on-error", "--dbname", urlDe(base), volcado]);
      const otra = await conectar(base);
      try {
        // Volvió la función de antes, que solo mira el servidor y la base: por ella, todo está bien.
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, true, "la prueba ya no reproduce el caso: la función repuesta debería decir que sí");
        // La aplicación no le pregunta a esa función.
        assert.equal(await atiende(base), false, "la aplicación atendería con los folios de antes: repetiría el 2");
        // Y migrar tampoco se fía de ella: no adopta nada.
        await writeFile(join(hasta23, "9001_de_despues.sql"), "CREATE TABLE de_despues (n int);");
        assert.deepEqual(await migrar(otra, hasta23), ["9001_de_despues.sql"]);
        await otra.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), false, "migrar adoptó una base restaurada sin registrar");
      } finally {
        await otra.end();
      }
    });
  } finally {
    for (const c of [hasta22, hasta23, carpeta]) await rm(c, { recursive: true, force: true });
  }
});

// Lo que Codex iba a reproducir cuando se le acabó la cuota en su octava pasada (lo dejó dicho en
// su registro): al retirar una tabla, esa tabla queda un momento «de más» hasta que se quita; si
// retirar exige que no sobre nada, ya no se puede retirar lo siguiente —su secuencia, u otra tabla—,
// y una migración legítima que hizo lo que el contrato pide deja la base sin emparejar.
test("una migración que quita tablas con sus secuencias propias, o varias tablas, diciéndolo, deja la base emparejada", async () => {
  const antes = {
    "9001_con_series.sql": `CREATE TABLE con_serie (id serial PRIMARY KEY, n int);
                            CREATE TABLE con_identidad (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n int);
                            CREATE TABLE suelta (n int);
                            CREATE SEQUENCE serie_suelta;`,
  };
  const soloAntes = await migracionesCon(antes);
  const quitando = await migracionesCon({
    ...antes,
    // Cada cosa que se va se retira con su llamada; las secuencias propias de una tabla se van con ella.
    "9002_quita.sql": `SELECT vida_retirar('con_serie'); SELECT vida_retirar('con_identidad');
                       SELECT vida_retirar('suelta'); SELECT vida_retirar('serie_suelta');
                       DROP TABLE con_serie; DROP TABLE con_identidad; DROP TABLE suelta; DROP SEQUENCE serie_suelta;`,
    // Y una que se rehace entera en la misma migración.
    "9003_rehace.sql": `CREATE TABLE con_serie (id serial PRIMARY KEY, m text);`,
    "9004_rehace_otra_vez.sql": `SELECT vida_retirar('con_serie'); DROP TABLE con_serie; CREATE TABLE con_serie (id serial PRIMARY KEY, z text);`,
  });
  try {
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db, soloAntes);
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), true);
        assert.deepEqual(await migrar(db, quitando), ["9002_quita.sql", "9003_rehace.sql", "9004_rehace_otra_vez.sql"]);
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), true, "una migración que retiró lo que quitaba dejó la base sin emparejar");
        // Lo que quedó sigue cubierto: la tabla rehecha y su secuencia nueva.
        await db.query("BEGIN; ALTER TABLE con_serie ALTER COLUMN id DROP DEFAULT; DROP SEQUENCE con_serie_id_seq; CREATE SEQUENCE con_serie_id_seq");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false);
        await db.query("ROLLBACK");
        // Fuera de una migración, retirar algo y dejarlo ahí no cuenta como emparejada.
        await db.query("SELECT vida_retirar('con_serie')");
        assert.equal(await atiende(base), false);
      } finally {
        await db.end();
      }
    });
  } finally {
    await rm(soloAntes, { recursive: true, force: true });
    await rm(quitando, { recursive: true, force: true });
  }
});

// Lo que encontró Codex (A7-C-I1): la marca pedía que lo que conoció siguiera ahí, pero no que la
// aplicación estuviera usando eso mismo. Guardando la secuencia vieja con otro nombre y restaurando
// otra con el nombre de siempre, todo lo conocido seguía existiendo y los folios volvían atrás.
test("conservar con otro nombre lo que la marca conoce y restaurar otro con su nombre no deja la base emparejada", async () => {
  const conMas = await migracionesCon({ "9001_de_despues.sql": "CREATE TABLE de_despues (n int);" });
  const carpeta = await mkdtemp(join(tmpdir(), "con-otro-nombre-"));
  try {
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db);
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        await db.query("SELECT nextval('folio_operacion')");                 // el folio 1
        const volcado = join(carpeta, "folios.dump");
        await correr("pg_dump", ["--format=custom", "--table=public.folio_operacion", "--file", volcado, urlDe(base)]);
        await db.query("SELECT nextval('folio_operacion')");                 // el folio 2, que el volcado no trae
        assert.equal(await atiende(base), true);

        // «Por si acaso», se guarda la de ahora con otro nombre, y se restaura la del volcado con el de siempre.
        await db.query("ALTER SEQUENCE folio_operacion RENAME TO folio_operacion_antes_de_restaurar");
        await correr("pg_restore", ["--exit-on-error", "--dbname", urlDe(base), volcado]);
        assert.equal(await atiende(base), false, "la aplicación atendería con una secuencia de folios restaurada: el siguiente sería otra vez el 2");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false);

        // Ni migrar la adopta, ni retirar la vieja la arregla.
        assert.deepEqual(await migrar(db, conMas), ["9001_de_despues.sql"]);
        await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
        assert.equal(await atiende(base), false, "migrar adoptó la secuencia restaurada");
        assert.equal((await una(db, "SELECT vida_retirar('folio_operacion_antes_de_restaurar') AS hecho")).hecho, false);
        assert.equal(await atiende(base), false);

        // Registrar la restauración, sí: y entonces los folios saltan de bloque.
        await registrar(db);
        assert.equal(await atiende(base), true);
        assert.ok(Number((await una(db, "SELECT nextval('folio_operacion') AS n")).n) > BLOQUE);
      } finally {
        await db.end();
      }
    });
  } finally {
    await rm(conMas, { recursive: true, force: true });
    await rm(carpeta, { recursive: true, force: true });
  }
});

test("una tabla o una secuencia creada a mano en el esquema de la aplicación, fuera de una migración, deja la base sin emparejar", async () => {
  await conBaseVacia(async (base) => {
    const db = await conectar(base);
    try {
      await migrar(db);
      await db.query("GRANT CONNECT ON DATABASE " + base + " TO PUBLIC");
      assert.equal(await atiende(base), true);
      for (const [crear, quitar] of [["CREATE TABLE a_mano (n int)", "DROP TABLE a_mano"], ["CREATE SEQUENCE a_mano_serie", "DROP SEQUENCE a_mano_serie"]] as const) {
        await db.query(crear);
        assert.equal(await atiende(base), false, crear);
        await db.query(quitar);                                             // quitarla la deja como estaba: nada de lo conocido cambió
        assert.equal(await atiende(base), true, quitar);
      }
      // Lo que no vive en el esquema de la aplicación no cuenta.
      await db.query("CREATE SCHEMA aparte; CREATE TABLE aparte.cosa (n int)");
      assert.equal(await atiende(base), true);
    } finally {
      await db.end();
    }
  });
});

test("un respaldo de cuando la marca solo miraba el servidor y la base, restaurado ENCIMA de la misma base, no queda adoptado al volver a migrar", async () => {
  // Las migraciones hasta la 0022: la marca todavía no miraba las tablas.
  const todas = join(fileURLToPath(new URL("..", import.meta.url)), "db/migraciones");
  const hasta22 = await mkdtemp(join(tmpdir(), "hasta22-"));
  // Y hasta la 0023, que es la que trajo la marca de las tablas. La prueba es de ese paso: un volcado
  // tan viejo ya no se restaura encima de una base más nueva, cuyas tablas dependen de las que él quita.
  const hasta23 = await mkdtemp(join(tmpdir(), "hasta23-"));
  const carpeta = await mkdtemp(join(tmpdir(), "de-la-22-"));
  for (const archivo of await readdir(todas)) {
    if (archivo <= "0022_vida_del_servidor.sql") await copyFile(join(todas, archivo), join(hasta22, archivo));
    if (archivo <= "0023_vida_de_las_tablas.sql") await copyFile(join(todas, archivo), join(hasta23, archivo));
  }
  try {
    await conBaseVacia(async (base) => {
      const volcado = join(carpeta, "de-la-22.dump");
      const db = await conectar(base);
      try {
        await migrar(db, hasta22);                                           // recién instalada: emparejada
        await db.query("SELECT nextval('folio_operacion')");                 // el folio 1: ya opera
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        await correr("pg_dump", ["--format=custom", "--file", volcado, urlDe(base)]);

        // Se pone al día. Ya operaba: no se empareja sola, hay que decirlo.
        await migrar(db, hasta23);
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false, "una base que ya operaba se emparejó sola al migrar");
        await db.query("SELECT estrenar_vida()");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        await db.query("SELECT nextval('folio_operacion')");                 // el folio 2, que el respaldo no trae
      } finally {
        await db.end();
      }

      // Aquel respaldo, encima de la misma base. Vuelve también la lista de migraciones de entonces.
      await correr("pg_restore", ["--clean", "--if-exists", "--exit-on-error", "--dbname", urlDe(base), volcado]);
      const otra = await conectar(base);
      try {
        assert.deepEqual(await migrar(otra, hasta23), ["0023_vida_de_las_tablas.sql"]);
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, false, "migrar adoptó una base restaurada sin registrar: repetiría el folio 2");
        // Ponerla al día del todo tampoco la empareja.
        await migrar(otra);
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, false);
        assert.equal(await cuantos(otra, "restauracion"), 0);
        await registrar(otra);
        assert.equal((await una(otra, "SELECT vida_vigente() AS v")).v, true);
        assert.ok(Number((await una(otra, "SELECT nextval('folio_operacion') AS n")).n) > BLOQUE);
      } finally {
        await otra.end();
      }
    });
  } finally {
    await rm(hasta22, { recursive: true, force: true });
    await rm(hasta23, { recursive: true, force: true });
    await rm(carpeta, { recursive: true, force: true });
  }
});

test("un respaldo anterior a la marca nueva, restaurado y puesto al día, no queda emparejado por el solo hecho de migrar", async () => {
  // Las migraciones hasta la 0021, como estaba el sistema antes de la marca nueva.
  const todas = join(fileURLToPath(new URL("..", import.meta.url)), "db/migraciones");
  const hasta21 = await mkdtemp(join(tmpdir(), "hasta21-"));
  const carpeta = await mkdtemp(join(tmpdir(), "anterior-"));
  for (const archivo of (await readdir(todas)).filter((a) => a <= "0021_vida_sin_reconectar.sql")) await copyFile(join(todas, archivo), join(hasta21, archivo));
  const limpio = new pg.Client({ connectionString: LIMPIO });
  await limpio.connect();
  try {
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db, hasta21);
        await db.query("SELECT nextval('folio_operacion')");                 // ya operaba: emitió folios
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        const volcado = join(carpeta, "anterior.dump");
        await correr("pg_dump", ["--format=custom", "--file", volcado, urlDe(base)]);

        // En otro servidor, con --create (que se lleva la propiedad de la base), y luego se pone al día.
        await correr("pg_restore", ["--create", "--exit-on-error", "--dbname", LIMPIO, volcado]);
        const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, base) });
        await restaurada.connect();
        try {
          await migrar(restaurada);
          assert.equal((await una(restaurada, "SELECT vida_vigente() AS v")).v, false, "migrar convalidó una base restaurada sin registrar");
          await registrar(restaurada);
          assert.equal((await una(restaurada, "SELECT vida_vigente() AS v")).v, true);
        } finally {
          await restaurada.end();
        }

        // La instalación original, que sí es la suya, tampoco se empareja sola al ponerse al día: ya
        // operaba, y desde dentro no se distingue de la restaurada. Se empareja expresamente, sin mover folios.
        await migrar(db);
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, false);
        await db.query("SELECT estrenar_vida()");
        assert.equal((await una(db, "SELECT vida_vigente() AS v")).v, true);
        assert.equal(await cuantos(db, "restauracion"), 0);
      } finally {
        await db.end();
      }
      await limpio.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    });
  } finally {
    await limpio.end();
    await rm(hasta21, { recursive: true, force: true });
    await rm(carpeta, { recursive: true, force: true });
  }
});

test("fuera de desarrollo la aplicación no atiende sobre una base restaurada sin registrar: ni la salud ni una ruta con sesión válida", () =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 1 });
    usarBd(bd);
    const antes = { ...process.env };
    const operacion = {
      MODO: undefined, DATABASE_URL: "postgres://feruga_web:Jf6Gs1Ua0Ve8Xi3Ko9Ml2Np7@db:5432/feruga",
      SESION_CLAVE: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", COOKIE_SEGURA: "1", ORIGEN: "https://patio.ejemplo.mx",
    };
    const poner = (v: Record<string, string | undefined>): void => {
      for (const [k, valor] of Object.entries(v)) {
        if (valor === undefined) delete process.env[k];
        else process.env[k] = valor;
      }
    };
    try {
      // En desarrollo las bases se clonan de una plantilla y no se exige.
      poner({ SESION_CLAVE: operacion.SESION_CLAVE });
      assert.equal((await salud()).status, 200);
      // Un equipo dado de alta y una persona adentro, mientras todavía se atiende.
      const { POST: alta } = await import("../src/app/api/equipo/alta/route.ts");
      const { POST: entrar } = await import("../src/app/api/sesion/entrar/route.ts");
      const { POST: abrir } = await import("../src/app/api/cuentas/route.ts");
      const rosa = await personaConClave(db, "Rosa", "mostrador", "4815");
      const n = new Navegador();
      await n.bien(alta, "POST", "/api/equipo/alta", { codigo: (await una(db, "SELECT crear_codigo_alta('Mostrador') AS c")).c });
      await n.bien(entrar, "POST", "/api/sesion/entrar", { persona: rosa, clave: "4815" });
      n.persona = rosa;
      const abrirCompra = (): Promise<Response> =>
        n.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null }, { origen: "https://patio.ejemplo.mx" });
      poner(operacion);
      assert.equal((await salud()).status, 503);
      // La salud avisa, pero quien impide trabajar es cada ruta: con sesión y cuerpo válidos, no pasa y no escribe.
      const cuentas = await cuantos(db, "operacion");
      const negada = await abrirCompra();
      assert.equal(negada.status, 503);
      assert.equal((await negada.json()).error.codigo, "INTERNO");
      assert.equal(await cuantos(db, "operacion"), cuentas);
      await registrar(db);
      // Con el mismo pozo de conexiones que ya tenía abierto: la aplicación vuelve sola, sin reiniciarla.
      assert.equal((await salud()).status, 200);
      // Registrar la restauración cerró la sesión que venía en el respaldo: hay que volver a entrar, y entonces sí.
      assert.equal((await abrirCompra()).status, 401);
      await n.bien(entrar, "POST", "/api/sesion/entrar", { persona: rosa, clave: "4815" }, { origen: "https://patio.ejemplo.mx" });
      // Ya atiende: la petición llega hasta la regla del negocio (aquí el día todavía no está listo para comprar).
      const atendida = await abrirCompra();
      assert.equal(atendida.status, 409);
      assert.match((await atendida.json()).error.codigo, /^RC\d{3}$/);
    } finally {
      poner(Object.fromEntries(Object.keys(operacion).map((k) => [k, antes[k]])));
      usarBd(null);
      await bd.cerrar().catch(() => {});
    }
  }));

// ── el programa que restaura ───────────────────────────────────────────────
//
// Uno solo, para el ensayo y para la emergencia. Aquí se corre contra un servidor vacío, con un
// respaldo cifrado de verdad, y se comprueba lo que queda.

test("restaurar un respaldo cifrado en un servidor vacío: queda lo que había, se puede usar, y ningún folio se repite", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const carpeta = await mkdtemp(join(tmpdir(), "restaurar-"));
    try {
      const llave = await llaves();
      const antes = await retrato(p.db);
      const archivo = await respaldoCifrado(p.base, carpeta, llave.publica);
      // Lo cifrado no se puede leer sin la llave.
      await assert.rejects(correr("pg_restore", ["--list", archivo]));

      // Después del respaldo el patio siguió trabajando: esos folios se imprimieron y se pierden con el servidor.
      const perdidos: number[] = [];
      for (const kg of [5, 6, 7]) perdidos.push(await folioDe(p.db, await compraDe(p.db, p.e, carton, kg)));

      await conDestino(async (destino, admin) => {
        const dicho: string[] = [];
        const r = await restaurar({
          servidor: LIMPIO, base: destino, archivo, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
          nota: "Ensayo", decir: (linea) => dicho.push(linea),
        });
        assert.deepEqual(await basesCon(admin, destino), [destino], "no queda la base de trabajo");
        assert.ok(!dicho.join("\n").includes("AGE-SECRET-KEY"));

        const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
        await restaurada.connect();
        const app = await comoApp(destino, LIMPIO);
        try {
          // 1. Lo que había, está, e igual: también la identidad, las impresiones, los envíos y la bitácora.
          const despues = await retrato(restaurada);
          assert.deepEqual(despues, antes);
          assert.equal(despues.disparadores.activos, despues.disparadores.total);

          // 2. Quedó registrada, con el momento del respaldo, y las sesiones del respaldo cerradas.
          const registro = await una(restaurada, "SELECT * FROM restauracion");
          assert.equal(registro.nota, "Ensayo");
          assert.equal(Number(registro.folio_despues), BLOQUE);
          assert.equal(new Date(registro.respaldo_de).getTime(), r.respaldoDe.getTime());
          assert.equal(await cuantos(restaurada, "sesion", "cerrada_en IS NULL"), 0);
          assert.equal((await una(app, "SELECT vida_vigente() AS v")).v, true);

          // 3. Se usa de verdad, con el usuario de la aplicación: entrar con la clave y hacer una compra.
          assert.ok((await una(app, "SELECT entrar($1, $2, $3) AS s", [p.huella, p.rosa, "4815"])).s);
          const cuenta = await abrirCuenta(app, "compra", p.rosa);
          await agregarMaterial(app, cuenta.id, carton, "10", p.rosa);
          const revision = (await una(restaurada, "SELECT revision FROM operacion WHERE id = $1", [cuenta.id])).revision;
          const hecha = await una(app, "SELECT * FROM confirmar_cuenta($1, $2, $3)", [cuenta.id, p.rosa, revision]);
          // 4. El folio nuevo no es ninguno de los que se perdieron: cae en el bloque siguiente.
          assert.equal(Number(hecha.folio), BLOQUE + 1);
          assert.ok(!perdidos.includes(Number(hecha.folio)));

          // 5. Los envíos de antes siguen siendo los mismos: el que entró devuelve lo que hizo; el cancelado sigue sin entrar.
          const otraVez = await una(app, "SELECT * FROM dar_merma($1, $2, 10, 'Mojado', $3)", [p.merma.envio, carton, p.e.mostrador]);
          assert.equal(otraVez.id, p.merma.movimiento);
          await rechaza(app.query("SELECT dar_merma($1, $2, 10, 'Mojado', $3)", [p.cancelado, carton, p.e.mostrador]), "RC012");
          // 6. Y las reglas siguen vivas.
          await rechaza(restaurada.query("UPDATE movimiento_inventario SET cantidad_kg = 1"), "RC001");
          await rechaza(app.query("DELETE FROM movimiento_inventario"), "42501");
        } finally {
          await app.end();
          await restaurada.end();
        }
      });
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

test("una restauración que no puede terminar no deja nada: ni la base, ni una a medias", () =>
  conPatio(async (p) => {
    const carpeta = await mkdtemp(join(tmpdir(), "restaurar-"));
    try {
      const llave = await llaves();
      const otra = await llaves();
      const bueno = await respaldoCifrado(p.base, carpeta, llave.publica);
      const intento = (destino: string, archivo: string, privada = llave.privada) =>
        restaurar({ servidor: LIMPIO, base: destino, archivo, llave: privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba" });

      await conDestino(async (destino, admin) => {
        // Con otra llave.
        await assert.rejects(intento(destino, bueno, otra.privada), /no se pudo descifrar/i);
        assert.deepEqual(await basesCon(admin, destino), []);

        // Un archivo dañado: mismos bytes al principio, basura a la mitad.
        const danado = join(carpeta, "danado.dump.age");
        const bytes = await readFile(bueno);
        bytes.fill(0x41, Math.floor(bytes.length / 2), Math.floor(bytes.length / 2) + 64);
        await writeFile(danado, bytes);
        await assert.rejects(intento(destino, danado));
        assert.deepEqual(await basesCon(admin, destino), []);

        // Un volcado cortado: descifra bien, pero la restauración falla a la mitad.
        const claro = join(carpeta, "entero.dump");
        await correr("pg_dump", ["--format=custom", "--file", claro, urlDe(p.base)]);
        const cortado = join(carpeta, "cortado.dump");
        const entero = await readFile(claro);
        await writeFile(cortado, entero.subarray(0, Math.floor(entero.length * 0.6)));
        await correr("age", ["-r", llave.publica, "-o", `${cortado}.age`, cortado]);
        await assert.rejects(intento(destino, `${cortado}.age`), /no se pudo restaurar/i);
        assert.deepEqual(await basesCon(admin, destino), []);

        // Y después de los tres fracasos, el bueno entra.
        await intento(destino, bueno);
        assert.deepEqual(await basesCon(admin, destino), [destino]);

        // Sobre una base que ya existe no se restaura: ni se toca.
        const registros = async (): Promise<number> => {
          const c = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
          await c.connect();
          try {
            return await cuantos(c, "restauracion");
          } finally {
            await c.end();
          }
        };
        assert.equal(await registros(), 1);
        await assert.rejects(intento(destino, bueno), /ya existe/i);
        assert.equal(await registros(), 1);
        assert.deepEqual(await basesCon(admin, destino), [destino]);
      });
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

test("la llave privada no aparece en los argumentos ni en el entorno de ningún proceso, ni en lo que el programa dice; la clave de la base no viaja en argumentos", () =>
  conPatio(async (p) => {
    const carpeta = await mkdtemp(join(tmpdir(), "restaurar-"));
    const administrador = await administradorConClave(LIMPIO);
    try {
      const llave = await llaves();
      const secreta = /AGE-SECRET-KEY-1[0-9A-Z]+/.exec(llave.privada)![0];
      const cifrado = await respaldoCifrado(p.base, carpeta, llave.publica);
      // El respaldo llega por una tubería que nadie alimenta todavía: el descifrador se queda vivo,
      // con la llave ya entregada, esperando el archivo. Ahí se le mira con calma.
      const tuberia = join(carpeta, "respaldo.tuberia");
      await correr("mkfifo", [tuberia]);

      await conDestino(async (destino) => {
        const dicho: string[] = [];
        const restaurando = restaurar({
          servidor: administrador.url, base: destino, archivo: tuberia, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
          decir: (linea) => dicho.push(linea),
        });
        let delDescifrado: Proceso[] = [];
        for (let k = 0; k < 500 && delDescifrado.length === 0; k += 1) {
          delDescifrado = await procesos("age");
          if (delDescifrado.length === 0) await new Promise((sigue) => setTimeout(sigue, 10));
        }

        // Se le suelta el archivo pase lo que pase: si no, el descifrador se quedaría esperando para
        // siempre. Mientras sigue la restauración se mira también a pg_restore, que dura lo suficiente.
        const delRestaurador: Proceso[] = [];
        let mirando = true;
        const vigia = (async () => {
          while (mirando) {
            delRestaurador.push(...(await procesos("pg_restore")));
            await new Promise((sigue) => setImmediate(sigue));
          }
        })();
        try {
          await pipeline(createReadStream(cifrado), createWriteStream(tuberia));
          await restaurando;
        } finally {
          mirando = false;
          await vigia;
        }

        assert.equal(delDescifrado.length, 1, "el descifrador debe haberse visto vivo, esperando el archivo");
        const todo = (v: Proceso): string => v.argumentos + "\n" + v.entorno;
        assert.ok(delDescifrado[0]!.argumentos.includes("--identity\0-\0"), "la llave entra por la entrada estándar");
        assert.ok(!todo(delDescifrado[0]!).includes(secreta), "la llave está en los argumentos o el entorno del descifrador");
        assert.ok(delRestaurador.length > 0, "no se alcanzó a ver la restauración corriendo");
        assert.ok(!delRestaurador.some((v) => todo(v).includes(secreta)), "la llave está en los argumentos o el entorno de pg_restore");
        assert.ok(!dicho.join("\n").includes(secreta));
        // La clave de la base sí la necesita pg_restore, pero no a la vista de cualquiera: va en su entorno, no en sus argumentos.
        assert.ok(!delRestaurador.some((v) => v.argumentos.includes(administrador.clave)), "la clave de la base está en los argumentos de pg_restore");
        assert.ok(!dicho.join("\n").includes(administrador.clave));
        // Y no queda el volcado descifrado en el disco.
        assert.deepEqual((await readdir(tmpdir())).filter((x) => x.startsWith("feruga-restaurar-")), []);
      });
    } finally {
      await administrador.quitar();
      await rm(carpeta, { recursive: true, force: true });
    }
  }));
