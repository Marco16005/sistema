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
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
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
    assert.deepEqual(p.personas, [{ nombre: "Luis", cuentas: 4 }, { nombre: "Servando", cuentas: 1 }]);
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
      assert.deepEqual(p.inventario, { listaDel: null, valor: "0.00", sinPrecio: 0, materiales: [] });
      assert.deepEqual(p.control, {
        mermas: 0, mermaKg: "0.000", ajustes: 0, ajusteEntroKg: "0.000", ajusteSalioKg: "0.000",
        preciosEspeciales: 0, diferenciaEnCompras: "0.00", diferenciaEnVentas: "0.00", reaperturas: 0,
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
    });
    assert.deepEqual({ cuentas: p.totales.cuentas, pagado: p.totales.pagado, kgComprado: p.totales.kgComprado }, { cuentas: 1, pagado: "260", kgComprado: "100.000" });
    assert.deepEqual(p.inventario.materiales, [{ nombre: "Cartón", kg: "570.500", precio: "2.1000", valor: "1198.05" }]);
  }));
