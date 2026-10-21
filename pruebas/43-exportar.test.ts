// Archivos CSV: texto para Excel y cifras que salen de la base.
import assert from "node:assert/strict";
import { test } from "node:test";
import { comoCsv, tablaPara } from "../src/servidor/dominio/exportar.ts";

test("comoCsv lleva marca UTF-8, termina cada renglón con CRLF y deja null vacío", () => {
  assert.equal(comoCsv({ encabezados: ["Nombre", "Total"], filas: [["José", null], ["Ana", "-57"]], deTexto: [0] }),
    '\uFEFFNombre,Total\r\nJosé,\r\nAna,-57\r\n');
});

test("comoCsv encierra comas, comillas y saltos y duplica las comillas", () => {
  assert.equal(comoCsv({ encabezados: ["Texto"], filas: [['a,b'], ['a"b'], ['a\nb'], ['a\rb']], deTexto: [0] }),
    '\uFEFFTexto\r\n"a,b"\r\n"a""b"\r\n"a\nb"\r\n"a\rb"\r\n');
});

test("comoCsv protege fórmulas solo en columnas de texto y conserva números negativos", () => {
  assert.equal(comoCsv({ encabezados: ["Texto", "Número"], filas: [["=SUMA(A1)", "-57"], ["-Juan", "+2"], ["+Luis", null], ["@Ana", null], ["\tJuan", null], ["\rJuan", null]], deTexto: [0] }),
    '\uFEFFTexto,Número\r\n\'=SUMA(A1),-57\r\n\'-Juan,+2\r\n\'+Luis,\r\n\'@Ana,\r\n\'\tJuan,\r\n"\'\rJuan",\r\n');
});

// Un mismo archivo lo abren programas que no lo leen igual: donde la lista se separa con punto y
// coma (o con tabulador), lo que aquí es UNA celda allá son dos, y la segunda puede empezar como
// fórmula. Por eso, en lo que escribió una persona, la fórmula se desarma donde sea que pudiera
// quedar al principio de una celda, no solo al principio de la nuestra.
const celdaDeTexto = (texto: string): string => comoCsv({ encabezados: ["Texto"], filas: [[texto]], deTexto: [0] }).slice("\uFEFFTexto\r\n".length, -2);

test("comoCsv desarma la fórmula que quedaría al principio de una celda en un programa que separa con punto y coma, tabulador o renglón", () => {
  assert.equal(celdaDeTexto("x;=1+1"), "x;'=1+1");
  assert.equal(celdaDeTexto("x; =1+1"), "x; '=1+1");
  assert.equal(celdaDeTexto("x\t@SUMA(A1)"), "x\t'@SUMA(A1)");
  assert.equal(celdaDeTexto("uno\n=2+2"), '"uno\n\'=2+2"');
  assert.equal(celdaDeTexto('a,"b";-cmd'), '"a,""b"";\'-cmd"');
  assert.equal(celdaDeTexto("Pérez, +52 55"), '"Pérez, \'+52 55"');
});

test("comoCsv también desarma la fórmula escondida tras espacios, y la escrita con signos de ancho completo", () => {
  assert.equal(celdaDeTexto("  =SUMA(A1)"), "'  =SUMA(A1)");
  assert.equal(celdaDeTexto("\u00a0-Juan"), "'\u00a0-Juan");
  assert.equal(celdaDeTexto("＝1+1"), "'＝1+1");
  assert.equal(celdaDeTexto("x;＋1"), "x;'＋1");
});

