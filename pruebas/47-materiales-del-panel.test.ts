// Los materiales en el panel: qué se está quedando en el patio y la ficha de cada material —lo que
// entró y salió, a cuánto el kilo, cuánto ha habido y lo que se le perdió—. No llevan cuentas
// propias: salen de los comprobantes y del libro de inventario, como el resto del panel.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { abrirJornada, conBase, escenario, material, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { conMundo, ruta } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { cerrarJornada } from "../src/servidor/dominio/cierre.ts";
import { abrirCuenta, agregarMaterial, confirmar, ponerDescuento } from "../src/servidor/dominio/cuentas.ts";
import { estadoDelDia } from "../src/servidor/dominio/dia.ts";
import { darMerma, separar } from "../src/servidor/dominio/inventario.ts";
import { fichaDeMaterial, materialesDelPatio } from "../src/servidor/dominio/materiales-del-panel.ts";
import type { MaterialDelPatio } from "../src/servidor/dominio/materiales-del-panel.ts";

interface Patio {
  bd: Bd;
  db: pg.Client;
  e: Escenario;
  bronce: number;
}

/** Una cuenta con esos materiales —[nombre, kilos, kilos descontados]—, ya confirmada. */
async function hecha(bd: Bd, quien: string, e: Escenario, tipo: "compra" | "venta", materiales: Array<[string, string, string?]>): Promise<void> {
  let c = await abrirCuenta(bd, quien, { id: randomUUID(), tipo, etiqueta: null });
  for (const [nombre, kg, descuento] of materiales) {
    const linea = randomUUID();
    c = await agregarMaterial(bd, quien, c.id, { linea, captura: randomUUID(), material: e.mat[nombre]!, bascula: 2, kg });
    if (descuento) c = await ponerDescuento(bd, quien, c.id, linea, descuento);
  }
  await confirmar(bd, quien, c.id, c.revision);
}

/**
 * Un patio con dos días de movimiento. Antes de abrir (30 de septiembre) había 1,000 kg de Cartón
 * y 50 de Bronce, que no tiene precio y nunca sale.
 *   1 de octubre — Cartón a $2.10 / $2.50: se compran 30.2 kg de Cartón y 4 de PET; 10 de Cartón y
 *                  3 de Magnesio; se venden 200.3 kg de Cartón ($500.75).
 *   2 de octubre — el Cartón sube a $2.30 / $2.70: se compran 10 kg de Cartón con 1 de descuento
 *                  ($20.70) y 10 de PET; se venden 2 kg de PET y los 3 de Magnesio; se dan de baja
 *                  5 kg de Cartón. Sigue abierto.
 */
const conPatio = (prueba: (p: Patio) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 3 });
    try {
      const e = await escenario(db);
      const bronce = await material(db, "Bronce");
      await db.query("SELECT registrar_apertura($1, 1000, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
      await db.query("SELECT registrar_apertura($1, 50, 'estimado', $2)", [bronce, e.responsable]);
      // Un saldo inicial no es de ninguna jornada: va en el día en que se asentó. Se lleva a la víspera.
      await db.query("BEGIN");
      await db.query("SET LOCAL session_replication_role = replica");
      await db.query("UPDATE movimiento_inventario SET creado_en = '2026-09-30 18:00+00', efectivo_en = '2026-09-30 18:00+00' WHERE tipo = 'apertura'");
      await db.query("COMMIT");

      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "30.2"], ["PET", "4"]]);       // 63.42 + 30.00
      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "10"], ["Magnesio", "3"]]);    // 21.00 + 66.00
      await hecha(bd, e.mostrador, e, "venta", [["Cartón", "200.3"]]);                     // 500.75
      const dia = await estadoDelDia(bd);
      await cerrarJornada(bd, e.mostrador, { id: randomUUID(), jornada: dia.jornada!.id, cierres: dia.jornada!.cierres });

      const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
      await db.query("SELECT fijar_precio($1, 2.3, 2.7, $2)", [e.mat["Cartón"], e.responsable]);
      await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "10", "1"]]);                  // 9 × 2.30 = 20.70
      await hecha(bd, e.mostrador, e, "compra", [["PET", "10"]]);                          // 75.00
      await hecha(bd, e.mostrador, e, "venta", [["PET", "2"]]);                            // 17.80
      await hecha(bd, e.mostrador, e, "venta", [["Magnesio", "3"]]);                       // 78.00
      await darMerma(bd, e.mostrador, { id: randomUUID(), material: e.mat["Cartón"]!, kg: "5", motivo: "Mojado" });
      await prueba({ bd, db, e, bronce });
    } finally {
      await bd.cerrar();
    }
  });

