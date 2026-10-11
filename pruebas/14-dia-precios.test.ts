// El día visto desde el servidor: en qué va, el saldo inicial, abrir la jornada, los precios y el
// catálogo que ve el mostrador. Todo con las credenciales de la aplicación.
import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import {
  abrirCuenta, agregarMaterial, comoApp, conBase, contar, desenlace, esperarQueEspere, existencia, material, pidDe, una, urlApp, usuario,
} from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { catalogo } from "../src/servidor/dominio/catalogo.ts";
import { abrirJornada, estadoDelDia, saldoInicial, terminarArranque } from "../src/servidor/dominio/dia.ts";
import { guardarPrecios, listaDelDia, publicarLista } from "../src/servidor/dominio/precios.ts";
import { ErrorDeNegocio } from "../src/servidor/errores.ts";

interface Gente {
  servando: string;
  luis: string;
  beto: string;
  ana: string;
}

const conDia = (prueba: (bd: Bd, db: pg.Client, g: Gente) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 3 });
    try {
      await prueba(bd, db, {
        servando: await usuario(db, "Servando", "responsable", true),
        luis: await usuario(db, "Luis", "mostrador"),
        beto: await usuario(db, "Beto", "patio"),
        ana: await usuario(db, "Ana", "consulta"),
      });
    } finally {
      await bd.cerrar();
    }
  });

const rechazaCon = (promesa: Promise<unknown>, codigo: string) =>
  assert.rejects(promesa, (e: unknown) => {
    assert.ok(e instanceof ErrorDeNegocio, `se esperaba ${codigo} y llegó ${e}`);
    assert.equal(e.codigo, codigo, e.message);
    return true;
  });

const hoyDe = async (db: pg.Client): Promise<string> =>
  (await una(db, "SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS hoy")).hoy;

/** Un día anterior ya cerrado, con su lista publicada: Cartón a 2.10 / 2.50 y PET a 7.50 / 8.90. */
async function ayerCerrado(db: pg.Client, g: Gente): Promise<void> {
  const j = await una(db, "SELECT * FROM abrir_jornada(1::smallint, (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date - 1, $1)", [g.servando]);
  await db.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [await material(db, "Cartón"), g.servando]);
  await db.query("SELECT fijar_precio($1, 7.5, 8.9, $2)", [await material(db, "PET"), g.servando]);
  await db.query("SELECT publicar_lista((SELECT id FROM lista_precios WHERE jornada_id = $1), $2)", [j.id, g.servando]);
  await db.query("SELECT cerrar_jornada($1, $2)", [j.id, g.servando]);
}

/** El día de hoy listo para trabajar: jornada abierta y lista publicada con Cartón y PET. */
async function hoyListo(bd: Bd, db: pg.Client, g: Gente): Promise<void> {
  await abrirJornada(bd, g.luis);
  await guardarPrecios(bd, g.servando, [
    { material: await material(db, "Cartón"), compra: "2.1", venta: "2.5" },
    { material: await material(db, "PET"), compra: "7.5", venta: "8.9" },
  ]);
  await publicarLista(bd, g.servando);
}

const materialDe = (familias: Array<{ materiales: Array<Record<string, any>> }>, nombre: string) =>
  familias.flatMap((f) => f.materiales).find((m) => m.nombre === nombre);

// ── en qué va el día ───────────────────────────────────────────────────────

test("en una base nueva el día dice todo lo que falta", () =>
  conDia(async (bd, db) => {
    assert.deepEqual(await estadoDelDia(bd), {
      hoy: await hoyDe(db),
      arranqueTerminado: false,
      jornada: null,
      cerradaHoy: null,
      lista: null,
      vehiculosPorVolver: 0,
      listo: false,
    });
  }));

test("el día avanza: jornada abierta, precios por publicar, listo", () =>
  conDia(async (bd, db, g) => {
    const hoy = await hoyDe(db);
    await terminarArranque(bd, g.servando, []);
    assert.equal((await estadoDelDia(bd)).arranqueTerminado, true);

    await abrirJornada(bd, g.luis);
    let d = await estadoDelDia(bd);
    assert.equal(d.jornada?.fecha, hoy);
    assert.equal(d.jornada?.esDeHoy, true);
    assert.deepEqual({ publicada: d.lista?.publicada, precios: d.lista?.precios }, { publicada: false, precios: 0 });
    assert.equal(d.listo, false);

    await guardarPrecios(bd, g.servando, [{ material: await material(db, "Cartón"), compra: "2.1", venta: "2.5" }]);
    d = await estadoDelDia(bd);
    assert.deepEqual({ publicada: d.lista?.publicada, precios: d.lista?.precios }, { publicada: false, precios: 1 });

    await publicarLista(bd, g.servando);
    d = await estadoDelDia(bd);
    assert.equal(d.lista?.publicada, true);
    assert.equal(d.listo, true);
  }));

