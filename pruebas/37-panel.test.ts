// El panel del negocio: lo comprado, lo vendido y lo que se movió en un periodo, para quien dirige.
// No lleva cuentas propias: cada día del panel dice lo mismo que el cierre de ese día, porque
// salen de los mismos comprobantes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { abrirJornada, conBase, escenario, material, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { CLAVES, conMundo, ruta } from "./mundo.ts";
import type { Mundo } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { cerrarJornada, resumenDelCierre } from "../src/servidor/dominio/cierre.ts";
import { abrirCuenta, agregarMaterial, confirmar, descartar, ponerDescuento, ponerRecipiente, segundaPesada } from "../src/servidor/dominio/cuentas.ts";
import { estadoDelDia } from "../src/servidor/dominio/dia.ts";
import { panel } from "../src/servidor/dominio/panel.ts";

const SIN_NADA = { cuentas: 0, compras: 0, ventas: 0, pagado: "0", cobrado: "0", diferencia: "0", kgComprado: "0.000", kgVendido: "0.000" };

interface DosDias {
  bd: Bd;
  db: pg.Client;
  e: Escenario;
  /** Las dos jornadas: la del 1 de octubre, cerrada, y la del 2, abierta. */
  ayer: string;
  hoy: string;
}

/** Una cuenta con esos materiales, ya confirmada por esa persona. */
async function hecha(bd: Bd, quien: string, e: Escenario, tipo: "compra" | "venta", materiales: Array<[string, string]>): Promise<void> {
  let c = await abrirCuenta(bd, quien, { id: randomUUID(), tipo, etiqueta: null });
  for (const [nombre, kg] of materiales) {
    c = await agregarMaterial(bd, quien, c.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat[nombre]!, bascula: 2, kg });
  }
  await confirmar(bd, quien, c.id, c.revision);
}

/**
 * Dos días con movimiento. El 1 de octubre: se compran 44.2 kg (a pagar $114, en dos cuentas) y se
 * venden 200.3 kg de Cartón (a cobrar $501). El 2: se compran 10 kg de PET ($75) y se venden 2 ($18).
 * Había 1,000 kg de Cartón al arrancar.
 */
const conDosDias = (prueba: (d: DosDias) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 3 });
    try {
      const e = await escenario(db);
      await db.query("SELECT registrar_apertura($1, 1000, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "30.2"], ["PET", "4"]]);   // 63.42 + 30.00 = 93.42 → 93
      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "10"]]);                   // 21.00 → 21
      await hecha(bd, e.mostrador, e, "venta", [["Cartón", "200.3"]]);                 // 500.75 → 501
      const dia = await estadoDelDia(bd);
      await cerrarJornada(bd, e.mostrador, { id: randomUUID(), jornada: dia.jornada!.id, cierres: dia.jornada!.cierres });

      const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
      await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
      await hecha(bd, e.mostrador, e, "compra", [["PET", "10"]]);                      // 75.00 → 75
      await hecha(bd, e.responsable, e, "venta", [["PET", "2"]]);                      // 17.80 → 18
      await prueba({ bd, db, e, ayer: e.jornada, hoy: hoy.id });
    } finally {
      await bd.cerrar();
    }
  });

// ── lo del periodo ─────────────────────────────────────────────────────────

test("el panel suma lo del periodo: cuentas, dinero en pesos cerrados y kilos, por compra y por venta", () =>
  conDosDias(async ({ bd }) => {
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    assert.deepEqual({ desde: p.desde, hasta: p.hasta, dias: p.dias, paso: p.paso }, { desde: "2026-09-26", hasta: "2026-10-02", dias: 7, paso: "dia" });
    assert.deepEqual(p.totales, {
      cuentas: 5, compras: 3, ventas: 2, pagado: "189", cobrado: "519", diferencia: "330", kgComprado: "54.200", kgVendido: "202.300",
    });
  }));

