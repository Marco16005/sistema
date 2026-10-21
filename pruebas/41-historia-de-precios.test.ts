// La historia compara listas publicadas completas, incluidos los materiales que dejan de tener precio.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { conMundo, ruta } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";
import { abrirJornada, cerrarSinCorte, conBase, escenario, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { historiaDePrecios, PERIODOS_DE_PRECIOS } from "../src/servidor/dominio/historia-de-precios.ts";
import { ErrorDeForma } from "../src/servidor/numeros.ts";

interface Patio { db: pg.Client; bd: Bd; e: Escenario }
const conHistoria = (prueba: (p: Patio) => Promise<void>) => conBase(async (db, base) => {
  const bd = crearBd(await urlApp(base));
  try { await prueba({ db, bd, e: await escenario(db) }); } finally { await bd.cerrar(); }
});

async function siguiente(p: Patio, fecha: string): Promise<string> {
  const j = await una(p.db, "SELECT id, cierres FROM jornada WHERE sucursal_id = 1 AND cerrada_en IS NULL");
  await cerrarSinCorte(p.db, j.id, j.cierres, p.e.responsable);
  return (await abrirJornada(p.db, p.e.responsable, fecha)).lista;
}
const publicar = (p: Patio, lista: string) => p.db.query("SELECT publicar_lista($1, $2)", [lista, p.e.responsable]);
const fijar = (p: Patio, compra: string, venta = "2.50") =>
  p.db.query("SELECT fijar_precio($1, $2, $3, $4)", [p.e.mat["Cartón"], compra, venta, p.e.responsable]);
const quitar = (p: Patio) => p.db.query("SELECT quitar_precio($1, $2)", [p.e.mat["Cartón"], p.e.responsable]);
const inicial = { compra: "2.1000", venta: "2.5000" };
const cambioInicial = { fecha: "2026-10-01", ...inicial };

test("tres listas cuentan tres, pero Cartón solo cambia al aparecer y al subir la compra", () => conHistoria(async (p) => {
  let lista = await siguiente(p, "2026-10-02");
  await fijar(p, "2.20");
  await publicar(p, lista);
  lista = await siguiente(p, "2026-10-03");
  await fijar(p, "2.2000", "2.5000");
  await publicar(p, lista);
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-03" });
  assert.deepEqual([h.desde, h.hasta, h.dias, h.listas], ["2026-09-04", "2026-10-03", 30, 3]);
  const carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.equal(carton.alEmpezar, null);
  assert.deepEqual(carton.ahora, { compra: "2.2000", venta: "2.5000" });
  assert.deepEqual(carton.cambios, [cambioInicial, { fecha: "2026-10-02", compra: "2.2000", venta: "2.5000" }]);
}));

test("alEmpezar toma la última lista anterior y el primer día del periodo sí cuenta", () => conHistoria(async (p) => {
  let lista = await siguiente(p, "2026-11-02");
  await fijar(p, "2.1", "2.75");
  await publicar(p, lista);
  lista = await siguiente(p, "2026-12-02");
  await fijar(p, "9");
  await publicar(p, lista);
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-12-01" });
  assert.equal(h.desde, "2026-11-02");
  assert.equal(h.listas, 1);
  const carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.alEmpezar, inicial);
  assert.deepEqual(carton.ahora, { compra: "2.1000", venta: "2.7500" });
  assert.deepEqual(carton.cambios, [{ fecha: "2026-11-02", compra: "2.1000", venta: "2.7500" }]);
}));

test("quitar un precio produce null; seguir sin precio no cambia y reponerlo sí", () => conHistoria(async (p) => {
  let lista = await siguiente(p, "2026-10-02");
  await quitar(p);
  await publicar(p, lista);
  lista = await siguiente(p, "2026-10-03");
  await publicar(p, lista);
  let h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-03" });
  let carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.equal(carton.ahora, null);
  assert.deepEqual(carton.cambios, [cambioInicial, { fecha: "2026-10-02", compra: null, venta: null }]);
  lista = await siguiente(p, "2026-10-04");
  await fijar(p, "2.1");
  await publicar(p, lista);
  h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-04" });
  carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.ahora, inicial);
  assert.deepEqual(carton.cambios, [cambioInicial, { fecha: "2026-10-02", compra: null, venta: null }, { fecha: "2026-10-04", ...inicial }]);
}));

