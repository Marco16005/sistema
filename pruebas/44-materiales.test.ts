// El catálogo que administra el responsable: reglas de base, servidor y puertas de entrada.
import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import {
  abrirCuenta, agregarMaterial, comoApp, conApp, conBase, conectar, contar, cuenta, desenlace, escenario, esperarQueEspere, pidDe, rechaza, renglon, una, urlApp, usuario,
} from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import { catalogo } from "../src/servidor/dominio/catalogo.ts";

const ALTA = "SELECT * FROM alta_material($1::smallint, $2, $3, $4, $5)";
const CAMBIO = "SELECT * FROM cambiar_material($1, $2, $3, $4)";
const alta = (db: pg.Client, quien: string, nombre = "Cobre quemado", corto = "Quemado", familia = 2, frecuente: boolean | null = false) =>
  una(db, ALTA, [familia, nombre, corto, frecuente, quien]);
const cambio = (db: pg.Client, quien: string, id: number, activo: boolean | null, frecuente: boolean | null = null) =>
  una(db, CAMBIO, [id, activo, frecuente, quien]);
const falla = (p: Promise<unknown>, mensaje: string) => assert.rejects(p, (e: unknown) => {
  const error = e as { code: string; message: string };
  assert.equal(error.code, "RC005");
  assert.equal(error.message, mensaje);
  return true;
});

test("base: el alta limpia nombres, nace activa sin precio y anota a quien la hizo", () => conBase(async (db) => {
  const quien = await usuario(db, "Dueño", "responsable");
  const m = await alta(db, quien, "  Cobre   quemado ", "  Quemado   fino  ", 2, true);
  assert.deepEqual([m.nombre, m.nombre_corto, m.familia_id, m.sucursal_id, m.activo, m.frecuente],
    ["Cobre quemado", "Quemado fino", 2, 1, true, true]);
  const b = await una(db, "SELECT * FROM bitacora WHERE entidad = 'material'");
  assert.equal(b.usuario_id, quien);
  assert.equal(b.accion, "insert");
  assert.equal(b.detalle.despues.id, m.id);
  assert.equal((await una(db, "SELECT count(*)::int AS n FROM precio WHERE material_id = $1", [m.id])).n, 0);
  assert.equal((await alta(db, quien, "Cobre nuevo", "Nuevo", 2, null)).frecuente, false);
}));

test("base: rechaza largos, controles, familia inexistente y nombres repetidos activos o de baja", () => conBase(async (db) => {
  const q = await usuario(db, "Dueño", "responsable");
  for (const nombre of ["X", "X".repeat(41), "", "Cobre\nquemado", "Cobre\tquemado", null]) {
    await assert.rejects(alta(db, q, nombre as string), (e: unknown) => {
      const error = e as { code: string; message: string };
      assert.equal(error.code, "RC005");
      assert.match(error.message, /2.*40/);
      return true;
    });
  }
  for (const corto of ["", "X".repeat(25), "A\nB", "A\tB", null]) {
    await assert.rejects(alta(db, q, "Cobre quemado", corto as string), (e: unknown) => {
      const error = e as { code: string; message: string };
      assert.equal(error.code, "RC005");
      assert.match(error.message, /1.*24/);
      return true;
    });
  }
  await falla(alta(db, q, "Cobre quemado", "Quemado", 999), "Esa familia no existe");
  const m = await alta(db, q);
  await falla(alta(db, q, "COBRE QUEMADO"), "Ya hay un material que se llama «Cobre quemado»");
  await cambio(db, q, m.id, false);
  await falla(alta(db, q, "cobre quemado"), "«Cobre quemado» está dado de baja: reactívalo en vez de crear otro");
  await rechaza(cambio(db, q, 999999, false), "RC005");
}));

test("base: solo responsable puede dar de alta o cambiar, antes de validar los datos", () => conBase(async (db) => {
  for (const rol of ["mostrador", "patio", "consulta", "administracion"]) {
    const q = await usuario(db, rol, rol);
    await rechaza(alta(db, q, "X"), "RC008");
    await rechaza(cambio(db, q, 999999, false), "RC008");
  }
}));