test("la serie trae todos los días del periodo, también los que no tuvieron nada, y cada uno dice lo que su cierre", () =>
  conDosDias(async ({ bd, ayer, hoy }) => {
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    assert.deepEqual(p.serie.map((t) => t.desde), ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    assert.ok(p.serie.every((t) => t.hasta === t.desde));
    for (const t of p.serie.slice(0, 5)) assert.deepEqual({ ...t, desde: undefined, hasta: undefined }, { ...SIN_NADA, desde: undefined, hasta: undefined });
    assert.deepEqual(p.serie[5], {
      desde: "2026-10-01", hasta: "2026-10-01", cuentas: 3, compras: 2, ventas: 1, pagado: "114", cobrado: "501", diferencia: "387", kgComprado: "44.200", kgVendido: "200.300",
    });
    for (const [tramo, jornada] of [[p.serie[5]!, ayer], [p.serie[6]!, hoy]] as const) {
      const cierre = (await resumenDelCierre(bd, jornada))!;
      assert.deepEqual(
        { fecha: tramo.desde, cuentas: tramo.cuentas, pagado: tramo.pagado, cobrado: tramo.cobrado },
        { fecha: cierre.jornada.fecha, cuentas: cierre.operaciones, pagado: cierre.aPagar, cobrado: cierre.aCobrar },
      );
    }
  }));

test("lo anterior al periodo no entra en sus totales: es con lo que se compara", () =>
  conDosDias(async ({ bd }) => {
    // Del 2 al 8 de octubre: el día 1 queda en los siete días de antes.
    const p = await panel(bd, { dias: 7, hasta: "2026-10-08" });
    assert.equal(p.desde, "2026-10-02");
    assert.deepEqual(p.totales, { cuentas: 2, compras: 1, ventas: 1, pagado: "75", cobrado: "18", diferencia: "-57", kgComprado: "10.000", kgVendido: "2.000" });
    assert.deepEqual(p.antes, { cuentas: 3, compras: 2, ventas: 1, pagado: "114", cobrado: "501", diferencia: "387", kgComprado: "44.200", kgVendido: "200.300" });
    // En por ciento, con un decimal: (2 − 3) / 3, (75 − 114) / 114, (18 − 501) / 501.
    assert.deepEqual(p.cambio, { cuentas: "-33.3", pagado: "-34.2", cobrado: "-96.4" });
  }));

test("sin nada en el periodo anterior no hay con qué comparar, y no se inventa un por ciento", () =>
  conDosDias(async ({ bd }) => {
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    assert.deepEqual(p.antes, SIN_NADA);
    assert.deepEqual(p.cambio, { cuentas: null, pagado: null, cobrado: null });
  }));

test("una cuenta que sigue abierta no cuenta en el panel", () =>
  conDosDias(async ({ bd, e }) => {
    const antes = (await panel(bd, { dias: 7, hasta: "2026-10-02" })).totales;
    const abierta = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: "Don Chuy" });
    await agregarMaterial(bd, e.mostrador, abierta.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["Cartón"]!, bascula: 2, kg: "500" });
    assert.deepEqual((await panel(bd, { dias: 7, hasta: "2026-10-02" })).totales, antes);
  }));

test("a tres meses el panel va por semanas: trece tramos de siete días, sin perder ni repetir un día", () =>
  conDosDias(async ({ bd }) => {
    const p = await panel(bd, { dias: 91, hasta: "2026-10-02" });
    assert.deepEqual({ desde: p.desde, paso: p.paso, tramos: p.serie.length }, { desde: "2026-07-04", paso: "semana", tramos: 13 });
    assert.deepEqual({ desde: p.serie[0]!.desde, hasta: p.serie[0]!.hasta }, { desde: "2026-07-04", hasta: "2026-07-10" });
    // Los dos días caen en la última semana, y lo que suma ella es lo que suma el periodo.
    assert.deepEqual(p.serie[12], { desde: "2026-09-26", hasta: "2026-10-02", ...p.totales });
    assert.equal(p.totales.cuentas, 5);
  }));

// ── de qué está hecho ──────────────────────────────────────────────────────

