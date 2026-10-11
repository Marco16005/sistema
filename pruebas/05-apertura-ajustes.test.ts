import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compraDe, conBase, conectar, confirmar, cuenta, desenlace, escenario, esperarQueEspere, existencia, pidDe, rechaza,
  renglon, una, usuario,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import type pg from "pg";

const apertura = (db: pg.Client, e: Escenario, materialId: number, kg: number, origen: string, quien = e.responsable) =>
  una(db, "SELECT * FROM registrar_apertura($1, $2, $3, $4)", [materialId, kg, origen, quien]);
const conteo = (db: pg.Client, e: Escenario, materialId: number, contado: number, cuando: string | null = null) =>
  una(db, "SELECT registrar_conteo($1, $2, $3, $4, NULL, coalesce($5::timestamptz, now())) AS diferencia", [
    materialId, contado, e.responsable, e.mostrador, cuando,
  ]);
const movimientoDe = async (db: pg.Client, op: string) =>
  una(db, "SELECT mv.* FROM movimiento_inventario mv JOIN operacion_linea l ON l.id = mv.linea_id WHERE l.operacion_id = $1", [op]);
async function ventaDe(db: pg.Client, e: Escenario, materialId: number, kg: number): Promise<string> {
  const op = await cuenta(db, e, "venta");
  await renglon(db, e, op, materialId, kg);
  await confirmar(db, op, e.mostrador);
  return op;
}

// ── el saldo con que se arranca ────────────────────────────────────────────

test("la apertura carga existencia y guarda si el saldo fue contado o estimado", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const m = await apertura(db, e, e.mat["Cartón"], 10000, "estimado");
    assert.equal(m.tipo, "apertura");
    assert.equal(m.origen_saldo, "estimado");
    assert.equal(await existencia(db, e.mat["Cartón"]), 10000);
    assert.equal((await apertura(db, e, e.mat["PET"], 298.4, "contado")).origen_saldo, "contado");
  }));

test("la apertura declara su origen: no hay saldo inicial sin decir de dónde salió", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(apertura(db, e, e.mat["Cartón"], 100, "a ojo"), "23514");
  }));

test("solo un responsable carga el saldo inicial", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(apertura(db, e, e.mat["Cartón"], 100, "contado", e.mostrador), "RC008");
  }));

test("cerrado el corte de arranque, ya no se carga saldo inicial", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 100, "contado");
    await db.query("SELECT cerrar_corte(1::smallint, $1)", [e.responsable]);
    await rechaza(apertura(db, e, e.mat["PET"], 50, "contado"), "RC003");
    assert.equal(await existencia(db, e.mat["PET"]), 0);
  }));

test("el corte de arranque no se cierra dos veces", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("SELECT cerrar_corte(1::smallint, $1)", [e.responsable]);
    await rechaza(db.query("SELECT cerrar_corte(1::smallint, $1)", [e.responsable]), "RC003");
  }));

test("el corte de arranque, una vez cerrado, no se reabre", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("SELECT cerrar_corte(1::smallint, $1)", [e.responsable]);
    await rechaza(db.query("UPDATE sucursal SET corte_cerrado_en = NULL, corte_cerrado_por = NULL WHERE id = 1"), "RC001");
  }));

test("quien carga saldo inicial mientras se cierra el corte espera, y su carga tardía se rechaza", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await db.query("SELECT cerrar_corte(1::smallint, $1)", [e.responsable]);
      const carga = desenlace(otra.query("SELECT registrar_apertura($1, 100, 'contado', $2)", [e.mat["Cartón"], e.responsable]));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await carga, "RC003");
    } finally {
      await otra.end();
    }
    assert.equal(await existencia(db, e.mat["Cartón"]), 0);
  }));

// ── arrancar en cero ───────────────────────────────────────────────────────

test("sin existencia registrada, la venta se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 10);
    await rechaza(confirmar(db, venta, e.mostrador), "RC002");
  }));

test("arrancando en cero, lo que se compra después ya se puede vender", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 30);
    await ventaDe(db, e, e.mat["Cartón"], 10);
    assert.equal(await existencia(db, e.mat["Cartón"]), 20);
  }));

test("arrancando en cero, un conteo autorizado del material que ya estaba en el patio permite venderlo", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await conteo(db, e, e.mat["Cartón"], 500);
    await ventaDe(db, e, e.mat["Cartón"], 10);
    assert.equal(await existencia(db, e.mat["Cartón"]), 490);
  }));

