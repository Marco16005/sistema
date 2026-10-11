// El piso del servidor: cómo habla con la base, cómo traduce sus errores y cómo recibe los números.
import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { conBase, conBaseVacia, contar, escenario, esperarQueEsperen, pidDe, rechaza, una, urlApp, urlDe, usuario } from "./apoyo.ts";
import { migrar } from "../db/migrar.ts";
import { asegurarRol } from "../db/rol.ts";
import { GET as salud } from "../src/app/api/salud/route.ts";
import { crearBd, usarBd } from "../src/servidor/bd.ts";
import { ESQUEMA_ESPERADO } from "../src/servidor/esquema.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { ErrorDeNegocio, traducir } from "../src/servidor/errores.ts";
import { ErrorDeForma, kilos, precio } from "../src/servidor/numeros.ts";

process.env.SESION_CLAVE = "una clave de prueba para sellar la cookie, bien larga";

/** Corre la prueba con la conexión del dueño, que arma el escenario, y con la del servidor, que usa el rol de la aplicación. */
const conBd = (prueba: (bd: Bd, db: pg.Client, base: string) => Promise<void>, conexiones = 2) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones });
    try {
      await prueba(bd, db, base);
    } finally {
      await bd.cerrar();
    }
  });

const personaDeLaConexion = "SELECT coalesce(current_setting('feruga.usuario', true), '') AS persona";

// ── errores ────────────────────────────────────────────────────────────────

test("un error de negocio de la base sale con su código y su mensaje", () =>
  conBd(async (bd, db) => {
    const luis = await usuario(db, "Luis", "mostrador");
    await assert.rejects(
      bd.enTransaccion(luis, (c) => c.query("SELECT abrir_cuenta(gen_random_uuid(), 'compra', NULL, $1)", [luis])),
      (e: unknown) => {
        assert.ok(e instanceof ErrorDeNegocio, `llegó ${e}`);
        assert.equal(e.codigo, "RC006");
        assert.equal(e.message, "No hay jornada abierta");
        return true;
      },
    );
  }));

test("una lectura que falla por regla de negocio también se traduce", () =>
  conBd(async (bd) => {
    await assert.rejects(bd.leer("SELECT exigir_rol(1, 'responsable')"), (e: unknown) => !(e instanceof ErrorDeNegocio));
    await assert.rejects(
      bd.leer("DO $$ BEGIN RAISE EXCEPTION 'No hay' USING ERRCODE = 'RC009'; END $$"),
      (e: unknown) => e instanceof ErrorDeNegocio && e.codigo === "RC009",
    );
  }));

test("un error que no es de negocio se queda como está", () => {
  const roto = Object.assign(new Error("relation \"x\" does not exist"), { code: "42P01" });
  assert.equal(traducir(roto), roto);
  const sinCodigo = new Error("se cayó");
  assert.equal(traducir(sinCodigo), sinCodigo);
});

// ── transacciones ──────────────────────────────────────────────────────────

test("si la acción falla no queda nada escrito", () =>
  conBd(async (bd, db) => {
    const e = await escenario(db);
    await assert.rejects(
      bd.enTransaccion(e.mostrador, async (c) => {
        await c.query("SELECT abrir_cuenta($1, 'compra', NULL, $2)", [randomUUID(), e.mostrador]);
        throw new Error("algo salió mal después");
      }),
      /algo salió mal después/,
    );
    assert.equal(await contar(db, "operacion"), 0);
  }));

test("lo que devuelve la acción queda escrito y llega a quien la pidió", () =>
  conBd(async (bd, db) => {
    const e = await escenario(db);
    const id = randomUUID();
    const r = await bd.enTransaccion(e.mostrador, async (c) => {
      await c.query("SELECT abrir_cuenta($1, 'compra', NULL, $2)", [id, e.mostrador]);
      return "listo";
    });
    assert.equal(r, "listo");
    assert.equal(await contar(db, "operacion", "id = $1", [id]), 1);
  }));

