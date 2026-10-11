import assert from "node:assert/strict";
import { test } from "node:test";
import { compraDe, conBase, escenario, existencia, rechaza, una } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import type pg from "pg";

// Para estas pruebas el lote mezclado se compra como fierro lámina y se separa en fierro pesado y cartón.
const separar = (db: pg.Client, e: Escenario, origenKg: number, productos: Array<{ material: number | null; kg: number | null }>) =>
  una(db, "SELECT * FROM registrar_transformacion($1, $2, $3::jsonb, 'Separación de lote', $4)", [
    e.mat["Fierro lámina"], origenKg, JSON.stringify(productos), e.mostrador,
  ]);
const nada = async (db: pg.Client) => {
  assert.equal((await una(db, "SELECT count(*)::int AS n FROM transformacion")).n, 0);
  assert.equal((await una(db, "SELECT count(*)::int AS n FROM movimiento_inventario WHERE tipo = 'transformacion'")).n, 0);
};

test("separar un lote mezclado baja el origen y sube cada producto", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await separar(db, e, 100, [{ material: e.mat["Fierro pesado"], kg: 60 }, { material: e.mat["Cartón"], kg: 35 }]);
    assert.equal(await existencia(db, e.mat["Fierro lámina"]), 0);
    assert.equal(await existencia(db, e.mat["Fierro pesado"]), 60);
    assert.equal(await existencia(db, e.mat["Cartón"]), 35);
  }));

test("la merma de una separación no se dicta: es lo que entró menos lo que salió", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    const t = await separar(db, e, 100, [{ material: e.mat["Fierro pesado"], kg: 60 }, { material: e.mat["Cartón"], kg: 35 }]);
    assert.equal(t.merma_kg, "5.000");
    const libro = await una(db, "SELECT sum(cantidad_kg) AS neto FROM movimiento_inventario WHERE transformacion_id = $1", [t.id]);
    assert.equal(libro.neto, "-5.000", "el libro pierde exactamente la merma declarada");
  }));

test("se puede separar solo una parte del material de origen", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await separar(db, e, 40, [{ material: e.mat["Fierro pesado"], kg: 40 }]);
    assert.equal(await existencia(db, e.mat["Fierro lámina"]), 60);
    assert.equal(await existencia(db, e.mat["Fierro pesado"]), 40);
  }));

test("no se separa más de lo que hay del material de origen, y no queda nada a medias", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 50);
    await rechaza(separar(db, e, 80, [{ material: e.mat["Fierro pesado"], kg: 80 }]), "RC002");
    await nada(db);
    assert.equal(await existencia(db, e.mat["Fierro pesado"]), 0);
  }));

test("los productos no pueden pesar más que el material del que salieron", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await rechaza(separar(db, e, 100, [{ material: e.mat["Fierro pesado"], kg: 70 }, { material: e.mat["Cartón"], kg: 31 }]), "RC007");
    await nada(db);
  }));

test("una separación necesita al menos un producto", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await rechaza(separar(db, e, 100, []), "RC007");
  }));

test("un producto con cero kilos, con kilos negativos o sin material se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await rechaza(separar(db, e, 100, [{ material: e.mat["Cartón"], kg: 0 }]), "RC007");
    await rechaza(separar(db, e, 100, [{ material: e.mat["Cartón"], kg: 120 }, { material: e.mat["PET"], kg: -20 }]), "RC007");
    await rechaza(separar(db, e, 100, [{ material: null, kg: 10 }]), "RC007");
    await rechaza(separar(db, e, 100, [{ material: e.mat["Cartón"], kg: null }]), "RC007");
    await nada(db);
  }));

test("el material de origen no puede ser a la vez uno de los productos", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await rechaza(separar(db, e, 100, [{ material: e.mat["Fierro lámina"], kg: 50 }]), "RC007");
  }));

test("la conservación se comprueba sobre los gramos que de verdad se guardan", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    // Dos productos de medio gramo suman un gramo en papel, pero guardados a gramos son dos.
    await rechaza(separar(db, e, 0.001, [{ material: e.mat["Cartón"], kg: 0.0005 }, { material: e.mat["PET"], kg: 0.0005 }]), "RC007");
    await nada(db);
  }));

test("un producto de un material que no existe tumba la separación completa", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await rechaza(separar(db, e, 100, [{ material: e.mat["Cartón"], kg: 40 }, { material: 987654, kg: 40 }]), "23503");
    await nada(db);
    assert.equal(await existencia(db, e.mat["Fierro lámina"]), 100);
  }));

test("quien solo consulta no separa material", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    await rechaza(
      db.query("SELECT registrar_transformacion($1, 10, $2::jsonb, NULL, $3)", [
        e.mat["Fierro lámina"], JSON.stringify([{ material: e.mat["Cartón"], kg: 10 }]), e.consulta,
      ]),
      "RC008",
    );
  }));