test("los materiales salen del que más kilos movió al que menos, con lo comprado y lo vendido de cada uno", () =>
  conDosDias(async ({ bd }) => {
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    assert.deepEqual(p.materiales, [
      { nombre: "Cartón", kgComprado: "40.200", importeComprado: "84.42", kgVendido: "200.300", importeVendido: "500.75" },
      { nombre: "PET", kgComprado: "14.000", importeComprado: "105.00", kgVendido: "2.000", importeVendido: "17.80" },
    ]);
    // Con solo el día 2 a la vista, el Cartón no se movió: no sale.
    assert.deepEqual((await panel(bd, { dias: 7, hasta: "2026-10-08" })).materiales.map((m) => m.nombre), ["PET"]);
  }));

test("quién atendió, del que más cuentas terminó al que menos; y a qué hora, sin perder ninguna cuenta", () =>
  conDosDias(async ({ bd }) => {
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    const sinNovedad = { descuentoKg: "0.000", recipienteKg: "0.000", descartadas: 0, correcciones: 0, reimpresiones: 0 };
    assert.deepEqual(p.personas, [
      // Luis: tres compras ($93 + $21 + $75) y la venta de Cartón; por sus manos pasaron 34.2 + 10 + 200.3 + 10 kg.
      { nombre: "Luis", cuentas: 4, compras: 3, ventas: 1, pagado: "189", cobrado: "501", kg: "254.500", ...sinNovedad },
      { nombre: "Servando", cuentas: 1, compras: 0, ventas: 1, pagado: "0", cobrado: "18", kg: "2.000", ...sinNovedad },
    ]);
    assert.equal(p.horas.reduce((s, h) => s + h.cuentas, 0), 5);
    assert.ok(p.horas.every((h) => Number.isInteger(h.hora) && h.hora >= 0 && h.hora <= 23));
    assert.deepEqual(p.horas.map((h) => h.hora), [...p.horas.map((h) => h.hora)].sort((a, b) => a - b));
  }));

test("lo que hay en el patio vale lo que diría la última lista publicada, a precio de compra", () =>
  conDosDias(async ({ bd, db, e }) => {
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    assert.deepEqual(p.inventario, {
      listaDel: "2026-10-02", valor: "1853.79", sinPrecio: 0,
      materiales: [
        { nombre: "Cartón", kg: "839.900", precio: "2.1000", valor: "1763.79" },    // 1000 + 40.2 − 200.3
        { nombre: "PET", kg: "12.000", precio: "7.5000", valor: "90.00" },
      ],
    });
    // Lo que hay no depende del periodo que se mire.
    assert.deepEqual((await panel(bd, { dias: 91, hasta: "2026-10-08" })).inventario, p.inventario);
    // Un material con existencia y sin precio en la lista sale, sin valor, y se dice que falta.
    await db.query("SELECT registrar_apertura($1, 50, 'estimado', $2)", [await material(db, "Bronce"), e.responsable]);
    const q = (await panel(bd, { dias: 7, hasta: "2026-10-02" })).inventario;
    assert.deepEqual({ valor: q.valor, sinPrecio: q.sinPrecio, ultimo: q.materiales.at(-1) }, {
      valor: "1853.79", sinPrecio: 1, ultimo: { nombre: "Bronce", kg: "50.000", precio: null, valor: null },
    });
  }));

test("sin ningún día todavía, el panel sale vacío y no truena", () =>
  conBase(async (_db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 2 });
    try {
      const p = await panel(bd, { dias: 30, hasta: "2026-10-02" });
      assert.deepEqual(p.totales, SIN_NADA);
      assert.equal(p.serie.length, 30);
      assert.deepEqual({ materiales: p.materiales, personas: p.personas, horas: p.horas }, { materiales: [], personas: [], horas: [] });
      assert.deepEqual(p.promedio, { pagado: null, kgComprado: null, cobrado: null, kgVendido: null });
      assert.deepEqual(p.semana.map((d) => [d.dia, d.cuentas, d.porDia]), [1, 2, 3, 4, 5, 6, 7].map((d) => [d, 0, "0.0"]));
      assert.deepEqual(p.inventario, { listaDel: null, valor: "0.00", sinPrecio: 0, materiales: [] });
      assert.deepEqual(p.control, {
        mermas: 0, mermaKg: "0.000", ajustes: 0, ajusteEntroKg: "0.000", ajusteSalioKg: "0.000",
        preciosEspeciales: 0, diferenciaEnCompras: "0.00", diferenciaEnVentas: "0.00", reaperturas: 0,
        descuentos: 0, descuentoEnComprasKg: "0.000", descuentoEnVentasKg: "0.000", descontados: [],
        recipientes: 0, recipienteEnComprasKg: "0.000", recipienteEnVentasKg: "0.000",
      });
    } finally {
      await bd.cerrar();
    }
  }));