/** Un material del patio sin su familia ni su identificador: lo que se compara número por número. */
const sinFamilia = (m: MaterialDelPatio) => ({ ...m, id: undefined, familia: undefined });
const CARTON = {
  nombre: "Cartón", activo: true, kg: "844.900", precio: "2.3000", valor: "1943.27",
  ultimaSalida: "2026-10-01", diasSinSalir: 19, kgSalio: "200.300", alcanzaPara: 119,
};

// ── lo que se está quedando en el patio ─────────────────────────────────────

test("el patio dice de cada material cuánto hay, cuánto vale, cuándo salió por última vez y para cuántos días alcanza", () =>
  conPatio(async ({ bd }) => {
    const p = await materialesDelPatio(bd, { hoy: "2026-10-20" });
    assert.deepEqual({ hoy: p.hoy, listaDel: p.listaDel, valor: p.valor }, { hoy: "2026-10-20", listaDel: "2026-10-02", valor: "2033.27" });
    // Se está quedando lo que tiene existencia y lleva treinta días o más sin salir. A los veinte, todavía nada.
    assert.deepEqual(p.seQuedan, { dias: 30, materiales: 0, valor: "0.00" });
    assert.deepEqual(p.materiales.map(sinFamilia), [
      // Con existencia, primero lo que más lleva sin salir. Lo que nunca ha salido cuenta desde el día en que llegó: el 30 de septiembre.
      { nombre: "Bronce", activo: true, kg: "50.000", precio: null, valor: null, ultimaSalida: null, diasSinSalir: 20, kgSalio: "0.000", alcanzaPara: null },
      // 1000 + 30.2 + 10 + 10 − 200.3 − 5. Alcanza: 844.9 kg entre los 200.3 que salieron en cuatro semanas.
      CARTON,
      { nombre: "PET", activo: true, kg: "12.000", precio: "7.5000", valor: "90.00", ultimaSalida: "2026-10-02", diasSinSalir: 18, kgSalio: "2.000", alcanzaPara: 168 },
      // Al final, lo que ya no tiene existencia: no hay nada que alcance para nada.
      { nombre: "Magnesio", activo: true, kg: "0.000", precio: "22.0000", valor: "0.00", ultimaSalida: "2026-10-02", diasSinSalir: 18, kgSalio: "3.000", alcanzaPara: null },
    ].map((m) => ({ ...m, id: undefined, familia: undefined })));
    assert.ok(p.materiales.every((m) => Number.isInteger(m.id) && m.familia.length > 0));
  }));

test("un material que nunca se ha movido no sale en el patio", () =>
  conPatio(async ({ bd }) => {
    const nombres = (await materialesDelPatio(bd, { hoy: "2026-10-20" })).materiales.map((m) => m.nombre);
    assert.ok(!nombres.includes("Cobre de primera"));
    assert.equal(nombres.length, 4);
  }));

