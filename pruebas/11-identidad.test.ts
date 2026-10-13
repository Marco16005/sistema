// Identidad: equipos dados de alta, claves por persona con bloqueo, y sesiones que viven en la base.
// La aplicación solo puede preguntar por funciones; no lee ninguna de estas tablas.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import {
  abrirCuenta, comoApp, conBase, conectar, contar, desenlace, equipoDeAlta, escenario, esperarQueEspere, esperarQueEsperen, pidDe, rechaza, una,
} from "./apoyo.ts";

const SIN_PERMISO = "42501";
const huellaDe = (secreto: string) => createHash("sha256").update(secreto).digest("hex");

/** Corre la prueba con la conexión del dueño (la consola) y la de la aplicación. */
const conIdentidad = (prueba: (app: pg.Client, db: pg.Client, base: string) => Promise<void>) =>
  conBase(async (db, base) => {
    const app = await comoApp(base);
    try {
      await prueba(app, db, base);
    } finally {
      await app.end();
    }
  });

const alta = async (db: pg.Client, nombre: string, rol: string, clave: string, autoriza = false): Promise<string> =>
  (await una(db, "SELECT * FROM alta_persona($1, $2, $3, $4)", [nombre, rol, autoriza, clave])).id;

const codigoNuevo = async (db: pg.Client, nombre = "Mostrador"): Promise<string> =>
  (await una(db, "SELECT crear_codigo_alta($1) AS codigo", [nombre])).codigo;

const canjear = async (app: pg.Client, codigo: string, huella: string): Promise<string | null> =>
  (await una(app, "SELECT canjear_codigo($1, $2) AS equipo", [codigo, huella])).equipo;

/** Da de alta un equipo y devuelve la huella de su secreto, que es lo que la aplicación presenta. */
const equipoNuevo = async (app: pg.Client, db: pg.Client, nombre = "Mostrador"): Promise<string> => {
  const huella = huellaDe(randomUUID());
  assert.ok(await canjear(app, await codigoNuevo(db, nombre), huella));
  return huella;
};

const entrar = async (app: pg.Client, huella: string, persona: string, clave: string): Promise<string | null> =>
  (await una(app, "SELECT entrar($1, $2, $3) AS sesion", [huella, persona, clave])).sesion;

const vigente = async (app: pg.Client, huella: string, sesion: string | null) =>
  (await app.query("SELECT * FROM sesion_vigente($1, $2)", [huella, sesion])).rows;

const credencialDe = (db: pg.Client, persona: string) => una(db, "SELECT * FROM credencial WHERE usuario_id = $1", [persona]);

const fallar = async (app: pg.Client, huella: string, persona: string, veces: number) => {
  for (let k = 0; k < veces; k++) assert.equal(await entrar(app, huella, persona, "0000"), null);
};

// ── entrar ─────────────────────────────────────────────────────────────────

test("con su clave la persona entra y la sesión dice quién es", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const servando = await alta(db, "Servando", "responsable", "481516", true);
    const sesion = await entrar(app, h, servando, "481516");
    assert.ok(sesion);
    assert.deepEqual(await vigente(app, h, sesion), [
      { usuario_id: servando, nombre: "Servando", rol: "responsable", puede_autorizar: true },
    ]);
  }));

test("con otra clave no entra y no queda sesión", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    assert.equal(await entrar(app, h, luis, "4816"), null);
    assert.equal(await entrar(app, h, luis, ""), null);
    assert.equal((await una(app, "SELECT entrar($1, $2, NULL) AS sesion", [h, luis])).sesion, null);
    assert.equal(await contar(db, "sesion"), 0);
  }));

test("no entrar se ve igual sea cual sea la razón", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const baja = await alta(db, "Ya no está", "mostrador", "4815");
    await db.query("SELECT baja_persona($1)", [baja]);
    const sinClave = (await una(db, "INSERT INTO usuario (sucursal_id, nombre, rol) VALUES (1, 'Sin clave', 'mostrador') RETURNING id")).id;
    assert.equal(await entrar(app, h, luis, "0000"), null);            // clave equivocada
    assert.equal(await entrar(app, h, baja, "4815"), null);            // dada de baja
    assert.equal(await entrar(app, h, sinClave, "4815"), null);        // nunca tuvo clave
    assert.equal(await entrar(app, h, "999999", "4815"), null);        // no existe
    assert.equal(await entrar(app, huellaDe("otro equipo"), luis, "4815"), null); // equipo desconocido
    assert.equal(await contar(db, "sesion"), 0);
  }));

test("la clave no se guarda: se guarda una huella con sal", () =>
  conIdentidad(async (_app, db) => {
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const beto = await alta(db, "Beto", "patio", "4815");
    const a = (await credencialDe(db, luis)).huella as string;
    const b = (await credencialDe(db, beto)).huella as string;
    assert.match(a, /^\$2[ab]\$10\$/);
    assert.notEqual(a, b, "dos personas con la misma clave no comparten huella");
    assert.equal(await contar(db, "bitacora", "detalle::text LIKE '%4815%'"), 0);
  }));

// ── bloqueo por intentos ───────────────────────────────────────────────────