test("una jornada de otro día que sigue abierta se nota", () =>
  conDia(async (bd, db, g) => {
    await db.query("SELECT abrir_jornada(1::smallint, (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date - 1, $1)", [g.servando]);
    const d = await estadoDelDia(bd);
    assert.equal(d.jornada?.esDeHoy, false);
    assert.notEqual(d.jornada?.fecha, d.hoy);
    await rechazaCon(abrirJornada(bd, g.luis), "RC006");
  }));

test("el día cuenta los vehículos que quedaron de jornadas cerradas", () =>
  conDia(async (bd, db, g) => {
    await hoyListo(bd, db, g);
    const op = (await abrirCuenta(db, "compra", g.luis)).id;
    await agregarMaterial(db, op, await material(db, "Cartón"), "5200", g.luis, { bascula: 1 });
    assert.equal((await estadoDelDia(bd)).vehiculosPorVolver, 0);
    await db.query("SELECT cerrar_jornada((SELECT id FROM jornada WHERE cerrada_en IS NULL), $1)", [g.luis]);
    const d = await estadoDelDia(bd);
    assert.equal(d.vehiculosPorVolver, 1);
    assert.equal(d.jornada, null);
    assert.equal(d.listo, false);
  }));

// ── el saldo inicial ───────────────────────────────────────────────────────

test("terminar el arranque carga lo que hay en el patio, con su origen, y lo cierra", () =>
  conDia(async (bd, db, g) => {
    const carton = await material(db, "Cartón");
    const pet = await material(db, "PET");
    await terminarArranque(bd, g.servando, [
      { material: carton, kg: "10000", origen: "estimado" },
      { material: pet, kg: "350.5", origen: "contado" },
    ]);
    assert.equal(await existencia(db, carton), 10000);
    assert.equal(await existencia(db, pet), 350.5);
    const origenes = (await db.query("SELECT material_id, origen_saldo, creado_por FROM movimiento_inventario WHERE tipo = 'apertura' ORDER BY material_id")).rows;
    assert.deepEqual(origenes, [
      { material_id: Math.min(carton, pet), origen_saldo: carton < pet ? "estimado" : "contado", creado_por: g.servando },
      { material_id: Math.max(carton, pet), origen_saldo: carton < pet ? "contado" : "estimado", creado_por: g.servando },
    ]);
    assert.ok((await una(db, "SELECT corte_cerrado_en FROM sucursal WHERE id = 1")).corte_cerrado_en);
  }));

test("terminar el arranque dos veces no carga dos veces", () =>
  conDia(async (bd, db, g) => {
    const carton = await material(db, "Cartón");
    const saldos = [{ material: carton, kg: "10000", origen: "estimado" as const }];
    await terminarArranque(bd, g.servando, saldos);
    await rechazaCon(terminarArranque(bd, g.servando, saldos), "RC003");
    assert.equal(await existencia(db, carton), 10000);
    assert.equal(await contar(db, "movimiento_inventario"), 1);
  }));

test("dos arranques a la vez dejan uno solo", () =>
  conBase(async (db, base) => {
    const servando = await usuario(db, "Servando", "responsable", true);
    const carton = await material(db, "Cartón");
    const [una_, otra] = [await comoApp(base), await comoApp(base)];
    try {
      const saldos = JSON.stringify([{ material: carton, kg: "10000", origen: "estimado" }]);
      const pid = await pidDe(otra);
      await una_.query("BEGIN");
      await una_.query("SELECT terminar_arranque($1::jsonb, $2)", [saldos, servando]);
      const segundo = desenlace(otra.query("SELECT terminar_arranque($1::jsonb, $2)", [saldos, servando]));
      await esperarQueEspere(db, pid);
      await una_.query("COMMIT");
      assert.equal(await segundo, "RC003");
      assert.equal(await existencia(db, carton), 10000);
      assert.equal(await contar(db, "movimiento_inventario"), 1);
    } finally {
      await Promise.all([una_.end(), otra.end()]);
    }
  }));

test("se puede arrancar en ceros", () =>
  conDia(async (bd, db, g) => {
    await terminarArranque(bd, g.servando, []);
    assert.equal(await contar(db, "movimiento_inventario"), 0);
    assert.ok((await una(db, "SELECT corte_cerrado_en FROM sucursal WHERE id = 1")).corte_cerrado_en);
  }));