test("base: la aplicación llama ambas entradas pero no inserta ni renombra por UPDATE", () => conApp(async (app, db, e) => {
  const m = await alta(app, e.responsable);
  assert.equal((await cambio(app, e.responsable, m.id, false)).activo, false);
  await rechaza(app.query("INSERT INTO material (sucursal_id, familia_id, nombre, nombre_corto) VALUES (1, 2, 'Otro', 'Otro')"), "42501");
  await rechaza(app.query("UPDATE material SET nombre = 'Renombrado' WHERE id = $1", [m.id]), "42501");
  const firma = await una(db, "SELECT proargnames FROM pg_proc WHERE proname = 'cambiar_material'");
  assert.deepEqual(firma.proargnames, ["p_material", "p_activo", "p_frecuente", "p_usuario"]);
}));

test("base: la baja rechaza existencia con kilos y cuentas abiertas incluso vehículos sin volver", () => conBase(async (db) => {
  const e = await escenario(db);
  const carton = e.mat["Cartón"]!;
  await db.query("SELECT registrar_apertura($1, 120, 'contado', $2)", [carton, e.responsable]);
  await falla(cambio(db, e.responsable, carton, false), "Todavía hay 120.000 kg de Cartón en el patio: primero hay que venderlo, darlo de baja del inventario o corregirlo");
  assert.equal((await cambio(db, e.responsable, carton, null, false)).frecuente, false);
  for (const bascula of [2, 1]) {
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["PET"], 10, bascula);
    await falla(cambio(db, e.responsable, e.mat["PET"]!, false), "PET está en una cuenta abierta: termínala o quítalo de ahí primero");
    await db.query("SELECT descartar_cuenta($1, $2)", [op, e.responsable]);
  }
}));

test("base: baja y reactivación cambian el mostrador y conservan la historia; frecuente y no cambios", () => conApp(async (app, db, e, base) => {
  const bd = crearBd(await urlApp(base));
  try {
    const m = await alta(app, e.responsable);
    await cambio(app, e.responsable, m.id, false);
    assert.ok(!(await catalogo(bd, "compra")).familias.flatMap((f) => f.materiales).some((x) => x.id === m.id));
    await cambio(app, e.responsable, m.id, true);
    assert.ok((await catalogo(bd, "compra")).familias.flatMap((f) => f.materiales).some((x) => x.id === m.id));
    assert.equal((await cambio(app, e.responsable, m.id, null, true)).frecuente, true);
    assert.equal((await cambio(app, e.responsable, m.id, null, false)).frecuente, false);
    const antes = await una(db, "SELECT count(*)::int AS n FROM bitacora WHERE entidad = 'material'");
    await cambio(app, e.responsable, m.id, true, false);
    await cambio(app, e.responsable, m.id, null, null);
    assert.deepEqual(await una(db, "SELECT count(*)::int AS n FROM bitacora WHERE entidad = 'material'"), antes);
    assert.equal(antes.n, 5);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM bitacora WHERE entidad = 'material' AND usuario_id = $1", [e.responsable])).n, 5);
  } finally { await bd.cerrar(); }
}));

test("base: dos altas simultáneas dejan una sola y la segunda recibe RC005 con el mismo mensaje", () => conBase(async (db, base) => {
  const q = await usuario(db, "Dueño", "responsable");
  const otro = await conectar(base);
  const vigia = await conectar(base);
  try {
    const pid = await pidDe(otro);
    await db.query("BEGIN");
    await alta(db, q);
    const pendiente = falla(alta(otro, q, "COBRE QUEMADO"), "Ya hay un material que se llama «Cobre quemado»");
    await esperarQueEspere(vigia, pid);
    await db.query("COMMIT");
    await pendiente;
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM material WHERE lower(nombre) = 'cobre quemado'")).n, 1);
  } finally { await db.query("ROLLBACK"); await otro.end(); await vigia.end(); }
}));