test("sin decir hasta cuándo, el periodo termina hoy, en la fecha del patio", () =>
  conDosDias(async ({ bd, db }) => {
    const hoy = (await una(db, "SELECT to_char(hoy_en(1::smallint), 'YYYY-MM-DD') AS f")).f;
    const p = await panel(bd, { dias: 7 });
    assert.equal(p.hasta, hoy);
    assert.equal(p.serie.at(-1)!.desde, hoy);
  }));


// ── la cuenta promedio, el día de la semana, los descuentos y cada persona ──

test("la cuenta promedio: lo que se paga y lo que entra por cuenta de compra, y lo que se cobra y sale por cuenta de venta", () =>
  conDosDias(async ({ bd }) => {
    // Tres compras: $189 y 54.2 kg. Dos ventas: $519 y 202.3 kg.
    assert.deepEqual((await panel(bd, { dias: 7, hasta: "2026-10-02" })).promedio, { pagado: "63.00", kgComprado: "18.067", cobrado: "259.50", kgVendido: "101.150" });
    // Con solo el día 2 a la vista: una compra y una venta.
    assert.deepEqual((await panel(bd, { dias: 7, hasta: "2026-10-08" })).promedio, { pagado: "75.00", kgComprado: "10.000", cobrado: "18.00", kgVendido: "2.000" });
  }));

test("por día de la semana: cuántas cuentas hubo y cuántas por cada día de ese nombre que cae en el periodo", () =>
  conDosDias(async ({ bd }) => {
    // El 1 de octubre de 2026 es jueves y el 2, viernes. En siete días cada día de la semana cae una vez.
    const semana = (await panel(bd, { dias: 7, hasta: "2026-10-02" })).semana;
    assert.deepEqual(semana, [
      { dia: 1, dias: 1, cuentas: 0, porDia: "0.0" }, { dia: 2, dias: 1, cuentas: 0, porDia: "0.0" }, { dia: 3, dias: 1, cuentas: 0, porDia: "0.0" },
      { dia: 4, dias: 1, cuentas: 3, porDia: "3.0" }, { dia: 5, dias: 1, cuentas: 2, porDia: "2.0" },
      { dia: 6, dias: 1, cuentas: 0, porDia: "0.0" }, { dia: 7, dias: 1, cuentas: 0, porDia: "0.0" },
    ]);
    // En treinta días, del 3 de septiembre al 2 de octubre, caen cinco jueves y cinco viernes, y cuatro de los demás.
    const mes = (await panel(bd, { dias: 30, hasta: "2026-10-02" })).semana;
    assert.deepEqual(mes.map((d) => d.dias), [4, 4, 4, 5, 5, 4, 4]);
    assert.deepEqual([mes[3], mes[4]], [{ dia: 4, dias: 5, cuentas: 3, porDia: "0.6" }, { dia: 5, dias: 5, cuentas: 2, porDia: "0.4" }]);
  }));

