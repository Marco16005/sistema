// Personas y equipos desde la pantalla (migración 0031). Hasta el 12 de octubre de 2026 esto era
// solo de la consola; ese día el dueño decidió un punto medio: el responsable que autoriza, con su
// clave otra vez, da de alta y de baja a personas de mostrador, de patio y de consulta, les cambia
// la clave, y da de alta y de baja equipos. Los responsables, quien administra y la facultad de
// autorizar siguen siendo de la consola: quien se meta a la aplicación no se fabrica un jefe.
import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { comoApp, conBase, contar, equipoDeAlta, esperarQueEspere, personaConClave, pidDe, rechaza, una } from "./apoyo.ts";
import { CLAVES, conMundo, ruta } from "./mundo.ts";
import type { Mundo } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";

const CLAVE = "481516";

interface Patio {
  app: pg.Client;
  db: pg.Client;
  base: string;
  /** La huella del equipo desde el que se pide. */
  h: string;
  /** La responsable que autoriza. */
  elena: string;
  luis: string;
}

const conPatio = (prueba: (p: Patio) => Promise<void>) =>
  conBase(async (db, base) => {
    const app = await comoApp(base);
    try {
      const h = await equipoDeAlta(db);
      const elena = await personaConClave(db, "Elena", "responsable", CLAVE, true);
      const luis = await personaConClave(db, "Luis", "mostrador", "4815");
      await prueba({ app, db, base, h, elena, luis });
    } finally {
      await app.end();
    }
  });

const entra = async (app: pg.Client, h: string, persona: string, clave: string): Promise<boolean> =>
  (await una(app, "SELECT entrar($1, $2, $3) AS sesion", [h, persona, clave])).sesion !== null;
const fallosDe = async (db: pg.Client, persona: string): Promise<number> =>
  (await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [persona])).fallos;
/** Lo que la bitácora tiene de esa acción sobre esa entidad: quién lo hizo. */
const anotados = async (db: pg.Client, accion: string, entidad: string): Promise<Array<string | null>> =>
  (await db.query("SELECT usuario_id FROM bitacora WHERE accion = $1 AND entidad = $2 ORDER BY id", [accion, entidad])).rows.map((f) => f.usuario_id);

const alta = (c: pg.Client, p: Patio, nombre: string, rol: string, nueva: string, o: { quien?: string; clave?: string; h?: string } = {}) =>
  una(c, "SELECT alta_de_persona($1, $2, $3, $4, $5, $6) AS id", [o.h ?? p.h, o.quien ?? p.elena, o.clave ?? CLAVE, nombre, rol, nueva]);

// ── dar de alta a una persona ──────────────────────────────────────────────

test("el responsable que autoriza da de alta, con su clave, a alguien de mostrador, de patio o de consulta: la persona nueva entra con la suya, sin facultad de autorizar, y queda anotado quién la dio de alta", () =>
  conPatio(async (p) => {
    for (const [nombre, rol, clave] of [["Rosa", "mostrador", "5731"], ["Beto", "patio", "2718"], ["Ana", "consulta", "3141"]] as const) {
      const { id } = await alta(p.app, p, `  ${nombre} `, rol, clave);
      assert.ok(id, nombre);
      assert.deepEqual(await una(p.db, "SELECT nombre, rol, puede_autorizar, activo FROM usuario WHERE id = $1", [id]),
        { nombre, rol, puede_autorizar: false, activo: true });
      assert.equal(await entra(p.app, p.h, id, clave), true, nombre);
    }
    // Quedó a nombre de Elena, no de «la consola».
    assert.deepEqual((await anotados(p.db, "insert", "usuario")).slice(-3), [p.elena, p.elena, p.elena]);
    assert.deepEqual((await anotados(p.db, "clave", "credencial")).slice(-3), [p.elena, p.elena, p.elena]);
  }));