test("la persona que actúa queda en la bitácora", () =>
  conBd(async (bd, db) => {
    const servando = await usuario(db, "Servando", "responsable", true);
    // Una tabla de la prueba con el mismo rastro que llevan los catálogos.
    await db.query(`CREATE TABLE nota (texto text);
      CREATE TRIGGER nota_auditada AFTER INSERT ON nota FOR EACH ROW EXECUTE FUNCTION auditar();
      GRANT INSERT ON nota TO feruga_app`);
    await bd.enTransaccion(servando, (c) => c.query("INSERT INTO nota VALUES ('hola')"));
    const rastro = await una(db, "SELECT usuario_id FROM bitacora WHERE entidad = 'nota'");
    assert.equal(rastro.usuario_id, servando);
    await bd.enTransaccion(null, (c) => c.query("INSERT INTO nota VALUES ('nadie')"));
    const sinPersona = await una(db, "SELECT usuario_id FROM bitacora WHERE entidad = 'nota' ORDER BY id DESC LIMIT 1");
    assert.equal(sinPersona.usuario_id, null);
  }));

test("la persona no se queda en la conexión para la acción que sigue", () =>
  conBd(async (bd, db) => {
    const servando = await usuario(db, "Servando", "responsable", true);
    // Con una sola conexión, la segunda acción usa por fuerza la misma que la primera.
    const dentro = await bd.enTransaccion(servando, async (c) => (await c.query(personaDeLaConexion)).rows[0].persona);
    assert.equal(dentro, servando);
    // Se mira enseguida, antes de que otra acción fije a su propia persona y tape el descuido.
    assert.equal((await bd.leer(personaDeLaConexion))[0]!.persona, "");
    const despues = await bd.enTransaccion(null, async (c) => (await c.query(personaDeLaConexion)).rows[0].persona);
    assert.equal(despues, "");
  }, 1));

test("la persona tampoco se queda cuando la acción falló", () =>
  conBd(async (bd, db) => {
    const servando = await usuario(db, "Servando", "responsable", true);
    await assert.rejects(bd.enTransaccion(servando, () => Promise.reject(new Error("falló"))));
    assert.equal((await bd.leer(personaDeLaConexion))[0]!.persona, "");
  }, 1));

test("la conexión se devuelve aunque la acción falle, una y otra vez", () =>
  conBd(async (bd) => {
    for (let k = 0; k < 5; k++) {
      await assert.rejects(bd.enTransaccion(null, (c) => c.query("SELECT 1 / 0")));
    }
    assert.equal((await bd.leer("SELECT 1 AS uno"))[0]!.uno, 1);
  }, 1));

/** Corre el guion en otro proceso y devuelve con qué código salió y lo que escribió. */
const enOtroProceso = (argumentos: string[]): Promise<{ codigo: number | null; salida: string; errores: string }> =>
  new Promise((listo, fallo) => {
    const hijo = spawn(process.execPath, [fileURLToPath(new URL("./hijos/conexion-caida.ts", import.meta.url)), ...argumentos]);
    let salida = "";
    let errores = "";
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (errores += d));
    hijo.on("error", fallo);
    hijo.on("close", (codigo) => listo({ codigo, salida, errores }));
  });

for (const modo of ["esperando", "consultando"]) {
  test(`perder la conexión a media acción (${modo}) no tumba el servidor: la acción se rechaza y la siguiente se atiende`, () =>
    conBase(async (_db, base) => {
      const r = await enOtroProceso([await urlApp(base), urlDe(base), modo]);
      assert.equal(r.codigo, 0, `el proceso terminó con ${r.codigo}:\n${r.errores}`);
      assert.deepEqual(JSON.parse(r.salida), { rechazada: true, uno: 1 });
    }));
}

test("toda acción corre en READ COMMITTED aunque la base esté configurada de otro modo", () =>
  conBase(async (db, base) => {
    await db.query(`ALTER DATABASE ${base} SET default_transaction_isolation = 'serializable'`);
    const bd = crearBd(await urlApp(base), { conexiones: 1 });
    try {
      const nivel = await bd.enTransaccion(null, async (c) => (await c.query("SHOW transaction_isolation")).rows[0].transaction_isolation);
      assert.equal(nivel, "read committed");
    } finally {
      await bd.cerrar();
    }
  }));

// ── números ────────────────────────────────────────────────────────────────

test("un peso bien escrito pasa tal cual, como texto", () => {
  for (const bueno of ["12", "12.5", "0.005", "123456.125", "0", "007.5"]) {
    assert.equal(kilos(bueno), bueno);
  }
});

test("un peso mal escrito se rechaza por su forma", () => {
  const malos: unknown[] = ["12,5", "", "abc", "1.2345", "1e3", "-5", "+5", " 12", "12 ", "12.", ".5", "1.2.3",
    "Infinity", "NaN", "1234567", 12, 12.5, null, undefined, {}, ["12"]];
  for (const malo of malos) {
    assert.throws(() => kilos(malo), ErrorDeForma, `se aceptó ${JSON.stringify(malo)}`);
  }
});