test("cinco fallos seguidos bloquean la clave, aunque después llegue la buena", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await fallar(app, h, luis, 4);
    assert.equal((await credencialDe(db, luis)).bloqueada_hasta, null);
    await fallar(app, h, luis, 1);
    assert.ok((await credencialDe(db, luis)).bloqueada_hasta > new Date());
    assert.equal(await entrar(app, h, luis, "4815"), null);
    const rastro = await una(db, "SELECT * FROM bitacora WHERE accion = 'bloquear'");
    assert.equal(rastro.usuario_id, luis);
    assert.equal(rastro.entidad, "credencial");
  }));

test("pasado el bloqueo, la clave buena vuelve a entrar", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await fallar(app, h, luis, 5);
    await db.query("UPDATE credencial SET bloqueada_hasta = now() - interval '1 second' WHERE usuario_id = $1", [luis]);
    assert.ok(await entrar(app, h, luis, "4815"));
  }));

test("mientras está bloqueada, los intentos no cuentan ni alargan el bloqueo", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await fallar(app, h, luis, 5);
    const antes = await credencialDe(db, luis);
    await fallar(app, h, luis, 7);
    const despues = await credencialDe(db, luis);
    assert.equal(despues.bloqueada_hasta.getTime(), antes.bloqueada_hasta.getTime());
    assert.equal(despues.fallos, antes.fallos);
    assert.equal(despues.bloqueos, antes.bloqueos);
  }));

test("el bloqueo se alarga cada vez que se repite: 5, 15 y 60 minutos", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const minutos = async () =>
      Math.round((await una(db, "SELECT extract(epoch FROM bloqueada_hasta - now()) / 60 AS m FROM credencial WHERE usuario_id = $1", [luis])).m);
    const liberar = () => db.query("UPDATE credencial SET bloqueada_hasta = now() - interval '1 second' WHERE usuario_id = $1", [luis]);
    for (const esperado of [5, 15, 60, 60]) {
      await fallar(app, h, luis, 5);
      assert.equal(await minutos(), esperado);
      await liberar();
    }
    // Un acierto borra la cuenta: el siguiente bloqueo vuelve a ser el corto.
    assert.ok(await entrar(app, h, luis, "4815"));
    await fallar(app, h, luis, 5);
    assert.equal(await minutos(), 5);
  }));

test("un acierto limpia los fallos anteriores", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await fallar(app, h, luis, 4);
    assert.ok(await entrar(app, h, luis, "4815"));
    await fallar(app, h, luis, 4);
    assert.equal((await credencialDe(db, luis)).bloqueada_hasta, null);
    assert.ok(await entrar(app, h, luis, "4815"));
  }));

test("cinco fallos a la vez cuentan cinco", () =>
  conIdentidad(async (app, db, base) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const otras = await Promise.all([1, 2, 3, 4, 5].map(() => comoApp(base)));
    const candado = await conectar(base);
    try {
      const pids = await Promise.all(otras.map(pidDe));
      // Con la credencial tomada, los cinco intentos llegan juntos al mismo punto y esperan ahí.
      await candado.query("BEGIN");
      await candado.query("SELECT 1 FROM credencial WHERE usuario_id = $1 FOR UPDATE", [luis]);
      const intentos = otras.map((c) => entrar(c, h, luis, "0000"));
      await esperarQueEsperen(db, pids);
      await candado.query("COMMIT");
      assert.deepEqual(await Promise.all(intentos), [null, null, null, null, null]);
      const c = await credencialDe(db, luis);
      assert.ok(c.bloqueada_hasta > new Date(), `quedó con ${c.fallos} fallos y sin bloqueo`);
      assert.equal(await entrar(app, h, luis, "4815"), null);
    } finally {
      await candado.end();
      await Promise.all(otras.map((c) => c.end()));
    }
  }));

test("comprobar una clave en el momento dice sí o no, cuenta los fallos y no abre sesión", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const servando = await alta(db, "Servando", "responsable", "481516", true);
    const comprobar = async (clave: string, huella = h) =>
      (await una(app, "SELECT verificar_clave($1, $2, $3) AS bien", [huella, servando, clave])).bien;
    assert.equal(await comprobar("481516"), true);
    assert.equal(await comprobar("481517"), false);
    assert.equal((await credencialDe(db, servando)).fallos, 1);
    assert.equal(await comprobar("481516", huellaDe("otro equipo")), false);
    assert.equal(await contar(db, "sesion"), 0);
    for (let k = 0; k < 5; k++) await comprobar("000000");
    assert.equal(await comprobar("481516"), false, "bloqueada también para autorizar");
  }));

// ── la clave ───────────────────────────────────────────────────────────────

test("la clave es de cuatro a ocho dígitos, y de seis o más para quien es responsable o administra", () =>
  conIdentidad(async (_app, db) => {
    await alta(db, "Luis", "mostrador", "4815");
    await alta(db, "Beto", "patio", "48151623");
    await alta(db, "Servando", "responsable", "481516", true);
    await alta(db, "Técnico", "administracion", "4815162");
    for (const [rol, clave] of [
      ["mostrador", "481"], ["mostrador", "481516234"], ["mostrador", "48a5"], ["mostrador", ""], ["mostrador", " 4815"],
      ["responsable", "4815"], ["responsable", "48151"], ["administracion", "4815"],
    ] as const) {
      await rechaza(alta(db, `Otro ${rol} ${clave}`, rol, clave), "RC005");
    }
    await rechaza(db.query("SELECT alta_persona('Sin clave', 'mostrador', false, NULL)"), "RC005");
    assert.equal(await contar(db, "usuario"), 4);
  }));

