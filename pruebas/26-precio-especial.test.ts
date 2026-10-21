// Clientes con precio especial. A ciertos clientes se les da, en un material de su cuenta, un precio
// distinto del de la lista del día: una diferencia por kilo, hacia arriba o hacia abajo, al comprar
// y al vender. Lo decide un dueño en el momento, con su clave, y queda registro que no se borra.
//
// El renglón guarda los dos precios —el de lista, que ya no cambia, y el que se cobra—, y cada
// cambio de precio es un evento que nombra al anterior: la cadena es una sola. Dar y quitar dicen
// qué evento vieron, así una petición atrasada no pisa ni quita un precio que no vio.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import {
  CHICA_2, GRANDE, PRECIOS, abrirCuenta, agregarMaterial, comoApp, conBase, conectar, contar, desenlace, equipoDeAlta, esperarQueEspere, existencia,
  material, num, personaConClave, pidDe, rechaza, revisionDe, segundaPesada, una, usuario, verRenglon,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { LIMPIO, conDestino, llaves, respaldoCifrado, retrato, urlEn } from "./patio.ts";
import { restaurar } from "../operacion/restaurar.ts";

const CLAVE = "481516";

interface Dia {
  app: pg.Client;
  db: pg.Client;
  base: string;
  e: Escenario;
  /** Quien autoriza, con su clave. */
  duena: string;
  huella: string;
  hoy: string;
}

// El patio de estas pruebas vive en una zona que tiene otra exactamente veinticuatro horas adelante:
// cambiar de una a la otra es pasar la medianoche, a cualquier hora que se corra la batería.
const ZONA = "Etc/GMT+12";
const ZONA_DE_MANANA = "Etc/GMT-12";

/** Abre la jornada de esa fecha con los precios de ejemplo publicados. */
async function diaCon(
  db: pg.Client, fecha: string, quien: string, mat: Record<string, number>, otros: Record<string, [number, number]> = {},
): Promise<{ jornada: string; lista: string }> {
  const j = await una(db, "SELECT * FROM abrir_jornada(1::smallint, $1::date, $2)", [fecha, quien]);
  const lista = (await una(db, "SELECT id FROM lista_precios WHERE jornada_id = $1", [j.id])).id as string;
  for (const [nombre, [compra, venta]] of Object.entries({ ...PRECIOS, ...otros })) {
    mat[nombre] ??= await material(db, nombre);
    // Al abrir, la lista trae los precios del día anterior, si lo hubo: los de hoy los pisan.
    await db.query(
      "INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, $3, $4) ON CONFLICT (lista_id, material_id) DO UPDATE SET compra = EXCLUDED.compra, venta = EXCLUDED.venta",
      [lista, mat[nombre], compra, venta],
    );
  }
  await db.query("SELECT publicar_lista($1, $2)", [lista, quien]);
  return { jornada: j.id, lista };
}

interface Antes<T> {
  /** Lo que pasó antes de abrir el día de hoy (ayer, por ejemplo). Lo que devuelve le llega a la prueba. */
  antes?: (db: pg.Client, duena: string, mat: Record<string, number>, hoy: string) => Promise<T>;
  /** Precios de hoy que no son los de ejemplo: [compra, venta]. */
  precios?: Record<string, [number, number]>;
}

/** Un día de HOY ya en marcha: jornada abierta con precios publicados, y alguien que autoriza con su clave. */
const conHoy = <T = undefined>(prueba: (d: Dia, previo: T) => Promise<void>, opciones: Antes<T> = {}) =>
  conBase(async (db, base) => {
    await db.query("UPDATE sucursal SET zona = $1", [ZONA]);
    const duena = await personaConClave(db, "Zayra", "responsable", CLAVE, true);
    const mostrador = await usuario(db, "Luis", "mostrador");
    const patio = await usuario(db, "Beto", "patio");
    const consulta = await usuario(db, "Ana", "consulta");
    const huella = await equipoDeAlta(db);
    const hoy = (await una(db, "SELECT to_char(hoy_en(1::smallint), 'YYYY-MM-DD') AS d")).d as string;
    const mat: Record<string, number> = {};
    const previo = (opciones.antes ? await opciones.antes(db, duena, mat, hoy) : undefined) as T;
    const { jornada, lista } = await diaCon(db, hoy, duena, mat, opciones.precios);
    // El cajón contado al abrir: sin eso no hay corte, y sin corte la aplicación no cierra (0038).
    await db.query("SELECT abrir_el_cajon(gen_random_uuid(), $1, 100000, $2)", [jornada, mostrador]);
    const app = await comoApp(base);
    try {
      await prueba({ app, db, base, duena, huella, hoy, e: { responsable: duena, mostrador, patio, consulta, jornada, lista, mat } }, previo);
    } finally {
      await app.end();
    }
  });

// ── las dos acciones, como las llama la aplicación ─────────────────────────

interface Dar {
  envio?: string; cuenta: string; linea: string; visto?: string | null; cliente?: string | null; nuevo?: string | null;
  diferencia: string; autoriza?: string; clave?: string; huella?: string; quien?: string;
}
const dar = (c: pg.Client, d: Dia, p: Dar) =>
  una(c, "SELECT * FROM dar_precio_especial($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
    p.envio ?? randomUUID(), p.cuenta, p.linea, p.visto ?? null, p.cliente ?? null, p.nuevo === undefined && !p.cliente ? "Don Chuy" : p.nuevo ?? null,
    p.diferencia, p.autoriza ?? d.duena, p.clave ?? CLAVE, p.huella ?? d.huella, p.quien ?? d.e.mostrador,
  ]);

interface Quitar { envio?: string; cuenta: string; linea: string; visto: string | null; quien?: string }
const quitar = (c: pg.Client, d: Dia, p: Quitar) =>
  una(c, "SELECT * FROM quitar_precio_especial($1, $2, $3, $4, $5)", [p.envio ?? randomUUID(), p.cuenta, p.linea, p.visto, p.quien ?? d.e.mostrador]);

/** Una cuenta con un material ya pesado. Devuelve la cuenta y el renglón. */
async function cuentaCon(d: Dia, tipo: "compra" | "venta", nombre: string, kg: string, bascula = CHICA_2): Promise<{ cuenta: string; linea: string }> {
  const cuenta = (await abrirCuenta(d.app, tipo, d.e.mostrador)).id as string;
  const linea = randomUUID();
  await agregarMaterial(d.app, cuenta, d.e.mat[nombre]!, kg, d.e.mostrador, { linea, bascula });
  return { cuenta, linea };
}

const verCuenta = (c: pg.Client, id: string) => una(c, "SELECT * FROM operacion WHERE id = $1", [id]);
const cobrar = (c: pg.Client, cuenta: string, quien: string) =>
  una(c, "SELECT * FROM confirmar_cuenta($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [cuenta, quien]);
/** Cierra el día como la aplicación, con su corte (0038): el cajón se contó al empezar, y firma la dueña. */
const cerrarHoy = (c: pg.Client, d: Dia) =>
  una(c, `SELECT h.* FROM jornada j, LATERAL cerrar_el_dia(gen_random_uuid(), j.id, j.cierres, esperado_en_cajon(j.id),
            esperado_en_cajon(j.id), $1, $2, $3, $4) h WHERE j.id = $5`, [d.duena, CLAVE, d.huella, d.e.mostrador, d.e.jornada]);
const eventos = async (db: pg.Client, linea: string) =>
  (await db.query("SELECT id, clase, precio_anterior, precio_nuevo, anterior_id FROM precio_especial WHERE linea_id = $1 ORDER BY id", [linea])).rows;

interface Ayer { ayer: string; camiones: { cuenta: string; linea: string }[] }
/** Ayer: se abre el día con el fierro a 6.5, entran camiones y se pesan llenos; el día se cierra sin que vuelvan. */
const ayerConCamiones = (cuantos: number) => async (db: pg.Client, duena: string, mat: Record<string, number>, hoy: string): Promise<Ayer> => {
  const fecha = (await una(db, "SELECT to_char($1::date - 1, 'YYYY-MM-DD') AS d", [hoy])).d as string;
  const j = await una(db, "SELECT * FROM abrir_jornada(1::smallint, $1::date, $2)", [fecha, duena]);
  const lista = (await una(db, "SELECT id FROM lista_precios WHERE jornada_id = $1", [j.id])).id;
  mat["Fierro pesado"] = await material(db, "Fierro pesado");
  await db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, 6.5, 7.7)", [lista, mat["Fierro pesado"]]);
  await db.query("SELECT publicar_lista($1, $2)", [lista, duena]);
  const camiones = [];
  for (let k = 0; k < cuantos; k++) {
    const [cuenta, linea] = [randomUUID(), randomUUID()];
    await db.query("SELECT abrir_cuenta($1, 'compra', NULL, $2)", [cuenta, duena]);
    await db.query("SELECT agregar_material($1, $2, $3, $4::smallint, $5, '5200', $6)", [cuenta, linea, mat["Fierro pesado"], GRANDE, randomUUID(), duena]);
    camiones.push({ cuenta, linea });
  }
  await db.query("SELECT h.* FROM jornada x, LATERAL cerrar_el_dia(gen_random_uuid(), x.id, x.cierres, $1) h WHERE x.id = $2", [duena, j.id]);
  return { ayer: j.id as string, camiones };
};

// ── las reglas ─────────────────────────────────────────────────────────────

test("dar un precio especial: el renglón cobra el precio nuevo y guarda el de lista, quién lo autorizó y su evento; la cuenta queda a nombre del cliente; y queda registro", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const { cuenta, linea } = await cuentaCon(d, "compra", "Cartón", "100");
    const antes = await verRenglon(db, linea);
    assert.deepEqual([num(antes.precio_unitario), num(antes.precio_lista), antes.precio_autorizado_por, antes.precio_evento], [2.1, 2.1, null, null]);
    const revision = await revisionDe(db, cuenta);

    const ev = await dar(app, d, { cuenta, linea, nuevo: "  Don   Chuy ", diferencia: "0.5" });
    assert.ok(ev.id, "no dio el precio");
    const l = await verRenglon(db, linea);
    assert.deepEqual([num(l.precio_unitario), num(l.precio_lista), l.precio_autorizado_por, l.precio_evento], [2.6, 2.1, d.duena, ev.id]);
    assert.equal(num(l.importe), 260);
    assert.ok((await revisionDe(db, cuenta)) > revision, "cambiar el precio no movió la revisión de la cuenta");

    // El cliente se dio de alta en el mismo acto, con su nombre limpio, y la cuenta es suya.
    const cliente = await una(db, "SELECT * FROM cliente");
    assert.deepEqual([cliente.nombre, cliente.activo, cliente.creado_por], ["Don Chuy", true, e.mostrador]);
    assert.equal((await verCuenta(db, cuenta)).cliente_id, cliente.id);

    // El registro: a quién, qué material, los tres precios, quién capturó y quién autorizó.
    const reg = await una(db, "SELECT * FROM precio_especial WHERE id = $1", [ev.id]);
    assert.deepEqual(
      { clase: reg.clase, cuenta: reg.operacion_id, linea: reg.linea_id, material: reg.material_id, cliente: reg.cliente_id, nombre: reg.cliente_nombre,
        lista: num(reg.precio_lista), anterior: num(reg.precio_anterior), nuevo: num(reg.precio_nuevo), capturo: reg.capturado_por, autorizo: reg.autorizado_por, previo: reg.anterior_id },
      { clase: "dar", cuenta, linea, material: e.mat["Cartón"], cliente: cliente.id, nombre: "Don Chuy",
        lista: 2.1, anterior: 2.1, nuevo: 2.6, capturo: e.mostrador, autorizo: d.duena, previo: null },
    );
    // Y en la bitácora, sin la clave.
    const nota = await una(db, "SELECT detalle::text AS t FROM bitacora WHERE accion = 'precio_especial' ORDER BY id DESC LIMIT 1");
    assert.ok(nota.t.includes("Don Chuy") && !nota.t.includes(CLAVE));
  }));