test("base: dos cambios esperan al material y conservan ambos campos", () => conBase(async (db, base) => {
  const q = await usuario(db, "Dueño", "responsable");
  const m = await alta(db, q);
  const otro = await conectar(base);
  const vigia = await conectar(base);
  try {
    const pid = await pidDe(otro);
    await db.query("BEGIN");
    await cambio(db, q, m.id, false);
    const pendiente = cambio(otro, q, m.id, null, true);
    await esperarQueEspere(vigia, pid);
    await db.query("COMMIT");
    const queda = await pendiente;
    assert.deepEqual([queda.activo, queda.frecuente, queda.nombre], [false, true, m.nombre]);
  } finally { await db.query("ROLLBACK"); await otro.end(); await vigia.end(); }
}));

test("dominio: trae las seis familias y todo el catálogo ordenado, también bajas, sin jornada", () => conBase(async (db, base) => {
  const { materialesDelCatalogo } = await import("../src/servidor/dominio/materiales.ts");
  const q = await usuario(db, "Dueño", "responsable");
  const z = await alta(db, q, "zinc fino", "Fino", 4);
  const a = await alta(db, q, "Acero nuevo", "Nuevo", 4);
  await cambio(db, q, a.id, false);
  const bd = crearBd(await urlApp(base));
  try {
    const r = await materialesDelCatalogo(bd);
    assert.deepEqual(r.familias, [
      { id: 1, nombre: "Aluminio" }, { id: 2, nombre: "Cobre y bronce" }, { id: 3, nombre: "Fierro" },
      { id: 4, nombre: "Otros metales" }, { id: 5, nombre: "Papel" }, { id: 6, nombre: "Plástico" },
    ]);
    const orden = (await db.query("SELECT m.id FROM material m JOIN familia f ON f.id = m.familia_id ORDER BY f.orden, lower(m.nombre)")).rows;
    assert.deepEqual(r.materiales.map((m) => m.id), orden.map((m) => m.id));
    assert.deepEqual(r.materiales.find((m) => m.id === a.id), {
      id: a.id, nombre: "Acero nuevo", nombreCorto: "Nuevo", familia: "Otros metales", familiaId: 4,
      frecuente: false, activo: false, existencia: "0.000", enCuentasAbiertas: 0, conPrecioHoy: false,
    });
    assert.equal(r.materiales.find((m) => m.id === z.id)?.activo, true);
    assert.ok(r.materiales.every((m) => !m.conPrecioHoy));
  } finally { await bd.cerrar(); }
}));

test("dominio: existencia exacta, cuentas distintas con vehículo pendiente y precio solo de jornada abierta", () => conApp(async (_app, db, e, base) => {
  const { materialesDelCatalogo } = await import("../src/servidor/dominio/materiales.ts");
  const carton = e.mat["Cartón"]!;
  await db.query("SELECT registrar_apertura($1, 120.125, 'contado', $2)", [carton, e.responsable]);
  const chica = await cuenta(db, e, "compra");
  await renglon(db, e, chica, carton, 10);
  await renglon(db, e, chica, carton, 20);
  const grande = await cuenta(db, e, "compra");
  await renglon(db, e, grande, carton, 500, 1);
  const bd = crearBd(await urlApp(base));
  try {
    const ver = async () => (await materialesDelCatalogo(bd)).materiales.find((m) => m.id === carton)!;
    assert.deepEqual([ (await ver()).existencia, (await ver()).enCuentasAbiertas, (await ver()).conPrecioHoy ], ["120.125", 2, true]);
    await db.query("SELECT descartar_cuenta($1, $2)", [chica, e.responsable]);
    await db.query("SELECT cerrar_jornada($1, $2)", [e.jornada, e.responsable]);
    assert.deepEqual([(await ver()).enCuentasAbiertas, (await ver()).conPrecioHoy], [1, false]);
    await db.query("SELECT abrir_jornada(1::smallint, '2026-10-02'::date, $1)", [e.responsable]);
    assert.equal((await una(db, "SELECT publicada_en FROM lista_precios ORDER BY id DESC LIMIT 1")).publicada_en, null);
    assert.equal((await ver()).conPrecioHoy, true, "también cuenta la lista sin publicar");
    await db.query("SELECT quitar_precio($1, $2)", [carton, e.responsable]);
    assert.equal((await ver()).conPrecioHoy, false, "el precio de ayer no cuenta");
  } finally { await bd.cerrar(); }
}));