test("una clave que se adivina sola no se admite", () =>
  conIdentidad(async (_app, db) => {
    for (const clave of ["0000", "1111", "1234", "4321", "9876", "0123", "222222", "123456", "654321"]) {
      await rechaza(alta(db, `Persona ${clave}`, "mostrador", clave), "RC005");
    }
    assert.equal(await contar(db, "usuario"), 0);
  }));

test("no se dan de alta dos personas activas con el mismo nombre, ni con un rol que no existe", () =>
  conIdentidad(async (_app, db) => {
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await rechaza(alta(db, "Luis", "patio", "4815"), "RC005");
    await rechaza(alta(db, "  luis ", "patio", "4815"), "RC005");
    await rechaza(alta(db, "", "patio", "4815"), "RC005");
    await rechaza(alta(db, "Pedro", "jefe", "4815"), "RC005");
    await rechaza(alta(db, "Pedro", "mostrador", "4815", true), "RC005"); // solo un responsable autoriza
    await db.query("SELECT baja_persona($1)", [luis]);
    await alta(db, "Luis", "patio", "4815");
    assert.equal(await contar(db, "usuario", "activo"), 1);
  }));

test("dos altas a la vez con el mismo nombre dejan una sola persona", () =>
  conIdentidad(async (_app, db, base) => {
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await alta(db, "Luis", "mostrador", "4815");
      const segunda = desenlace(alta(otra, " luis", "mostrador", "2718"));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await segunda, "RC005");
      assert.equal(await contar(db, "usuario", "activo"), 1);
      assert.equal(await contar(db, "credencial"), 1);
    } finally {
      await otra.end();
    }
  }));

test("cambiar la clave deja fuera a la anterior, cierra las sesiones de esa persona y quita el bloqueo", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    await db.query("SELECT fijar_clave($1, $2)", [luis, "2718"]);
    assert.deepEqual(await vigente(app, h, sesion), []);
    assert.equal(await entrar(app, h, luis, "4815"), null);
    assert.ok(await entrar(app, h, luis, "2718"));

    await fallar(app, h, luis, 5);
    await db.query("SELECT fijar_clave($1, $2)", [luis, "3141"]);
    assert.ok(await entrar(app, h, luis, "3141"));
    await rechaza(db.query("SELECT fijar_clave(999999, '3141')"), "RC005");
    await rechaza(db.query("SELECT fijar_clave($1, '12')", [luis]), "RC005");
  }));

test("dar de baja a una persona le cierra la sesión y ya no entra", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    await db.query("SELECT baja_persona($1)", [luis]);
    assert.deepEqual(await vigente(app, h, sesion), []);
    assert.equal(await entrar(app, h, luis, "4815"), null);
    assert.equal((await una(db, "SELECT activo FROM usuario WHERE id = $1", [luis])).activo, false);
  }));

test("lo que hace la consola queda en la bitácora, sin la clave", () =>
  conIdentidad(async (_app, db) => {
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await db.query("SELECT fijar_clave($1, '2718')", [luis]);
    await db.query("SELECT baja_persona($1)", [luis]);
    const acciones = (await db.query("SELECT accion FROM bitacora WHERE entidad IN ('usuario', 'credencial') ORDER BY id")).rows.map((f) => f.accion);
    assert.deepEqual(acciones, ["insert", "clave", "clave", "update", "baja"]);
    assert.equal(await contar(db, "bitacora", "detalle::text ~ '4815|2718'"), 0);
  }));

// ── equipos ────────────────────────────────────────────────────────────────

test("el código de alta es corto, sin letras que se confundan, y la base no lo guarda", () =>
  conIdentidad(async (_app, db) => {
    const codigo = await codigoNuevo(db);
    assert.match(codigo, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.notEqual(codigo, await codigoNuevo(db));
    assert.equal(await contar(db, "codigo_alta", "huella = $1 OR nombre_equipo = $1", [codigo]), 0);
    assert.equal(await contar(db, "codigo_alta"), 2);
  }));

test("el código da de alta un equipo, una sola vez", () =>
  conIdentidad(async (app, db) => {
    const codigo = await codigoNuevo(db, "Mostrador principal");
    const huella = huellaDe("secreto del equipo");
    const equipo = await canjear(app, codigo, huella);
    assert.ok(equipo);
    assert.equal((await una(app, "SELECT equipo_vigente($1) AS id", [huella])).id, equipo);
    assert.equal((await una(db, "SELECT nombre FROM equipo WHERE id = $1", [equipo])).nombre, "Mostrador principal");
    assert.equal(await canjear(app, codigo, huellaDe("otro secreto")), null);
    assert.equal(await contar(db, "equipo"), 1);
    assert.equal(await contar(db, "bitacora", "accion = 'alta' AND entidad = 'equipo' AND entidad_id = $1", [equipo]), 1);
  }));

test("el código se acepta como lo teclea una persona: minúsculas, espacios y guiones", () =>
  conIdentidad(async (app, db) => {
    const codigo = await codigoNuevo(db);
    const tecleado = ` ${codigo.slice(0, 5).toLowerCase()}-${codigo.slice(5).toLowerCase()} `;
    assert.ok(await canjear(app, tecleado, huellaDe("x")));
  }));

test("un código vencido, equivocado o vacío no da de alta nada", () =>
  conIdentidad(async (app, db) => {
    const vencido = await codigoNuevo(db);
    await db.query("UPDATE codigo_alta SET vence_en = now() - interval '1 second'");
    assert.equal(await canjear(app, vencido, huellaDe("a")), null);
    assert.equal(await canjear(app, "AAAAAAAAAA", huellaDe("b")), null);
    assert.equal(await canjear(app, "", huellaDe("c")), null);
    assert.equal((await una(app, "SELECT canjear_codigo(NULL, $1) AS equipo", [huellaDe("d")])).equipo, null);
    assert.equal(await contar(db, "equipo"), 0);
  }));

test("dos canjes a la vez del mismo código dan un solo equipo", () =>
  conIdentidad(async (app, db, base) => {
    const otra = await comoApp(base);
    try {
      const codigo = await codigoNuevo(db);
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      assert.ok(await canjear(app, codigo, huellaDe("uno")));
      const segundo = canjear(otra, codigo, huellaDe("dos"));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await segundo, null);
      assert.equal(await contar(db, "equipo"), 1);
    } finally {
      await otra.end();
    }
  }));