test("la diferencia va hacia arriba o hacia abajo, en compra y en venta, con hasta cuatro decimales; y es sobre el precio de lista, no sobre el especial que hubiera", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const venta = await cuentaCon(d, "venta", "Cartón", "10");            // lista de venta: 2.5
    const e1 = await dar(app, d, { ...venta, diferencia: "-0.1234" });
    assert.equal(num((await verRenglon(db, venta.linea)).precio_unitario), 2.3766);
    // Otro precio encima: la diferencia vuelve a contarse desde la lista (2.5), no desde 2.3766.
    const e2 = await dar(app, d, { ...venta, visto: e1.id, cliente: e1.cliente_id, diferencia: "1" });
    const l = await verRenglon(db, venta.linea);
    assert.deepEqual([num(l.precio_unitario), num(l.precio_lista), l.precio_evento], [3.5, 2.5, e2.id]);
    assert.deepEqual([num(e2.precio_anterior), num(e2.precio_nuevo), e2.anterior_id], [2.3766, 3.5, e1.id]);

    const compra = await cuentaCon(d, "compra", "Aluminio bote", "4.11");  // lista de compra: 28
    await dar(app, d, { ...compra, cliente: e1.cliente_id, diferencia: "-3" });
    assert.equal(num((await verRenglon(db, compra.linea)).precio_unitario), 25);
  }));

test("no procede: sin diferencia o mal escrita, un precio que queda en cero o fuera de tope, un renglón de otra cuenta, cliente y nombre a la vez o ninguno", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const b = await cuentaCon(d, "compra", "PET", "5");
    for (const diferencia of ["0", "0.0000", "NaN", "Infinity", "0.00001", "1.23456"]) {
      await rechaza(dar(app, d, { ...a, diferencia }), "RC004");
    }
    await rechaza(dar(app, d, { ...a, diferencia: "-2.1" }), "RC004");          // queda en cero
    await rechaza(dar(app, d, { ...a, diferencia: "-5" }), "RC004");            // queda negativo
    await rechaza(dar(app, d, { ...a, diferencia: "99999" }), "RC004");         // se pasa del tope
    await rechaza(dar(app, d, { cuenta: a.cuenta, linea: b.linea, diferencia: "1" }), "RC005");
    await rechaza(dar(app, d, { cuenta: randomUUID(), linea: a.linea, diferencia: "1" }), "RC005");
    await rechaza(dar(app, d, { ...a, cliente: null, nuevo: null, diferencia: "1" }), "RC005");
    await rechaza(dar(app, d, { ...a, cliente: null, nuevo: "   ", diferencia: "1" }), "RC005");
    const ev = await dar(app, d, { ...b, nuevo: "Doña Mari", diferencia: "1" });
    await rechaza(dar(app, d, { ...a, cliente: ev.cliente_id, nuevo: "Doña Mari", diferencia: "1" }), "RC005");
    await rechaza(dar(app, d, { ...a, cliente: "999999", diferencia: "1" }), "RC005");
    // Sin identificador de envío, tampoco: ni dar ni quitar.
    await rechaza(app.query("SELECT dar_precio_especial(NULL, $1, $2, NULL, NULL, 'Don Chuy', 1, $3, $4, $5, $6)", [a.cuenta, a.linea, d.duena, CLAVE, d.huella, d.e.mostrador]), "RC005");
    await rechaza(app.query("SELECT quitar_precio_especial(NULL, $1, $2, $3, $4)", [b.cuenta, b.linea, ev.id, d.e.mostrador]), "RC005");
    // Nada de eso dejó precio, evento ni cliente de más.
    assert.equal(num((await verRenglon(db, a.linea)).precio_unitario), 2.1);
    assert.equal(await contar(db, "precio_especial"), 1);
    assert.equal(await contar(db, "cliente"), 1);
  }));

test("solo en una cuenta abierta y con jornada abierta hoy; lo autoriza quien está facultado y activo; lo captura mostrador o responsable", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    // Quien autoriza: ni el mostrador, ni un responsable sin permiso, ni uno dado de baja.
    const sinPermiso = await personaConClave(db, "Rita", "responsable", "271828", false);
    await rechaza(dar(app, d, { ...a, diferencia: "1", autoriza: e.mostrador, clave: "0000" }), "RC008");
    await rechaza(dar(app, d, { ...a, diferencia: "1", autoriza: sinPermiso, clave: "271828" }), "RC008");
    const deBaja = await personaConClave(db, "Otilia", "responsable", "314159", true);
    await db.query("UPDATE usuario SET activo = false WHERE id = $1", [deBaja]);
    await rechaza(dar(app, d, { ...a, diferencia: "1", autoriza: deBaja, clave: "314159" }), "RC008");
    // Quien captura: mostrador o responsable. Patio, consulta y administración, no.
    const administracion = await usuario(db, "Paty", "administracion");
    for (const quien of [e.patio, e.consulta, administracion]) await rechaza(dar(app, d, { ...a, diferencia: "1", quien }), "RC008");

    // Ya cobrada, no.
    const ev = await dar(app, d, { ...a, diferencia: "1" });
    await cobrar(app, a.cuenta, e.mostrador);
    await rechaza(dar(app, d, { ...a, visto: ev.id, cliente: ev.cliente_id, diferencia: "2" }), "RC001");
    await rechaza(quitar(app, d, { ...a, visto: ev.id }), "RC001");
    assert.equal(num((await verRenglon(db, a.linea)).precio_unitario), 3.1);

    // Con el día cerrado, tampoco: ni dar ni quitar. (La cuenta de un vehículo sobrevive al cierre.)
    const v = await cuentaCon(d, "compra", "Fierro pesado", "5200", GRANDE);
    const w = await cuentaCon(d, "compra", "Fierro pesado", "4100", GRANDE);
    const ew = await dar(app, d, { ...w, cliente: ev.cliente_id, diferencia: "0.2" });
    await cerrarHoy(app, d);
    await rechaza(dar(app, d, { ...v, cliente: ev.cliente_id, diferencia: "1" }), "RC006");
    await rechaza(quitar(app, d, { ...w, visto: ew.id }), "RC006");
    assert.equal(num((await verRenglon(db, w.linea)).precio_unitario), 7);
  }));

test("el cliente: uno nuevo se da de alta al darle su primer precio; con otra escritura es el mismo; uno dado de baja no, ni por su nombre; y una cuenta es de un solo cliente", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const b = await cuentaCon(d, "compra", "PET", "5");
    const e1 = await dar(app, d, { ...a, nuevo: "Don Chuy", diferencia: "1" });
    // Mayúsculas y espacios no hacen otro cliente.
    const e2 = await dar(app, d, { ...b, nuevo: "  DON   chuy  ", diferencia: "1" });
    assert.equal(e2.cliente_id, e1.cliente_id);
    assert.equal(await contar(db, "cliente"), 1);
    // Los acentos sí distinguen: es otro (se arregla renombrando).
    const c = await cuentaCon(d, "compra", "PET", "5");
    const e3 = await dar(app, d, { ...c, nuevo: "Dón Chuy", diferencia: "1" });
    assert.notEqual(e3.cliente_id, e1.cliente_id);

    // Dado de baja: ni por su número ni tecleando su nombre como si fuera nuevo. No se crea otro igual.
    await db.query("SELECT baja_de_cliente($1)", [e3.cliente_id]);
    const f = await cuentaCon(d, "compra", "PET", "5");
    await rechaza(dar(app, d, { ...f, cliente: e3.cliente_id, diferencia: "1" }), "RC005");
    await rechaza(dar(app, d, { ...f, nuevo: "dón chuy", diferencia: "1" }), "RC005");
    assert.equal(await contar(db, "cliente"), 2);

    // Una cuenta, un cliente: el segundo material de la cuenta no puede ser de otro.
    const otra = randomUUID();
    await agregarMaterial(app, a.cuenta, d.e.mat["PET"]!, "3", d.e.mostrador, { linea: otra });
    await rechaza(dar(app, d, { cuenta: a.cuenta, linea: otra, nuevo: "Doña Mari", diferencia: "1" }), "RC005");
    await dar(app, d, { cuenta: a.cuenta, linea: otra, cliente: e1.cliente_id, diferencia: "1" });
    // Pero si es el único precio especial de la cuenta, sí puede pasar a otro cliente.
    const e5 = await dar(app, d, { ...b, visto: e2.id, nuevo: "Doña Mari", diferencia: "2" });
    assert.equal((await verCuenta(db, b.cuenta)).cliente_id, e5.cliente_id);
    assert.notEqual(e5.cliente_id, e1.cliente_id);
  }));

test("quitar el precio especial es volver al de lista: no pide clave, queda anotado y apunta a lo que deshace", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "venta", "Cartón", "40");
    const e1 = await dar(app, d, { ...a, diferencia: "-0.3" });
    const revision = await revisionDe(db, a.cuenta);
    const e2 = await quitar(app, d, { ...a, visto: e1.id });
    const l = await verRenglon(db, a.linea);
    assert.deepEqual([num(l.precio_unitario), num(l.precio_lista), l.precio_autorizado_por, l.precio_evento], [2.5, 2.5, null, e2.id]);
    assert.equal(num(l.importe), 100);
    assert.ok((await revisionDe(db, a.cuenta)) > revision);
    assert.equal((await verCuenta(db, a.cuenta)).cliente_id, null);
    // El evento de quitar conserva, como historia, a quién y quién había autorizado; no es una autorización nueva.
    assert.deepEqual(
      { clase: e2.clase, previo: e2.anterior_id, anterior: num(e2.precio_anterior), nuevo: num(e2.precio_nuevo), cliente: e2.cliente_id, autorizo: e2.autorizado_por, capturo: e2.capturado_por },
      { clase: "quitar", previo: e1.id, anterior: 2.2, nuevo: 2.5, cliente: e1.cliente_id, autorizo: d.duena, capturo: e.mostrador },
    );
    // No hay qué quitar: ni dos veces, ni donde nunca hubo.
    await rechaza(quitar(app, d, { ...a, visto: e2.id }), "RC005");
    const b = await cuentaCon(d, "venta", "PET", "5");
    await rechaza(quitar(app, d, { ...b, visto: null }), "RC005");
    const administracion = await usuario(db, "Paty", "administracion");
    for (const quien of [e.patio, e.consulta, administracion]) await rechaza(quitar(app, d, { ...a, visto: e2.id, quien }), "RC008");
  }));

// ── los guardianes: como dueño de la base, y sin apagar ninguna regla ──────