test("un saldo mal dado no carga nada ni cierra el arranque", () =>
  conDia(async (bd, db, g) => {
    const carton = await material(db, "Cartón");
    const pet = await material(db, "PET");
    const bueno = { material: carton, kg: "100", origen: "contado" as const };
    const malos: Array<[unknown, string]> = [
      [[bueno, { material: pet, kg: "0", origen: "contado" }], "RC004"],
      [[bueno, { material: pet, kg: "1.0005", origen: "contado" }], "RC004"],
      [[bueno, { material: pet, kg: "-3", origen: "contado" }], "RC004"],
      [[bueno, { material: pet, kg: "1000000000", origen: "contado" }], "RC004"],
      [[bueno, { material: pet, kg: "Infinity", origen: "contado" }], "RC004"],
      [[bueno, { material: pet, kg: "10", origen: "adivinado" }], "RC005"],
      [[bueno, { material: 999999, kg: "10", origen: "contado" }], "RC005"],
      [[bueno, { material: carton, kg: "10", origen: "estimado" }], "RC005"], // el mismo material dos veces
      [[bueno, { kg: "10", origen: "contado" }], "RC005"],
    ];
    for (const [saldos, codigo] of malos) {
      await rechazaCon(terminarArranque(bd, g.servando, saldos as any), codigo);
    }
    assert.equal(await contar(db, "movimiento_inventario"), 0);
    assert.equal((await una(db, "SELECT corte_cerrado_en FROM sucursal WHERE id = 1")).corte_cerrado_en, null);
  }));

test("el arranque lo termina un responsable", () =>
  conDia(async (bd, db, g) => {
    for (const quien of [g.luis, g.beto, g.ana]) {
      await rechazaCon(terminarArranque(bd, quien, []), "RC008");
    }
    assert.equal((await una(db, "SELECT corte_cerrado_en FROM sucursal WHERE id = 1")).corte_cerrado_en, null);
  }));

test("la hoja del saldo inicial trae todos los materiales por familia, y después lo que se cargó", () =>
  conDia(async (bd, db, g) => {
    const antes = await saldoInicial(bd);
    assert.equal(antes.terminado, false);
    assert.deepEqual(antes.familias.map((f) => f.nombre), ["Aluminio", "Cobre y bronce", "Fierro", "Otros metales", "Papel", "Plástico"]);
    assert.equal(antes.familias.flatMap((f) => f.materiales).length, 27);
    assert.deepEqual(materialDe(antes.familias, "Cartón"), { id: await material(db, "Cartón"), nombre: "Cartón", nombreCorto: "Cartón", kg: null, origen: null });

    await terminarArranque(bd, g.servando, [{ material: await material(db, "Cartón"), kg: "10000", origen: "estimado" }]);
    const despues = await saldoInicial(bd);
    assert.equal(despues.terminado, true);
    assert.deepEqual(
      { kg: materialDe(despues.familias, "Cartón")?.kg, origen: materialDe(despues.familias, "Cartón")?.origen },
      { kg: "10000.000", origen: "estimado" },
    );
    assert.equal(materialDe(despues.familias, "PET")?.kg, null);
  }));

// ── abrir la jornada ───────────────────────────────────────────────────────

test("el mostrador abre la jornada de hoy, una sola vez", () =>
  conDia(async (bd, db, g) => {
    const j = await abrirJornada(bd, g.luis);
    assert.equal(j.fecha, await hoyDe(db));
    assert.equal((await una(db, "SELECT abierta_por FROM jornada WHERE id = $1", [j.id])).abierta_por, g.luis);
    await rechazaCon(abrirJornada(bd, g.luis), "RC006");
    await rechazaCon(abrirJornada(bd, g.ana), "RC008");
    await rechazaCon(abrirJornada(bd, g.beto), "RC008");
    assert.equal(await contar(db, "jornada"), 1);
  }));

// ── los precios ────────────────────────────────────────────────────────────

test("el primer día la lista sale completa del catálogo y sin precios", () =>
  conDia(async (bd, _db, g) => {
    await abrirJornada(bd, g.luis);
    const l = await listaDelDia(bd);
    assert.deepEqual({ abierta: l.lista?.abierta, publicada: l.lista?.publicada }, { abierta: true, publicada: false });
    assert.equal(l.familias.length, 6);
    const todos = l.familias.flatMap((f) => f.materiales);
    assert.equal(todos.length, 27);
    assert.ok(todos.every((m) => m.compra === null && m.venta === null && m.antes === null));
    assert.deepEqual(l.familias[4]!.materiales.map((m) => m.nombre), ["Cartón", "Archivo"]);
  }));

