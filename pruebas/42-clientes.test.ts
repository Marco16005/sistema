// Los clientes del panel: solo las cuentas cobradas que conservaron algún precio especial.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { material, una, urlApp } from "./apoyo.ts";
import { CLAVES, conMundo, ruta } from "./mundo.ts";
import type { Mundo } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { clientesDelPanel, fichaDeCliente, resumenDeClientes } from "../src/servidor/dominio/clientes.ts";

import { ErrorDeForma } from "../src/servidor/numeros.ts";

interface Patio { m: Mundo; bd: Bd; jefe: Navegador; caja: Navegador; carton: number; hoy: string; jornada: string }
const conPatio = (prueba: (p: Patio) => Promise<void>) => conMundo(async (m) => {
  const carton = await material(m.db, "Cartón");
  const jefe = await m.adentro("responsable");
  await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/x", { saldos: [{ material: carton, kg: "500", origen: "estimado" }] });
  await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/x");
  await jefe.bien(await ruta("precios", "POST"), "POST", "/api/x", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
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
  await p.caja.bien(await ruta("cuentas", "POST"), "POST", "/api/x", { id, tipo, etiqueta: null });
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

const CEROS = { cuentas: 0, compras: 0, ventas: 0, pagado: "0", cobrado: "0", kgComprado: "0.000", kgVendido: "0.000", diferenciaEnCompras: "0.00", diferenciaEnVentas: "0.00", ultimaVez: null };

test("clientesDelPanel cuenta la compra especial cobrada y coincide con la diferencia del cierre", () => conPatio(async (p) => {
  const c = await cuenta(p, "Don Chuy");
  const clientes = await clientesDelPanel(p.bd);
  assert.deepEqual(clientes, [{ id: c.cliente, nombre: "Don Chuy", activo: true, cuentas: 1, compras: 1, ventas: 0, pagado: "260", cobrado: "0", kgComprado: "100.000", kgVendido: "0.000", diferenciaEnCompras: "50.00", diferenciaEnVentas: "0.00", ultimaVez: p.hoy }]);
  const cierre = await una(p.m.db, "SELECT sum(diferencia)::numeric(14,2)::text AS diferencia FROM precios_especiales_del_dia($1)", [p.jornada]);
  assert.equal(clientes[0]!.diferenciaEnCompras, cierre.diferencia);
}));

test("clientesDelPanel separa compras y ventas y conserva negativa la rebaja de venta", () => conPatio(async (p) => {
  await cuenta(p, "Don Chuy");
  await cuenta(p, "Don Chuy", "venta");
  const [c] = await clientesDelPanel(p.bd);
  assert.deepEqual(c, { id: c!.id, nombre: "Don Chuy", activo: true, cuentas: 2, compras: 1, ventas: 1, pagado: "260", cobrado: "200", kgComprado: "100.000", kgVendido: "100.000", diferenciaEnCompras: "50.00", diferenciaEnVentas: "-50.00", ultimaVez: p.hoy });
}));

test("clientesDelPanel excluye abiertas, descartadas, precios quitados y cuentas sin cliente; ordena por actividad y nombre sin mayúsculas", () => conPatio(async (p) => {
  await cuenta(p, "Abierta", "compra", "abierta");
  await cuenta(p, "Quitada", "compra", "quitar");
  await cuenta(p, "Descartada", "compra", "descartar");
  await cuenta(p, null);
  await cuenta(p, "Zeta");
  await cuenta(p, "alfa");
  const clientes = await clientesDelPanel(p.bd);
  assert.deepEqual(clientes.map((c) => c.nombre), ["alfa", "Zeta", "Abierta", "Descartada", "Quitada"]);
  for (const c of clientes.slice(2)) assert.deepEqual(c, { id: c.id, nombre: c.nombre, activo: true, ...CEROS });
  for (const c of clientes.slice(0, 2)) assert.equal(c.cuentas, 1);
}));

test("clientesDelPanel conserva cuentas por id al renombrar y dar de baja al cliente", () => conPatio(async (p) => {
  const c = await cuenta(p, "Don Chuy");
  const [antes] = await clientesDelPanel(p.bd);
  await p.m.db.query("SELECT renombrar_cliente($1, 'Jesús')", [c.cliente]);
  await p.m.db.query("SELECT baja_de_cliente($1)", [c.cliente]);
  assert.deepEqual(await clientesDelPanel(p.bd), [{ ...antes, nombre: "Jesús", activo: false }]);
}));

test("fichaDeCliente comparte el resumen y detalla materiales, autorizaciones y cuentas del cliente aunque cambie de nombre", () => conPatio(async (p) => {
  const compra = await cuenta(p, "Don Chuy");
  const venta = await cuenta(p, "Don Chuy", "venta");
  await cuenta(p, "Otro");
  await cuenta(p, "Don Chuy", "compra", "abierta");
  await cuenta(p, "Don Chuy", "compra", "quitar");
  await p.m.db.query("SELECT renombrar_cliente($1, 'Jesús')", [compra.cliente]);
  const ficha = await fichaDeCliente(p.bd, compra.cliente);
  assert.ok(ficha);
  assert.deepEqual(ficha.cliente, (await clientesDelPanel(p.bd)).find((c) => c.id === compra.cliente));
  assert.equal(ficha.cliente.nombre, "Jesús");
  assert.deepEqual(ficha.materiales, [{ nombre: "Cartón", kgComprado: "100.000", importeComprado: "260.00", kgVendido: "100.000", importeVendido: "200.00" }]);
  const folioCompra = (await una(p.m.db, "SELECT folio::text FROM operacion WHERE id = $1", [compra.id])).folio;
  const folioVenta = (await una(p.m.db, "SELECT folio::text FROM operacion WHERE id = $1", [venta.id])).folio;
  assert.deepEqual(ficha.precios, [
    { fecha: p.hoy, folio: folioVenta, tipo: "venta", material: "Cartón", kg: "100.000", precioLista: "2.5000", precio: "2.0000", diferencia: "-50.00", autorizo: "De responsable" },
    { fecha: p.hoy, folio: folioCompra, tipo: "compra", material: "Cartón", kg: "100.000", precioLista: "2.1000", precio: "2.6000", diferencia: "50.00", autorizo: "De responsable" },
  ]);
  assert.deepEqual(ficha.cuentas, [
    { id: venta.id, folio: folioVenta, fecha: p.hoy, tipo: "venta", total: "200", materiales: 1, atendio: "De mostrador" },
    { id: compra.id, folio: folioCompra, fecha: p.hoy, tipo: "compra", total: "260", materiales: 1, atendio: "De mostrador" },
  ]);
}));

test("fichaDeCliente devuelve listas vacías sin cuentas, null si no existe y ErrorDeForma para ids inválidos", () => conPatio(async (p) => {
  const c = await cuenta(p, "Sin cuentas", "compra", "descartar");
  assert.deepEqual(await fichaDeCliente(p.bd, c.cliente), {
    cliente: (await clientesDelPanel(p.bd))[0], materiales: [], precios: [], cuentas: [],
  });
  assert.equal(await fichaDeCliente(p.bd, "999999"), null);
  for (const id of ["abc", "0", "-1", "1.5", "", " 1", "9223372036854775808"]) {
    await assert.rejects(() => fichaDeCliente(p.bd, id), ErrorDeForma);
  }
}));

test("las rutas de clientes permiten responsable y consulta; rechazan otros roles y equipos sin persona", () => conPatio(async (p) => {
  const c = await cuenta(p, "Don Chuy");
  for (const camino of ["clientes/resumen", "clientes/[cliente]"]) {
    const get = await ruta(camino, "GET");
    const extra = { parametros: { cliente: c.cliente } };
    const url = camino === "clientes/resumen" ? "/api/clientes/resumen" : `/api/clientes/${c.cliente}`;
    for (const n of [p.jefe, await p.m.adentro("consulta")]) {
      const datos = await n.bien(get, "GET", url, undefined, extra);
      assert.deepEqual(datos, camino === "clientes/resumen" ? await resumenDeClientes(p.bd) : { ficha: await fichaDeCliente(p.bd, c.cliente) });
    }
    for (const rol of ["mostrador", "patio", "administracion"] as const) {
      const r = await (await p.m.adentro(rol)).pedir(get, "GET", url, undefined, extra);
      assert.equal(r.status, 403, rol);
      assert.equal((await r.json()).error.codigo, "ROL");
    }
    assert.equal((await (await p.m.equipo()).pedir(get, "GET", url, undefined, extra)).status, 401);
  }
}));

test("la ruta de ficha devuelve 404 NO_EXISTE para un cliente ausente y 400 FORMA para abc", () => conPatio(async (p) => {
  const get = await ruta("clientes/[cliente]", "GET");
  for (const [cliente, estado, codigo] of [["999999", 404, "NO_EXISTE"], ["abc", 400, "FORMA"]] as const) {
    const r = await p.jefe.pedir(get, "GET", `/api/clientes/${cliente}`, undefined, { parametros: { cliente } });
    assert.equal(r.status, estado);
    const datos = await r.json();
    assert.equal(datos.error.codigo, codigo);
    if (estado === 404) assert.equal(datos.error.mensaje, "Ese cliente no existe");
  }
}));

test("la ficha suma todos los renglones sin duplicar cuentas y distingue kilos recibidos de liquidables", () => conPatio(async (p) => {
  const c = await cuenta(p, "Don Chuy", "compra", "abierta");
  const par = { parametros: { cuenta: c.id } };
  await p.caja.bien(await ruta("cuentas/[cuenta]/descuento", "POST"), "POST", "/api/x", { linea: c.linea, kg: "0.012" }, par);
  const r = await p.caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x", { linea: randomUUID(), captura: randomUUID(), material: p.carton, bascula: 2, kg: "10" }, par);
  await p.caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision: r.cuenta.revision }, par);
  const f = await fichaDeCliente(p.bd, c.cliente);
  assert.ok(f);
  assert.equal(f.cliente.cuentas, 1);
  assert.equal(f.cliente.pagado, "281");
  assert.equal(f.cliente.kgComprado, "110.000");
  assert.equal(f.cliente.diferenciaEnCompras, "50.00");
  assert.deepEqual(f.materiales, [{ nombre: "Cartón", kgComprado: "110.000", importeComprado: "280.97", kgVendido: "0.000", importeVendido: "0.00" }]);
  assert.equal(f.cuentas[0]!.materiales, 2);
  assert.equal(f.precios.length, 1);
  assert.equal(f.precios[0]!.kg, "99.988");
  // Restar importes redondeados da 50.00; redondear kilos por diferencia daría 49.99.
  assert.equal(f.precios[0]!.diferencia, "50.00");
}));

test("la ficha limita a 200 precios y cuentas recientes sin recortar los totales ni los materiales", () => conPatio(async (p) => {
  const ids: string[] = [];
  let cliente = "";
  for (let i = 0; i < 201; i++) {
    const c = await cuenta(p, "Don Chuy");
    ids.push(c.id);
    cliente = c.cliente;
  }
  const f = await fichaDeCliente(p.bd, cliente);
  assert.ok(f);
  assert.equal(f.cliente.cuentas, 201);
  assert.equal(f.cliente.pagado, "52260");
  assert.equal(f.cliente.diferenciaEnCompras, "10050.00");
  assert.equal(f.materiales[0]!.kgComprado, "20100.000");
  assert.equal(f.precios.length, 200);
  assert.equal(f.cuentas.length, 200);
  assert.deepEqual(f.cuentas.map((c) => c.id), ids.slice(1).reverse());
  assert.deepEqual(f.precios.map((p) => p.folio), f.cuentas.map((c) => c.folio));
}));

// ── lo de todos juntos, para los indicadores de la pantalla ───────────────

test("resumenDeClientes trae la lista y lo que suman todos: cuántos hay, cuántos siguen activos, sus cuentas y lo que movieron sus precios", () => conPatio(async (p) => {
  const SIN_NADIE = { clientes: 0, activos: 0, cuentas: 0, diferenciaEnCompras: "0.00", diferenciaEnVentas: "0.00" };
  assert.deepEqual(await resumenDeClientes(p.bd), { clientes: [], totales: SIN_NADIE });
  await cuenta(p, "Don Chuy");
  await cuenta(p, "Don Chuy", "venta");
  const lupe = await cuenta(p, "Doña Lupe");
  await cuenta(p, "Sin cobrar", "compra", "abierta");
  await p.m.db.query("SELECT baja_de_cliente($1)", [lupe.cliente]);
  const r = await resumenDeClientes(p.bd);
  // Tres clientes dados de alta (uno, sin ninguna cuenta cobrada) y uno de baja; tres cuentas cobradas.
  assert.deepEqual(r.totales, { clientes: 3, activos: 2, cuentas: 3, diferenciaEnCompras: "100.00", diferenciaEnVentas: "-50.00" });
  assert.deepEqual(r.clientes, await clientesDelPanel(p.bd));
  assert.deepEqual(r.clientes.map((c) => c.nombre), ["Don Chuy", "Doña Lupe", "Sin cobrar"]);
}));

test("la ruta del resumen manda también lo que suman todos", () => conPatio(async (p) => {
  await cuenta(p, "Don Chuy");
  const r = await p.jefe.bien(await ruta("clientes/resumen", "GET"), "GET", "/api/clientes/resumen");
  assert.deepEqual(r.totales, { clientes: 1, activos: 1, cuentas: 1, diferenciaEnCompras: "50.00", diferenciaEnVentas: "0.00" });
  assert.equal(r.clientes.length, 1);
}));