// ── el conteo físico ───────────────────────────────────────────────────────

test("el conteo recibe lo que se contó y asienta la diferencia contra lo registrado", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 80);
    const f = await conteo(db, e, e.mat["Cartón"], 100);
    assert.equal(f.diferencia, "20.000");
    assert.equal(await existencia(db, e.mat["Cartón"]), 100);
    const mov = await una(db, "SELECT tipo, cantidad_kg, autorizado_por, motivo FROM movimiento_inventario WHERE tipo = 'ajuste'");
    assert.equal(mov.cantidad_kg, "20.000");
    assert.equal(mov.autorizado_por, e.responsable);
    assert.match(mov.motivo, /80\.000.*100\.000/);
  }));

test("el primer conteo absorbe el error de una apertura estimada y deja medido de cuánto era", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 10000, "estimado");
    const f = await conteo(db, e, e.mat["Cartón"], 8500);
    assert.equal(f.diferencia, "-1500.000");
    assert.equal(await existencia(db, e.mat["Cartón"]), 8500);
    const inicial = await una(db, "SELECT cantidad_kg, origen_saldo FROM movimiento_inventario WHERE tipo = 'apertura'");
    assert.deepEqual(inicial, { cantidad_kg: "10000.000", origen_saldo: "estimado" }, "la apertura queda como se declaró");
  }));

test("un conteo que coincide con lo registrado no mueve nada, pero queda anotado", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 80);
    assert.equal((await conteo(db, e, e.mat["Cartón"], 80)).diferencia, "0.000");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM movimiento_inventario WHERE tipo = 'ajuste'")).n, 0);
    const nota = await una(db, "SELECT detalle FROM bitacora WHERE accion = 'conteo'");
    assert.equal(nota.detalle.contado, 80);
  }));

test("una venta hecha después de contar no se pierde al registrar el conteo", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 80);
    const alContar = (await una(db, "SELECT clock_timestamp()::text AS t")).t;   // se contaron 100 en este momento
    await ventaDe(db, e, e.mat["Cartón"], 10);                                            // y antes de capturarlo se vendieron 10
    const f = await conteo(db, e, e.mat["Cartón"], 100, alContar);
    assert.equal(f.diferencia, "20.000", "la diferencia se mide contra lo que el libro decía al momento de contar");
    assert.equal(await existencia(db, e.mat["Cartón"]), 90);
  }));

test("una salida registrada después de contar no pasa por anterior al conteo, aunque su transacción hubiera empezado antes", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const otra = await conectar(base);
    try {
      await otra.query("BEGIN");
      await otra.query("SELECT 1");                                                        // la transacción ya empezó
      const alContar = (await una(db, "SELECT clock_timestamp()::text AS t")).t;   // se cuentan 100 kg
      await otra.query("SELECT registrar_merma($1, 10, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]);
      await otra.query("COMMIT");                                                          // la merma se registra después de contar
    const f = await conteo(db, e, e.mat["Cartón"], 100, alContar);
      assert.equal(f.diferencia, "0.000", "al contar, el libro decía 100: no hay diferencia que asentar");
    } finally {
      await otra.end();
    }
    assert.equal(await existencia(db, e.mat["Cartón"]), 90, "la merma posterior al conteo se conserva");
  }));

const ahoraEnLaBase = async (db: pg.Client): Promise<string> => (await una(db, "SELECT clock_timestamp()::text AS t")).t;

test("dos capturas del mismo conteo no cuentan dos veces la diferencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 100, "contado");
    const alContar = await ahoraEnLaBase(db);                       // se contaron 110
    assert.equal((await conteo(db, e, e.mat["Cartón"], 110, alContar)).diferencia, "10.000");
    assert.equal((await conteo(db, e, e.mat["Cartón"], 110, alContar)).diferencia, "0.000");
    assert.equal(await existencia(db, e.mat["Cartón"]), 110);
  }));

test("dos cajas capturando el mismo conteo a la vez tampoco lo cuentan dos veces", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 100, "contado");
    const alContar = await ahoraEnLaBase(db);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await conteo(db, e, e.mat["Cartón"], 110, alContar);
      const segundo = otra.query("SELECT registrar_conteo($1, 110, $2, $3, NULL, $4::timestamptz) AS diferencia", [
        e.mat["Cartón"], e.responsable, e.mostrador, alContar,
      ]);
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal((await segundo).rows[0].diferencia, "0.000");
    } finally {
      await otra.end();
    }
    assert.equal(await existencia(db, e.mat["Cartón"]), 110);
  }));