test("como dueño de la base: el precio de lista no cambia nunca, y el precio que se cobra no cambia por ningún otro camino", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    await rechaza(db.query("UPDATE operacion_linea SET precio_lista = 9 WHERE id = $1", [a.linea]), "RC005");
    await rechaza(db.query("UPDATE operacion_linea SET precio_unitario = 9 WHERE id = $1", [a.linea]), "RC005");
    await rechaza(db.query("UPDATE operacion_linea SET precio_unitario = 9, precio_autorizado_por = $2 WHERE id = $1", [a.linea, d.duena]), "RC005");
    const e1 = await dar(app, d, { ...a, diferencia: "1" });
    await rechaza(db.query("UPDATE operacion_linea SET precio_lista = 9 WHERE id = $1", [a.linea]), "RC005");
    // Cambiar solo quién autorizó, o solo el evento, o solo el precio: tampoco.
    const otra = await personaConClave(db, "Rita", "responsable", "271828", true);
    await rechaza(db.query("UPDATE operacion_linea SET precio_autorizado_por = $2 WHERE id = $1", [a.linea, otra]), "RC005");
    await rechaza(db.query("UPDATE operacion_linea SET precio_evento = NULL WHERE id = $1", [a.linea]), "RC005");
    await rechaza(db.query("UPDATE operacion_linea SET precio_unitario = 2.1 WHERE id = $1", [a.linea]), "RC005");
    await rechaza(db.query("UPDATE operacion_linea SET precio_unitario = 2.1, precio_autorizado_por = NULL, precio_evento = NULL WHERE id = $1", [a.linea]), "RC005");
    const l = await verRenglon(db, a.linea);
    assert.deepEqual([num(l.precio_unitario), num(l.precio_lista), l.precio_autorizado_por, l.precio_evento], [3.1, 2.1, d.duena, e1.id]);
    // Lo demás del renglón sigue pudiendo cambiar: el descuento en kilos no toca el precio.
    await db.query("SELECT poner_descuento($1, 2, $2)", [a.linea, d.e.mostrador]);
    assert.equal(num((await verRenglon(db, a.linea)).importe), 303.8);
  }));

test("como dueño de la base: un evento viejo no se vuelve a instalar —ni después de otro precio, ni después de quitar, ni en la misma transacción—", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    // dar P1 → dar P2 → volver a poner P1 a mano con el evento de P1.
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const p1 = await dar(app, d, { ...a, diferencia: "1" });
    const p2 = await dar(app, d, { ...a, visto: p1.id, cliente: p1.cliente_id, diferencia: "2" });
    await rechaza(db.query("UPDATE operacion_linea SET precio_unitario = 3.1, precio_evento = $2 WHERE id = $1", [a.linea, p1.id]), "RC005");
    assert.equal((await verRenglon(db, a.linea)).precio_evento, p2.id);

    // dar P1 → quitar → volver a poner P1 a mano, todo en una transacción.
    const b = await cuentaCon(d, "compra", "PET", "5");
    await db.query("BEGIN");
    const q1 = await dar(db, d, { ...b, cliente: p1.cliente_id, diferencia: "1" });
    await quitar(db, d, { ...b, visto: q1.id });
    await rechaza(
      db.query("UPDATE operacion_linea SET precio_unitario = 8.5, precio_autorizado_por = $2, precio_evento = $3 WHERE id = $1", [b.linea, d.duena, q1.id]),
      "RC005",
    );
    await db.query("ROLLBACK");
    const l = await verRenglon(db, b.linea);
    assert.deepEqual([num(l.precio_unitario), l.precio_evento], [7.5, null]);
  }));

// Lo encontró Codex en su décima revisión: borrado el renglón y vuelto a crear con el mismo identificador dentro de la
// misma transacción, nacía «limpio» —sin evento— y el evento de antes le volvía a encajar.
test("como dueño de la base: un renglón que tuvo precio especial no vuelve a nacer con el mismo identificador: su autorización no se muda a otro material ni revive después de quitada", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const recrear = (r: { cuenta: string; linea: string }, nombre: string) =>
      db.query("INSERT INTO operacion_linea (id, operacion_id, material_id, instrumento_id) VALUES ($1, $2, $3, $4)", [r.linea, r.cuenta, e.mat[nombre], CHICA_2]);
    const instalar = (r: { linea: string }, evento: string) =>
      db.query("UPDATE operacion_linea SET precio_unitario = 3.1, precio_autorizado_por = $2, precio_evento = $3 WHERE id = $1", [r.linea, d.duena, evento]);

    // En una sola transacción: dar, borrar el renglón, volver a crearlo —con otro material del mismo precio, o con el
    // mismo— y ponerle a mano el precio con el evento de antes. No queda.
    for (const material of ["Archivo", "Cartón"]) {
      const a = await cuentaCon(d, "compra", "Cartón", "100");
      const fin = await desenlace((async () => {
        await db.query("BEGIN");
        const ev = await dar(db, d, { ...a, diferencia: "1" });
        await db.query("DELETE FROM operacion_linea WHERE id = $1", [a.linea]);
        await recrear(a, material);
        await instalar(a, ev.id);
        await db.query("COMMIT");
      })());
      await db.query("ROLLBACK");
      assert.equal(fin, "RC005", `vuelto a crear como ${material}`);
      const l = await verRenglon(db, a.linea);
      assert.deepEqual([l.material_id, num(l.precio_unitario), l.precio_evento], [e.mat["Cartón"], 2.1, null]);
    }

    // Lo mismo con una autorización ya quitada: se da, se quita, se hace que la base revise ya lo que dejaba para el
    // final, y se intenta revivir aquel «dar» en el renglón vuelto a crear.
    const b = await cuentaCon(d, "compra", "Cartón", "100");
    const fin = await desenlace((async () => {
      await db.query("BEGIN");
      const ev = await dar(db, d, { ...b, diferencia: "1" });
      await quitar(db, d, { ...b, visto: ev.id });
      await db.query("SET CONSTRAINTS ALL IMMEDIATE");
      await db.query("SET CONSTRAINTS ALL DEFERRED");
      await db.query("DELETE FROM operacion_linea WHERE id = $1", [b.linea]);
      await recrear(b, "Cartón");
      await instalar(b, ev.id);
      await db.query("COMMIT");
    })());
    await db.query("ROLLBACK");
    assert.equal(fin, "RC005");
    assert.equal(await contar(db, "precio_especial"), 0);

    // Y de una transacción a otra, tampoco: quitado el material, ese identificador ya no se vuelve a usar.
    const c = await cuentaCon(d, "compra", "Cartón", "100");
    await dar(app, d, { ...c, diferencia: "1" });
    await app.query("SELECT quitar_material($1, $2)", [c.linea, e.mostrador]);
    await rechaza(recrear(c, "Cartón"), "RC005");
    assert.equal(await contar(db, "operacion_linea", "id = $1", [c.linea]), 0);
    // Un renglón que nunca tuvo precio especial no tiene historia que confundir: ese sí se puede volver a crear.
    const s = await cuentaCon(d, "compra", "Cartón", "100");
    await app.query("SELECT quitar_material($1, $2)", [s.linea, e.mostrador]);
    await recrear(s, "Cartón");
    assert.equal((await verRenglon(db, s.linea)).precio_evento, null);
  }, { precios: { "Archivo": [2.1, 2.5] } }));

// Lo encontró Codex al verificar la corrección de arriba: un evento recién escrito y todavía sin confirmar no lo ve
// nadie más, así que otra sesión podía borrar el renglón y volver a crearlo —como otro material— antes de que la
// primera lo instalara. El nacimiento de un evento toma ahora la cuenta y aparta el identificador del renglón.
test("como dueño de la base, con dos sesiones a la vez: mientras un evento nace, nadie le cambia el renglón por debajo; ni en su cuenta, ni llevándose su identificador a otra", () =>
  conHoy(async (d) => {
    const { app, db, base, e } = d;
    const evento = (c: pg.Client, r: { cuenta: string; linea: string }, cliente: string) =>
      una(c, `INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior, precio_nuevo, capturado_por, autorizado_por)
              VALUES ('dar', $1, $2, $3, $4, 'Don Chuy', 2.1, 2.1, 3.1, $5, $6) RETURNING id`, [r.cuenta, r.linea, e.mat["Cartón"], cliente, e.mostrador, d.duena]);
    const instalar = (c: pg.Client, r: { linea: string }, ev: string) =>
      c.query("UPDATE operacion_linea SET precio_unitario = 3.1, precio_autorizado_por = $2, precio_evento = $3 WHERE id = $1", [r.linea, d.duena, ev]);
    const chuy = (await una(db, "INSERT INTO cliente (nombre) VALUES ('Don Chuy') RETURNING id")).id as string;
    const otra = await conectar(base);
    const vigia = await conectar(base);
    try {
      // En la misma cuenta: la primera sesión escribe su evento y todavía no lo instala. La segunda quiere borrar el
      // renglón y volver a crearlo como otro material del mismo precio: tiene que esperar, y al pasar ya no puede.
      const a = await cuentaCon(d, "compra", "Cartón", "100");
      await db.query("BEGIN");
      const ev = await evento(db, a, chuy);
      const pid = await pidDe(otra);
      await otra.query("BEGIN");
      const borra = desenlace(otra.query("DELETE FROM operacion_linea WHERE id = $1", [a.linea]));
      await esperarQueEspere(vigia, pid);
      await instalar(db, a, ev.id);
      await db.query("COMMIT");
      assert.equal(await borra, "pasó");
      await rechaza(otra.query("INSERT INTO operacion_linea (id, operacion_id, material_id, instrumento_id) VALUES ($1, $2, $3, $4)", [a.linea, a.cuenta, e.mat["Archivo"], CHICA_2]), "RC005");
      await otra.query("ROLLBACK");
      const l = await verRenglon(db, a.linea);
      assert.deepEqual([l.material_id, num(l.precio_unitario), l.precio_evento], [e.mat["Cartón"], 3.1, ev.id]);

      // Llevándose el identificador a otra cuenta: la primera da el precio y quita el material, sin confirmar todavía.
      // La segunda quiere ese mismo identificador para un renglón de otra cuenta: espera, y al pasar ya tiene historia.
      const b = await cuentaCon(d, "compra", "Cartón", "100");
      const c = await cuentaCon(d, "compra", "PET", "5");
      await db.query("BEGIN");
      await instalar(db, b, (await evento(db, b, chuy)).id);
      await db.query("DELETE FROM operacion_linea WHERE id = $1", [b.linea]);
      const nace = desenlace(otra.query("INSERT INTO operacion_linea (id, operacion_id, material_id, instrumento_id) VALUES ($1, $2, $3, $4)", [b.linea, c.cuenta, e.mat["Cartón"], CHICA_2]));
      await esperarQueEspere(vigia, pid);
      await db.query("COMMIT");
      assert.equal(await nace, "RC005", "el identificador de un renglón con historia se fue a otra cuenta");
      assert.equal(await contar(db, "operacion_linea", "id = $1", [b.linea]), 0);
      // Y el camino de siempre no cambió: por la aplicación, dar sigue pasando.
      assert.ok((await dar(app, d, { ...c, cliente: chuy, diferencia: "1" })).id);
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      await otra.query("ROLLBACK").catch(() => {});
      await otra.end();
      await vigia.end();
    }
  }, { precios: { "Archivo": [2.1, 2.5] } }));