test("dominio: alta y cambios devuelven la misma forma que la lista y conservan nombre y familia", () => conApp(async (_app, _db, e, base) => {
  const { altaDeMaterial, cambiarMaterial, materialesDelCatalogo } = await import("../src/servidor/dominio/materiales.ts");
  const bd = crearBd(await urlApp(base));
  try {
    const m = await altaDeMaterial(bd, e.responsable, { familia: 2, nombre: " Cobre   quemado ", nombreCorto: " Quemado ", frecuente: true });
    assert.deepEqual(m, {
      id: m.id, nombre: "Cobre quemado", nombreCorto: "Quemado", familia: "Cobre y bronce", familiaId: 2,
      frecuente: true, activo: true, existencia: "0.000", enCuentasAbiertas: 0, conPrecioHoy: false,
    });
    const baja = await cambiarMaterial(bd, e.responsable, m.id, { activo: false, frecuente: false });
    assert.deepEqual(baja, { ...m, activo: false, frecuente: false });
    assert.deepEqual((await materialesDelCatalogo(bd)).materiales.find((x) => x.id === m.id), baja);
    assert.deepEqual(await cambiarMaterial(bd, e.responsable, m.id, { activo: null, frecuente: null }), baja);
    assert.deepEqual(await cambiarMaterial(bd, e.responsable, m.id, { activo: true, frecuente: null }), { ...baja, activo: true });
  } finally { await bd.cerrar(); }
}));

// Estas rutas se cargan por camino: no hay que cambiar el registro de rutas del proyecto.
const ALTA_CUERPO = { familia: 2, nombre: "Cobre quemado", nombreCorto: "Quemado", frecuente: false };

test("rutas: responsable lee, da de alta, cambia y reactiva; omitir campos los conserva y no renombra", async () => {
  const { conMundo, ruta } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const n = await m.adentro("responsable");
    const get = await ruta("materiales", "GET");
    const post = await ruta("materiales", "POST");
    const cambiar = await ruta("materiales/[material]", "POST");
    const inicial = await n.bien(get, "GET", "/api/materiales");
    assert.equal(inicial.familias.length, 6);
    assert.equal(inicial.materiales.length, 27);
    const { material: nuevo } = await n.bien(post, "POST", "/api/materiales", ALTA_CUERPO);
    assert.deepEqual(nuevo, {
      id: nuevo.id, nombre: "Cobre quemado", nombreCorto: "Quemado", familia: "Cobre y bronce", familiaId: 2,
      frecuente: false, activo: true, existencia: "0.000", enCuentasAbiertas: 0, conPrecioHoy: false,
    });
    const par = { parametros: { material: String(nuevo.id) } };
    const pedir = (cuerpo: object) => n.bien(cambiar, "POST", `/api/materiales/${nuevo.id}`, cuerpo, par);
    assert.deepEqual((await pedir({ frecuente: true })).material, { ...nuevo, frecuente: true });
    assert.deepEqual((await pedir({ activo: false })).material, { ...nuevo, frecuente: true, activo: false });
    assert.deepEqual((await pedir({ nombre: "Otro", nombreCorto: "Otro", familia: 1 })).material, { ...nuevo, frecuente: true, activo: false });
    assert.deepEqual((await pedir({ activo: true, frecuente: false })).material, nuevo);
    const antes = await una(m.db, "SELECT count(*)::int AS n FROM bitacora WHERE entidad = 'material'");
    assert.deepEqual((await pedir({})).material, nuevo);
    assert.deepEqual(await una(m.db, "SELECT count(*)::int AS n FROM bitacora WHERE entidad = 'material'"), antes);
    const listado = await n.bien(get, "GET", "/api/materiales");
    assert.deepEqual(listado.materiales.find((x: { id: number }) => x.id === nuevo.id), nuevo);
  });
});