test("dos códigos canjeados a la vez con la misma huella: el segundo se rechaza y no gasta su código", () =>
  conIdentidad(async (app, db, base) => {
    const otra = await comoApp(base);
    try {
      const [uno, dos] = [await codigoNuevo(db), await codigoNuevo(db)];
      const huella = huellaDe("el mismo equipo");
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      assert.ok(await canjear(app, uno, huella));
      const segundo = desenlace(canjear(otra, dos, huella));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await segundo, "RC005");
      assert.equal(await contar(db, "equipo"), 1);
      assert.equal(await contar(db, "codigo_alta", "usado_en IS NULL"), 1);
    } finally {
      await otra.end();
    }
  }));

test("la huella del equipo tiene que ser una huella, y no se repite", () =>
  conIdentidad(async (app, db) => {
    for (const mala of ["", "abc", "Z".repeat(64), huellaDe("x").toUpperCase(), huellaDe("x") + "0"]) {
      await rechaza(canjear(app, await codigoNuevo(db), mala), "RC005");
    }
    const huella = huellaDe("repetida");
    assert.ok(await canjear(app, await codigoNuevo(db), huella));
    await rechaza(canjear(app, await codigoNuevo(db), huella), "RC005");
    assert.equal(await contar(db, "equipo"), 1);
    // Un canje rechazado no gasta el código.
    assert.equal(await contar(db, "codigo_alta", "usado_en IS NULL"), 6);
  }));

test("un equipo dado de baja deja de valer y sus sesiones se cierran", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    const equipo = (await una(app, "SELECT equipo_vigente($1) AS id", [h])).id;
    await db.query("SELECT baja_equipo($1)", [equipo]);
    assert.equal((await una(app, "SELECT equipo_vigente($1) AS id", [h])).id, null);
    assert.deepEqual(await vigente(app, h, sesion), []);
    assert.equal(await entrar(app, h, luis, "4815"), null);
    assert.equal(await contar(db, "bitacora", "accion = 'baja' AND entidad = 'equipo'"), 1);
  }));

// ── sesiones ───────────────────────────────────────────────────────────────

test("la sesión vence a los treinta minutos sin actividad", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    await db.query("UPDATE sesion SET vista_en = now() - interval '29 minutes' WHERE id = $1", [sesion]);
    assert.equal((await vigente(app, h, sesion)).length, 1);
    await db.query("UPDATE sesion SET vista_en = now() - interval '31 minutes' WHERE id = $1", [sesion]);
    assert.deepEqual(await vigente(app, h, sesion), []);
    const s = await una(db, "SELECT * FROM sesion WHERE id = $1", [sesion]);
    assert.ok(s.cerrada_en);
    assert.equal(s.motivo_cierre, "inactividad");
    // Una vez cerrada no revive.
    await db.query("UPDATE sesion SET vista_en = now() WHERE id = $1", [sesion]);
    assert.deepEqual(await vigente(app, h, sesion), []);
  }));

test("cada uso de la sesión cuenta como actividad", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    await db.query("UPDATE sesion SET vista_en = now() - interval '20 minutes' WHERE id = $1", [sesion]);
    await vigente(app, h, sesion);
    const s = await una(db, "SELECT extract(epoch FROM now() - vista_en) AS hace FROM sesion WHERE id = $1", [sesion]);
    assert.ok(Number(s.hace) < 5);
  }));

test("la sesión vence a las doce horas aunque haya actividad", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    await db.query("UPDATE sesion SET abierta_en = now() - interval '12 hours 1 minute' WHERE id = $1", [sesion]);
    assert.deepEqual(await vigente(app, h, sesion), []);
    assert.equal((await una(db, "SELECT motivo_cierre FROM sesion WHERE id = $1", [sesion])).motivo_cierre, "duración");
  }));