test("con la clave equivocada no se da de alta a nadie y el intento queda contado; a los cinco se bloquea, y entonces ni la clave buena pasa", () =>
  conPatio(async (p) => {
    const antes = await contar(p.db, "usuario");
    assert.equal((await alta(p.app, p, "Rosa", "mostrador", "5731", { clave: "000000" })).id, null);
    assert.equal(await contar(p.db, "usuario"), antes);
    assert.equal(await fallosDe(p.db, p.elena), 1);
    for (let k = 0; k < 4; k++) assert.equal((await alta(p.app, p, "Rosa", "mostrador", "5731", { clave: "000000" })).id, null);
    assert.ok((await una(p.db, "SELECT bloqueada_hasta FROM credencial WHERE usuario_id = $1", [p.elena])).bloqueada_hasta);
    assert.equal((await alta(p.app, p, "Rosa", "mostrador", "5731")).id, null);
    assert.equal(await contar(p.db, "usuario"), antes);
  }));

test("lo que no procede se dice antes de mirar la clave, y no gasta intentos: un responsable o quien administra, un nombre repetido o vacío, una clave nueva que se adivina sola", () =>
  conPatio(async (p) => {
    const mala = { clave: "000000" };
    // Un jefe no se fabrica desde la pantalla, ni con la clave buena.
    await rechaza(alta(p.app, p, "Colado", "responsable", "271828"), "RC008");
    await rechaza(alta(p.app, p, "Colado", "administracion", "271828"), "RC008");
    await rechaza(alta(p.app, p, "Colado", "dueño", "5731", mala), "RC005");
    await rechaza(alta(p.app, p, "luis ", "mostrador", "5731", mala), "RC005");
    await rechaza(alta(p.app, p, "   ", "mostrador", "5731", mala), "RC005");
    await rechaza(alta(p.app, p, "x".repeat(41), "mostrador", "5731", mala), "RC005");
    for (const clave of ["1111", "1234", "12", "abcd", ""]) await rechaza(alta(p.app, p, "Rosa", "mostrador", clave, mala), "RC005");
    assert.equal(await fallosDe(p.db, p.elena), 0);
    assert.equal(await contar(p.db, "usuario", "nombre IN ('Colado', 'Rosa')"), 0);
  }));

test("solo un responsable facultado: uno sin la facultad, alguien de mostrador, de consulta o de administración, y uno dado de baja, no pueden —ni leer las listas—", () =>
  conPatio(async (p) => {
    const marta = await personaConClave(p.db, "Marta", "responsable", "271828");
    const ana = await personaConClave(p.db, "Ana", "consulta", "3141");
    const tecnico = await personaConClave(p.db, "Técnico", "administracion", "161803");
    const ida = await personaConClave(p.db, "Ida", "responsable", "141421", true);
    await p.db.query("SELECT baja_persona($1)", [ida]);
    const equipo = (await una(p.db, "SELECT id FROM equipo LIMIT 1")).id;
    for (const [quien, clave] of [[marta, "271828"], [p.luis, "4815"], [ana, "3141"], [tecnico, "161803"], [ida, "141421"]] as const) {
      const pedidos: Array<[string, unknown[]]> = [
        ["SELECT alta_de_persona($1, $2, $3, 'Rosa', 'mostrador', '5731')", [p.h, quien, clave]],
        ["SELECT cambiar_clave_de_persona($1, $2, $3, $4, '5731')", [p.h, quien, clave, p.luis]],
        ["SELECT baja_de_persona($1, $2, $3, $4)", [p.h, quien, clave, p.luis]],
        ["SELECT codigo_para_equipo($1, $2, $3, 'Oficina')", [p.h, quien, clave]],
        ["SELECT baja_de_equipo($1, $2, $3, $4)", [p.h, quien, clave, equipo]],
        ["SELECT * FROM personas_para_administrar($1)", [quien]],
        ["SELECT * FROM equipos_para_administrar($1, $2)", [p.h, quien]],
      ];
      for (const [sql, valores] of pedidos) await rechaza(p.app.query(sql, valores), "RC008");
    }
    assert.equal(await contar(p.db, "usuario", "nombre = 'Rosa'"), 0);
    assert.equal(await entra(p.app, p.h, p.luis, "4815"), true);
  }));