test("pasadas cuatro semanas sin salir ya no hay ritmo con qué decir para cuánto alcanza, y los días sin salir siguen contando", () =>
  conPatio(async ({ bd }) => {
    // El 15 de noviembre, las últimas cuatro semanas empiezan el 19 de octubre: nada salió en ellas.
    const carton = (await materialesDelPatio(bd, { hoy: "2026-11-15" })).materiales.find((m) => m.nombre === "Cartón")!;
    assert.deepEqual({ dias: carton.diasSinSalir, salio: carton.kgSalio, alcanza: carton.alcanzaPara }, { dias: 45, salio: "0.000", alcanza: null });
    // Para entonces se están quedando el Bronce, el Cartón y el PET; el Magnesio no, que ya no tiene existencia.
    assert.deepEqual((await materialesDelPatio(bd, { hoy: "2026-11-15" })).seQuedan, { dias: 30, materiales: 3, valor: "2033.27" });
    // A los treinta días justos ya cuenta: el 31 de octubre, el Cartón, que salió el 1, y el Bronce, que llegó el 30 de
    // septiembre y no tiene precio; el PET, que salió el 2, todavía no.
    assert.deepEqual((await materialesDelPatio(bd, { hoy: "2026-10-31" })).seQuedan, { dias: 30, materiales: 2, valor: "1943.27" });
    // El día 28 todavía entra lo del 1 de octubre; el 29, ya no.
    const el28 = (await materialesDelPatio(bd, { hoy: "2026-10-28" })).materiales.find((m) => m.nombre === "Cartón")!;
    const el29 = (await materialesDelPatio(bd, { hoy: "2026-10-29" })).materiales.find((m) => m.nombre === "Cartón")!;
    assert.deepEqual([el28.kgSalio, el29.kgSalio], ["200.300", "0.000"]);
  }));

test("separar un material en otros también es salir: no se está quedando", () =>
  conPatio(async ({ bd, e, bronce }) => {
    await separar(bd, e.mostrador, { id: randomUUID(), origen: bronce, kg: "20", productos: [{ material: e.mat["Magnesio"]!, kg: "18" }], nota: null });
    const p = await materialesDelPatio(bd, { hoy: "2026-10-20" });
    const b = p.materiales.find((m) => m.nombre === "Bronce")!;
    // La separación es de la jornada abierta, la del 2 de octubre.
    assert.deepEqual({ kg: b.kg, ultima: b.ultimaSalida, dias: b.diasSinSalir, salio: b.kgSalio, alcanza: b.alcanzaPara },
      { kg: "30.000", ultima: "2026-10-02", dias: 18, salio: "20.000", alcanza: 42 });
    // Lo que llegó por la separación no es una salida del que lo recibe.
    assert.equal(p.materiales.find((m) => m.nombre === "Magnesio")!.kgSalio, "3.000");
  }));

// Lo encontró Codex (docs/revisiones/2026-10-13-codex-revision-de-los-intentos-y-el-sello.md, D2):
// con muchísimo de un material y una salida diminuta, los días para los que alcanza no cabían en
// un entero, y ni el patio ni la ficha salían.
test("si de algo hay muchísimo y casi no sale, «alcanza para» se queda en diez años o más: no revienta el patio ni la ficha", () =>
  conPatio(async ({ bd, db, e }) => {
    const cobre = e.mat["Cobre de primera"]!;
    await db.query("SELECT registrar_apertura($1, 1000000, 'estimado', $2)", [cobre, e.responsable]);
    await hecha(bd, e.mostrador, e, "venta", [["Cobre de primera", "0.01"]]);
    const delPatio = (await materialesDelPatio(bd, { hoy: "2026-10-20" })).materiales.find((m) => m.nombre === "Cobre de primera")!;
    assert.deepEqual({ kg: delPatio.kg, salio: delPatio.kgSalio, alcanza: delPatio.alcanzaPara }, { kg: "999999.990", salio: "0.010", alcanza: 3650 });
    assert.equal((await fichaDeMaterial(bd, cobre, { dias: 30, hasta: "2026-10-20" }))!.material.alcanzaPara, 3650);
    // Lo que alcanza para menos de eso sigue saliendo exacto.
    assert.equal((await materialesDelPatio(bd, { hoy: "2026-10-20" })).materiales.find((m) => m.nombre === "PET")!.alcanzaPara, 168);
  }));