test("la lista abierta sin publicar no cambia el precio ni el número de listas", () => conHistoria(async (p) => {
  await siguiente(p, "2026-10-02");
  await fijar(p, "99");
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-02" });
  assert.equal(h.listas, 1);
  const carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.ahora, inicial);
  assert.deepEqual(carton.cambios, [cambioInicial]);
}));

test("un día cerrado sin publicar y un día sin jornada no cortan la comparación", () => conHistoria(async (p) => {
  await siguiente(p, "2026-10-02");
  await fijar(p, "99");
  const lista = await siguiente(p, "2026-10-04");
  await publicar(p, lista);
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-04" });
  assert.equal(h.listas, 2);
  const carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.ahora, inicial);
  assert.deepEqual(carton.cambios, [cambioInicial]);
}));

test("sin listas dentro del periodo sigue vigente lo anterior, sin inventar cambios", () => conHistoria(async (p) => {
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-12-01" });
  assert.equal(h.listas, 0);
  assert.equal(h.materiales.length, Object.keys(p.e.mat).length);
  const carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.alEmpezar, inicial);
  assert.deepEqual(carton.ahora, inicial);
  assert.deepEqual(carton.cambios, []);
}));

test("solo aparecen materiales con historia, en orden de familia y de identificador", () => conHistoria(async (p) => {
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-01" });
  const esperado = await p.db.query(
    "SELECT m.id, m.nombre, f.nombre AS familia FROM material m JOIN familia f ON f.id = m.familia_id WHERE m.id = ANY($1::int[]) ORDER BY f.orden, m.id",
    [Object.values(p.e.mat)],
  );
  assert.deepEqual(h.materiales.map(({ id, nombre, familia }) => ({ id, nombre, familia })), esperado.rows);
}));

test("sin publicaciones hasta el corte devuelve listas cero y materiales vacíos", () => conHistoria(async (p) => {
  const h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-09-30" });
  assert.deepEqual(h, { desde: "2026-09-01", hasta: "2026-09-30", dias: 30, listas: 0, materiales: [] });
}));

test("una base sin listas usa hoy del patio y admite los tres periodos fijos", () => conBase(async (db, base) => {
  const bd = crearBd(await urlApp(base));
  try {
    assert.deepEqual(PERIODOS_DE_PRECIOS, [30, 91, 365]);
    for (const dias of PERIODOS_DE_PRECIOS) {
      const fechas = await una(db, "SELECT hoy_en(1::smallint)::text AS hasta, (hoy_en(1::smallint) - ($1::int - 1))::text AS desde", [dias]);
      assert.deepEqual(await historiaDePrecios(bd, { dias, hasta: null }), { ...fechas, dias, listas: 0, materiales: [] });
    }
  } finally { await bd.cerrar(); }
}));

test("hasta exige una fecha real AAAA-MM-DD y permite el día bisiesto", () => conBase(async (_db, base) => {
  const bd = crearBd(await urlApp(base));
  try {
    for (const hasta of ["", "ayer", "2026-2-01", "2026-02-30", "2026-02-29", "2026-13-01", "0000-01-01", "2026-10-01T00:00:00Z"]) {
      await assert.rejects(historiaDePrecios(bd, { dias: 30, hasta }), ErrorDeForma, hasta);
    }
    assert.equal((await historiaDePrecios(bd, { dias: 30, hasta: "2024-02-29" })).hasta, "2024-02-29");
  } finally { await bd.cerrar(); }
}));

// ── contra qué se compara: la base, la variación y las veces ─────────────────

test("la base es lo que valía al empezar o, si no tenía, su primer precio del periodo; de ahí salen la variación y las veces", () => conHistoria(async (p) => {
  let lista = await siguiente(p, "2026-10-02");
  await fijar(p, "2.3", "2.8");
  await publicar(p, lista);
  lista = await siguiente(p, "2026-10-03");
  await fijar(p, "2.2", "2.8");
  await publicar(p, lista);
  // Sin nada antes del periodo: la base es el primer precio, y haber aparecido no cuenta como cambio.
  let h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-03" });
  let carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.equal(carton.alEmpezar, null);
  assert.equal(carton.cambios.length, 3);
  assert.deepEqual([carton.base, carton.variacion, carton.veces], [inicial, { compra: "4.8", venta: "12.0" }, 2]);
  // Con el primer día fuera del periodo: la base es lo que valía al empezar, y los dos cambios cuentan.
  h = await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-31" });
  carton = h.materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.alEmpezar, inicial);
  assert.equal(carton.cambios.length, 2);
  assert.deepEqual([carton.base, carton.variacion, carton.veces], [inicial, { compra: "4.8", venta: "12.0" }, 2]);
  // El que no se movió: su base es su precio, varió cero y cambió cero veces.
  const pet = h.materiales.find((m) => m.id === p.e.mat["PET"])!;
  assert.deepEqual([pet.base, pet.variacion, pet.veces], [pet.ahora, { compra: "0.0", venta: "0.0" }, 0]);
}));