test("desde un equipo que no está dado de alta no se administra nada, aunque la clave sea la buena", () =>
  conPatio(async (p) => {
    const ajena = "f".repeat(64);
    assert.equal((await alta(p.app, p, "Rosa", "mostrador", "5731", { h: ajena })).id, null);
    assert.equal((await una(p.app, "SELECT codigo_para_equipo($1, $2, $3, 'Oficina') AS c", [ajena, p.elena, CLAVE])).c, null);
    assert.equal(await contar(p.db, "usuario", "nombre = 'Rosa'"), 0);
    assert.equal(await contar(p.db, "codigo_alta", "nombre_equipo = 'Oficina'"), 0);
  }));

// ── cambiar la clave y dar de baja ─────────────────────────────────────────

test("cambiar la clave de una persona: la anterior deja de servir, la nueva entra, se cierra su sesión y se le quita el bloqueo; queda anotado quién lo hizo", () =>
  conPatio(async (p) => {
    assert.equal(await entra(p.app, p.h, p.luis, "4815"), true);
    for (let k = 0; k < 5; k++) await entra(p.app, p.h, p.luis, "0000");
    assert.ok((await una(p.db, "SELECT bloqueada_hasta FROM credencial WHERE usuario_id = $1", [p.luis])).bloqueada_hasta);

    assert.equal((await una(p.app, "SELECT cambiar_clave_de_persona($1, $2, $3, $4, '2718') AS hecho", [p.h, p.elena, CLAVE, p.luis])).hecho, true);
    assert.equal(await contar(p.db, "sesion", "usuario_id = $1 AND cerrada_en IS NULL", [p.luis]), 0);
    assert.equal(await entra(p.app, p.h, p.luis, "4815"), false);
    assert.equal(await entra(p.app, p.h, p.luis, "2718"), true);
    assert.equal((await anotados(p.db, "clave", "credencial")).at(-1), p.elena);

    // Con la clave equivocada de quien lo pide no cambia nada.
    assert.equal((await una(p.app, "SELECT cambiar_clave_de_persona($1, $2, '000000', $3, '3141') AS hecho", [p.h, p.elena, p.luis])).hecho, false);
    assert.equal(await entra(p.app, p.h, p.luis, "2718"), true);
    // Y una clave nueva que no vale se dice antes de mirar la de quien lo pide.
    await rechaza(p.app.query("SELECT cambiar_clave_de_persona($1, $2, '000000', $3, '1111')", [p.h, p.elena, p.luis]), "RC005");
    assert.equal(await fallosDe(p.db, p.elena), 1);
  }));

test("dar de baja a una persona: ya no entra y su sesión se cierra; no se puede dos veces; y queda anotado quién lo hizo", () =>
  conPatio(async (p) => {
    assert.equal(await entra(p.app, p.h, p.luis, "4815"), true);
    assert.equal((await una(p.app, "SELECT baja_de_persona($1, $2, '000000', $3) AS hecho", [p.h, p.elena, p.luis])).hecho, false);
    assert.equal(await contar(p.db, "usuario", "id = $1 AND activo", [p.luis]), 1);

    assert.equal((await una(p.app, "SELECT baja_de_persona($1, $2, $3, $4) AS hecho", [p.h, p.elena, CLAVE, p.luis])).hecho, true);
    assert.equal(await contar(p.db, "usuario", "id = $1 AND activo", [p.luis]), 0);
    assert.equal(await contar(p.db, "sesion", "usuario_id = $1 AND cerrada_en IS NULL", [p.luis]), 0);
    assert.equal(await entra(p.app, p.h, p.luis, "4815"), false);
    assert.equal((await anotados(p.db, "baja", "usuario")).at(-1), p.elena);
    await rechaza(p.app.query("SELECT baja_de_persona($1, $2, $3, $4)", [p.h, p.elena, CLAVE, p.luis]), "RC005");
    await rechaza(p.app.query("SELECT baja_de_persona($1, $2, $3, 999999)", [p.h, p.elena, CLAVE]), "RC005");
  }));