test("los kilos descontados: cuántos renglones, cuántos kilos en compras y en ventas, de qué materiales, y quién cobró esas cuentas", () =>
  conDosDias(async ({ bd, e }) => {
    const conDescuento = async (quien: string, tipo: "compra" | "venta", material: string, kg: string, descuento: string): Promise<void> => {
      const linea = randomUUID();
      let c = await abrirCuenta(bd, quien, { id: randomUUID(), tipo, etiqueta: null });
      c = await agregarMaterial(bd, quien, c.id, { linea, captura: randomUUID(), material: e.mat[material]!, bascula: 2, kg });
      c = await ponerDescuento(bd, quien, c.id, linea, descuento);
      await confirmar(bd, quien, c.id, c.revision);
    };
    await conDescuento(e.mostrador, "compra", "Cartón", "20", "1.5");
    await conDescuento(e.mostrador, "compra", "PET", "5", "0.25");
    await conDescuento(e.mostrador, "compra", "Cartón", "10", "2");
    await conDescuento(e.responsable, "venta", "Cartón", "50", "3");
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    const { descuentos, descuentoEnComprasKg, descuentoEnVentasKg, descontados } = p.control;
    assert.deepEqual({ descuentos, descuentoEnComprasKg, descuentoEnVentasKg }, { descuentos: 4, descuentoEnComprasKg: "3.750", descuentoEnVentasKg: "3.000" });
    // Del que más kilos se le descontaron al que menos, sumando compras y ventas.
    assert.deepEqual(descontados, [{ nombre: "Cartón", kg: "6.500" }, { nombre: "PET", kg: "0.250" }]);
    assert.deepEqual(p.personas.map((x) => [x.nombre, x.descuentoKg]), [["Luis", "3.750"], ["Servando", "3.000"]]);
    // Lo que entró son los kilos pesados; el descuento baja lo que se paga, no lo que entra al patio.
    assert.equal(p.totales.kgComprado, "89.200");
  }));

test("los kilos de recipiente: cuántos renglones, cuántos kilos en compras y en ventas, y quién cobró esas cuentas", () =>
  conDosDias(async ({ bd, e }) => {
    const conRecipiente = async (quien: string, tipo: "compra" | "venta", material: string, kg: string, recipiente: string, despues = false): Promise<void> => {
      const linea = randomUUID();
      let c = await abrirCuenta(bd, quien, { id: randomUUID(), tipo, etiqueta: null });
      c = await agregarMaterial(bd, quien, c.id, { linea, captura: randomUUID(), material: e.mat[material]!, bascula: 2, kg, ...(despues ? {} : { recipiente }) });
      // Puesto al pesar o después, desde la cuenta, es lo mismo.
      if (despues) c = await ponerRecipiente(bd, e.patio, c.id, linea, recipiente);
      await confirmar(bd, quien, c.id, c.revision);
    };
    await conRecipiente(e.mostrador, "compra", "Cartón", "20.4", "0.4");
    await conRecipiente(e.mostrador, "compra", "PET", "5.2", "0.2", true);
    await conRecipiente(e.responsable, "venta", "Cartón", "51.5", "1.5");
    const p = await panel(bd, { dias: 7, hasta: "2026-10-02" });
    const { recipientes, recipienteEnComprasKg, recipienteEnVentasKg } = p.control;
    assert.deepEqual({ recipientes, recipienteEnComprasKg, recipienteEnVentasKg }, { recipientes: 3, recipienteEnComprasKg: "0.600", recipienteEnVentasKg: "1.500" });
    assert.deepEqual(p.personas.map((x) => [x.nombre, x.recipienteKg]), [["Luis", "0.600"], ["Servando", "1.500"]]);
    // A diferencia del descuento, el recipiente no entra al patio: los kilos son los del material solo.
    assert.equal(p.totales.kgComprado, "79.200");
    // El vehículo de la báscula grande tiene tara, pero no es recipiente: no se cuenta aquí.
    let v = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: null });
    v = await agregarMaterial(bd, e.mostrador, v.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["Cartón"]!, bascula: 1, kg: "5200" });
    v = await segundaPesada(bd, e.mostrador, v.id, v.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    await confirmar(bd, e.mostrador, v.id, v.revision);
    assert.equal((await panel(bd, { dias: 7, hasta: "2026-10-02" })).control.recipientes, 3);
  }));