test("los plazos de la sesión se pueden configurar", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, h, luis, "4815");
    await db.query("UPDATE sesion SET vista_en = now() - interval '6 minutes' WHERE id = $1", [sesion]);
    const r = await app.query("SELECT * FROM sesion_vigente($1, $2, interval '5 minutes', interval '1 hour')", [h, sesion]);
    assert.deepEqual(r.rows, []);
  }));

test("una sesión solo vale en el equipo donde se abrió", () =>
  conIdentidad(async (app, db) => {
    const uno = await equipoNuevo(app, db, "Mostrador");
    const dos = await equipoNuevo(app, db, "Patio");
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, uno, luis, "4815");
    assert.deepEqual(await vigente(app, dos, sesion), []);
    assert.deepEqual(await vigente(app, huellaDe("ninguno"), sesion), []);
    assert.deepEqual(await vigente(app, uno, randomUUID()), []);
    assert.deepEqual(await vigente(app, uno, null), []);
    assert.equal((await vigente(app, uno, sesion)).length, 1);
  }));

test("salir cierra la sesión, y solo desde su equipo", () =>
  conIdentidad(async (app, db) => {
    const uno = await equipoNuevo(app, db, "Mostrador");
    const dos = await equipoNuevo(app, db, "Patio");
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const sesion = await entrar(app, uno, luis, "4815");
    await app.query("SELECT salir($1, $2)", [dos, sesion]);
    assert.equal((await vigente(app, uno, sesion)).length, 1);
    await app.query("SELECT salir($1, $2)", [uno, sesion]);
    assert.deepEqual(await vigente(app, uno, sesion), []);
    assert.equal((await una(db, "SELECT motivo_cierre FROM sesion WHERE id = $1", [sesion])).motivo_cierre, "salida");
    await app.query("SELECT salir($1, $2)", [uno, sesion]); // repetirlo no falla
  }));

test("cuando otra persona entra en el mismo equipo, la sesión anterior se cierra", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const servando = await alta(db, "Servando", "responsable", "481516", true);
    const deLuis = await entrar(app, h, luis, "4815");
    const deServando = await entrar(app, h, servando, "481516");
    assert.deepEqual(await vigente(app, h, deLuis), []);
    assert.equal((await vigente(app, h, deServando))[0].nombre, "Servando");
    assert.equal(await contar(db, "sesion", "cerrada_en IS NULL"), 1);
    // Un intento fallido no saca a quien está atendiendo.
    assert.equal(await entrar(app, h, luis, "0000"), null);
    assert.equal((await vigente(app, h, deServando)).length, 1);
  }));

test("dos personas entrando a la vez al mismo equipo: entran una tras otra y queda la última", () =>
  conIdentidad(async (app, db, base) => {
    const otra = await comoApp(base);
    try {
      const h = await equipoNuevo(app, db);
      const luis = await alta(db, "Luis", "mostrador", "4815");
      const servando = await alta(db, "Servando", "responsable", "481516", true);
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      const deLuis = await entrar(app, h, luis, "4815");
      const segunda = entrar(otra, h, servando, "481516");
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      const deServando = await segunda;
      assert.ok(deLuis && deServando);
      assert.deepEqual(await vigente(app, h, deLuis), []);
      assert.equal((await vigente(app, h, deServando))[0].nombre, "Servando");
      assert.equal(await contar(db, "sesion", "cerrada_en IS NULL"), 1);
    } finally {
      await otra.end();
    }
  }));

test("lo mismo cuando ya había alguien atendiendo en el equipo", () =>
  conIdentidad(async (app, db, base) => {
    const otra = await comoApp(base);
    try {
      const h = await equipoNuevo(app, db);
      const luis = await alta(db, "Luis", "mostrador", "4815");
      const beto = await alta(db, "Beto", "patio", "2718");
      const servando = await alta(db, "Servando", "responsable", "481516", true);
      await entrar(app, h, beto, "2718");
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      await entrar(app, h, luis, "4815");
      const segunda = entrar(otra, h, servando, "481516");
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.ok(await segunda);
      assert.equal(await contar(db, "sesion", "cerrada_en IS NULL"), 1);
      assert.equal(await contar(db, "sesion"), 3);
    } finally {
      await otra.end();
    }
  }));

// ── los intentos que no se pueden deshacer ─────────────────────────────────
// Quien tuviera la contraseña con que la aplicación entra a la base podía probar una clave dentro
// de una transacción y deshacerla si no pasaba: el fallo no quedaba contado. La cuenta vive ahora,
// además, en una secuencia por persona, que no es de la transacción (migración 0035).

/** Prueba una clave como lo haría quien tiene la contraseña de la aplicación: en una transacción que deshace. */
const probarYDeshacer = async (app: pg.Client, huella: string, persona: string, clave: string): Promise<boolean> => {
  await app.query("BEGIN");
  try {
    return (await una(app, "SELECT verificar_clave($1, $2, $3) AS bien", [huella, persona, clave])).bien;
  } finally {
    await app.query("ROLLBACK");
  }
};
const intentosDe = (db: pg.Client, persona: string) => una(db, "SELECT * FROM intentos_de($1)", [persona]);