test("a un responsable y a quien administra no se les cambia la clave ni se les da de baja desde la pantalla: ni a otro, ni a uno mismo", () =>
  conPatio(async (p) => {
    const marta = await personaConClave(p.db, "Marta", "responsable", "271828");
    const tecnico = await personaConClave(p.db, "Técnico", "administracion", "161803");
    for (const quien of [marta, tecnico, p.elena]) {
      await rechaza(p.app.query("SELECT cambiar_clave_de_persona($1, $2, $3, $4, '314159')", [p.h, p.elena, CLAVE, quien]), "RC008");
      await rechaza(p.app.query("SELECT baja_de_persona($1, $2, $3, $4)", [p.h, p.elena, CLAVE, quien]), "RC008");
    }
    assert.equal(await contar(p.db, "usuario", "activo AND id = ANY($1::bigint[])", [[marta, tecnico, p.elena]]), 3);
    assert.equal(await entra(p.app, p.h, marta, "271828"), true);
  }));

// ── equipos ────────────────────────────────────────────────────────────────

test("el código para un equipo nuevo: sirve una vez, el equipo queda a nombre de quien lo pidió, y pedirlo queda anotado sin el código", () =>
  conPatio(async (p) => {
    assert.equal((await una(p.app, "SELECT codigo_para_equipo($1, $2, '000000', 'Oficina') AS c", [p.h, p.elena])).c, null);
    assert.equal(await contar(p.db, "codigo_alta", "nombre_equipo = 'Oficina'"), 0);

    const codigo = (await una(p.app, "SELECT codigo_para_equipo($1, $2, $3, '  Oficina ') AS c", [p.h, p.elena, CLAVE])).c as string;
    assert.match(codigo, /^[A-Z2-9]{10}$/);
    const nueva = "a".repeat(64);
    assert.ok((await una(p.app, "SELECT canjear_codigo($1, $2) AS e", [codigo, nueva])).e);
    assert.equal((await una(p.app, "SELECT canjear_codigo($1, $2) AS e", [codigo, "b".repeat(64)])).e, null);
    assert.equal((await anotados(p.db, "alta", "equipo")).at(-1), p.elena);
    const pedido = await una(p.db, "SELECT usuario_id, detalle FROM bitacora WHERE accion = 'codigo' AND entidad = 'equipo'");
    assert.equal(pedido.usuario_id, p.elena);
    assert.deepEqual(pedido.detalle, { nombre: "Oficina" });
    assert.equal(JSON.stringify(pedido).includes(codigo), false);
    // Un nombre vacío se rechaza antes de mirar la clave: el intento fallido de arriba ya lo borró
    // la clave buena, y este no cuenta.
    await rechaza(p.app.query("SELECT codigo_para_equipo($1, $2, '000000', '   ')", [p.h, p.elena]), "RC005");
    assert.equal(await fallosDe(p.db, p.elena), 0);
  }));

test("dar de baja un equipo: deja de valer y se cierra la sesión de quien atendía en él; no el equipo desde el que se pide, ni uno que no existe o ya estaba de baja", () =>
  conPatio(async (p) => {
    const codigo = (await una(p.app, "SELECT codigo_para_equipo($1, $2, $3, 'Patio') AS c", [p.h, p.elena, CLAVE])).c;
    const otra = "c".repeat(64);
    const equipo = (await una(p.app, "SELECT canjear_codigo($1, $2) AS e", [codigo, otra])).e;
    assert.equal(await entra(p.app, otra, p.luis, "4815"), true);

    assert.equal((await una(p.app, "SELECT baja_de_equipo($1, $2, '000000', $3) AS hecho", [p.h, p.elena, equipo])).hecho, false);
    assert.ok((await una(p.app, "SELECT equipo_vigente($1) AS e", [otra])).e);
    assert.equal((await una(p.app, "SELECT baja_de_equipo($1, $2, $3, $4) AS hecho", [p.h, p.elena, CLAVE, equipo])).hecho, true);
    assert.equal((await una(p.app, "SELECT equipo_vigente($1) AS e", [otra])).e, null);
    assert.equal(await contar(p.db, "sesion", "equipo_id = $1 AND cerrada_en IS NULL", [equipo]), 0);
    assert.equal((await anotados(p.db, "baja", "equipo")).at(-1), p.elena);

    const este = (await una(p.app, "SELECT equipo_vigente($1) AS e", [p.h])).e;
    await rechaza(p.app.query("SELECT baja_de_equipo($1, $2, $3, $4)", [p.h, p.elena, CLAVE, este]), "RC005");
    await rechaza(p.app.query("SELECT baja_de_equipo($1, $2, $3, $4)", [p.h, p.elena, CLAVE, equipo]), "RC005");
    await rechaza(p.app.query("SELECT baja_de_equipo($1, $2, $3, gen_random_uuid())", [p.h, p.elena, CLAVE]), "RC005");
    assert.ok((await una(p.app, "SELECT equipo_vigente($1) AS e", [p.h])).e);
  }));