test("comoCsv no toca lo que no es fórmula: un guion o un signo en medio de un nombre, ni las columnas que no son de texto", () => {
  for (const nombre of ["Ana-María", "Juan Pérez; el de la esquina", "Taller 5+", "correo@ejemplo.com", "Camioneta roja, la grande"]) {
    assert.equal(comoCsv({ encabezados: ["Texto"], filas: [[nombre]], deTexto: [0] }).includes("'"), false, nombre);
  }
  assert.equal(comoCsv({ encabezados: ["Número"], filas: [["-57"], ["2;=1"]], deTexto: [] }), "\uFEFFNúmero\r\n-57\r\n2;=1\r\n");
});

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { abrirJornada, cerrarSinCorte, conBase, escenario, material, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { CLAVES, conMundo, ruta } from "./mundo.ts";
import type { Mundo } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { resumenDelCierre } from "../src/servidor/dominio/cierre.ts";
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
import { estadoDelDia } from "../src/servidor/dominio/dia.ts";

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
      const e = await escenario(db, { "Cartón": [2.1, 2.5], "PET": [7.5, 8.9] });
      await db.query("SELECT registrar_apertura($1, 1000, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "30.2"], ["PET", "4"]]);   // 63.42 + 30.00 = 93.42 → 93
      await hecha(bd, e.mostrador, e, "compra", [["Cartón", "10"]]);                   // 21.00 → 21
      await hecha(bd, e.mostrador, e, "venta", [["Cartón", "200.3"]]);                 // 500.75 → 501
      const dia = await estadoDelDia(bd);
      await cerrarSinCorte(db, dia.jornada!.id, dia.jornada!.cierres, e.mostrador);

      const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
      await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
      await hecha(bd, e.mostrador, e, "compra", [["PET", "10"]]);                      // 75.00 → 75
      await hecha(bd, e.responsable, e, "venta", [["PET", "2"]]);                      // 17.80 → 18
      await prueba({ bd, db, e, ayer: e.jornada, hoy: hoy.id });
    } finally {
      await bd.cerrar();
    }
  });

interface Patio { m: Mundo; bd: Bd; jefe: Navegador; caja: Navegador; carton: number; hoy: string; jornada: string }
const conPatio = (prueba: (p: Patio) => Promise<void>) => conMundo(async (m) => {
  const carton = await material(m.db, "Cartón");
  const jefe = await m.adentro("responsable");
  await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/x", { saldos: [{ material: carton, kg: "500", origen: "estimado" }] });
  await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/x");
  await jefe.bien(await ruta("precios", "POST"), "POST", "/api/x", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }, { material: await material(m.db, "PET"), compra: "7.5", venta: "8.9" }] });
  await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/x");
  const dia = await una(m.db, "SELECT id::text, fecha::text FROM jornada WHERE cerrada_en IS NULL");
  const bd = crearBd(await urlApp(m.base), { conexiones: 2 });
  try { await prueba({ m, bd, jefe, caja: await m.adentro("mostrador"), carton, hoy: dia.fecha, jornada: dia.id }); }
  finally { await bd.cerrar(); }
});

/** Una cuenta por las rutas reales; permite dejarla abierta, quitar el precio o descartarla. */
async function cuenta(p: Patio, nombre: string | null, tipo: "compra" | "venta" = "compra", final: "cobrar" | "abierta" | "quitar" | "descartar" = "cobrar") {
  const id = randomUUID();
  const linea = randomUUID();
  const par = { parametros: { cuenta: id } };
  await p.caja.bien(await ruta("cuentas", "POST"), "POST", "/api/x", { id, tipo, etiqueta: "Camioneta" });
  let r = await p.caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x", { linea, captura: randomUUID(), material: p.carton, bascula: 2, kg: "100" }, par);
  if (nombre !== null) {
    r = await p.caja.bien(await ruta("cuentas/[cuenta]/precio-especial", "POST"), "POST", "/api/x", {
      id: randomUUID(), linea, visto: null, cliente: null, clienteNuevo: nombre,
      diferencia: tipo === "compra" ? "0.50" : "-0.50", autoriza: p.m.personas.responsable, clave: CLAVES.responsable,
    }, par);
  }
  const cliente = r.cuenta.cliente?.id as string | undefined;
  if (final === "quitar") {
    const evento = await una(p.m.db, "SELECT precio_evento::text FROM operacion_linea WHERE id = $1", [linea]);
    r = await p.caja.bien(await ruta("cuentas/[cuenta]/precio-especial/quitar", "POST"), "POST", "/api/x", { id: randomUUID(), linea, visto: evento.precio_evento }, par);
  }
  if (final === "descartar") await p.caja.bien(await ruta("cuentas/[cuenta]/descartar", "POST"), "POST", "/api/x", {}, par);
  if (final === "cobrar" || final === "quitar") r = await p.caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision: r.cuenta.revision }, par);
  return { id, cliente: cliente!, linea };
}