test("rutas: los otros cuatro roles reciben 403 ROL en las tres puertas; sin persona reciben 401", async () => {
  const { conMundo, ruta } = await import("./mundo.ts");
  await conMundo(async (m) => {
    for (const rol of ["consulta", "mostrador", "patio", "administracion", null] as const) {
      const n = rol === null ? await m.equipo() : await m.adentro(rol);
      for (const [camino, metodo, cuerpo] of [
        ["materiales", "GET", undefined], ["materiales", "POST", ALTA_CUERPO],
        ["materiales/[material]", "POST", { activo: false }],
      ] as const) {
        const r = await n.pedir(await ruta(camino, metodo), metodo, "/api/materiales", cuerpo, { parametros: { material: "1" } });
        assert.equal(r.status, rol === null ? 401 : 403, `${rol}: ${camino} ${metodo}`);
        if (rol !== null) assert.equal((await r.json()).error.codigo, "ROL");
      }
    }
  });
});

test("rutas: cuerpos, identificadores y booleanos mal formados son 400 FORMA; reglas de base son 409 con mensaje", async () => {
  const { conMundo, ruta } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const n = await m.adentro("responsable");
    const post = await ruta("materiales", "POST");
    const cambiar = await ruta("materiales/[material]", "POST");
    for (const cuerpo of [[], {}, { ...ALTA_CUERPO, familia: 0 }, { ...ALTA_CUERPO, familia: 32768 },
      { ...ALTA_CUERPO, nombre: 42 }, { ...ALTA_CUERPO, nombreCorto: null },
      { ...ALTA_CUERPO, frecuente: "true" }, { ...ALTA_CUERPO, frecuente: null }]) {
      const r = await n.pedir(post, "POST", "/api/materiales", cuerpo);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    for (const campo of ["activo", "frecuente"]) {
      for (const valor of ["true", 0, null, [], {}]) {
        const r = await n.pedir(cambiar, "POST", "/api/materiales/1", { [campo]: valor }, { parametros: { material: "1" } });
        assert.equal(r.status, 400);
        assert.equal((await r.json()).error.codigo, "FORMA");
      }
    }
    for (const id of ["0", "abc", "2147483648"]) {
      const r = await n.pedir(cambiar, "POST", "/api/materiales/x", {}, { parametros: { material: id } });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    for (const cuerpo of [{ ...ALTA_CUERPO, nombre: "X" }, { ...ALTA_CUERPO, nombre: "X".repeat(41) }]) {
      const r = await n.pedir(post, "POST", "/api/materiales", cuerpo);
      assert.equal(r.status, 409);
      const error = (await r.json()).error;
      assert.equal(error.codigo, "RC005");
      assert.match(error.mensaje, /2.*40/);
    }
    const { material: nuevo } = await n.bien(post, "POST", "/api/materiales", ALTA_CUERPO);
    const repetido = await n.pedir(post, "POST", "/api/materiales", { ...ALTA_CUERPO, nombre: "COBRE QUEMADO" });
    assert.equal(repetido.status, 409);
    assert.deepEqual((await repetido.json()).error, { codigo: "RC005", mensaje: "Ya hay un material que se llama «Cobre quemado»" });
    await m.db.query("SELECT registrar_apertura($1, 120, 'contado', $2)", [nuevo.id, m.personas.responsable]);
    const baja = await n.pedir(cambiar, "POST", `/api/materiales/${nuevo.id}`, { activo: false }, { parametros: { material: String(nuevo.id) } });
    assert.equal(baja.status, 409);
    assert.deepEqual((await baja.json()).error, {
      codigo: "RC005", mensaje: "Todavía hay 120.000 kg de Cobre quemado en el patio: primero hay que venderlo, darlo de baja del inventario o corregirlo",
    });
  });
});