test("dos responsables que se dan de baja el equipo uno al otro a la vez: las bajas van en fila, la segunda ya no pasa porque su equipo dejó de valer, y el negocio no se queda sin equipos", () =>
  conPatio(async (p) => {
    // Lo encontró la revisión de Codex del 12 de octubre: cada baja veía vigente su propio equipo, las dos
    // pasaban, y quedaban cero equipos: nadie podía volver a entrar sin la consola.
    const ida = await personaConClave(p.db, "Ida", "responsable", "141421", true);
    const codigo = (await una(p.app, "SELECT codigo_para_equipo($1, $2, $3, 'Oficina') AS c", [p.h, p.elena, CLAVE])).c;
    const hB = "b".repeat(64);
    const equipoB = (await una(p.app, "SELECT canjear_codigo($1, $2) AS e", [codigo, hB])).e;
    const equipoA = (await una(p.app, "SELECT equipo_vigente($1) AS e", [p.h])).e;
    const otra = await comoApp(p.base);
    try {
      // Desde A, Elena da de baja B: hecho, pero todavía sin terminar.
      await p.app.query("BEGIN");
      assert.equal((await una(p.app, "SELECT baja_de_equipo($1, $2, $3, $4) AS hecho", [p.h, p.elena, CLAVE, equipoB])).hecho, true);
      // Desde B, Ida da de baja A: espera a la otra.
      const pid = await pidDe(otra);
      const laDeIda = otra.query("SELECT baja_de_equipo($1, $2, '141421', $3) AS hecho", [hB, ida, equipoA]);
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      // Al pasar, el equipo de Ida ya no vale: su baja no se hace.
      assert.equal((await laDeIda).rows[0].hecho, false);
    } finally {
      await otra.end();
    }
    assert.equal(await contar(p.db, "equipo", "baja_en IS NULL"), 1);
    assert.ok((await una(p.app, "SELECT equipo_vigente($1) AS e", [p.h])).e);
  }));

// ── las listas ─────────────────────────────────────────────────────────────

test("la lista de personas dice de cada una su rol, si autoriza, si está bloqueada, en qué equipo está adentro, y si se administra desde la pantalla; las dadas de baja van al final", () =>
  conPatio(async (p) => {
    const ana = await personaConClave(p.db, "Ana", "consulta", "3141");
    const ida = await personaConClave(p.db, "Ida", "patio", "2718");
    await p.db.query("SELECT baja_persona($1)", [ida]);
    assert.equal(await entra(p.app, p.h, p.luis, "4815"), true);
    for (let k = 0; k < 5; k++) await entra(p.app, "0".repeat(64), ana, "0000");   // un equipo ajeno no cuenta fallos
    for (let k = 0; k < 5; k++) await p.db.query("SELECT comprobar_clave((SELECT id FROM equipo LIMIT 1), $1, '0000')", [ana]);
    const lista = (await p.app.query("SELECT * FROM personas_para_administrar($1)", [p.elena])).rows;
    assert.deepEqual(lista, [
      { id: ana, nombre: "Ana", rol: "consulta", puede_autorizar: false, activo: true, bloqueada: true, adentro_de: null, se_administra: true },
      { id: p.elena, nombre: "Elena", rol: "responsable", puede_autorizar: true, activo: true, bloqueada: false, adentro_de: null, se_administra: false },
      { id: p.luis, nombre: "Luis", rol: "mostrador", puede_autorizar: false, activo: true, bloqueada: false, adentro_de: "Mostrador", se_administra: true },
      { id: ida, nombre: "Ida", rol: "patio", puede_autorizar: false, activo: false, bloqueada: false, adentro_de: null, se_administra: false },
    ]);
  }));