test("guardar precios cambia solo lo que se manda", () =>
  conDia(async (bd, db, g) => {
    await abrirJornada(bd, g.luis);
    const carton = await material(db, "Cartón");
    const pet = await material(db, "PET");
    await guardarPrecios(bd, g.servando, [
      { material: carton, compra: "2.1", venta: "2.5" },
      { material: pet, compra: "7.5", venta: "8.9" },
    ]);
    await guardarPrecios(bd, g.servando, [{ material: carton, compra: "2.25", venta: "2.6" }]);
    const l = await listaDelDia(bd);
    assert.deepEqual({ compra: materialDe(l.familias, "Cartón")?.compra, venta: materialDe(l.familias, "Cartón")?.venta }, { compra: "2.2500", venta: "2.6000" });
    assert.deepEqual({ compra: materialDe(l.familias, "PET")?.compra, venta: materialDe(l.familias, "PET")?.venta }, { compra: "7.5000", venta: "8.9000" });

    await guardarPrecios(bd, g.servando, [{ material: pet, quitar: true }]);
    assert.equal(materialDe((await listaDelDia(bd)).familias, "PET")?.compra, null);
    assert.equal(await contar(db, "precio"), 1);
  }));

test("si un precio del envío no pasa, no se guarda ninguno", () =>
  conDia(async (bd, db, g) => {
    await abrirJornada(bd, g.luis);
    await rechazaCon(
      guardarPrecios(bd, g.servando, [
        { material: await material(db, "Cartón"), compra: "2.1", venta: "2.5" },
        { material: 999999, compra: "1", venta: "2" },
      ]),
      "RC005",
    );
    assert.equal(await contar(db, "precio"), 0);
  }));

test("los precios los pone y los publica el responsable", () =>
  conDia(async (bd, db, g) => {
    await abrirJornada(bd, g.luis);
    const cambio = [{ material: await material(db, "Cartón"), compra: "2.1", venta: "2.5" }];
    for (const quien of [g.luis, g.beto, g.ana]) {
      await rechazaCon(guardarPrecios(bd, quien, cambio), "RC008");
    }
    await guardarPrecios(bd, g.servando, cambio);
    await rechazaCon(publicarLista(bd, g.luis), "RC008");
    await publicarLista(bd, g.servando);
    assert.ok((await una(db, "SELECT publicada_por FROM lista_precios")).publicada_por === g.servando);
  }));

test("una lista vacía no se publica, y una publicada ya no cambia", () =>
  conDia(async (bd, db, g) => {
    await abrirJornada(bd, g.luis);
    await rechazaCon(publicarLista(bd, g.servando), "RC009");
    const cambio = [{ material: await material(db, "Cartón"), compra: "2.1", venta: "2.5" }];
    await guardarPrecios(bd, g.servando, cambio);
    await publicarLista(bd, g.servando);
    await rechazaCon(guardarPrecios(bd, g.servando, cambio), "RC001");
    await rechazaCon(publicarLista(bd, g.servando), "RC001");
  }));

test("sin jornada abierta no hay dónde guardar ni qué publicar", () =>
  conDia(async (bd, db, g) => {
    await rechazaCon(guardarPrecios(bd, g.servando, [{ material: await material(db, "Cartón"), compra: "2.1", venta: "2.5" }]), "RC006");
    await rechazaCon(publicarLista(bd, g.servando), "RC006");
  }));

test("al día siguiente la lista trae lo último publicado, por publicar, y lo muestra de referencia", () =>
  conDia(async (bd, db, g) => {
    await ayerCerrado(db, g);
    await abrirJornada(bd, g.luis);
    const l = await listaDelDia(bd);
    assert.equal(l.lista?.publicada, false);
    const carton = materialDe(l.familias, "Cartón")!;
    assert.deepEqual({ compra: carton.compra, venta: carton.venta, antes: carton.antes }, {
      compra: "2.1000", venta: "2.5000", antes: { compra: "2.1000", venta: "2.5000" },
    });
    await guardarPrecios(bd, g.servando, [{ material: carton.id, compra: "2.3", venta: "2.7" }]);
    const cambiado = materialDe((await listaDelDia(bd)).familias, "Cartón")!;
    assert.deepEqual({ compra: cambiado.compra, antes: cambiado.antes }, { compra: "2.3000", antes: { compra: "2.1000", venta: "2.5000" } });
    assert.equal(materialDe(l.familias, "Plomo")?.antes, null);
  }));

