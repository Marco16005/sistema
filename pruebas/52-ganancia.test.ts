// La ganancia, para quien dirige: lo que se vendió, lo que costó (el costo promedio de 0039), lo
// que se perdió en bajas y ajustes, y el patio valuado a lo que costó. Por día, semana o mes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { abrirJornada, cerrarSinCorte, conBase, escenario, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
import { ganancia } from "../src/servidor/dominio/ganancia.ts";

const CERO = { vendido: "0.00", costo: "0.00", margen: "0.00", perdidas: "0.00", aFavor: "0.00", correcciones: "0.00", redondeo: "0.00", resultado: "0.00", kgVendido: "0.000" };
/** En los totales y en cada tramo van además los gastos que cuentan (0042) y lo que queda después de ellos. */
const SIN_GASTOS = { gastos: "0.00" };

async function hecha(bd: Bd, e: Escenario, tipo: "compra" | "venta", material: string, kg: string): Promise<void> {
  let c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo, etiqueta: null });
  c = await agregarMaterial(bd, e.mostrador, c.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat[material]!, bascula: 2, kg });
  await confirmar(bd, e.mostrador, c.id, c.revision);
}

/**
 * Dos días. El 1 de octubre se compran 100 kg de Cartón a $2.10 ($210). El 2, con el cartón a $2.50
 * de compra y $3.00 de venta, se compran otros 100 kg ($250): el promedio queda en $2.30. Se venden
 * 50 kg ($150; costaron $115) y se dan de baja 10 kg mojados (se pierden $23).
 */
const conDosDias = (prueba: (bd: Bd, db: pg.Client, e: Escenario) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 2 });
    try {
      const e = await escenario(db);
      await hecha(bd, e, "compra", "Cartón", "100");
      await cerrarSinCorte(db, e.jornada, 0, e.responsable);
      const dos = await abrirJornada(db, e.responsable, "2026-10-02");
      await db.query("UPDATE precio SET compra = 2.5, venta = 3 WHERE lista_id = $1 AND material_id = $2", [dos.lista, e.mat["Cartón"]]);
      await db.query("SELECT publicar_lista($1, $2)", [dos.lista, e.responsable]);
      await hecha(bd, e, "compra", "Cartón", "100");
      await hecha(bd, e, "venta", "Cartón", "50");
      await db.query("SELECT registrar_merma($1, 10, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]);
      await prueba(bd, db, e);
    } finally {
      await bd.cerrar();
    }
  });

test("lo vendido, lo que costó a precio promedio, el margen, lo perdido y el resultado", () =>
  conDosDias(async (bd) => {
    const g = await ganancia(bd, { desde: "2026-10-01", hasta: "2026-10-02", agrupar: "dia" });
    const dia2 = { vendido: "150.00", costo: "115.00", margen: "35.00", perdidas: "23.00", aFavor: "0.00", correcciones: "0.00", redondeo: "0.00", resultado: "12.00", kgVendido: "50.000" };
    assert.deepEqual(g.totales, { ...dia2, ...SIN_GASTOS, utilidad: "12.00" });
    assert.deepEqual(g.serie, [
      { desde: "2026-10-01", hasta: "2026-10-01", ...CERO, ...SIN_GASTOS, utilidad: "0.00" },
      { desde: "2026-10-02", hasta: "2026-10-02", ...dia2, ...SIN_GASTOS, utilidad: "12.00" },
    ]);
    assert.deepEqual(g.materiales, [{ nombre: "Cartón", ...dia2 }]);
  }));

test("el patio valuado a lo que costó, junto a lo que valdría a la última lista de compra", () =>
  conDosDias(async (bd) => {
    const { patio } = await ganancia(bd, { desde: "2026-10-01", hasta: "2026-10-02", agrupar: "dia" });
    assert.deepEqual(patio, {
      valor: "322.00", valorALista: "350.00", listaDel: "2026-10-02",
      materiales: [{ nombre: "Cartón", kg: "140.000", valor: "322.00", costoPorKilo: "2.3000", precioDeLista: "2.5000", valorALista: "350.00" }],
    });
  }));