test("la lista de equipos dice cuál es este, desde cuándo está, quién atiende en cada uno, y cuáles se dieron de baja; nunca su huella", () =>
  conPatio(async (p) => {
    const codigo = (await una(p.app, "SELECT codigo_para_equipo($1, $2, $3, 'Patio') AS c", [p.h, p.elena, CLAVE])).c;
    const otra = "d".repeat(64);
    const patio = (await una(p.app, "SELECT canjear_codigo($1, $2) AS e", [codigo, otra])).e;
    assert.equal(await entra(p.app, otra, p.luis, "4815"), true);
    const este = (await una(p.app, "SELECT equipo_vigente($1) AS e", [p.h])).e;
    const hoy = (await una(p.db, "SELECT hoy_en(1::smallint)::text AS f")).f;

    let lista = (await p.app.query("SELECT id, nombre, alta_el::text, activo, atiende, es_este FROM equipos_para_administrar($1, $2)", [p.h, p.elena])).rows;
    assert.deepEqual(lista, [
      { id: este, nombre: "Mostrador", alta_el: hoy, activo: true, atiende: null, es_este: true },
      { id: patio, nombre: "Patio", alta_el: hoy, activo: true, atiende: "Luis", es_este: false },
    ]);
    assert.deepEqual(Object.keys((await p.app.query("SELECT * FROM equipos_para_administrar($1, $2)", [p.h, p.elena])).rows[0]).sort(),
      ["activo", "alta_el", "atiende", "es_este", "id", "nombre"]);

    await p.app.query("SELECT baja_de_equipo($1, $2, $3, $4)", [p.h, p.elena, CLAVE, patio]);
    lista = (await p.app.query("SELECT nombre, activo, atiende FROM equipos_para_administrar($1, $2)", [p.h, p.elena])).rows;
    assert.deepEqual(lista, [{ nombre: "Mostrador", activo: true, atiende: null }, { nombre: "Patio", activo: false, atiende: null }]);
  }));

test("la aplicación sigue sin poder llamar a las funciones de la consola ni leer las tablas de identidad", () =>
  conPatio(async (p) => {
    const SIN_PERMISO = "42501";
    const directas: Array<[string, unknown[]]> = [
      ["SELECT alta_persona('Colado', 'responsable', true, '481516')", []],
      ["SELECT fijar_clave($1, '2718')", [p.luis]],
      ["SELECT baja_persona($1)", [p.luis]],
      ["SELECT crear_codigo_alta('Colado')", []],
      ["SELECT * FROM equipo", []],
      ["SELECT * FROM credencial", []],
      ["SELECT * FROM sesion", []],
      ["SELECT * FROM codigo_alta", []],
      ["UPDATE usuario SET rol = 'responsable', puede_autorizar = true WHERE id = $1", [p.luis]],
    ];
    for (const [sql, valores] of directas) await rechaza(p.app.query(sql, valores), SIN_PERMISO);
  }));

// ── por las rutas ──────────────────────────────────────────────────────────

const pedirA = async (n: Navegador, camino: string, cuerpo: unknown, parametros: Record<string, string> = {}): Promise<Response> =>
  n.pedir(await ruta(camino, "POST"), "POST", "/api/x", cuerpo, { parametros });
const errorDe = async (r: Response): Promise<[number, string]> => [r.status, (await r.json()).error.codigo];
/** ¿Esa persona entra con esa clave, desde un equipo recién dado de alta? */
async function entraPorLaPuerta(m: Mundo, persona: string, clave: string): Promise<boolean> {
  const n = await m.equipo();
  return (await n.pedir(await ruta("sesion/entrar", "POST"), "POST", "/api/sesion/entrar", { persona, clave })).status === 200;
}