test("un precio admite hasta cuatro decimales y nada más", () => {
  for (const bueno of ["150", "6.2", "2.1234", "0.5"]) {
    assert.equal(precio(bueno), bueno);
  }
  for (const malo of ["2.12345", "6,2", "", "-1", "1e2", "100000", 6.2, null]) {
    assert.throws(() => precio(malo), ErrorDeForma, `se aceptó ${JSON.stringify(malo)}`);
  }
});

// ── salud ──────────────────────────────────────────────────────────────────

test("la ruta de salud responde bien cuando hay base", () =>
  conBd(async (bd) => {
    usarBd(bd);
    try {
      const r = await salud();
      assert.equal(r.status, 200);
      // Dos cosas, por separado: la aplicación está lista, y la operación está abierta. A quien no se acredita, nada más.
      assert.deepEqual(await r.json(), { bien: true, abierta: true });
    } finally {
      usarBd(null);
    }
  }));

test("la ruta de salud avisa cuando la base no está en la versión que la aplicación espera", () =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 1 });
    usarBd(bd);
    try {
      assert.equal((await salud()).status, 200);
      // Una migración de más: la base es de una versión más nueva que la aplicación.
      await db.query("INSERT INTO migracion (archivo) VALUES ('9999_de_mas.sql')");
      const deMas = await salud();
      assert.equal(deMas.status, 503);
      assert.deepEqual(await deMas.json(), { bien: false });
      await db.query("DELETE FROM migracion WHERE archivo = '9999_de_mas.sql'");
      assert.equal((await salud()).status, 200);
      // Una de menos: la aplicación es más nueva que la base.
      await db.query("DELETE FROM migracion WHERE archivo = $1", [ESQUEMA_ESPERADO]);
      assert.equal((await salud()).status, 503);
    } finally {
      usarBd(null);
      await bd.cerrar();
    }
  }));

test("la versión del esquema que espera la aplicación es la última migración del repositorio", async () => {
  const migraciones = (await readdir(fileURLToPath(new URL("../db/migraciones", import.meta.url)))).filter((a) => a.endsWith(".sql")).sort();
  assert.equal(ESQUEMA_ESPERADO, migraciones.at(-1), "al agregar una migración hay que decirle a la aplicación que la espera: src/servidor/esquema.ts");
});

test("la ruta de salud avisa cuando no hay base, sin contar por qué", async () => {
  const sinBase = new URL(urlDe("no_existe"));
  sinBase.port = "1"; // ahí no escucha nadie
  const bd = crearBd(sinBase.toString(), { conexiones: 1, esperaMs: 2_000 });
  usarBd(bd);
  try {
    const r = await salud();
    assert.equal(r.status, 503);
    const texto = await r.text();
    assert.deepEqual(JSON.parse(texto), { bien: false });
    assert.doesNotMatch(texto, /ECONN|refused|no_existe|feruga/i);
  } finally {
    usarBd(null);
    await bd.cerrar();
  }
});

// ── migrador ───────────────────────────────────────────────────────────────

test("dos migradores a la vez no se pisan: el segundo espera al primero, y cada migración entra una sola vez", () =>
  conBaseVacia(async (base) => {
    const [uno, dos, vigia] = [1, 2, 3].map(() => new pg.Client({ connectionString: urlDe(base) })) as [pg.Client, pg.Client, pg.Client];
    await Promise.all([uno.connect(), dos.connect(), vigia.connect()]);
    try {
      // Con el candado del migrador tomado por otro, los dos se quedan esperándolo: no entran a la vez.
      await vigia.query("SELECT pg_advisory_lock(7150)");
      const pids = [await pidDe(uno), await pidDe(dos)];
      const [a, b] = [migrar(uno), migrar(dos)];
      await esperarQueEsperen(vigia, pids);
      assert.equal((await vigia.query("SELECT to_regclass('migracion') AS t")).rows[0].t, null);
      await vigia.query("SELECT pg_advisory_unlock(7150)");
      const [deUno, deDos] = await Promise.all([a, b]);
      assert.ok(deUno.length > 0 || deDos.length > 0);
      assert.equal(deUno.length === 0 || deDos.length === 0, true, "los dos aplicaron migraciones");
      const r = await uno.query("SELECT count(*)::int AS n, count(DISTINCT archivo)::int AS distintas FROM migracion");
      assert.equal(r.rows[0].n, r.rows[0].distintas);
      assert.equal(r.rows[0].n, Math.max(deUno.length, deDos.length));
      assert.deepEqual(await migrar(uno), []);
    } finally {
      await Promise.all([uno.end(), dos.end(), vigia.end()]);
    }
  }));