test("sin jornada abierta se ve la última lista publicada, solo para consultarla", () =>
  conDia(async (bd, db, g) => {
    const vacia = await listaDelDia(bd);
    assert.equal(vacia.lista, null);
    assert.equal(vacia.familias.flatMap((f) => f.materiales).length, 27);

    await ayerCerrado(db, g);
    const l = await listaDelDia(bd);
    assert.deepEqual({ abierta: l.lista?.abierta, publicada: l.lista?.publicada }, { abierta: false, publicada: true });
    assert.equal(materialDe(l.familias, "PET")?.venta, "8.9000");
  }));

// ── el catálogo del mostrador ──────────────────────────────────────────────

test("el catálogo de compra trae cada material con su precio de compra, o sin precio", () =>
  conDia(async (bd, db, g) => {
    await hoyListo(bd, db, g);
    const c = await catalogo(bd, "compra");
    assert.deepEqual(c.familias.map((f) => f.nombre), ["Aluminio", "Cobre y bronce", "Fierro", "Otros metales", "Papel", "Plástico"]);
    assert.deepEqual(materialDe(c.familias, "Cartón"), {
      id: await material(db, "Cartón"), nombre: "Cartón", nombreCorto: "Cartón", frecuente: true, precio: "2.1000", disponible: null,
    });
    assert.equal(materialDe(c.familias, "Plomo")?.precio, null);
    assert.equal(materialDe(c.familias, "Aluminio bote")?.nombreCorto, "Bote");
    assert.deepEqual(c.frecuentes.map((m) => m.nombre), ["Aluminio bote", "Cobre de primera", "Fierro lámina", "Cartón"]);
    assert.deepEqual(c.basculas, [
      { id: 1, nombre: "Báscula 1", doblePesaje: true },
      { id: 2, nombre: "Báscula 2", doblePesaje: false },
      { id: 3, nombre: "Báscula 3", doblePesaje: false },
    ]);
  }));

test("un material dado de baja no aparece en el catálogo", () =>
  conDia(async (bd, db, g) => {
    await hoyListo(bd, db, g);
    await db.query("UPDATE material SET activo = false WHERE nombre = 'PET'");
    const c = await catalogo(bd, "compra");
    assert.equal(materialDe(c.familias, "PET"), undefined);
    assert.equal(c.familias.flatMap((f) => f.materiales).length, 26);
  }));

test("el catálogo de venta trae el precio de venta y lo disponible, descontando lo apartado en ventas abiertas", () =>
  conDia(async (bd, db, g) => {
    const carton = await material(db, "Cartón");
    await terminarArranque(bd, g.servando, [{ material: carton, kg: "500", origen: "contado" }]);
    await hoyListo(bd, db, g);
    let c = await catalogo(bd, "venta");
    assert.deepEqual({ precio: materialDe(c.familias, "Cartón")?.precio, disponible: materialDe(c.familias, "Cartón")?.disponible }, { precio: "2.5000", disponible: "500.000" });
    assert.equal(materialDe(c.familias, "PET")?.disponible, "0.000");

    const op = (await abrirCuenta(db, "venta", g.luis)).id;
    await agregarMaterial(db, op, carton, "120.5", g.luis);
    c = await catalogo(bd, "venta");
    assert.equal(materialDe(c.familias, "Cartón")?.disponible, "379.500");
  }));

test("sin jornada o sin lista publicada el catálogo viene sin precios", () =>
  conDia(async (bd, _db, g) => {
    let c = await catalogo(bd, "compra");
    assert.ok(c.familias.flatMap((f) => f.materiales).every((m) => m.precio === null));
    await abrirJornada(bd, g.luis);
    await guardarPrecios(bd, g.servando, [{ material: c.familias[0]!.materiales[0]!.id, compra: "1", venta: "2" }]);
    c = await catalogo(bd, "compra");
    assert.ok(c.familias.flatMap((f) => f.materiales).every((m) => m.precio === null), "una lista sin publicar todavía no vale");
  }));

test("el catálogo sale de una sola lectura: materiales y básculas son del mismo instante", () =>
  conDia(async (bd, db, g) => {
    await hoyListo(bd, db, g);
    let lecturas = 0;
    const contada: Bd = { ...bd, leer: (sql, valores) => { lecturas += 1; return bd.leer(sql, valores); } };
    const c = await catalogo(contada, "compra");
    assert.equal(lecturas, 1);
    assert.equal(c.basculas.length, 3);
    assert.equal(c.familias.flatMap((f) => f.materiales).length, 27);
  }));