test("cuentas ordena por fecha y folio, suma renglones y omite abiertas y días fuera del periodo", () => conDosDias(async ({ bd, db, e }) => {
  await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: "Abierta" });
  const t = await tablaPara(bd, { hoja: "cuentas", desde: "2026-10-01", hasta: "2026-10-02" });
  assert.deepEqual(t.encabezados, ["Fecha", "Hora", "Folio", "Tipo", "Cliente", "Nombre", "Materiales", "Kilos", "Total", "Atendió"]);
  assert.deepEqual(t.deTexto, [4, 5, 9]);
  assert.deepEqual(t.filas.map((f) => [f[0], ...f.slice(2)]), [
    ["2026-10-01", "1", "compra", null, null, "2", "34.200", "93", "Luis"],
    ["2026-10-01", "2", "compra", null, null, "1", "10.000", "21", "Luis"],
    ["2026-10-01", "3", "venta", null, null, "1", "200.300", "501", "Luis"],
    ["2026-10-02", "4", "compra", null, null, "1", "10.000", "75", "Luis"],
    ["2026-10-02", "5", "venta", null, null, "1", "2.000", "18", "Servando"],
  ]);
  const horas = (await db.query("SELECT to_char(o.confirmada_en AT TIME ZONE s.zona, 'HH24:MI') AS hora FROM operacion o JOIN sucursal s ON s.id = o.sucursal_id WHERE o.estado = 'confirmada' ORDER BY o.folio")).rows;
  assert.deepEqual(t.filas.map((f) => f[1]), horas.map((f) => f.hora));
  assert.deepEqual((await tablaPara(bd, { hoja: "cuentas", desde: "2026-10-02", hasta: "2026-10-02" })).filas, t.filas.slice(3));
}));

test("cuentas conserva cliente y etiqueta y usa kilos recibidos aunque haya descuento", () => conPatio(async (p) => {
  const c = await cuenta(p, "Don Chuy", "compra", "abierta");
  const par = { parametros: { cuenta: c.id } };
  const r = await p.caja.bien(await ruta("cuentas/[cuenta]/descuento", "POST"), "POST", "/api/x", { linea: c.linea, kg: "1" }, par);
  await p.caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision: r.cuenta.revision }, par);
  const t = await tablaPara(p.bd, { hoja: "cuentas", desde: p.hoy, hasta: p.hoy });
  assert.equal(t.filas.length, 1);
  assert.deepEqual(t.filas[0]!.slice(3), ["compra", "Don Chuy", "Camioneta", "1", "100.000", "257", "De mostrador"]);
}));

test("el periodo rechaza fechas inválidas, orden invertido y más de 366 días incluidos", () => conPatio(async (p) => {
  for (const fecha of ["ayer", "2026-2-01", "2026-02-30", "0000-01-01", "", "2026-13-01"]) {
    for (const o of [{ desde: fecha, hasta: p.hoy }, { desde: p.hoy, hasta: fecha }]) {
      await assert.rejects(() => tablaPara(p.bd, { hoja: "cuentas", ...o }), { name: "ErrorDeForma", message: /fecha.*AAAA-MM-DD/ });
    }
  }
  await assert.rejects(() => tablaPara(p.bd, { hoja: "cuentas", desde: "2026-10-02", hasta: "2026-10-01" }), { name: "ErrorDeForma", message: /primer día.*posterior al último/ });
  await assert.rejects(() => tablaPara(p.bd, { hoja: "cuentas", desde: "2024-01-01", hasta: "2025-01-01" }), { name: "ErrorDeForma", message: /366/ });
  assert.deepEqual((await tablaPara(p.bd, { hoja: "cuentas", desde: "2024-01-01", hasta: "2024-12-31" })).filas, []);
}));