test("bitácora: cuenta baja, reactivación y ambos cambios de frecuente sin exponer el detalle", () => conApp(async (app, _db, e, base) => {
  const { bitacora } = await import("../src/servidor/dominio/bitacora.ts");
  const bd = crearBd(await urlApp(base));
  try {
    const m = await alta(app, e.responsable);
    for (const [activo, frecuente, frase] of [
      [false, null, "dio de baja el material Cobre quemado"],
      [true, null, "reactivó el material Cobre quemado"],
      [null, true, "marcó como frecuente el material Cobre quemado"],
      [null, false, "quitó de frecuentes el material Cobre quemado"],
      [false, true, "dio de baja el material Cobre quemado"],
    ] as const) {
      await cambio(app, e.responsable, m.id, activo, frecuente);
      const r = (await bitacora(bd, { cuantos: 1 })).asientos[0]!;
      assert.equal(r.que, frase);
      assert.equal(r.quien, "Servando");
      assert.deepEqual(Object.keys(r).sort(), ["accion", "entidad", "fecha", "hora", "id", "que", "quien"]);
    }
  } finally { await bd.cerrar(); }
}));

test("base: la baja con saldo cero conserva compras, ventas y movimientos anteriores", () => conApp(async (app, db, e) => {
  const { compraDe, confirmar } = await import("./apoyo.ts");
  const id = e.mat["Cartón"]!;
  const compra = await compraDe(db, e, id, 10);
  const venta = await cuenta(db, e, "venta");
  await renglon(db, e, venta, id, 10);
  await confirmar(db, venta, e.mostrador);
  const historia = async () => ({
    operaciones: (await db.query("SELECT * FROM operacion WHERE id = ANY($1::uuid[]) ORDER BY id", [[compra, venta]])).rows,
    renglones: (await db.query("SELECT * FROM operacion_linea WHERE material_id = $1 ORDER BY id", [id])).rows,
    movimientos: (await db.query("SELECT * FROM movimiento_inventario WHERE material_id = $1 ORDER BY id", [id])).rows,
  });
  const antes = await historia();
  assert.equal(antes.movimientos.length, 2);
  assert.equal((await cambio(app, e.responsable, id, false)).activo, false);
  assert.deepEqual(await historia(), antes);
  assert.equal((await cambio(app, e.responsable, id, true)).activo, true);
  assert.deepEqual(await historia(), antes);
}));

// ── a la vez ───────────────────────────────────────────────────────────────
// Lo señaló la revisión de seguridad del guardado a9777c9: la baja comprobaba que el material no
// estuviera en una cuenta abierta, pero quien lo agregaba en ese mismo instante ya había leído que
// seguía activo, y entraba: quedaba una cuenta abierta con un material dado de baja.

test("a la vez: dar de baja un material mientras alguien lo agrega a una cuenta — quien lo agrega espera a la baja, y ya no entra", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const cuenta = (await abrirCuenta(app, "compra", e.mostrador)).id;
      // La baja, hecha pero sin terminar.
      await otra.query("BEGIN");
      await otra.query("SELECT cambiar_material($1, false, NULL, $2)", [e.mat["PET"], e.responsable]);
      const pid = await pidDe(app);
      const agrega = desenlace(agregarMaterial(app, cuenta, e.mat["PET"]!, "10", e.mostrador));
      await esperarQueEspere(db, pid);
      await otra.query("COMMIT");
      assert.equal(await agrega, "RC005");
      assert.equal(await contar(db, "operacion_linea"), 0);
      assert.equal((await una(db, "SELECT activo FROM material WHERE id = $1", [e.mat["PET"]])).activo, false);
    } finally {
      await otra.end();
    }
  }));

test("a la vez, al revés: el material entra a una cuenta mientras se le da de baja — la baja espera, y al mirar lo encuentra en una cuenta abierta", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const cuenta = (await abrirCuenta(app, "compra", e.mostrador)).id;
      await app.query("BEGIN");
      await agregarMaterial(app, cuenta, e.mat["PET"]!, "10", e.mostrador);
      const pid = await pidDe(otra);
      const baja = desenlace(otra.query("SELECT cambiar_material($1, false, NULL, $2)", [e.mat["PET"], e.responsable]));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await baja, "RC005");
      assert.equal((await una(db, "SELECT activo FROM material WHERE id = $1", [e.mat["PET"]])).activo, true);
      assert.equal(await contar(db, "operacion_linea"), 1);
    } finally {
      await otra.end();
    }
  }));