test("por las rutas: el responsable facultado ve a las personas y los equipos; da de alta a alguien de mostrador y recibe su clave, una sola vez y sin que se guarde en ningún caché; con esa clave la persona entra", () =>
  conMundo(async (m) => {
    const jefe = await m.adentro("responsable");
    const lista = await jefe.bien(await ruta("administracion", "GET"), "GET", "/api/administracion");
    assert.deepEqual(lista.personas.map((p: any) => [p.nombre, p.rol, p.seAdministra]), [
      ["De administracion", "administracion", false], ["De consulta", "consulta", true], ["De mostrador", "mostrador", true],
      ["De patio", "patio", true], ["De responsable", "responsable", false],
    ]);
    assert.deepEqual(Object.keys(lista.personas[0]).sort(), ["activa", "adentroDe", "bloqueada", "id", "nombre", "puedeAutorizar", "rol", "seAdministra"]);
    assert.deepEqual(lista.equipos.map((e: any) => [e.nombre, e.activo, e.atiende, e.esEste]), [["Mostrador", true, "De responsable", true]]);
    assert.match(lista.equipos[0].altaEl, /^\d{4}-\d{2}-\d{2}$/);

    const r = await pedirA(jefe, "administracion/personas", { nombre: " Rosa ", rol: "mostrador", clave: CLAVES.responsable });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const alta = await r.json();
    assert.deepEqual(Object.keys(alta).sort(), ["clave", "persona"]);
    assert.deepEqual([alta.persona.nombre, alta.persona.rol], ["Rosa", "mostrador"]);
    assert.match(alta.clave, /^\d{4}$/);
    assert.equal(await entraPorLaPuerta(m, alta.persona.id, alta.clave), true);
    // La base no guarda la clave: solo su huella.
    assert.equal(await contar(m.db, "credencial", "usuario_id = $1 AND huella <> $2", [alta.persona.id, alta.clave]), 1);
  }));

test("por las rutas: la clave de quien lo pide tiene que pasar; lo que es de la consola se niega; y lo que no tiene forma se dice", () =>
  conMundo(async (m) => {
    const jefe = await m.adentro("responsable");
    const antes = await contar(m.db, "usuario");
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas", { nombre: "Rosa", rol: "mostrador", clave: "000000" })), [401, "CLAVE"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas", { nombre: "Colado", rol: "responsable", clave: CLAVES.responsable })), [403, "RC008"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas", { nombre: "De patio", rol: "patio", clave: CLAVES.responsable })), [409, "RC005"]);
    for (const cuerpo of [{}, { nombre: "Rosa", rol: "mostrador" }, { nombre: "", rol: "mostrador", clave: "481516" }, { nombre: "Rosa", rol: 5, clave: "481516" }, { nombre: "Rosa", rol: "mostrador", clave: 481516 }]) {
      assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas", cuerpo)), [400, "FORMA"], JSON.stringify(cuerpo));
    }
    assert.equal(await contar(m.db, "usuario"), antes);
    // A la persona de mostrador, aunque esté adentro, no le toca: ni verlo.
    const caja = await m.adentro("mostrador");
    assert.deepEqual(await errorDe(await caja.pedir(await ruta("administracion", "GET"), "GET", "/api/administracion")), [403, "ROL"]);
  }));