test("lo dado de baja no cuenta como salida", () =>
  conPatio(async ({ bd }) => {
    // Al Cartón se le dieron de baja 5 kg el 2 de octubre: su última salida sigue siendo la venta del 1.
    assert.equal((await materialesDelPatio(bd, { hoy: "2026-10-20" })).materiales.find((m) => m.nombre === "Cartón")!.ultimaSalida, "2026-10-01");
  }));

test("sin decir qué día es, hoy es la fecha del patio; y sin nada todavía, el patio sale vacío", () =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 2 });
    try {
      const p = await materialesDelPatio(bd, {});
      assert.equal(p.hoy, (await db.query("SELECT to_char(hoy_en(1::smallint), 'YYYY-MM-DD') AS f")).rows[0].f);
      assert.deepEqual({ listaDel: p.listaDel, valor: p.valor, seQuedan: p.seQuedan, materiales: p.materiales },
        { listaDel: null, valor: "0.00", seQuedan: { dias: 30, materiales: 0, valor: "0.00" }, materiales: [] });
    } finally {
      await bd.cerrar();
    }
  }));

// ── la ficha de un material ─────────────────────────────────────────────────

test("la ficha suma lo que entró y lo que salió de ese material, y a cuánto salió el kilo en promedio", () =>
  conPatio(async ({ bd, e }) => {
    const f = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-20" }))!;
    assert.deepEqual({ desde: f.desde, hasta: f.hasta, dias: f.dias, paso: f.paso }, { desde: "2026-09-21", hasta: "2026-10-20", dias: 30, paso: "dia" });
    assert.deepEqual(sinFamilia(f.material), { ...CARTON, id: undefined, familia: undefined });
    assert.deepEqual(f.totales, {
      compras: 3, ventas: 1,
      kgComprado: "50.200", importeComprado: "105.12", kgVendido: "200.300", importeVendido: "500.75",
      // Por cada kilo que entró: 105.12 / 50.2. El descuento baja lo que costó el kilo.
      porKiloComprado: "2.0940", porKiloVendido: "2.5000", diferenciaPorKilo: "0.4060",
      kgDescontadoEnCompras: "1.000", kgDescontadoEnVentas: "0.000",
    });
  }));

test("la serie trae todos los días del periodo, con lo que entró, lo que salió y lo que quedó en el patio al terminar cada uno", () =>
  conPatio(async ({ bd, e }) => {
    const f = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-20" }))!;
    assert.equal(f.serie.length, 30);
    assert.ok(f.serie.every((t) => t.desde === t.hasta));
    assert.equal(f.kgAlEmpezar, "0.000");
    const nada = { kgComprado: "0.000", importeComprado: "0.00", kgVendido: "0.000", importeVendido: "0.00" };
    assert.deepEqual(f.serie.slice(8, 12), [
      { desde: "2026-09-29", hasta: "2026-09-29", ...nada, kgAlFinal: "0.000" },
      { desde: "2026-09-30", hasta: "2026-09-30", ...nada, kgAlFinal: "1000.000" },      // el saldo inicial
      { desde: "2026-10-01", hasta: "2026-10-01", kgComprado: "40.200", importeComprado: "84.42", kgVendido: "200.300", importeVendido: "500.75", kgAlFinal: "839.900" },
      { desde: "2026-10-02", hasta: "2026-10-02", kgComprado: "10.000", importeComprado: "20.70", kgVendido: "0.000", importeVendido: "0.00", kgAlFinal: "844.900" },   // con la baja de 5 kg
    ]);
    assert.deepEqual(f.serie.at(-1), { desde: "2026-10-20", hasta: "2026-10-20", ...nada, kgAlFinal: "844.900" });
  }));

test("a tres meses la ficha va por semanas, sin perder ni repetir un día", () =>
  conPatio(async ({ bd, e }) => {
    const f = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 91, hasta: "2026-10-20" }))!;
    assert.deepEqual({ desde: f.desde, paso: f.paso, tramos: f.serie.length }, { desde: "2026-07-22", paso: "semana", tramos: 13 });
    assert.deepEqual(f.serie[10], {
      desde: "2026-09-30", hasta: "2026-10-06", kgComprado: "50.200", importeComprado: "105.12", kgVendido: "200.300", importeVendido: "500.75", kgAlFinal: "844.900",
    });
    assert.deepEqual({ desde: f.serie[12]!.desde, hasta: f.serie[12]!.hasta, alFinal: f.serie[12]!.kgAlFinal }, { desde: "2026-10-14", hasta: "2026-10-20", alFinal: "844.900" });
    assert.equal(f.totales.kgComprado, "50.200");
  }));