// Dos huecos que no cubría ninguna prueba; los destapó romper el guardián a propósito.
test("como dueño de la base: aunque la regla anterior faltara, un evento de otra transacción no se instala en un renglón vuelto a crear; y quien queda como autorizante es el del evento, no otro", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    // El renglón tuvo su precio especial y se quitó el material. Con la regla del nacimiento apagada —ya es la única
    // forma de volver a crearlo con el mismo identificador— nace limpio, y el evento viejo «encaja» en todo —mismo
    // renglón, misma cuenta, sin anterior, mismos precios—, salvo en que no es de ahora. Son dos cerraduras, y esta
    // aguanta sola.
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const viejo = await dar(app, d, { ...a, diferencia: "1" });
    await app.query("SELECT quitar_material($1, $2)", [a.linea, e.mostrador]);
    await db.query("ALTER TABLE operacion_linea DISABLE TRIGGER linea_nace");
    await db.query(
      "INSERT INTO operacion_linea (id, operacion_id, material_id, instrumento_id, precio_unitario, precio_lista) VALUES ($1, $2, $3, $4, 2.1, 2.1)",
      [a.linea, a.cuenta, e.mat["Cartón"], CHICA_2],
    );
    await db.query("ALTER TABLE operacion_linea ENABLE TRIGGER linea_nace");
    const nuevo = await verRenglon(db, a.linea);
    assert.deepEqual([num(nuevo.precio_unitario), nuevo.precio_evento], [2.1, null]);
    await rechaza(
      db.query("UPDATE operacion_linea SET precio_unitario = 3.1, precio_autorizado_por = $2, precio_evento = $3 WHERE id = $1", [a.linea, d.duena, viejo.id]),
      "RC005",
    );
    assert.equal((await verRenglon(db, a.linea)).precio_evento, null);

    // Un evento bien nacido, en esta misma transacción, pero el renglón se quiere dejar a nombre de otra persona.
    const rita = await personaConClave(db, "Rita", "responsable", "271828", true);
    const b = await cuentaCon(d, "compra", "PET", "5");
    await db.query("BEGIN");
    const ev = (await db.query(
      `INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior, precio_nuevo, capturado_por, autorizado_por, anterior_id)
       VALUES ('dar', $1, $2, $3, $4, 'Don Chuy', 7.5, 7.5, 8.5, $5, $6, NULL) RETURNING id`,
      [b.cuenta, b.linea, e.mat["PET"], viejo.cliente_id, e.mostrador, d.duena],
    )).rows[0].id;
    await rechaza(db.query("UPDATE operacion_linea SET precio_unitario = 8.5, precio_autorizado_por = $2, precio_evento = $3 WHERE id = $1", [b.linea, rita, ev]), "RC005");
    await db.query("ROLLBACK");
    // Con el autorizante del evento, esa misma transición sí pasa: lo rechazado era el nombre cambiado.
    await db.query("BEGIN");
    const ev2 = (await db.query(
      `INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior, precio_nuevo, capturado_por, autorizado_por, anterior_id)
       VALUES ('dar', $1, $2, $3, $4, 'Don Chuy', 7.5, 7.5, 8.5, $5, $6, NULL) RETURNING id`,
      [b.cuenta, b.linea, e.mat["PET"], viejo.cliente_id, e.mostrador, d.duena],
    )).rows[0].id;
    await db.query("UPDATE operacion_linea SET precio_unitario = 8.5, precio_autorizado_por = $2, precio_evento = $3 WHERE id = $1", [b.linea, d.duena, ev2]);
    await db.query("COMMIT");
    assert.deepEqual([num((await verRenglon(db, b.linea)).precio_unitario), (await verCuenta(db, b.cuenta)).cliente_id], [8.5, viejo.cliente_id]);
  }));

test("como dueño de la base: un evento escrito suelto, sin su cambio en el renglón, se rechaza al terminar la transacción; también uno citado por otro suelto", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const p1 = await dar(app, d, { ...a, diferencia: "1" });
    const suelto = (anterior: string | null, de: number, a_: number) =>
      db.query(
        `INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior, precio_nuevo, capturado_por, autorizado_por, anterior_id)
         VALUES ('dar', $1, $2, $3, $4, 'Don Chuy', 2.1, $5, $6, $7, $8, $9) RETURNING id`,
        [a.cuenta, a.linea, e.mat["Cartón"], p1.cliente_id, de, a_, e.mostrador, d.duena, anterior],
      );
    // Uno solo, bien formado para el renglón pero sin mover el renglón.
    await db.query("BEGIN");
    await suelto(p1.id, 3.1, 4.1);
    await rechaza(db.query("COMMIT"), "RC005");
    // Dos: el segundo cita al primero. Que alguien lo cite no lo salva: ni siquiera nace, porque no nombra al que el renglón tiene.
    await db.query("BEGIN");
    const s1 = (await suelto(p1.id, 3.1, 4.1)).rows[0].id;
    await rechaza(suelto(s1, 4.1, 5.1), "RC005");
    await db.query("ROLLBACK");
    // Uno suelto, y en la misma transacción un precio de verdad que sí mueve el renglón: el suelto sigue suelto.
    await db.query("BEGIN");
    await suelto(p1.id, 3.1, 4.1);
    assert.ok((await dar(db, d, { ...a, visto: p1.id, cliente: p1.cliente_id, diferencia: "2" })).id);
    await rechaza(db.query("COMMIT"), "RC005");
    // Y uno que no corresponde al renglón ni nace: otro anterior, otro precio anterior, otro precio de lista.
    await rechaza(suelto(null, 3.1, 4.1), "RC005");
    await rechaza(suelto(p1.id, 2.1, 4.1), "RC005");
    assert.equal(await contar(db, "precio_especial"), 1);
    assert.equal((await verRenglon(db, a.linea)).precio_evento, p1.id);
  }));

test("dar, quitar y volver a dar pasa: el renglón apunta al tercero y la cadena es una sola", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const e1 = await dar(app, d, { ...a, diferencia: "1" });
    const e2 = await quitar(app, d, { ...a, visto: e1.id });
    const e3 = await dar(app, d, { ...a, visto: e2.id, cliente: e1.cliente_id, diferencia: "0.4" });
    assert.equal((await verRenglon(db, a.linea)).precio_evento, e3.id);
    assert.deepEqual(
      (await eventos(db, a.linea)).map((x) => [x.clase, num(x.precio_anterior), num(x.precio_nuevo), x.anterior_id]),
      [["dar", 2.1, 3.1, null], ["quitar", 3.1, 2.1, e1.id], ["dar", 2.1, 2.5, e2.id]],
    );
    assert.equal((await verCuenta(db, a.cuenta)).cliente_id, e1.cliente_id);
  }));

test("el registro no se edita, no se borra ni se vacía; y el cliente de una operación pagada no cambia, aunque después se le cambie el nombre", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const e1 = await dar(app, d, { ...a, nuevo: "Don Chuy", diferencia: "1" });
    await rechaza(db.query("UPDATE precio_especial SET precio_nuevo = 9 WHERE id = $1", [e1.id]), "RC001");
    await rechaza(db.query("DELETE FROM precio_especial WHERE id = $1", [e1.id]), "RC001");
    await rechaza(db.query("TRUNCATE precio_especial CASCADE"), "RC001");

    // Abierta, la cuenta no lleva nombre guardado; al cobrarla se le guarda el de ese momento.
    assert.equal((await verCuenta(db, a.cuenta)).cliente_nombre, null);
    const pagada = await cobrar(app, a.cuenta, e.mostrador);
    assert.deepEqual([pagada.cliente_id, pagada.cliente_nombre, num(pagada.total)], [e1.cliente_id, "Don Chuy", 310]);
    await db.query("SELECT renombrar_cliente($1, 'Jesús Pérez')", [e1.cliente_id]);
    assert.equal((await verCuenta(db, a.cuenta)).cliente_nombre, "Don Chuy");
    await rechaza(db.query("UPDATE operacion SET cliente_id = NULL WHERE id = $1", [a.cuenta]), "RC001");
    await rechaza(db.query("UPDATE operacion SET cliente_nombre = 'Otro' WHERE id = $1", [a.cuenta]), "RC001");

    // En una abierta, ponerle a mano un cliente que no es el de sus precios se rechaza al terminar la transacción.
    const b = await cuentaCon(d, "compra", "PET", "5");
    await db.query("BEGIN");
    await db.query("UPDATE operacion SET cliente_id = $2 WHERE id = $1", [b.cuenta, e1.cliente_id]);
    await rechaza(db.query("COMMIT"), "RC005");
    assert.equal((await verCuenta(db, b.cuenta)).cliente_id, null);
  }));

// ── el dinero ──────────────────────────────────────────────────────────────

test("el importe del renglón y el total de la cuenta salen del precio que quedó, con descuento, fracciones y dos renglones; al quitarlo vuelven a los de lista, exactos", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100.5");                      // 100.5 kg a 2.1 = 211.05
    const pet = randomUUID();
    await agregarMaterial(app, a.cuenta, e.mat["PET"]!, "8.125", e.mostrador, { linea: pet });   // 8.125 kg a 7.5 = 60.94
    await db.query("SELECT poner_descuento($1, 0.5, $2)", [a.linea, e.mostrador]);  // 100 kg liquidables
    const importes = async () => (await db.query("SELECT importe FROM operacion_linea WHERE operacion_id = $1 ORDER BY creada_en", [a.cuenta])).rows.map((r) => num(r.importe));
    assert.deepEqual(await importes(), [210, 60.94]);

    const e1 = await dar(app, d, { ...a, diferencia: "0.0049" });                   // 2.1049 × 100 = 210.49
    const e2 = await dar(app, d, { cuenta: a.cuenta, linea: pet, cliente: e1.cliente_id, diferencia: "-0.0051" });   // 7.4949 × 8.125 = 60.896… → 60.90
    assert.deepEqual(await importes(), [210.49, 60.9]);

    await quitar(app, d, { cuenta: a.cuenta, linea: pet, visto: e2.id });
    assert.deepEqual(await importes(), [210.49, 60.94]);
    const pagada = await cobrar(app, a.cuenta, e.mostrador);
    assert.deepEqual([num(pagada.suma), num(pagada.total), num(pagada.ajuste_redondeo)], [271.43, 271, -0.43]);
  }));

test("en venta, dar un precio especial no mueve la existencia: la mueve cobrar, y por los kilos, no por el precio", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await db.query("SELECT terminar_arranque($1::jsonb, $2)", [JSON.stringify([{ material: e.mat["Cartón"], kg: "500", origen: "contado" }]), d.duena]);
    const a = await cuentaCon(d, "venta", "Cartón", "40");
    await dar(app, d, { ...a, diferencia: "-0.3" });
    assert.equal(await existencia(db, e.mat["Cartón"]!), 500);
    const pagada = await cobrar(app, a.cuenta, e.mostrador);
    assert.equal(num(pagada.total), 88);
    assert.equal(await existencia(db, e.mat["Cartón"]!), 460);
  }));

// ── el cliente de la cuenta ────────────────────────────────────────────────