test("por las rutas: cambiarle la clave a una persona da una nueva, que entra, y la anterior ya no; darla de baja la deja afuera", () =>
  conMundo(async (m) => {
    const jefe = await m.adentro("responsable");
    const persona = m.personas.mostrador;
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/clave", { clave: "000000" }, { persona })), [401, "CLAVE"]);
    const r = await pedirA(jefe, "administracion/personas/[persona]/clave", { clave: CLAVES.responsable }, { persona });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const { clave } = await r.json();
    assert.match(clave, /^\d{4}$/);
    assert.notEqual(clave, CLAVES.mostrador);
    assert.equal(await entraPorLaPuerta(m, persona, CLAVES.mostrador), false);
    assert.equal(await entraPorLaPuerta(m, persona, clave), true);
    // A un responsable no, y a una persona que no existe tampoco; un número que no lo es, es de forma.
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/clave", { clave: CLAVES.responsable }, { persona: m.personas.responsable })), [403, "RC008"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/clave", { clave: CLAVES.responsable }, { persona: "999999" })), [409, "RC005"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/clave", { clave: CLAVES.responsable }, { persona: "abc" })), [400, "FORMA"]);

    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/baja", { clave: "000000" }, { persona })), [401, "CLAVE"]);
    assert.deepEqual(await (await pedirA(jefe, "administracion/personas/[persona]/baja", { clave: CLAVES.responsable }, { persona })).json(), { hecho: true });
    assert.equal(await entraPorLaPuerta(m, persona, clave), false);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/baja", { clave: CLAVES.responsable }, { persona })), [409, "RC005"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/personas/[persona]/baja", { clave: CLAVES.responsable }, { persona: m.personas.administracion })), [403, "RC008"]);
  }));

test("por las rutas: se pide un código para un equipo nuevo, el equipo se da de alta con él, sale en la lista y se da de baja; el propio, no; y la bitácora lo dice en llano", () =>
  conMundo(async (m) => {
    const jefe = await m.adentro("responsable");
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/equipos", { nombre: "Oficina", clave: "000000" })), [401, "CLAVE"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/equipos", { nombre: "", clave: CLAVES.responsable })), [400, "FORMA"]);
    const r = await pedirA(jefe, "administracion/equipos", { nombre: "Oficina", clave: CLAVES.responsable });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const { codigo } = await r.json();
    assert.match(codigo, /^[A-Z2-9]{10}$/);

    const { Navegador: Nav } = await import("./navegador.ts");
    const oficina = new Nav();
    await oficina.bien(await ruta("equipo/alta", "POST"), "POST", "/api/equipo/alta", { codigo });
    let lista = await jefe.bien(await ruta("administracion", "GET"), "GET", "/api/administracion");
    assert.deepEqual(lista.equipos.map((e: any) => [e.nombre, e.activo, e.esEste]), [["Mostrador", true, true], ["Oficina", true, false]]);
    const [este, otro] = lista.equipos;

    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/equipos/[equipo]/baja", { clave: CLAVES.responsable }, { equipo: este.id })), [409, "RC005"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/equipos/[equipo]/baja", { clave: "000000" }, { equipo: otro.id })), [401, "CLAVE"]);
    assert.deepEqual(await errorDe(await pedirA(jefe, "administracion/equipos/[equipo]/baja", { clave: CLAVES.responsable }, { equipo: "no-es-un-equipo" })), [400, "FORMA"]);
    assert.deepEqual(await (await pedirA(jefe, "administracion/equipos/[equipo]/baja", { clave: CLAVES.responsable }, { equipo: otro.id })).json(), { hecho: true });
    lista = await jefe.bien(await ruta("administracion", "GET"), "GET", "/api/administracion");
    assert.deepEqual(lista.equipos.map((e: any) => [e.nombre, e.activo]), [["Mostrador", true], ["Oficina", false]]);
    // El equipo dado de baja ya no pasa de la puerta.
    assert.equal((await oficina.pedir(await ruta("personas", "GET"), "GET", "/api/personas")).status, 401);

    const { asientos } = await jefe.bien(await ruta("bitacora", "GET"), "GET", "/api/bitacora");
    const dicho = asientos.map((a: any) => `${a.quien} ${a.que}`);
    assert.ok(dicho.includes("De responsable pidió un código para dar de alta el equipo Oficina"), dicho.join(" | "));
    assert.ok(dicho.includes("De responsable dio de alta el equipo Oficina"));
    assert.ok(dicho.includes("De responsable dio de baja el equipo Oficina"));
    assert.equal(JSON.stringify(asientos).includes(codigo), false);
  }));