test("el que bajó varía en negativo; el que se quedó sin precio no tiene variación, y haberlo perdido cuenta como cambio", () => conHistoria(async (p) => {
  let lista = await siguiente(p, "2026-10-02");
  await fijar(p, "1.89", "2.50");
  await publicar(p, lista);
  let carton = (await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-02" })).materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual([carton.variacion, carton.veces], [{ compra: "-10.0", venta: "0.0" }, 1]);
  lista = await siguiente(p, "2026-10-03");
  await quitar(p);
  await publicar(p, lista);
  carton = (await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-03" })).materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.equal(carton.ahora, null);
  assert.deepEqual([carton.base, carton.variacion, carton.veces], [inicial, { compra: null, venta: null }, 2]);
}));

test("una base de cero pesos no da variación: no se divide entre cero", () => conHistoria(async (p) => {
  let lista = await siguiente(p, "2026-10-02");
  await fijar(p, "0", "2.50");
  await publicar(p, lista);
  lista = await siguiente(p, "2026-11-15");
  await fijar(p, "1", "3");
  await publicar(p, lista);
  const carton = (await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-11-15" })).materiales.find((m) => m.id === p.e.mat["Cartón"])!;
  assert.deepEqual(carton.base, { compra: "0.0000", venta: "2.5000" });
  assert.deepEqual(carton.variacion, { compra: null, venta: "20.0" });
}));

test("un material dado de baja conserva su historia", () => conHistoria(async (p) => {
  // Todavía no hay cómo darlo de baja desde el sistema: se le quita lo activo como dueño de la base.
  await p.db.query("UPDATE material SET activo = false WHERE id = $1", [p.e.mat["Cartón"]]);
  const carton = (await historiaDePrecios(p.bd, { dias: 30, hasta: "2026-10-01" })).materiales.find((m) => m.id === p.e.mat["Cartón"]);
  assert.deepEqual(carton?.ahora, inicial);
}));

// ── la puerta de la historia ──────────────────────────────────────────────

const verHistoria = async (n: Navegador, consulta = "") =>
  n.pedir(await ruta("precios/historia", "GET"), "GET", `/api/precios/historia${consulta}`);

test("la ruta deja leer a responsable y consulta, rechaza los otros roles y exige persona", () => conMundo(async (m) => {
  for (const rol of ["responsable", "consulta"] as const) {
    const r = await verHistoria(await m.adentro(rol));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).historia.dias, 30);
  }
  for (const rol of ["mostrador", "patio", "administracion"] as const) {
    const r = await verHistoria(await m.adentro(rol));
    assert.equal(r.status, 403, rol);
    assert.equal((await r.json()).error.codigo, "ROL");
  }
  const r = await verHistoria(await m.equipo());
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.codigo, "SESION");
}));

test("la ruta acepta 30, 91 y 365; rechaza otros periodos con FORMA e ignora hasta", () => conMundo(async (m) => {
  const jefe = await m.adentro("responsable");
  const hoy = (await una(m.db, "SELECT hoy_en(1::smallint)::text AS fecha")).fecha;
  for (const dias of [30, 91, 365]) {
    const r = await verHistoria(jefe, `?dias=${dias}&hasta=2000-01-01`);
    assert.equal(r.status, 200);
    const { historia } = await r.json();
    assert.equal(historia.dias, dias);
    assert.equal(historia.hasta, hoy);
  }
  for (const dias of ["7", "", "30.0", "030", "mes"]) {
    const r = await verHistoria(jefe, `?dias=${dias}`);
    assert.equal(r.status, 400, dias);
    assert.equal((await r.json()).error.codigo, "FORMA");
  }
}));