test("dias coincide con cada cierre, incluye jornadas vacías y excluye las ajenas al periodo", () => conDosDias(async ({ bd, db, e, ayer, hoy }) => {
  const t = await tablaPara(bd, { hoja: "dias", desde: "2026-10-01", hasta: "2026-10-02" });
  assert.deepEqual(t.encabezados, ["Fecha", "Estado", "Cuentas", "Compras", "Ventas", "Pagado", "Cobrado", "Kilos comprados", "Kilos vendidos"]);
  assert.deepEqual(t.deTexto, []);
  assert.deepEqual(t.filas, [
    ["2026-10-01", "cerrado", "3", "2", "1", "114", "501", "44.200", "200.300"],
    ["2026-10-02", "abierto", "2", "1", "1", "75", "18", "10.000", "2.000"],
  ]);
  for (const [i, jornada] of [ayer, hoy].entries()) {
    const c = (await resumenDelCierre(bd, jornada))!;
    assert.deepEqual([t.filas[i]![0], t.filas[i]![2], ...t.filas[i]!.slice(5, 7)], [c.jornada.fecha, String(c.operaciones), c.aPagar, c.aCobrar]);
  }
  const dia = await estadoDelDia(bd);
  await cerrarSinCorte(db, hoy, dia.jornada!.cierres, e.mostrador);
  await abrirJornada(db, e.responsable, "2026-10-03");
  assert.deepEqual((await tablaPara(bd, { hoja: "dias", desde: "2026-10-03", hasta: "2026-10-04" })).filas,
    [["2026-10-03", "abierto", "0", "0", "0", "0", "0", "0.000", "0.000"]]);
}));

test("renglones conserva el orden de captura, descuento, precio especial y decimales de dos materiales", () => conPatio(async (p) => {
  const pet = await material(p.m.db, "PET");
  const c = await cuenta(p, "Don Chuy", "compra", "abierta");
  const par = { parametros: { cuenta: c.id } };
  await p.caja.bien(await ruta("cuentas/[cuenta]/descuento", "POST"), "POST", "/api/x", { linea: c.linea, kg: "0.012" }, par);
  const r = await p.caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x", { linea: randomUUID(), captura: randomUUID(), material: pet, bascula: 2, kg: "10" }, par);
  await p.caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision: r.cuenta.revision }, par);
  await cuenta(p, null, "compra", "abierta");
  const t = await tablaPara(p.bd, { hoja: "renglones", desde: p.hoy, hasta: p.hoy });
  assert.deepEqual(t.encabezados, ["Fecha", "Folio", "Tipo", "Cliente", "Material", "Peso bruto", "Tara", "Descuento", "Kilos", "Precio de lista", "Precio", "Importe", "Precio especial"]);
  assert.deepEqual(t.deTexto, [3, 4]);
  assert.deepEqual(t.filas, [
    [p.hoy, "1", "compra", "Don Chuy", "Cartón", "100.000", "0.000", "0.012", "99.988", "2.1000", "2.6000", "259.97", "sí"],
    [p.hoy, "1", "compra", "Don Chuy", "PET", "10.000", "0.000", "0.000", "10.000", "7.5000", "7.5000", "75.00", "no"],
  ]);
  assert.deepEqual((await tablaPara(p.bd, { hoja: "renglones", desde: "2024-01-01", hasta: "2024-01-01" })).filas, []);
}));