test("lo de después del periodo no entra en sus totales; lo que había antes es con lo que empieza", () =>
  conPatio(async ({ bd, e }) => {
    // Hasta el 1 de octubre: lo del 2 queda fuera. Lo que hay ahora no depende del periodo.
    const f = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-01" }))!;
    assert.deepEqual({ compras: f.totales.compras, kg: f.totales.kgComprado, importe: f.totales.importeComprado, porKilo: f.totales.porKiloComprado, descontado: f.totales.kgDescontadoEnCompras },
      { compras: 2, kg: "40.200", importe: "84.42", porKilo: "2.1000", descontado: "0.000" });
    assert.equal(f.serie.at(-1)!.kgAlFinal, "839.900");
    assert.equal(f.material.kg, "844.900");
    assert.deepEqual({ mermas: f.control.mermas, kg: f.control.mermaKg }, { mermas: 0, kg: "0.000" });
    // Del 2 al 31 de octubre: empieza con lo que dejó el día 1.
    const despues = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-31" }))!;
    assert.deepEqual({ desde: despues.desde, alEmpezar: despues.kgAlEmpezar, ventas: despues.totales.ventas, porKiloVendido: despues.totales.porKiloVendido, diferencia: despues.totales.diferenciaPorKilo },
      { desde: "2026-10-02", alEmpezar: "839.900", ventas: 0, porKiloVendido: null, diferencia: null });
  }));

test("la ficha dice lo que se le perdió al material: lo dado de baja, lo ajustado y lo que se separó", () =>
  conPatio(async ({ bd, e, bronce }) => {
    const carton = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-20" }))!;
    assert.deepEqual(carton.control, { mermas: 1, mermaKg: "5.000", ajustes: 0, ajusteEntroKg: "0.000", ajusteSalioKg: "0.000", separadoKg: "0.000", deSeparacionKg: "0.000" });
    await separar(bd, e.mostrador, { id: randomUUID(), origen: bronce, kg: "20", productos: [{ material: e.mat["Magnesio"]!, kg: "18" }], nota: null });
    assert.equal((await fichaDeMaterial(bd, bronce, { dias: 30, hasta: "2026-10-20" }))!.control.separadoKg, "20.000");
    const magnesio = (await fichaDeMaterial(bd, e.mat["Magnesio"]!, { dias: 30, hasta: "2026-10-20" }))!;
    assert.equal(magnesio.control.deSeparacionKg, "18.000");
    // Lo que llegó por separación está en el patio aunque no se haya comprado: 3 − 3 + 18.
    assert.deepEqual({ kg: magnesio.material.kg, alFinal: magnesio.serie.at(-1)!.kgAlFinal, comprado: magnesio.totales.kgComprado }, { kg: "18.000", alFinal: "18.000", comprado: "3.000" });
  }));

test("la ficha trae la historia de precios de ese material en el mismo periodo", () =>
  conPatio(async ({ bd, e, bronce }) => {
    const f = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-20" }))!;
    assert.deepEqual({ alEmpezar: f.precios!.alEmpezar, ahora: f.precios!.ahora, cambios: f.precios!.cambios, veces: f.precios!.veces }, {
      alEmpezar: null, ahora: { compra: "2.3000", venta: "2.7000" }, veces: 1,
      cambios: [{ fecha: "2026-10-01", compra: "2.1000", venta: "2.5000" }, { fecha: "2026-10-02", compra: "2.3000", venta: "2.7000" }],
    });
    // Un material que nunca ha tenido precio no tiene historia, y su ficha sale igual.
    const b = (await fichaDeMaterial(bd, bronce, { dias: 30, hasta: "2026-10-20" }))!;
    assert.equal(b.precios, null);
    assert.deepEqual({ compras: b.totales.compras, porKilo: b.totales.porKiloComprado, alFinal: b.serie.at(-1)!.kgAlFinal }, { compras: 0, porKilo: null, alFinal: "50.000" });
  }));