test("el cliente de la cuenta se pone con el primer precio especial y se quita con el último: al quitarlo, al quitar el material y al descartar la cuenta", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const pet = randomUUID();
    await agregarMaterial(app, a.cuenta, e.mat["PET"]!, "5", e.mostrador, { linea: pet });
    const cliente = async () => (await verCuenta(db, a.cuenta)).cliente_id;
    assert.equal(await cliente(), null);
    const e1 = await dar(app, d, { ...a, diferencia: "1" });
    const e2 = await dar(app, d, { cuenta: a.cuenta, linea: pet, cliente: e1.cliente_id, diferencia: "1" });
    assert.equal(await cliente(), e1.cliente_id);
    // Se quita uno: queda el otro, y la cuenta sigue siendo del cliente.
    await quitar(app, d, { ...a, visto: e1.id });
    assert.equal(await cliente(), e1.cliente_id);
    // Se quita el material que llevaba el último: la cuenta vuelve a ser anónima, en esa misma acción.
    await app.query("SELECT quitar_material($1, $2)", [pet, e.mostrador]);
    assert.equal(await cliente(), null);
    // La historia del renglón quitado se conserva.
    assert.equal(await contar(db, "precio_especial", "id = $1", [e2.id]), 1);

    // Descartar la cuenta con un precio especial vigente: se va la cuenta, queda el registro.
    const e3 = await dar(app, d, { ...a, visto: (await verRenglon(db, a.linea)).precio_evento, cliente: e1.cliente_id, diferencia: "2" });
    await app.query("SELECT descartar_cuenta($1, $2)", [a.cuenta, e.mostrador]);
    assert.equal(await contar(db, "operacion", "id = $1", [a.cuenta]), 0);
    assert.equal(await contar(db, "precio_especial", "operacion_id = $1", [a.cuenta]), 4);
    assert.ok(e3.id);
  }));

test("dar, quitar y cobrar deja una operación anónima: «hubo precio especial» quiere decir que lo hay al cobrar", () =>
  conHoy(async (d) => {
    const { app, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const e1 = await dar(app, d, { ...a, diferencia: "1" });
    await quitar(app, d, { ...a, visto: e1.id });
    const pagada = await cobrar(app, a.cuenta, e.mostrador);
    assert.deepEqual([pagada.cliente_id, pagada.cliente_nombre, num(pagada.total)], [null, null, 210]);
  }));

// ── el envío ───────────────────────────────────────────────────────────────

test("el mismo envío, otra vez, devuelve su evento original y no escribe dos veces: sin pedir la clave, aunque quien autorizó ya no esté, y aunque el material o la cuenta ya no existan", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const envio = randomUUID();
    const pedido: Dar = { envio, ...a, nuevo: "Don Chuy", diferencia: "1" };
    const e1 = await dar(app, d, pedido);
    const otra = await dar(app, d, pedido);
    assert.equal(otra.id, e1.id);
    assert.equal(await contar(db, "precio_especial"), 1);
    // Sin la clave buena, y con quien autorizó dada de baja: sigue devolviendo lo que dejó.
    await db.query("UPDATE usuario SET activo = false WHERE id = $1", [d.duena]);
    assert.equal((await dar(app, d, { ...pedido, clave: "000000" })).id, e1.id);
    await db.query("UPDATE usuario SET activo = true WHERE id = $1", [d.duena]);
    // Lo guardado del envío no trae la clave.
    const guardado = await una(db, "SELECT clase, contenido::text AS t FROM envio WHERE id = $1", [envio]);
    assert.equal(guardado.clase, "precio");
    assert.ok(!guardado.t.includes(CLAVE), "el contenido del envío trae la clave");
    assert.deepEqual(JSON.parse(guardado.t), { accion: "dar", cuenta: a.cuenta, linea: a.linea, visto: null, cliente: null, cliente_nuevo: "Don Chuy", diferencia: "1.0000", autoriza: Number(d.duena) });

    // Quitar, repetido: lo mismo.
    const envioQ = randomUUID();
    const e2 = await quitar(app, d, { envio: envioQ, ...a, visto: e1.id });
    assert.equal((await quitar(app, d, { envio: envioQ, ...a, visto: e1.id })).id, e2.id);
    assert.equal(await contar(db, "precio_especial"), 2);

    // Se quita el material: los dos envíos siguen contestando con su evento.
    await app.query("SELECT quitar_material($1, $2)", [a.linea, e.mostrador]);
    assert.equal((await dar(app, d, pedido)).id, e1.id);
    assert.equal((await quitar(app, d, { envio: envioQ, ...a, visto: e1.id })).id, e2.id);
    // Y se descarta la cuenta: igual.
    await app.query("SELECT descartar_cuenta($1, $2)", [a.cuenta, e.mostrador]);
    assert.equal((await dar(app, d, pedido)).id, e1.id);
    assert.equal(await contar(db, "precio_especial"), 2);
  }));

test("el mismo envío con otro contenido se rechaza —también si lo único distinto es el evento que se vio, o la acción—; y uno cancelado ya no asienta", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const envio = randomUUID();
    const pedido: Dar = { envio, ...a, nuevo: "Don Chuy", diferencia: "1" };
    const e1 = await dar(app, d, pedido);
    await rechaza(dar(app, d, { ...pedido, diferencia: "2" }), "RC012");
    await rechaza(dar(app, d, { ...pedido, nuevo: "Doña Mari" }), "RC012");
    await rechaza(dar(app, d, { ...pedido, visto: e1.id }), "RC012");
    const otra = await personaConClave(db, "Rita", "responsable", "271828", true);
    await rechaza(dar(app, d, { ...pedido, autoriza: otra, clave: "271828" }), "RC012");
    await rechaza(quitar(app, d, { envio, ...a, visto: e1.id }), "RC012");      // la misma cuenta y renglón, otra acción
    // Y al revés: el envío de un quitar no sirve para dar.
    const envioQ = randomUUID();
    await quitar(app, d, { envio: envioQ, ...a, visto: e1.id });
    await rechaza(dar(app, d, { ...pedido, envio: envioQ }), "RC012");
    await rechaza(quitar(app, d, { envio: envioQ, ...a, visto: null }), "RC012");

    // Cancelado antes de llegar: ya no entra, ni dando ni quitando.
    const cancelado = randomUUID();
    assert.equal((await una(app, "SELECT cancelar_envio($1, $2) AS c", [cancelado, e.mostrador])).c, true);
    const b = await cuentaCon(d, "compra", "PET", "5");
    await rechaza(dar(app, d, { envio: cancelado, ...b, cliente: e1.cliente_id, diferencia: "1" }), "RC012");
    assert.equal((await verRenglon(db, b.linea)).precio_evento, null);
    // Cancelar uno que ya entró no lo deshace: dice que no quedó cancelado.
    assert.equal((await una(app, "SELECT cancelar_envio($1, $2) AS c", [envio, e.mostrador])).c, false);
    assert.equal(await contar(db, "precio_especial"), 2);
  }));

test("la clave mal no asienta nada y deja el envío sin gastar; el intento queda contado, y a los cinco se bloquea de verdad", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const envio = randomUUID();
    const pedido: Dar = { envio, ...a, nuevo: "Don Chuy", diferencia: "1" };
    const mal = await dar(app, d, { ...pedido, clave: "000001" });
    assert.equal(mal.id, null, "con la clave mal no debe devolver un evento");
    assert.equal(await contar(db, "precio_especial"), 0);
    assert.equal(await contar(db, "cliente"), 0);
    assert.equal(await contar(db, "envio", "id = $1", [envio]), 0);
    assert.equal(num((await verRenglon(db, a.linea)).precio_unitario), 2.1);
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [d.duena])).fallos, 1);
    // El mismo envío, ahora con la clave buena, entra.
    const bien = await dar(app, d, pedido);
    assert.ok(bien.id);
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [d.duena])).fallos, 0);

    // Cinco fallos seguidos: bloqueada. Ni con la clave buena pasa uno nuevo.
    const b = await cuentaCon(d, "compra", "PET", "5");
    for (let k = 0; k < 5; k++) assert.equal((await dar(app, d, { ...b, cliente: bien.cliente_id, diferencia: "1", clave: "000001" })).id, null);
    assert.ok((await una(db, "SELECT bloqueada_hasta FROM credencial WHERE usuario_id = $1", [d.duena])).bloqueada_hasta);
    assert.equal((await dar(app, d, { ...b, cliente: bien.cliente_id, diferencia: "1" })).id, null);
    assert.equal((await verRenglon(db, b.linea)).precio_evento, null);
    // Quitar no pide clave: con la credencial bloqueada, se puede.
    assert.ok((await quitar(app, d, { ...a, visto: bien.id })).id);
  }));

// Lo encontró Codex en su décima revisión: con un envío cancelado la clave se miraba antes de decir que ese envío ya no
// servía. Cada intento con la clave mal se contaba, y al quinto quedaba bloqueada quien autoriza.
test("lo que no procede se dice antes de mirar la clave —el envío cancelado u ocupado por otro, la cuenta, el material, lo que se vio, el precio, el cliente—: no gasta intentos ni bloquea a quien autoriza", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const mal = { diferencia: "1", clave: "000001" };
    // El envío cancelado: cinco veces, que es lo que antes bastaba para el bloqueo.
    const cancelado = randomUUID();
    assert.equal((await una(app, "SELECT cancelar_envio($1, $2) AS c", [cancelado, e.mostrador])).c, true);
    for (let k = 0; k < 5; k++) await rechaza(dar(app, d, { envio: cancelado, ...a, ...mal }), "RC012");
    // El identificador con que se agregó el material es un envío de otra clase: tampoco sirve.
    await rechaza(dar(app, d, { envio: a.linea, ...a, ...mal }), "RC012");

    // La cuenta que no existe, el material que no es de esa cuenta, lo que no se vio, y el precio que quedaría en cero.
    const otra = await cuentaCon(d, "compra", "PET", "5");
    await rechaza(dar(app, d, { cuenta: randomUUID(), linea: a.linea, ...mal }), "RC005");
    await rechaza(dar(app, d, { cuenta: a.cuenta, linea: otra.linea, ...mal }), "RC005");
    await rechaza(dar(app, d, { ...a, ...mal, visto: "999999" }), "RC011");
    await rechaza(dar(app, d, { ...a, ...mal, diferencia: "-2.1" }), "RC004");
    const intentos = async () => {
      const c = await una(db, "SELECT fallos, bloqueos, bloqueada_hasta FROM credencial WHERE usuario_id = $1", [d.duena]);
      return [c.fallos, c.bloqueos, c.bloqueada_hasta];
    };
    assert.deepEqual(await intentos(), [0, 0, null]);       // antes de la clave buena que viene, que los borraría
    // El cliente dado de baja —por su número y por su nombre—, y la cuenta que ya es de otro cliente.
    const chuy = (await dar(app, d, { ...otra, nuevo: "Don Chuy", diferencia: "1" })).cliente_id as string;
    const mari = (await una(db, "INSERT INTO cliente (nombre, activo) VALUES ('Doña Mari', false) RETURNING id")).id as string;
    await rechaza(dar(app, d, { ...a, ...mal, cliente: mari }), "RC005");
    await rechaza(dar(app, d, { ...a, ...mal, nuevo: "doña mari" }), "RC005");
    const dos = randomUUID();
    await agregarMaterial(app, otra.cuenta, e.mat["Cartón"]!, "10", e.mostrador, { linea: dos });
    await rechaza(dar(app, d, { cuenta: otra.cuenta, linea: dos, ...mal, nuevo: "Don Beto" }), "RC005");
    // Y la cuenta ya cobrada.
    await cobrar(app, otra.cuenta, e.mostrador);
    await rechaza(dar(app, d, { cuenta: otra.cuenta, linea: dos, ...mal, cliente: chuy }), "RC001");

    assert.deepEqual(await intentos(), [0, 0, null]);
    assert.equal(await contar(db, "cliente"), 2);
    // Nada de eso tocó el renglón; y con la clave mal de verdad —todo lo demás en orden—, el intento sí se cuenta.
    assert.equal((await dar(app, d, { ...a, ...mal })).id, null);
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [d.duena])).fallos, 1);
    assert.equal((await verRenglon(db, a.linea)).precio_evento, null);
  }));