test("cinco claves malas bloquean aunque quien pregunta deshaga cada intento", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const servando = await alta(db, "Servando", "responsable", "481516", true);
    for (let k = 0; k < 4; k++) assert.equal(await probarYDeshacer(app, h, servando, `00000${k}`), false);
    // El renglón no se enteró —cada intento se deshizo—, pero la cuenta sí: van cuatro.
    assert.equal((await credencialDe(db, servando)).fallos, 0);
    assert.deepEqual(await intentosDe(db, servando), { fallos: 4, bloqueos: 0, bloqueada_hasta: null });
    assert.equal(await probarYDeshacer(app, h, servando, "000004"), false);
    const i = await intentosDe(db, servando);
    assert.deepEqual({ fallos: i.fallos, bloqueos: i.bloqueos }, { fallos: 0, bloqueos: 1 });
    assert.ok(i.bloqueada_hasta > new Date());
    // Bloqueada: ni la clave buena pasa, se deshaga o no; y seguir probando no dice nada.
    assert.equal(await probarYDeshacer(app, h, servando, "481516"), false);
    assert.equal(await entrar(app, h, servando, "481516"), null);
    for (let k = 0; k < 20; k++) assert.equal(await probarYDeshacer(app, h, servando, "481516"), false);
  }));

test("un fallo deshecho se suma a los que sí quedaron asentados", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await fallar(app, h, luis, 2);
    assert.equal(await probarYDeshacer(app, h, luis, "0000"), false);
    assert.equal(await probarYDeshacer(app, h, luis, "0000"), false);
    assert.equal((await intentosDe(db, luis)).fallos, 4);
    // El quinto, por la pantalla, bloquea: y ahora sí queda en el renglón y en la bitácora.
    await fallar(app, h, luis, 1);
    const c = await credencialDe(db, luis);
    assert.ok(c.bloqueada_hasta > new Date());
    assert.deepEqual({ fallos: c.fallos, bloqueos: c.bloqueos }, { fallos: 0, bloqueos: 1 });
    assert.equal(await contar(db, "bitacora", "accion = 'bloquear'"), 1);
    assert.equal(await entrar(app, h, luis, "4815"), null);
  }));

test("un acierto limpia la cuenta aunque lo que siga se deshaga: nadie se bloquea por un error que no fue de su clave", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const servando = await alta(db, "Servando", "responsable", "481516", true);
    await fallar(app, h, servando, 4);
    assert.equal(await probarYDeshacer(app, h, servando, "481516"), true);
    assert.deepEqual(await intentosDe(db, servando), { fallos: 0, bloqueos: 0, bloqueada_hasta: null });
    // Con la cuenta en cero, hacen falta otros cinco fallos para bloquear.
    await fallar(app, h, servando, 4);
    assert.ok(await entrar(app, h, servando, "481516"));
  }));

test("pasado el bloqueo que dejaron los intentos deshechos, la clave buena vuelve a entrar, y el siguiente bloqueo dura más", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    for (let k = 0; k < 5; k++) await probarYDeshacer(app, h, luis, "0000");
    const primero = (await intentosDe(db, luis)).bloqueada_hasta as Date;
    // Cinco minutos, con el margen de lo que tardó la prueba.
    assert.ok(Math.abs(primero.getTime() - Date.now() - 5 * 60_000) < 30_000);
    // La consola (o el tiempo) levanta el bloqueo: lo que se escribe en el renglón pasa a la cuenta.
    await db.query("UPDATE credencial SET bloqueada_hasta = now() - interval '1 second' WHERE usuario_id = $1", [luis]);
    assert.equal(await probarYDeshacer(app, h, luis, "0000"), false);
    for (let k = 0; k < 4; k++) await probarYDeshacer(app, h, luis, "0000");
    const segundo = await intentosDe(db, luis);
    assert.equal(segundo.bloqueos, 2);
    assert.ok(Math.abs((segundo.bloqueada_hasta as Date).getTime() - Date.now() - 15 * 60_000) < 30_000);
    await db.query("UPDATE credencial SET bloqueada_hasta = now() - interval '1 second' WHERE usuario_id = $1", [luis]);
    assert.ok(await entrar(app, h, luis, "4815"));
    assert.deepEqual(await intentosDe(db, luis), { fallos: 0, bloqueos: 0, bloqueada_hasta: null });
  }));

test("una clave nueva empieza con la cuenta en cero, también la que dejaron los intentos deshechos", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    assert.deepEqual(await intentosDe(db, luis), { fallos: 0, bloqueos: 0, bloqueada_hasta: null });
    for (let k = 0; k < 5; k++) await probarYDeshacer(app, h, luis, "0000");
    assert.equal(await entrar(app, h, luis, "4815"), null);
    await db.query("SELECT fijar_clave($1, '2718')", [luis]);
    assert.deepEqual(await intentosDe(db, luis), { fallos: 0, bloqueos: 0, bloqueada_hasta: null });
    assert.ok(await entrar(app, h, luis, "2718"));
  }));

test("cinco claves malas a la vez, cada una en una transacción que se deshace, cuentan cinco", () =>
  conIdentidad(async (app, db, base) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const otras = await Promise.all([1, 2, 3, 4, 5].map(() => comoApp(base)));
    const candado = await conectar(base);
    try {
      const pids = await Promise.all(otras.map(pidDe));
      // Con la credencial tomada, los cinco intentos llegan juntos al mismo punto y esperan ahí.
      await candado.query("BEGIN");
      await candado.query("SELECT 1 FROM credencial WHERE usuario_id = $1 FOR UPDATE", [luis]);
      const intentos = otras.map((c) => probarYDeshacer(c, h, luis, "0000"));
      await esperarQueEsperen(db, pids);
      await candado.query("COMMIT");
      assert.deepEqual(await Promise.all(intentos), [false, false, false, false, false]);
      const i = await intentosDe(db, luis);
      assert.ok(i.bloqueada_hasta > new Date(), `quedó con ${i.fallos} fallos y sin bloqueo`);
      assert.equal(await entrar(app, h, luis, "4815"), null);
    } finally {
      await candado.end();
      await Promise.all(otras.map((c) => c.end()));
    }
  }));