test("precios exporta listas publicadas en orden por fecha, familia y material; omite la sin publicar", () => conDosDias(async ({ bd, db, e, hoy }) => {
  const dia = await estadoDelDia(bd);
  await cerrarSinCorte(db, hoy, dia.jornada!.cierres, e.mostrador);
  await abrirJornada(db, e.responsable, "2026-10-03");
  const t = await tablaPara(bd, { hoja: "precios", desde: "2026-10-01", hasta: "2026-10-03" });
  assert.deepEqual(t.encabezados, ["Fecha", "Familia", "Material", "Compra", "Venta"]);
  assert.deepEqual(t.deTexto, [1, 2]);
  const materiales = (await db.query("SELECT m.nombre, f.nombre AS familia FROM material m JOIN familia f ON f.id = m.familia_id WHERE m.id = ANY($1::int[]) ORDER BY f.orden, m.id", [[e.mat["Cartón"], e.mat["PET"]]])).rows;
  const precios: Record<string, string[]> = { "Cartón": ["2.1000", "2.5000"], "PET": ["7.5000", "8.9000"] };
  assert.deepEqual(t.filas, ["2026-10-01", "2026-10-02"].flatMap((fecha) => materiales.map((m) => [fecha, m.familia, m.nombre, ...precios[m.nombre]!] )));
  assert.deepEqual((await tablaPara(bd, { hoja: "precios", desde: "2026-10-02", hasta: "2026-10-03" })).filas, t.filas.filter((f) => f[0] === "2026-10-02"));
  assert.deepEqual((await tablaPara(bd, { hoja: "precios", desde: "2026-10-03", hasta: "2026-10-03" })).filas, []);
}));

test("ruta permite responsable y consulta y entrega cada CSV con marca y encabezados de descarga", () => conPatio(async (p) => {
  const get = await ruta("exportar", "GET");
  for (const n of [p.jefe, await p.m.adentro("consulta")]) {
    for (const hoja of ["dias", "cuentas", "renglones", "precios"] as const) {
      const r = await n.pedir(get, "GET", `/api/exportar?hoja=${hoja}&desde=${p.hoy}&hasta=${p.hoy}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
      assert.equal(r.headers.get("content-disposition"), `attachment; filename="${hoja}-${p.hoy}-a-${p.hoy}.csv"`);
      assert.equal(r.headers.get("cache-control"), "no-store");
      // Response.text() consume la marca; inspeccionamos los bytes descargados.
      const cuerpo = Buffer.from(await r.arrayBuffer()).toString("utf8");
      const tabla = await tablaPara(p.bd, { hoja, desde: p.hoy, hasta: p.hoy });
      assert.ok(cuerpo.startsWith("\uFEFF" + tabla.encabezados.join(",") + "\r\n"));
      assert.equal(cuerpo, comoCsv(tabla));
    }
  }
}));

test("ruta rechaza mostrador, patio y administracion con ROL y sin persona con 401", () => conPatio(async (p) => {
  const get = await ruta("exportar", "GET");
  const url = `/api/exportar?hoja=dias&desde=${p.hoy}&hasta=${p.hoy}`;
  for (const rol of ["mostrador", "patio", "administracion"] as const) {
    const r = await (await p.m.adentro(rol)).pedir(get, "GET", url);
    assert.equal(r.status, 403, rol);
    assert.equal((await r.json()).error.codigo, "ROL");
  }
  assert.equal((await (await p.m.equipo()).pedir(get, "GET", url)).status, 401);
}));

test("ruta devuelve JSON FORMA si falta un parámetro, la hoja no existe o el periodo es inválido", () => conPatio(async (p) => {
  const get = await ruta("exportar", "GET");
  for (const consulta of [
    `hoja=todo&desde=${p.hoy}&hasta=${p.hoy}`, `hoja=dias&hasta=${p.hoy}`,
    `hoja=dias&desde=ayer&hasta=${p.hoy}`, `desde=${p.hoy}&hasta=${p.hoy}`,
    `hoja=dias&desde=${p.hoy}`, "hoja=dias&desde=2026-10-02&hasta=2026-10-01",
    "hoja=dias&desde=2024-01-01&hasta=2025-01-01",
  ]) {
    const r = await p.jefe.pedir(get, "GET", `/api/exportar?${consulta}`);
    assert.equal(r.status, 400, consulta);
    assert.match(r.headers.get("content-type")!, /application\/json/);
    assert.equal((await r.json()).error.codigo, "FORMA");
  }
}));