test("la cancelación que le gana a una petición todavía en camino: esa petición ya no asienta", () =>
  conHoy(async (d) => {
    const { app, db, base, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const envio = randomUUID();
    const otra = await comoApp(base);
    const vigia = await conectar(base);
    try {
      // La petición se detiene comprobando la clave: alguien tiene tomada esa credencial.
      await db.query("BEGIN");
      await db.query("SELECT 1 FROM credencial WHERE usuario_id = $1 FOR UPDATE", [d.duena]);
      const pid = await pidDe(otra);
      const enCamino = desenlace(dar(otra, d, { envio, ...a, diferencia: "1" }));
      await esperarQueEspere(vigia, pid);
      // Mientras tanto la pantalla, que no supo de ella, la cancela.
      assert.equal((await una(app, "SELECT cancelar_envio($1, $2) AS c", [envio, e.mostrador])).c, true);
      await db.query("COMMIT");
      assert.equal(await enCamino, "RC012");
      assert.equal(await contar(db, "precio_especial"), 0);
      assert.equal(num((await verRenglon(db, a.linea)).precio_unitario), 2.1);
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      await otra.end();
      await vigia.end();
    }
  }));

// Lo encontró Codex en su décima revisión: la repetida no veía lo que el primero todavía no terminaba de dejar, miraba
// la clave y, si venía mal, contestaba que no había pasado —con el precio ya dado— y dejaba un intento contado.
test("el mismo envío repetido mientras el primero todavía va en camino: espera, y devuelve el evento del primero sin mirar la clave; al quitar, lo mismo", () =>
  conHoy(async (d) => {
    const { db, base } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const pedido: Dar = { envio: randomUUID(), ...a, nuevo: "Don Chuy", diferencia: "1" };
    const primera = await comoApp(base);
    const segunda = await comoApp(base);
    const vigia = await conectar(base);
    const idDe = (p: Promise<Record<string, unknown>>) => p.then((r) => r.id as string | null, (err) => `falló con ${(err as { code?: string }).code}`);
    try {
      await primera.query("BEGIN");
      const e1 = await dar(primera, d, pedido);
      const pid = await pidDe(segunda);
      // La repetida trae la clave mal: si llegara a mirarla, contestaría que no pasó.
      const repetida = idDe(dar(segunda, d, { ...pedido, clave: "000001" }));
      await esperarQueEspere(vigia, pid);
      await primera.query("COMMIT");
      assert.equal(await repetida, e1.id);
      assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [d.duena])).fallos, 0);
      assert.equal(await contar(db, "precio_especial"), 1);

      // Quitar, repetido igual: la segunda no contesta que el precio «cambió desde que se vio» —lo cambió ella misma—.
      const paraQuitar: Quitar = { envio: randomUUID(), ...a, visto: e1.id };
      await primera.query("BEGIN");
      const q1 = await quitar(primera, d, paraQuitar);
      const otraVez = idDe(quitar(segunda, d, paraQuitar));
      await esperarQueEspere(vigia, pid);
      await primera.query("COMMIT");
      assert.equal(await otraVez, q1.id);
      assert.equal(await contar(db, "precio_especial"), 2);
    } finally {
      await primera.query("ROLLBACK").catch(() => {});
      await primera.end();
      await segunda.end();
      await vigia.end();
    }
  }));

// ── la petición que llega tarde ────────────────────────────────────────────

test("una petición atrasada no quita ni pisa un precio que no vio: el reintento de quitar P1 no quita P2, y dar encima de un precio que no se vio se rechaza", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const p1 = await dar(app, d, { ...a, diferencia: "1" });
    // Quitar P1 se asienta y su respuesta se pierde.
    const envioQ = randomUUID();
    const q = await quitar(app, d, { envio: envioQ, ...a, visto: p1.id });
    // Otra pestaña, que ya vio el renglón sin precio, da P2.
    const p2 = await dar(app, d, { ...a, visto: q.id, cliente: p1.cliente_id, diferencia: "2" });
    // El reintento de aquel quitar: devuelve lo que hizo entonces, y P2 sigue ahí.
    assert.equal((await quitar(app, d, { envio: envioQ, ...a, visto: p1.id })).id, q.id);
    assert.deepEqual([num((await verRenglon(db, a.linea)).precio_unitario), (await verRenglon(db, a.linea)).precio_evento], [4.1, p2.id]);
    // Una petición nueva, pero que vio el renglón como estaba antes: no quita P2.
    await rechaza(quitar(app, d, { ...a, visto: p1.id }), "RC011");
    await rechaza(quitar(app, d, { ...a, visto: null }), "RC011");
    // Ni se da encima de P2 sin haberlo visto.
    await rechaza(dar(app, d, { ...a, visto: p1.id, cliente: p1.cliente_id, diferencia: "3" }), "RC011");
    await rechaza(dar(app, d, { ...a, visto: null, cliente: p1.cliente_id, diferencia: "3" }), "RC011");
    assert.equal((await verRenglon(db, a.linea)).precio_evento, p2.id);
    assert.equal(await contar(db, "precio_especial"), 3);
  }));

test("la que vio «ninguno»: si mientras tanto otro dio y quitó un precio, se rechaza aunque el renglón esté otra vez a precio de lista", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const p1 = await dar(app, d, { ...a, diferencia: "1" });
    await quitar(app, d, { ...a, visto: p1.id });
    assert.equal(num((await verRenglon(db, a.linea)).precio_unitario), 2.1);
    await rechaza(dar(app, d, { ...a, visto: null, cliente: p1.cliente_id, diferencia: "3" }), "RC011");
    assert.equal(await contar(db, "precio_especial"), 2);
  }));

// ── cruces, con barrera ────────────────────────────────────────────────────

/** Lanza `segunda` cuando `primera` ya tiene lo suyo tomado dentro de una transacción; suelta a la primera y devuelve cómo acabó la segunda. */
async function cruzar(
  d: Dia, primera: (c: pg.Client) => Promise<unknown>, segunda: (c: pg.Client) => Promise<unknown>, terminar: "COMMIT" | "ROLLBACK" = "COMMIT",
): Promise<string> {
  const a = await comoApp(d.base);
  const b = await comoApp(d.base);
  const vigia = await conectar(d.base);
  try {
    await a.query("BEGIN");
    await primera(a);
    const pid = await pidDe(b);
    const fin = desenlace(segunda(b));
    await esperarQueEspere(vigia, pid);
    await a.query(terminar);
    return await fin;
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await a.end();
    await b.end();
    await vigia.end();
  }
}

test("dar precio especial mientras otra sesión cobra la misma cuenta: nunca un comprobante con un total y la base con otro", () =>
  conHoy(async (d) => {
    const { db, e } = d;
    // Primero cobra: el precio llega después y encuentra la cuenta cobrada.
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    assert.equal(await cruzar(d, (c) => cobrar(c, a.cuenta, e.mostrador), (c) => dar(c, d, { ...a, diferencia: "1" })), "RC001");
    assert.deepEqual([num((await verCuenta(db, a.cuenta)).total), num((await verRenglon(db, a.linea)).precio_unitario)], [210, 2.1]);
    // Primero el precio: quien cobraba con el total viejo recibe el aviso de que la cuenta cambió.
    const b = await cuentaCon(d, "compra", "Cartón", "100");
    const revision = await revisionDe(db, b.cuenta);
    assert.equal(
      await cruzar(d, (c) => dar(c, d, { ...b, diferencia: "1" }), (c) => una(c, "SELECT * FROM confirmar_cuenta($1, $2, $3)", [b.cuenta, e.mostrador, revision])),
      "RC011",
    );
    assert.equal((await verCuenta(db, b.cuenta)).estado, "borrador");
    assert.equal(num((await verRenglon(db, b.linea)).precio_unitario), 3.1);
  }));