test("la lista de personas de los ajustes dice quién está bloqueado aunque el bloqueo venga de intentos deshechos", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const servando = await alta(db, "Servando", "responsable", "481516", true);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const bloqueados = async () => (await db.query("SELECT nombre FROM personas_para_administrar($1) WHERE bloqueada ORDER BY nombre", [servando])).rows.map((f) => f.nombre);
    assert.deepEqual(await bloqueados(), []);
    for (let k = 0; k < 5; k++) await probarYDeshacer(app, h, luis, "0000");
    // El renglón de Luis dice que no está bloqueado: cada intento se deshizo. La lista no se fía de él.
    assert.equal((await credencialDe(db, luis)).bloqueada_hasta, null);
    assert.deepEqual(await bloqueados(), ["Luis"]);
    await db.query("UPDATE credencial SET bloqueada_hasta = NULL WHERE usuario_id = $1", [luis]);
    assert.deepEqual(await bloqueados(), []);
  }));

test("una credencial a la que le falta su cuenta —datos cargados con los disparadores apagados— no deja a nadie afuera: la cuenta nace al primer intento", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await db.query(`DROP SEQUENCE intentos.c${luis}`);
    assert.equal(await entrar(app, h, luis, "0000"), null);
    assert.deepEqual(await intentosDe(db, luis), { fallos: 1, bloqueos: 0, bloqueada_hasta: null });
    await db.query(`DROP SEQUENCE intentos.c${luis}`);
    assert.ok(await entrar(app, h, luis, "4815"));
    assert.deepEqual(await intentosDe(db, luis), { fallos: 0, bloqueos: 0, bloqueada_hasta: null });
  }));

// Lo encontró Codex al revisar la 0035 (docs/revisiones/2026-10-13-codex-revision-de-los-intentos-y-el-sello.md):
// en una transacción SERIALIZABLE, otra conexión puede hacer que la base aborte a la primera justo
// cuando escribe —en el UPDATE de la credencial, antes de que los disparadores lleven la cuenta a la
// secuencia—, y el contexto del error dice qué UPDATE era: el de «acertó» o el de «falló». Así se
// probaban claves sin que contara ninguna. El intento se aparta ahora en la secuencia ANTES de comparar.
test("ni cuando la base aborta la transacción a media comprobación se prueba una clave sin que cuente: el intento queda apartado antes de comparar", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    await db.query("SELECT fijar_clave($1, '481516')", [e.responsable]);
    const h = await equipoDeAlta(db);
    const [a, b] = [await comoApp(base), await comoApp(base)];
    try {
      /** Prueba una clave como lo hizo la sonda de Codex. Devuelve lo que supo: la respuesta, o el error con su contexto. */
      const probar = async (clave: string): Promise<{ bien?: boolean; codigo?: string; contexto?: string }> => {
        await a.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await a.query("SELECT count(*) FROM operacion");
        // Otra conexión escribe lo que la primera leyó, y lee lo que la primera va a escribir: la base abortará a una de las dos.
        await b.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await b.query("SELECT verificar_clave($1, $2, NULL)", [h, e.responsable]);
        await abrirCuenta(b, "compra", e.mostrador);
        await b.query("COMMIT");
        try {
          return { bien: (await a.query("SELECT verificar_clave($1, $2, $3) AS bien", [h, e.responsable, clave])).rows[0].bien };
        } catch (error) {
          const x = error as { code: string; where?: string };
          return { codigo: x.code, contexto: x.where ?? "" };
        } finally {
          await a.query("ROLLBACK");
        }
      };
      const supo = [];
      for (const clave of ["000000", "111111", "222222", "333333"]) supo.push(await probar(clave));
      // La prueba vale si de verdad pasó lo que se quiere cubrir: la base abortó a media comprobación.
      assert.ok(supo.some((r) => r.codigo === "40001"), `la base no abortó ninguna: ${JSON.stringify(supo)}`);
      // Abortadas o no, las cuatro contaron…
      assert.deepEqual(await intentosDe(db, e.responsable), { fallos: 4, bloqueos: 0, bloqueada_hasta: null });
      // …y la quinta bloquea: desde ahí ni la buena pasa, por ningún camino.
      await probar("444444");
      const i = await intentosDe(db, e.responsable);
      assert.deepEqual({ fallos: i.fallos, bloqueos: i.bloqueos }, { fallos: 0, bloqueos: 1 });
      assert.ok(i.bloqueada_hasta > new Date());
      const conLaBuena = await probar("481516");
      assert.notEqual(conLaBuena.bien, true);
      assert.equal((await una(a, "SELECT verificar_clave($1, $2, '481516') AS bien", [h, e.responsable])).bien, false);
    } finally {
      await a.end();
      await b.end();
    }
  }));