test("de cada persona, lo que conviene vigilar: las cuentas que descartó, lo que corrigió y lo que reimprimió, aunque no haya cobrado nada", () =>
  conDosDias(async ({ bd, db, e }) => {
    const abierta = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: null });
    await agregarMaterial(bd, e.mostrador, abierta.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["Cartón"]!, bascula: 2, kg: "40" });
    await descartar(bd, e.mostrador, abierta.id);
    // Una corrección y dos reimpresiones piden clave e impresora: aquí se asientan en la bitácora como las asienta la base.
    await db.query(`INSERT INTO bitacora (usuario_id, accion, entidad) VALUES
      ($1, 'corregir', 'movimiento_inventario'), ($1, 'corregir_material', 'movimiento_inventario'),
      ($2, 'reimprimir', 'operacion'), ($2, 'reimprimir', 'operacion'), ($2, 'cerrar', 'jornada')`, [e.responsable, e.patio]);
    // La bitácora va por el día en que pasó cada cosa: se lleva todo al 2 de octubre.
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("UPDATE bitacora SET ocurrido_en = '2026-10-02 18:00+00'");
    await db.query("COMMIT");
    const de = (await panel(bd, { dias: 7, hasta: "2026-10-02" })).personas.map((x) => ({ nombre: x.nombre, cuentas: x.cuentas, descartadas: x.descartadas, correcciones: x.correcciones, reimpresiones: x.reimpresiones }));
    assert.deepEqual(de, [
      { nombre: "Luis", cuentas: 4, descartadas: 1, correcciones: 0, reimpresiones: 0 },
      { nombre: "Servando", cuentas: 1, descartadas: 0, correcciones: 2, reimpresiones: 0 },
      // Beto, del patio, no cobró ninguna cuenta: sale por lo que reimprimió.
      { nombre: "Beto", cuentas: 0, descartadas: 0, correcciones: 0, reimpresiones: 2 },
    ]);
    // Fuera del periodo, nada de eso cuenta; y quien no hizo nada de esto no sale.
    assert.deepEqual((await panel(bd, { dias: 7, hasta: "2026-09-25" })).personas, []);
  }));

// ── el periodo que se elige ─────────────────────────────────────────────────

test("un periodo elegido de tal día a tal día: lo suyo, día por día, y se compara con los mismos días de antes", () =>
  conDosDias(async ({ bd }) => {
    const p = await panel(bd, { desde: "2026-10-02", hasta: "2026-10-02" });
    assert.deepEqual({ desde: p.desde, hasta: p.hasta, dias: p.dias, paso: p.paso, tramos: p.serie.length }, { desde: "2026-10-02", hasta: "2026-10-02", dias: 1, paso: "dia", tramos: 1 });
    assert.deepEqual(p.totales, { cuentas: 2, compras: 1, ventas: 1, pagado: "75", cobrado: "18", diferencia: "-57", kgComprado: "10.000", kgVendido: "2.000" });
    // El día de antes: el 1 de octubre.
    assert.deepEqual({ cuentas: p.antes.cuentas, pagado: p.antes.pagado }, { cuentas: 3, pagado: "114" });
    const dos = await panel(bd, { desde: "2026-10-01", hasta: "2026-10-02" });
    assert.deepEqual({ dias: dos.dias, cuentas: dos.totales.cuentas, antes: dos.antes }, { dias: 2, cuentas: 5, antes: SIN_NADA });
    assert.deepEqual(dos.serie.map((t) => [t.desde, t.hasta, t.cuentas]), [["2026-10-01", "2026-10-01", 3], ["2026-10-02", "2026-10-02", 2]]);
  }));