test("dos precios al mismo renglón a la vez: entra uno, y el otro se entera de que ya no vio lo que hay", () =>
  conHoy(async (d) => {
    const { db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const fin = await cruzar(d, (c) => dar(c, d, { ...a, nuevo: "Don Chuy", diferencia: "1" }), (c) => dar(c, d, { ...a, nuevo: "Don Chuy", diferencia: "2" }));
    assert.equal(fin, "RC011");
    assert.equal(num((await verRenglon(db, a.linea)).precio_unitario), 3.1);
    assert.equal(await contar(db, "precio_especial"), 1);
  }));

// El orden de candados es uno solo: la cuenta y después la credencial. Dar un precio tomaba primero la credencial de quien
// autoriza, al revés que terminar un vehículo: si las dos cosas le pasaban a la misma cuenta con la clave de la misma
// persona, se esperaban una a otra y la base tumbaba a una. Codex lo confirmó en su décima revisión.
test("dar precio especial al vehículo de ayer mientras, desde otro equipo, se termina con la clave de la misma persona: hacen fila, sin abrazo mortal", () =>
  conHoy<Ayer>(async (d, previo) => {
    const { app, db, base, e } = d;
    /** Con la credencial tomada por alguien más, llega `primero` y después `segundo`; se suelta, y se ve cómo acabó cada uno. */
    const enFila = async (primero: (c: pg.Client) => Promise<unknown>, segundo: (c: pg.Client) => Promise<unknown>): Promise<string[]> => {
      const [uno, otro, vigia] = [await comoApp(base), await comoApp(base), await conectar(base)];
      try {
        await db.query("BEGIN");
        await db.query("SELECT 1 FROM credencial WHERE usuario_id = $1 FOR UPDATE", [d.duena]);
        const [pidUno, pidOtro] = [await pidDe(uno), await pidDe(otro)];
        const finUno = desenlace(primero(uno));
        await esperarQueEspere(vigia, pidUno);
        const finOtro = desenlace(segundo(otro));
        await esperarQueEspere(vigia, pidOtro);
        await db.query("COMMIT");
        return [await finUno, await finOtro];
      } finally {
        await db.query("ROLLBACK").catch(() => {});
        await uno.end();
        await otro.end();
        await vigia.end();
      }
    };
    const [v, w] = previo.camiones as [Ayer["camiones"][0], Ayer["camiones"][0]];
    for (const x of [v, w]) await segundaPesada(app, x.linea, "3400", e.mostrador);
    const precio = (x: { cuenta: string; linea: string }) => (c: pg.Client) => dar(c, d, { ...x, diferencia: "0.25" });
    const terminar = (x: { cuenta: string }, revision: number) => (c: pg.Client) =>
      una(c, "SELECT * FROM terminar_vehiculo($1, $2, $3, $4, $5)", [x.cuenta, revision, d.duena, CLAVE, d.huella]);

    // Llega primero el precio: entra, y quien terminaba la cuenta con el total viejo se entera de que cambió.
    assert.deepEqual(await enFila(precio(v), terminar(v, await revisionDe(db, v.cuenta))), ["pasó", "RC011"]);
    assert.deepEqual([num((await verRenglon(db, v.linea)).precio_unitario), (await verCuenta(db, v.cuenta)).estado], [6.75, "borrador"]);
    // Llega primero quien termina: se cobra, y el precio encuentra la cuenta cobrada.
    assert.deepEqual(await enFila(terminar(w, await revisionDe(db, w.cuenta)), precio(w)), ["pasó", "RC001"]);
    assert.deepEqual([num((await verRenglon(db, w.linea)).precio_unitario), (await verCuenta(db, w.cuenta)).estado], [6.5, "confirmada"]);
    assert.equal(await contar(db, "precio_especial"), 1);
  }, { antes: ayerConCamiones(2) }));

test("dos altas del mismo cliente nuevo a la vez, en dos cuentas: queda un solo cliente", () =>
  conHoy(async (d) => {
    const { db } = d;
    // Autorizan dos personas distintas: así las dos peticiones llegan a la vez a dar de alta al cliente
    // (con la misma, la segunda esperaría antes, comprobando la clave).
    const rita = { autoriza: await personaConClave(db, "Rita", "responsable", "271828", true), clave: "271828" };
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const b = await cuentaCon(d, "compra", "PET", "5");
    const fin = await cruzar(d, (c) => dar(c, d, { ...a, nuevo: "Don Chuy", diferencia: "1" }), (c) => dar(c, d, { ...b, nuevo: "don  chuy", diferencia: "1", ...rita }));
    assert.equal(fin, "pasó");
    assert.equal(await contar(db, "cliente"), 1);
    const [ca, cb] = [(await verCuenta(db, a.cuenta)).cliente_id, (await verCuenta(db, b.cuenta)).cliente_id];
    assert.ok(ca && ca === cb);
    // Y si la primera se arrepiente, la segunda da de alta al cliente ella sola.
    const c1 = await cuentaCon(d, "compra", "Cartón", "100");
    const c2 = await cuentaCon(d, "compra", "PET", "5");
    assert.equal(await cruzar(d, (c) => dar(c, d, { ...c1, nuevo: "Doña Mari", diferencia: "1" }), (c) => dar(c, d, { ...c2, nuevo: "Doña Mari", diferencia: "1", ...rita }), "ROLLBACK"), "pasó");
    assert.equal(await contar(db, "cliente"), 2);
    assert.ok((await verCuenta(db, c2.cuenta)).cliente_id);
  }));

test("quitar el material mientras se le da precio especial, y al revés: gana uno, y no queda nada a medias", () =>
  conHoy(async (d) => {
    const { db, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    assert.equal(await cruzar(d, (c) => c.query("SELECT quitar_material($1, $2)", [a.linea, e.mostrador]), (c) => dar(c, d, { ...a, diferencia: "1" })), "RC005");
    assert.equal(await contar(db, "precio_especial"), 0);
    assert.equal(await contar(db, "cliente"), 0);
    const b = await cuentaCon(d, "compra", "Cartón", "100");
    assert.equal(await cruzar(d, (c) => dar(c, d, { ...b, diferencia: "1" }), (c) => c.query("SELECT quitar_material($1, $2)", [b.linea, e.mostrador])), "pasó");
    assert.equal(await contar(db, "operacion_linea", "id = $1", [b.linea]), 0);
    assert.equal((await verCuenta(db, b.cuenta)).cliente_id, null);
    assert.equal(await contar(db, "precio_especial"), 1);
  }));

test("cerrar el día mientras se da un precio especial: si el cierre va primero, el precio espera y encuentra el día cerrado", () =>
  conHoy(async (d) => {
    const { db } = d;
    // El cierre va primero: el precio encuentra el día cerrado.
    const v = await cuentaCon(d, "compra", "Fierro pesado", "5200", GRANDE);
    assert.equal(await cruzar(d, (c) => cerrarHoy(c, d), (c) => dar(c, d, { ...v, diferencia: "1" })), "RC006");
    assert.equal(await contar(db, "precio_especial"), 0);
  }));

test("si el precio va primero, el cierre espera a que termine: pasan los dos", () =>
  conHoy(async (d) => {
    const { db, e } = d;
    const v = await cuentaCon(d, "compra", "Fierro pesado", "5200", GRANDE);
    assert.equal(await cruzar(d, (c) => dar(c, d, { ...v, diferencia: "1" }), (c) => cerrarHoy(c, d)), "pasó");
    assert.ok((await una(db, "SELECT cerrada_en FROM jornada WHERE id = $1", [e.jornada])).cerrada_en);
    assert.equal(num((await verRenglon(db, v.linea)).precio_unitario), 7.8);
  }));

test("a la vez, y muchas veces: dar precio, cobrar otra cuenta, agregar un material y cerrar el día nunca terminan en un abrazo mortal", () =>
  conHoy(async (d) => {
    const { app, db, base, e } = d;
    const conexiones = await Promise.all([0, 1, 2, 3].map(() => comoApp(base)));
    try {
      for (let vuelta = 0; vuelta < 6; vuelta++) {
        const a = await cuentaCon(d, "compra", "Cartón", "100");
        const b = await cuentaCon(d, "compra", "PET", "5");
        const c = await cuentaCon(d, "compra", "Cartón", "10");
        const fines = await Promise.all([
          desenlace(dar(conexiones[0]!, d, { ...a, nuevo: "Don Chuy", diferencia: "1" })),
          desenlace(cobrar(conexiones[1]!, b.cuenta, e.mostrador)),
          desenlace(agregarMaterial(conexiones[2]!, c.cuenta, e.mat["PET"]!, "3", e.mostrador)),
          desenlace(cerrarHoy(conexiones[3]!, d)),
        ]);
        assert.ok(!fines.includes("40P01"), `se trabaron en la vuelta ${vuelta}: ${fines.join(", ")}`);
        for (const fin of fines) assert.ok(["pasó", "RC006", "RC011"].includes(fin), `desenlace inesperado: ${fines.join(", ")}`);
        // Se reabre para la siguiente vuelta, y se limpian las cuentas que quedaron abiertas.
        const j = await una(db, "SELECT cerrada_en, cierres FROM jornada WHERE id = $1", [e.jornada]);
        if (j.cerrada_en) await una(app, "SELECT * FROM reabrir_jornada(gen_random_uuid(), $1, $2, $3, $4, $5, $6)", [e.jornada, j.cierres, d.duena, CLAVE, d.huella, e.mostrador]);
        for (const x of [a, b, c]) await app.query("SELECT descartar_cuenta($1, $2)", [x.cuenta, e.mostrador]).catch(() => {});
      }
    } finally {
      await Promise.all(conexiones.map((x) => x.end()));
    }
  }));

test("la petición que esperó hasta pasada la medianoche se rechaza, esperara la cuenta o la clave: «hoy» se mira al final, ya con los candados en la mano", () =>
  conHoy(async (d) => {
    const { db } = d;
    // Alguien tiene tomado algo que la petición necesita; la petición espera; mientras, pasa la medianoche.
    const tomado: Record<string, (cuenta: string) => Promise<unknown>> = {
      "la cuenta": (cuenta) => db.query("SELECT 1 FROM operacion WHERE id = $1 FOR UPDATE", [cuenta]),
      "la credencial de quien autoriza": () => db.query("SELECT 1 FROM credencial WHERE usuario_id = $1 FOR UPDATE", [d.duena]),
    };
    for (const [que, tomar] of Object.entries(tomado)) {
      const b = await cuentaCon(d, "compra", "PET", "5");
      const otra = await comoApp(d.base);
      const vigia = await conectar(d.base);
      try {
        await db.query("BEGIN");
        await tomar(b.cuenta);
        const pid = await pidDe(otra);
        const enCamino = desenlace(dar(otra, d, { ...b, diferencia: "1" }));
        await esperarQueEspere(vigia, pid);
        await vigia.query("UPDATE sucursal SET zona = $1", [ZONA_DE_MANANA]);
        await db.query("COMMIT");
        assert.equal(await enCamino, "RC006", `esperando ${que}`);
        assert.equal((await verRenglon(db, b.linea)).precio_evento, null);
        assert.equal(await contar(db, "precio_especial", "linea_id = $1", [b.linea]), 0);
      } finally {
        await db.query("ROLLBACK").catch(() => {});
        await otra.end();
        await vigia.end();
        await db.query("UPDATE sucursal SET zona = $1", [ZONA]);      // de vuelta a hoy, para la vuelta que sigue
      }
    }
  }));

test("después de reabrir el día, una petición nueva pasa; una vieja, que vio el renglón como estaba antes, no revive", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const v = await cuentaCon(d, "compra", "Fierro pesado", "5200", GRANDE);
    const p1 = await dar(app, d, { ...v, diferencia: "1" });
    const cierre = await cerrarHoy(app, d);
    const tarde = randomUUID();
    await rechaza(dar(app, d, { envio: tarde, ...v, visto: p1.id, cliente: p1.cliente_id, diferencia: "2" }), "RC006");
    await una(app, "SELECT * FROM reabrir_jornada(gen_random_uuid(), $1, $2, $3, $4, $5, $6)", [e.jornada, cierre.cierre, d.duena, CLAVE, d.huella, e.mostrador]);
    // Nueva, con lo que hay a la vista: pasa.
    const p2 = await dar(app, d, { ...v, visto: p1.id, cliente: p1.cliente_id, diferencia: "0.5" });
    assert.equal(num((await verRenglon(db, v.linea)).precio_unitario), 7.3);
    // La de antes del cierre, con su mismo envío y lo que entonces veía: ya no.
    await rechaza(dar(app, d, { envio: tarde, ...v, visto: p1.id, cliente: p1.cliente_id, diferencia: "2" }), "RC011");
    assert.equal((await verRenglon(db, v.linea)).precio_evento, p2.id);
  }));

// ── el vehículo de otro día, y el cierre ───────────────────────────────────

test("al vehículo de ayer se le da precio especial hoy, sobre su precio de lista de ayer; y sale en el cierre de hoy, que es cuando se cobra", () =>
  conHoy<Ayer>(async (d, previo) => {
    const { app, db, e } = d;
    const v = { ...previo.camiones[0]!, ayer: previo.ayer };
    assert.equal(num((await verRenglon(db, v.linea)).precio_lista), 6.5, "el precio de lista del vehículo es el de ayer");
    const p = await dar(app, d, { cuenta: v.cuenta, linea: v.linea, diferencia: "0.25" });
    assert.deepEqual([num(p.precio_lista), num(p.precio_nuevo)], [6.5, 6.75]);
    await segundaPesada(app, v.linea, "3400", e.mostrador);                       // entró con 5,200: son 1,800 kg
    const pagada = await una(app, "SELECT * FROM terminar_vehiculo($1, (SELECT revision FROM operacion WHERE id = $1), $2, $3, $4)", [v.cuenta, d.duena, CLAVE, d.huella]);
    assert.deepEqual([num(pagada.total), pagada.cliente_nombre, pagada.confirmada_en_jornada], [12150, "Don Chuy", e.jornada]);
    const deHoy = (await db.query("SELECT * FROM precios_especiales_del_dia($1)", [e.jornada])).rows;
    assert.equal(deHoy.length, 1);
    assert.deepEqual(
      [deHoy[0].tipo, deHoy[0].cliente, deHoy[0].material, num(deHoy[0].kg), num(deHoy[0].precio_lista), num(deHoy[0].precio_aplicado), num(deHoy[0].diferencia), deHoy[0].autorizo],
      ["compra", "Don Chuy", "Fierro pesado", 1800, 6.5, 6.75, 450, d.duena],
    );
    // En el de ayer, que es cuando nació la cuenta, no.
    assert.equal((await db.query("SELECT * FROM precios_especiales_del_dia($1)", [v.ayer])).rows.length, 0);
  }, { antes: ayerConCamiones(1) }));