test("una cuenta que sigue abierta no cuenta en la ficha", () =>
  conPatio(async ({ bd, e }) => {
    const antes = (await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-20" }))!.totales;
    const abierta = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: "Don Chuy" });
    await agregarMaterial(bd, e.mostrador, abierta.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["Cartón"]!, bascula: 2, kg: "500" });
    assert.deepEqual((await fichaDeMaterial(bd, e.mat["Cartón"]!, { dias: 30, hasta: "2026-10-20" }))!.totales, antes);
  }));

test("de un material que no existe no hay ficha", () =>
  conPatio(async ({ bd }) => {
    assert.equal(await fichaDeMaterial(bd, 999_999, { dias: 30, hasta: "2026-10-20" }), null);
  }));

// ── por las rutas ───────────────────────────────────────────────────────────

const conDia = (prueba: (p: { jefe: Navegador; consulta: Navegador; caja: Navegador; carton: number }) => Promise<void>) =>
  conMundo(async (m) => {
    const carton = await material(m.db, "Cartón");
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/x", { saldos: [{ material: carton, kg: "500", origen: "estimado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/x");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/x", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/x");
    await prueba({ jefe, consulta: await m.adentro("consulta"), caja: await m.adentro("mostrador"), carton });
  });

const codigoDe = async (r: Response): Promise<string> => (await r.json()).error?.codigo;

test("el patio y la ficha los ven quien dirige y quien consulta; el mostrador, no", () =>
  conDia(async ({ jefe, consulta, caja, carton }) => {
    const patio = await ruta("panel/materiales", "GET");
    const ficha = await ruta("panel/materiales/[material]", "GET");
    const par = { parametros: { material: String(carton) } };
    for (const n of [jefe, consulta]) {
      const p = (await n.bien(patio, "GET", "/api/panel/materiales")).patio;
      assert.deepEqual(p.materiales.map((m: { nombre: string; kg: string }) => [m.nombre, m.kg]), [["Cartón", "500.000"]]);
      const f = (await n.bien(ficha, "GET", "/api/panel/materiales/x", undefined, par)).ficha;
      assert.deepEqual({ nombre: f.material.nombre, dias: f.dias, tramos: f.serie.length }, { nombre: "Cartón", dias: 30, tramos: 30 });
    }
    for (const [manejador, extra] of [[patio, undefined], [ficha, par]] as const) {
      const r = await caja.pedir(manejador, "GET", "/api/panel/materiales", undefined, extra);
      assert.equal(r.status, 403);
      assert.equal(await codigoDe(r), "ROL");
    }
  }));

test("la ficha se pide por 30 días o por 3 meses; otro periodo, o un material que no es un número, no pasa", () =>
  conDia(async ({ jefe, carton }) => {
    const ficha = await ruta("panel/materiales/[material]", "GET");
    const pedir = (consulta: string, material = String(carton)) => jefe.pedir(ficha, "GET", `/api/panel/materiales/x${consulta}`, undefined, { parametros: { material } });
    assert.equal((await (await pedir("?dias=91")).json()).ficha.serie.length, 13);
    for (const mala of ["7", "365", "30.5", "mes", ""]) {
      const r = await pedir(`?dias=${mala}`);
      assert.equal(r.status, 400, `dias=${mala}`);
      assert.equal(await codigoDe(r), "FORMA");
    }
    for (const malo of ["carton", "1.5", "-1", ""]) {
      const r = await pedir("", malo);
      assert.equal(r.status, 400, `material=${malo}`);
      assert.equal(await codigoDe(r), "FORMA");
    }
    const r = await pedir("", "999999");
    assert.equal(r.status, 404);
    assert.equal(await codigoDe(r), "NO_EXISTE");
  }));