// ── el usuario con que la aplicación se conecta ────────────────────────────

const entrarComo = async (base: string, nombre: string, clave: string): Promise<pg.Client> => {
  const u = new URL(urlDe(base));
  u.username = nombre;
  u.password = clave;
  const c = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 10_000 });
  await c.connect();
  return c;
};

test("el usuario de conexión se crea, entra, y tiene lo de la aplicación y nada más", () =>
  conBase(async (db, base) => {
    const nombre = "web_" + randomUUID().replaceAll("-", "").slice(0, 12);
    try {
      await asegurarRol(db, nombre, "primera clave");
      const c = await entrarComo(base, nombre, "primera clave");
      try {
        assert.equal((await c.query("SELECT count(*)::int AS n FROM material")).rows[0].n, 27);
        await rechaza(c.query("INSERT INTO bitacora (accion, entidad) VALUES ('inventada', 'x')"), "42501");
        await rechaza(c.query("CREATE TABLE mia (x int)"), "42501");
      } finally {
        await c.end();
      }
    } finally {
      await db.query(`DROP ROLE IF EXISTS ${nombre}`);
    }
  }));

test("asegurar de nuevo al usuario de conexión no falla y deja la clave que se le dio", () =>
  conBase(async (db, base) => {
    const nombre = "web_" + randomUUID().replaceAll("-", "").slice(0, 12);
    try {
      await asegurarRol(db, nombre, "primera clave");
      await asegurarRol(db, nombre, "la de 'ahora'");
      await rechaza(entrarComo(base, nombre, "primera clave"), "28P01");
      await (await entrarComo(base, nombre, "la de 'ahora'")).end();
    } finally {
      await db.query(`DROP ROLE IF EXISTS ${nombre}`);
    }
  }));

test("el usuario de conexión no admite un nombre raro ni una clave vacía", () =>
  conBase(async (db) => {
    await assert.rejects(asegurarRol(db, "web; DROP TABLE material", "clave"), /nombre/);
    await assert.rejects(asegurarRol(db, "feruga", "clave"), /nombre/);
    await assert.rejects(asegurarRol(db, "feruga_app", "clave"), /nombre/);
    await assert.rejects(asegurarRol(db, "web_bien", ""), /clave/);
    assert.equal((await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'web_bien'")).rows.length, 0);
  }));

test("un usuario de conexión que ya existía con más de lo debido no se reutiliza", () =>
  conBase(async (db, base) => {
    const nombre = () => "web_" + randomUUID().replaceAll("-", "").slice(0, 12);
    const casos: Array<[string, (n: string) => string[]]> = [
      ["es miembro de otro rol", (n) => [`CREATE ROLE ${n} LOGIN PASSWORD 'vieja' IN ROLE feruga_app, pg_write_all_data`]],
      ["puede crear bases", (n) => [`CREATE ROLE ${n} LOGIN PASSWORD 'vieja' CREATEDB IN ROLE feruga_app`]],
      ["puede saltarse las políticas", (n) => [`CREATE ROLE ${n} LOGIN PASSWORD 'vieja' BYPASSRLS IN ROLE feruga_app`]],
      ["es dueño de una tabla", (n) => [`CREATE ROLE ${n} LOGIN PASSWORD 'vieja' IN ROLE feruga_app`, `CREATE TABLE de_${n} (x int)`, `ALTER TABLE de_${n} OWNER TO ${n}`]],
      ["tiene un permiso propio", (n) => [`CREATE ROLE ${n} LOGIN PASSWORD 'vieja' IN ROLE feruga_app`, `GRANT UPDATE ON credencial TO ${n}`]],
    ];
    for (const [que, preparar] of casos) {
      const n = nombre();
      try {
        for (const sql of preparar(n)) await db.query(sql);
        await assert.rejects(asegurarRol(db, n, "nueva"), /ya existe y tiene más de lo que debe/, `se reutilizó uno que ${que}`);
        // No se le tocó nada: sigue con su clave de antes.
        await (await entrarComo(base, n, "vieja")).end();
      } finally {
        await db.query(`DROP OWNED BY ${n}`);
        await db.query(`DROP ROLE ${n}`);
      }
    }
  }));