test("un periodo largo va por semanas, y uno de muchos meses, de cuatro en cuatro semanas: el último tramo termina el último día y no se pierde ninguno", () =>
  conDosDias(async ({ bd }) => {
    // Hasta 31 días, día por día.
    assert.deepEqual((({ paso, serie }) => [paso, serie.length])(await panel(bd, { desde: "2026-09-02", hasta: "2026-10-02" })), ["dia", 31]);
    // Cuarenta días: cinco semanas enteras y un tramo de cinco días, del 28 de septiembre al 2 de octubre.
    const p = await panel(bd, { desde: "2026-08-24", hasta: "2026-10-02" });
    assert.deepEqual({ dias: p.dias, paso: p.paso, tramos: p.serie.length }, { dias: 40, paso: "semana", tramos: 6 });
    assert.deepEqual({ desde: p.serie[0]!.desde, hasta: p.serie[0]!.hasta }, { desde: "2026-08-24", hasta: "2026-08-30" });
    assert.deepEqual(p.serie[5], { desde: "2026-09-28", hasta: "2026-10-02", ...p.totales });
    assert.equal(p.totales.cuentas, 5);
    // Trescientos días: diez tramos de cuatro semanas y uno de veinte días.
    const largo = await panel(bd, { desde: "2025-12-07", hasta: "2026-10-02" });
    assert.deepEqual({ dias: largo.dias, paso: largo.paso, tramos: largo.serie.length }, { dias: 300, paso: "cuatro-semanas", tramos: 11 });
    assert.deepEqual({ desde: largo.serie[10]!.desde, hasta: largo.serie[10]!.hasta, cuentas: largo.serie[10]!.cuentas }, { desde: "2026-09-13", hasta: "2026-10-02", cuentas: 5 });
    assert.equal(largo.serie.reduce((n, t) => n + t.cuentas, 0), 5);
  }));

// ── por las rutas: quién lo ve, y el control ────────────────────────────────

interface Patio {
  m: Mundo;
  jefe: Navegador;
  caja: Navegador;
  carton: number;
}

/** El día de hoy listo para atender, con 500 kg de Cartón de saldo inicial. */
const conPatio = (prueba: (p: Patio) => Promise<void>) =>
  conMundo(async (m) => {
    const carton = await material(m.db, "Cartón");
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/x", { saldos: [{ material: carton, kg: "500", origen: "estimado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/x");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/x", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/x");
    await m.db.query("UPDATE jornada SET abierta_en = abierta_en - interval '3 hours'");
    await prueba({ m, jefe, caja: await m.adentro("mostrador"), carton });
  });

const verPanel = async (n: Navegador, consulta = "") => n.pedir(await ruta("panel", "GET"), "GET", `/api/panel${consulta}`);
const codigoDe = async (r: Response): Promise<string> => (await r.json()).error?.codigo;

test("el panel lo ven quien dirige y quien consulta; el mostrador, el patio y la administración técnica, no", () =>
  conPatio(async ({ m, jefe, caja }) => {
    assert.equal((await verPanel(jefe)).status, 200);
    assert.equal((await verPanel(await m.adentro("consulta"))).status, 200);
    for (const n of [caja, await m.adentro("patio"), await m.adentro("administracion")]) {
      const r = await verPanel(n);
      assert.equal(r.status, 403);
      assert.equal(await codigoDe(r), "ROL");
    }
    assert.equal((await verPanel(await m.equipo())).status, 401);
  }));

test("el periodo es uno de los tres que hay; sin decirlo son siete días, y otro número no pasa", () =>
  conPatio(async ({ jefe }) => {
    assert.equal((await (await verPanel(jefe)).json()).panel.dias, 7);
    for (const dias of [7, 30, 91]) assert.equal((await (await verPanel(jefe, `?dias=${dias}`)).json()).panel.dias, dias);
    for (const mala of ["5", "365", "7.5", "siete", ""]) {
      const r = await verPanel(jefe, `?dias=${mala}`);
      assert.equal(r.status, 400, `dias=${mala}`);
      assert.equal(await codigoDe(r), "FORMA");
    }
  }));