test("dos conteos de momentos distintos, capturados después, corrigen una sola vez", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 100, "contado");
    const primero = await ahoraEnLaBase(db);
    const segundo = await ahoraEnLaBase(db);
    assert.equal((await conteo(db, e, e.mat["Cartón"], 110, primero)).diferencia, "10.000");
    assert.equal((await conteo(db, e, e.mat["Cartón"], 110, segundo)).diferencia, "0.000");
    assert.equal(await existencia(db, e.mat["Cartón"]), 110);
  }));

test("un conteo más viejo que otro ya capturado del mismo material se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 100, "contado");
    const viejo = await ahoraEnLaBase(db);
    const reciente = await ahoraEnLaBase(db);
    await conteo(db, e, e.mat["Cartón"], 110, reciente);
    await rechaza(conteo(db, e, e.mat["Cartón"], 110, viejo), "RC005");
    assert.equal(await existencia(db, e.mat["Cartón"]), 110);
  }));

for (const [caso, cuando] of [
  ["con fecha futura", "2099-01-01"],
  ["de antes de abrir la jornada", "1900-01-01"],
] as const) {
  test(`un conteo ${caso} se rechaza`, () =>
    conBase(async (db) => {
      const e = await escenario(db);
      await apertura(db, e, e.mat["Cartón"], 100, "contado");
      await db.query("SELECT registrar_merma($1, 10, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]);
      await rechaza(conteo(db, e, e.mat["Cartón"], 100, cuando), "RC005");
      assert.equal(await existencia(db, e.mat["Cartón"]), 90);
    }));
}

test("un conteo sin momento se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 100, "contado");
    await rechaza(
      db.query("SELECT registrar_conteo($1, 100, $2, $3, NULL, NULL)", [e.mat["Cartón"], e.responsable, e.mostrador]),
      "RC005",
    );
    assert.equal(await existencia(db, e.mat["Cartón"]), 100);
  }));

test("cada conteo queda como registro propio: lo contado, lo que decía el libro y la diferencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await apertura(db, e, e.mat["Cartón"], 10000, "estimado");
    await conteo(db, e, e.mat["Cartón"], 8500);
    await conteo(db, e, e.mat["Cartón"], 8500);
    const r = await db.query("SELECT contado_kg, registrado_kg, diferencia_kg, movimiento_id IS NOT NULL AS con_ajuste FROM conteo ORDER BY id");
    assert.deepEqual(r.rows, [
      { contado_kg: "8500.000", registrado_kg: "10000.000", diferencia_kg: "-1500.000", con_ajuste: true },
      { contado_kg: "8500.000", registrado_kg: "8500.000", diferencia_kg: "0.000", con_ajuste: false },
    ]);
    await rechaza(db.query("UPDATE conteo SET contado_kg = 1"), "RC001");
  }));

test("un conteo lo autoriza una persona facultada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(
      db.query("SELECT registrar_conteo($1, 100, $2, $2)", [e.mat["Cartón"], e.mostrador]),
      "RC008",
    );
  }));

// Las correcciones de lo ya asentado se prueban en 18-inventario, con la entrada que las hace
// (corregir_movimiento): decir cómo debió quedar el movimiento, en vez de sumarle una cantidad suelta.

// ── merma ──────────────────────────────────────────────────────────────────

test("la merma baja la existencia y queda como movimiento propio", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    await db.query("SELECT registrar_merma($1, 4, 'Cartón mojado que se tiró', $2)", [e.mat["Cartón"], e.mostrador]);
    assert.equal(await existencia(db, e.mat["Cartón"]), 96);
    assert.equal((await una(db, "SELECT cantidad_kg FROM movimiento_inventario WHERE tipo = 'merma'")).cantidad_kg, "-4.000");
  }));

test("la merma exige motivo y no puede rebasar la existencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("SELECT registrar_merma($1, 4, '', $2)", [e.mat["Cartón"], e.mostrador]), "23514");
    await rechaza(db.query("SELECT registrar_merma($1, 11, 'Se tiró', $2)", [e.mat["Cartón"], e.mostrador]), "RC002");
  }));