test("el cierre lista los precios especiales de lo cobrado en el día: compras y ventas aparte, la diferencia en dinero con cada importe redondeado, y sin lo quitado ni lo descartado", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await db.query("SELECT terminar_arranque($1::jsonb, $2)", [JSON.stringify([{ material: e.mat["Cartón"], kg: "500", origen: "contado" }]), d.duena]);
    // Una compra con dos precios especiales: uno hacia arriba y el del centavo.
    const compra = await cuentaCon(d, "compra", "Cartón", "100");                 // lista 2.1
    const magnesio = randomUUID();
    await agregarMaterial(app, compra.cuenta, e.mat["Magnesio"]!, "1", e.mostrador, { linea: magnesio });     // lista 1.0049
    const e1 = await dar(app, d, { ...compra, nuevo: "Don Chuy", diferencia: "0.5" });
    await dar(app, d, { cuenta: compra.cuenta, linea: magnesio, cliente: e1.cliente_id, diferencia: "0.0002" });
    await cobrar(app, compra.cuenta, e.mostrador);
    // Una venta con precio hacia abajo.
    const venta = await cuentaCon(d, "venta", "Cartón", "40");                    // lista 2.5
    const e3 = await dar(app, d, { ...venta, nuevo: "Doña Mari", diferencia: "-0.3" });
    await cobrar(app, venta.cuenta, e.mostrador);
    // Lo que no cuenta: uno que se dio y se quitó antes de cobrar, uno de una cuenta descartada, y uno todavía abierto.
    const quitado = await cuentaCon(d, "compra", "PET", "5");
    const q = await dar(app, d, { ...quitado, cliente: e1.cliente_id, diferencia: "1" });
    await quitar(app, d, { ...quitado, visto: q.id });
    await cobrar(app, quitado.cuenta, e.mostrador);
    const descartada = await cuentaCon(d, "compra", "PET", "5");
    await dar(app, d, { ...descartada, cliente: e1.cliente_id, diferencia: "1" });
    await app.query("SELECT descartar_cuenta($1, $2)", [descartada.cuenta, e.mostrador]);
    const abierta = await cuentaCon(d, "compra", "PET", "5");
    await dar(app, d, { ...abierta, cliente: e1.cliente_id, diferencia: "1" });

    const filas = (await db.query("SELECT * FROM precios_especiales_del_dia($1)", [e.jornada])).rows
      .map((f) => ({ tipo: f.tipo, cliente: f.cliente, material: f.material, kg: num(f.kg), lista: num(f.precio_lista), aplicado: num(f.precio_aplicado),
                     importe: num(f.importe), deLista: num(f.importe_de_lista), diferencia: num(f.diferencia), autorizo: f.autorizo_nombre }));
    assert.deepEqual(filas, [
      { tipo: "compra", cliente: "Don Chuy", material: "Cartón", kg: 100, lista: 2.1, aplicado: 2.6, importe: 260, deLista: 210, diferencia: 50, autorizo: "Zayra" },
      // 1 kg a 1.0051 son $1.01; a 1.0049, $1.00: la diferencia es un centavo, no «un kilo por 0.0002».
      { tipo: "compra", cliente: "Don Chuy", material: "Magnesio", kg: 1, lista: 1.0049, aplicado: 1.0051, importe: 1.01, deLista: 1, diferencia: 0.01, autorizo: "Zayra" },
      { tipo: "venta", cliente: "Doña Mari", material: "Cartón", kg: 40, lista: 2.5, aplicado: 2.2, importe: 88, deLista: 100, diferencia: -12, autorizo: "Zayra" },
    ]);
    assert.ok(e3.id);
    // La aplicación lo puede leer; y no puede pedir el de una jornada que no existe sin que se le diga.
    assert.equal((await app.query("SELECT * FROM precios_especiales_del_dia($1)", [e.jornada])).rows.length, 3);
  }, { precios: { Magnesio: [1.0049, 26] } }));

// ── permisos, y la consola ─────────────────────────────────────────────────

test("la aplicación no escribe las tablas: clientes, registro y precios solo cambian por las funciones", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const e1 = await dar(app, d, { ...a, diferencia: "1" });
    for (const sql of [
      "INSERT INTO cliente (nombre) VALUES ('Inventado')",
      `UPDATE cliente SET nombre = 'Otro' WHERE id = ${e1.cliente_id}`,
      `DELETE FROM cliente WHERE id = ${e1.cliente_id}`,
      `UPDATE operacion_linea SET precio_unitario = 9 WHERE id = '${a.linea}'`,
      `UPDATE operacion SET cliente_id = NULL WHERE id = '${a.cuenta}'`,
      `INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, precio_lista, precio_anterior, precio_nuevo) VALUES ('dar', '${a.cuenta}', '${a.linea}', 1, 1, 1, 2)`,
      `SELECT renombrar_cliente(${e1.cliente_id}, 'Otro')`,
      `SELECT baja_de_cliente(${e1.cliente_id})`,
      `SELECT reactivar_cliente(${e1.cliente_id})`,
    ]) {
      await rechaza(app.query(sql), "42501");
    }
    // Leer, sí: la pantalla necesita la lista de clientes y el registro.
    assert.equal((await app.query("SELECT id, nombre FROM cliente WHERE activo")).rows.length, 1);
    assert.equal((await app.query("SELECT id FROM precio_especial")).rows.length, 1);
    assert.equal(await contar(db, "cliente"), 1);
  }));

test("la consola renombra, da de baja y reactiva clientes: el nombre queda limpio y sigue siendo único", () =>
  conHoy(async (d) => {
    const { app, db } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const b = await cuentaCon(d, "compra", "PET", "5");
    const chuy = (await dar(app, d, { ...a, nuevo: "Don Chuy", diferencia: "1" })).cliente_id as string;
    const mari = (await dar(app, d, { ...b, nuevo: "Doña Mari", diferencia: "1" })).cliente_id as string;
    const ver = async (id: string) => una(db, "SELECT nombre, activo FROM cliente WHERE id = $1", [id]);

    await db.query("SELECT renombrar_cliente($1, $2)", [chuy, "  Jesús   Pérez "]);
    assert.equal((await ver(chuy)).nombre, "Jesús Pérez");
    await rechaza(db.query("SELECT renombrar_cliente($1, $2)", [chuy, "doña mari"]), "RC005");     // ya hay una
    await rechaza(db.query("SELECT renombrar_cliente($1, $2)", [chuy, "   "]), "RC005");
    await rechaza(db.query("SELECT renombrar_cliente($1, $2)", [999999, "Nadie"]), "RC005");
    await db.query("SELECT renombrar_cliente($1, $2)", [chuy, "JESÚS PÉREZ"]);                    // cambiarle solo las mayúsculas al suyo, sí
    assert.equal((await ver(chuy)).nombre, "JESÚS PÉREZ");

    await db.query("SELECT baja_de_cliente($1)", [mari]);
    assert.equal((await ver(mari)).activo, false);
    const c = await cuentaCon(d, "compra", "PET", "5");
    await rechaza(dar(app, d, { ...c, cliente: mari, diferencia: "1" }), "RC005");
    await db.query("SELECT reactivar_cliente($1)", [mari]);
    assert.ok((await dar(app, d, { ...c, cliente: mari, diferencia: "1" })).id);
    // El registro conserva el nombre que tenía cuando se le dio el precio.
    assert.equal((await una(db, "SELECT cliente_nombre FROM precio_especial WHERE operacion_id = $1", [a.cuenta])).cliente_nombre, "Don Chuy");
  }));

// ── el respaldo ────────────────────────────────────────────────────────────

test("un respaldo tomado entre dar y quitar conserva lo que había en ese momento, y restaurado queda idéntico: clientes, los dos precios, el cliente de la cuenta, los eventos y lo que dejó cada envío", () =>
  conHoy(async (d) => {
    const { app, db, base, e } = d;
    const a = await cuentaCon(d, "compra", "Cartón", "100");
    const p1 = await dar(app, d, { ...a, nuevo: "Don Chuy", diferencia: "1" });
    const cobrada = await cuentaCon(d, "compra", "PET", "5");
    const p2 = await dar(app, d, { ...cobrada, cliente: p1.cliente_id, diferencia: "-0.5" });
    await cobrar(app, cobrada.cuenta, e.mostrador);
    const quitado = await cuentaCon(d, "compra", "PET", "3");
    const p3 = await dar(app, d, { ...quitado, cliente: p1.cliente_id, diferencia: "2" });
    await quitar(app, d, { ...quitado, visto: p3.id });

    const carpeta = await mkdtemp(join(tmpdir(), "precio-"));
    try {
      const llave = await llaves();
      const antes = await retrato(db);
      assert.deepEqual([antes.clientes.length, antes.preciosEspeciales.length, antes.resultados.filter((r) => r.precio_especial_id).length], [1, 4, 4]);
      const archivo = await respaldoCifrado(base, carpeta, llave.publica);
      // Después del respaldo se quita el precio de la cuenta abierta: eso no está en el respaldo, y no vuelve.
      await quitar(app, d, { ...a, visto: p1.id });

      await conDestino(async (destino) => {
        await restaurar({
          servidor: LIMPIO, base: destino, archivo, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba", nota: "Ensayo", decir: () => {},
        });
        const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
        await restaurada.connect();
        const appRestaurada = await comoApp(destino, LIMPIO);
        try {
          assert.deepEqual(await retrato(restaurada), antes);
          // La cuenta abierta sigue con su precio especial, como estaba al respaldar.
          const l = await verRenglon(restaurada, a.linea);
          assert.deepEqual([num(l.precio_unitario), num(l.precio_lista), l.precio_evento], [3.1, 2.1, p1.id]);
          assert.equal((await una(restaurada, "SELECT cliente_nombre FROM operacion WHERE id = $1", [cobrada.cuenta])).cliente_nombre, "Don Chuy");
          // Y se sigue trabajando ahí: quitarlo crea un evento nuevo, con un número que no repite ninguno.
          const q = await una(appRestaurada, "SELECT * FROM quitar_precio_especial($1, $2, $3, $4, $5)", [randomUUID(), a.cuenta, a.linea, p1.id, e.mostrador]);
          assert.ok(Number(q.id) > Math.max(Number(p1.id), Number(p2.id), Number(p3.id)) + 1);
          // Un envío de antes del respaldo, repetido en la restaurada, sigue contestando con lo que dejó.
          const repetido = antes.envios.find((x) => x.clase === "precio" && x.contenido.accion === "quitar")!;
          assert.equal((await una(appRestaurada, "SELECT * FROM quitar_precio_especial($1, $2, $3, $4, $5)", [repetido.id, quitado.cuenta, quitado.linea, p3.id, e.mostrador])).anterior_id, p3.id);
        } finally {
          await restaurada.end();
          await appRestaurada.end();
        }
      });
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));