test("se agrupa por semana o por mes, con los tramos recortados al periodo", () =>
  conDosDias(async (bd) => {
    // El 1 de octubre de 2026 es jueves: la semana del 28 de septiembre se recorta al 1 de octubre.
    const semanas = await ganancia(bd, { desde: "2026-09-25", hasta: "2026-10-06", agrupar: "semana" });
    assert.deepEqual(semanas.serie.map((t) => [t.desde, t.hasta, t.vendido]), [
      ["2026-09-25", "2026-09-27", "0.00"],
      ["2026-09-28", "2026-10-04", "150.00"],
      ["2026-10-05", "2026-10-06", "0.00"],
    ]);
    const meses = await ganancia(bd, { desde: "2026-09-15", hasta: "2026-10-31", agrupar: "mes" });
    assert.deepEqual(meses.serie.map((t) => [t.desde, t.hasta, t.resultado]), [
      ["2026-09-15", "2026-09-30", "0.00"],
      ["2026-10-01", "2026-10-31", "12.00"],
    ]);
  }));

test("un periodo sin nada da ceros, y la ganancia no depende de la lista de hoy", () =>
  conDosDias(async (bd, db, e) => {
    const g = await ganancia(bd, { desde: "2026-09-01", hasta: "2026-09-30", agrupar: "mes" });
    assert.deepEqual(g.totales, { ...CERO, ...SIN_GASTOS, utilidad: "0.00" });
    assert.deepEqual(g.materiales, []);
    // Cambiar precios después no cambia lo que costó lo ya vendido.
    await db.query("UPDATE precio SET compra = 9 WHERE material_id = $1", [e.mat["Cartón"]]).catch(() => {});
    const otra = await ganancia(bd, { desde: "2026-10-01", hasta: "2026-10-02", agrupar: "dia" });
    assert.equal(otra.totales.costo, "115.00");
  }));

test("un ajuste de conteo a favor se cuenta aparte, a costo promedio", () =>
  conDosDias(async (bd, db, e) => {
    // Un ajuste que suma 10 kg (encontrados), a $2.30.
    await db.query(`INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, autorizado_por, creado_por)
                    SELECT 1, $1, 'ajuste', 10, id, 'Se encontró de más', $2, $2 FROM jornada WHERE cerrada_en IS NULL`, [e.mat["Cartón"], e.responsable]);
    const g = await ganancia(bd, { desde: "2026-10-02", hasta: "2026-10-02", agrupar: "dia" });
    assert.deepEqual({ aFavor: g.totales.aFavor, resultado: g.totales.resultado }, { aFavor: "23.00", resultado: "35.00" });
  }));

test("lo que queda después de los gastos: solo restan los de los tipos que cuentan, y no los anulados", () =>
  conDosDias(async (bd, db, e) => {
    const tipo = async (nombre: string) => (await db.query("SELECT id FROM tipo_de_gasto WHERE nombre = $1", [nombre])).rows[0].id;
    const gastar = (fecha: string, t: string, importe: string) =>
      db.query("SELECT * FROM registrar_gasto(gen_random_uuid(), $1, $2, 'x', $3, 'otro', NULL, $4)", [fecha, t, importe, e.responsable]);
    await gastar("2026-10-02", await tipo("Gasolina"), "5");
    await gastar("2026-10-01", await tipo("Renta"), "100");
    const anulado = (await gastar("2026-10-02", await tipo("Gasolina"), "50")).rows[0].id;
    await db.query("SELECT anular_gasto($1, 'Repetido', $2)", [anulado, e.responsable]);
    await db.query("SELECT cambiar_tipo_de_gasto($1, false, true, $2)", [await tipo("Renta"), e.responsable]);
    const g = await ganancia(bd, { desde: "2026-10-01", hasta: "2026-10-02", agrupar: "dia" });
    assert.deepEqual({ gastos: g.totales.gastos, utilidad: g.totales.utilidad }, { gastos: "5.00", utilidad: "7.00" });
    assert.deepEqual(g.serie.map((t) => [t.desde, t.gastos, t.utilidad]), [["2026-10-01", "0.00", "0.00"], ["2026-10-02", "5.00", "7.00"]]);
  }));