test("una clave buena cuya transacción la base aborta a media comprobación deja la cuenta en cero, no un fallo de más", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    await db.query("SELECT fijar_clave($1, '481516')", [e.responsable]);
    const h = await equipoDeAlta(db);
    const [a, b] = [await comoApp(base), await comoApp(base)];
    try {
      for (let k = 0; k < 4; k++) assert.equal((await una(a, "SELECT verificar_clave($1, $2, '000000') AS bien", [h, e.responsable])).bien, false);
      await a.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await a.query("SELECT count(*) FROM operacion");
      await b.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await b.query("SELECT verificar_clave($1, $2, NULL)", [h, e.responsable]);
      await abrirCuenta(b, "compra", e.mostrador);
      await b.query("COMMIT");
      const r = await a.query("SELECT verificar_clave($1, $2, '481516') AS bien", [h, e.responsable]).then((x) => x.rows[0].bien, (x: { code: string }) => x.code);
      await a.query("ROLLBACK");
      assert.ok(r === true || r === "40001", String(r));
      // Era la quinta, y era la buena: ni queda bloqueada ni con cuatro fallos a cuestas.
      assert.deepEqual(await intentosDe(db, e.responsable), { fallos: 0, bloqueos: 0, bloqueada_hasta: null });
    } finally {
      await a.end();
      await b.end();
    }
  }));

test("la aplicación no lee ni toca la cuenta de intentos: ni la secuencia ni la función que la lee", () =>
  conIdentidad(async (app, db) => {
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const secuencia = `intentos.c${luis}`;
    assert.equal((await una(db, `SELECT last_value::int AS v FROM ${secuencia}`)).v, 0);
    for (const consulta of [
      `SELECT last_value FROM ${secuencia}`, `SELECT setval('${secuencia}', 0)`, `SELECT nextval('${secuencia}')`,
      `ALTER SEQUENCE ${secuencia} RESTART`, `DROP SEQUENCE ${secuencia}`, "CREATE SEQUENCE intentos.otra",
    ]) await rechaza(app.query(consulta), SIN_PERMISO);
    await rechaza(app.query("SELECT * FROM intentos_de($1)", [luis]), SIN_PERMISO);
    await rechaza(app.query("SELECT intento_guardado($1)", [luis]), SIN_PERMISO);
    await rechaza(app.query("SELECT guardar_intento($1, 0)", [luis]), SIN_PERMISO);
    await rechaza(app.query("SELECT intento_empacado(0, 0, NULL)"), SIN_PERMISO);
  }));

test("quien no tiene clave no tiene cuenta, y una fecha sin fin no revienta la cuenta", () =>
  conIdentidad(async (_app, db) => {
    const sinClave = (await una(db, "INSERT INTO usuario (sucursal_id, nombre, rol) VALUES (1, 'Sin clave', 'patio') RETURNING id")).id;
    assert.deepEqual(await intentosDe(db, sinClave), { fallos: null, bloqueos: null, bloqueada_hasta: null });
    const luis = await alta(db, "Luis", "mostrador", "4815");
    await db.query("UPDATE credencial SET fallos = 3, bloqueos = 12, bloqueada_hasta = 'infinity' WHERE usuario_id = $1", [luis]);
    const i = await intentosDe(db, luis);
    assert.deepEqual({ fallos: i.fallos, bloqueos: i.bloqueos }, { fallos: 3, bloqueos: 9 });
    assert.ok((i.bloqueada_hasta as Date).getUTCFullYear() > 4000);
  }));

// ── lo que la aplicación no puede ──────────────────────────────────────────

test("la aplicación no lee claves, equipos, códigos ni sesiones", () =>
  conIdentidad(async (app, db) => {
    await equipoNuevo(app, db);
    await alta(db, "Luis", "mostrador", "4815");
    for (const tabla of ["credencial", "equipo", "codigo_alta", "sesion"]) {
      await rechaza(app.query(`SELECT * FROM ${tabla}`), SIN_PERMISO);
      await rechaza(app.query(`DELETE FROM ${tabla}`), SIN_PERMISO);
    }
    await rechaza(app.query("UPDATE credencial SET fallos = 0, bloqueada_hasta = NULL"), SIN_PERMISO);
  }));

test("la aplicación no da de alta personas ni equipos, ni cambia claves", () =>
  conIdentidad(async (app, db) => {
    const h = await equipoNuevo(app, db);
    const luis = await alta(db, "Luis", "mostrador", "4815");
    const equipo = (await una(app, "SELECT equipo_vigente($1) AS id", [h])).id;
    const consola: Array<[string, unknown[]]> = [
      ["SELECT alta_persona('Colado', 'responsable', true, '481516')", []],
      ["SELECT fijar_clave($1, '2718')", [luis]],
      ["SELECT baja_persona($1)", [luis]],
      ["SELECT crear_codigo_alta('Colado')", []],
      ["SELECT baja_equipo($1)", [equipo]],
      ["SELECT comprobar_clave($1, $2, '4815')", [equipo, luis]],
      ["SELECT extensiones.crypt('4815', extensiones.gen_salt('bf'))", []],
    ];
    for (const [sql, valores] of consola) {
      await rechaza(app.query(sql, valores), SIN_PERMISO);
    }
  }));