test("el control cuenta lo que se dio de baja, lo que ajustó un conteo, los precios especiales y las veces que se reabrió el día", () =>
  conPatio(async ({ m, jefe, caja, carton }) => {
    const autoriza = { autoriza: m.personas.responsable, clave: CLAVES.responsable };
    // Una compra de 100 kg de Cartón con 50 centavos más por kilo: $260.00 en vez de $210.00.
    const cuenta = randomUUID();
    const par = { parametros: { cuenta } };
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/x", { id: cuenta, tipo: "compra", etiqueta: null });
    const linea = randomUUID();
    await caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x", { linea, captura: randomUUID(), material: carton, bascula: 2, kg: "100" }, par);
    const conPrecio = await caja.bien(await ruta("cuentas/[cuenta]/precio-especial", "POST"), "POST", "/api/x",
      { id: randomUUID(), linea, visto: null, cliente: null, clienteNuevo: "Don Chuy", diferencia: "0.50", ...autoriza }, par);
    await caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision: conPrecio.cuenta.revision }, par);
    // Una merma de 10 kg, y un conteo que encuentra 19.5 kg de menos: 500 + 100 − 10 = 590 en el libro.
    await caja.bien(await ruta("inventario/merma", "POST"), "POST", "/api/x", { id: randomUUID(), material: carton, kg: "10", motivo: "Mojado" });
    const visto = (await caja.bien(await ruta("inventario/conteo/previa", "POST"), "POST", "/api/x", { material: carton, contado: "570.5" })).previa;
    await caja.bien(await ruta("inventario/conteo", "POST"), "POST", "/api/x",
      { id: randomUUID(), material: carton, contado: "570.5", contadoEn: visto.contadoEn, registrado: visto.registrado, ...autoriza });
    // Se cierra el día y se reabre.
    const dia = (await caja.bien(await ruta("dia", "GET"), "GET", "/api/dia")).dia;
    const cerrado = await caja.bien(await ruta("jornada/cerrar", "POST"), "POST", "/api/x", { id: randomUUID(), jornada: dia.jornada.id, cierres: dia.jornada.cierres });
    await caja.bien(await ruta("jornada/reabrir", "POST"), "POST", "/api/x", { id: randomUUID(), jornada: dia.jornada.id, cierre: cerrado.cierre.cierre, ...autoriza });

    const p = (await (await verPanel(jefe, "?dias=7")).json()).panel;
    assert.deepEqual(p.control, {
      mermas: 1, mermaKg: "10.000", ajustes: 1, ajusteEntroKg: "0.000", ajusteSalioKg: "19.500",
      preciosEspeciales: 1, diferenciaEnCompras: "50.00", diferenciaEnVentas: "0.00", reaperturas: 1,
      descuentos: 0, descuentoEnComprasKg: "0.000", descuentoEnVentasKg: "0.000", descontados: [],
      recipientes: 0, recipienteEnComprasKg: "0.000", recipienteEnVentasKg: "0.000",
    });
    assert.deepEqual({ cuentas: p.totales.cuentas, pagado: p.totales.pagado, kgComprado: p.totales.kgComprado }, { cuentas: 1, pagado: "260", kgComprado: "100.000" });
    assert.deepEqual(p.inventario.materiales, [{ nombre: "Cartón", kg: "570.500", precio: "2.1000", valor: "1198.05" }]);
  }));

test("el periodo también se elige de tal día a tal día; con fechas que no son, al revés o de más de un año, no pasa", () =>
  conPatio(async ({ jefe, m }) => {
    const hoy = (await una(m.db, "SELECT to_char(hoy_en(1::smallint), 'YYYY-MM-DD') AS f, to_char(hoy_en(1::smallint) - 9, 'YYYY-MM-DD') AS antes"));
    const p = (await (await verPanel(jefe, `?desde=${hoy.antes}&hasta=${hoy.f}`)).json()).panel;
    assert.deepEqual({ desde: p.desde, hasta: p.hasta, dias: p.dias, tramos: p.serie.length }, { desde: hoy.antes, hasta: hoy.f, dias: 10, tramos: 10 });
    for (const mala of [
      `?desde=${hoy.f}&hasta=${hoy.antes}`,          // al revés
      `?desde=${hoy.antes}`, `?hasta=${hoy.f}`,       // falta uno
      "?desde=2026-02-30&hasta=2026-03-02",            // un día que no existe
      "?desde=ayer&hasta=hoy", "?desde=&hasta=",
      "?desde=2025-01-01&hasta=2026-01-02",            // 367 días
      `?dias=7&desde=${hoy.antes}&hasta=${hoy.f}`,     // las dos maneras a la vez
    ]) {
      const r = await verPanel(jefe, mala);
      assert.equal(r.status, 400, mala);
      assert.equal(await codigoDe(r), "FORMA", mala);
    }
    // Un año justo sí cabe.
    assert.equal((await (await verPanel(jefe, "?desde=2025-10-03&hasta=2026-10-02")).json()).panel.dias, 365);
  }));
