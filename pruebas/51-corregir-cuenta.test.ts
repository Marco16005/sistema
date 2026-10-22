// La diferencia administrativa se prueba por la conexión de la aplicación, sin tocar el ticket.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { abrirCuenta, abrirJornada, agregarMaterial, cerrarSinCorte, comoApp, conApp, contar,
  desenlace, equipoDeAlta, esperarQueEspere, existencia, personaConClave, pidDe,
  rechaza, una } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const CLAVE = "481516";
interface Dia { app: pg.Client; db: pg.Client; e: Escenario; base: string; firma: string; huella: string }
const conDia = (prueba: (d: Dia) => Promise<void>) => conApp(async (app, db, e, base) => {
  const firma = await personaConClave(db, "Rosa", "responsable", CLAVE, true);
  const huella = await equipoDeAlta(db);
  await db.query("UPDATE jornada SET fecha=hoy_en(1::smallint) WHERE id=$1", [e.jornada]);
  await app.query("SELECT abrir_el_cajon($1,$2,1000,$3)", [randomUUID(), e.jornada, e.mostrador]);
  await prueba({ app, db, e, base, firma, huella });
});
async function cuenta(d: Dia, tipo = "compra", kg = "30", confirmar = true, mat = d.e.mat["Cartón"]!) {
  const o = await abrirCuenta(d.app, tipo, d.e.mostrador);
  const l = await agregarMaterial(d.app, o.id, mat, kg, d.e.mostrador);
  if (confirmar) await cobrar(d, o.id);
  return { op: o.id as string, linea: l.id as string };
}
const cobrar = (d: Dia, op: string) => una(d.app,
  "SELECT * FROM confirmar_cuenta($1,$2,(SELECT revision FROM operacion WHERE id=$1),'efectivo')", [op, d.e.mostrador]);
interface Orden { envio?: string; kg?: string; mat?: number; vistas?: number; liquidacion?: string; motivo?: string; autoriza?: string; clave?: string; quien?: string }
const corregir = (d: Dia, linea: string, o: Orden = {}, c = d.app) => una(c,
  "SELECT * FROM corregir_cuenta($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
  [o.envio ?? randomUUID(), linea, o.kg ?? "25", o.mat ?? d.e.mat["Cartón"], o.vistas ?? 0,
    o.liquidacion ?? "efectivo", o.motivo ?? "Error de registro", o.autoriza ?? d.firma,
    o.clave ?? CLAVE, d.huella, o.quien ?? d.e.mostrador]);
const esperado = async (d: Dia) => Number((await una(d.app, "SELECT esperado_en_cajon($1) AS n", [d.e.jornada])).n);
const fallos = async (d: Dia, quien = d.firma) => (await una(d.db, "SELECT * FROM intentos_de($1)", [quien])).fallos;
const cerrar = (d: Dia, contado = "947.50", c = d.app) => una(c,
  "SELECT * FROM cerrar_el_dia($1,$2,0,$3,$3,$4,$5,$6,$7)",
  [randomUUID(), d.e.jornada, contado, d.firma, CLAVE, d.huella, d.e.mostrador]);

// Fotografías completas: no basta con conservar solo el total del comprobante.
const original = (d: Dia, op: string) => una(d.app,
  "SELECT to_jsonb(o) AS cuenta, (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM operacion_linea l WHERE l.operacion_id=o.id) AS renglones FROM operacion o WHERE o.id=$1", [op]);

test("compra 30 a 25: devuelve $10.50, baja 5 kg, conserva ticket, costo y corte", () => conDia(async d => {
  const c = await cuenta(d);
  const antes = await original(d, c.op);
  assert.equal(await esperado(d), 937);
  const r = await corregir(d, c.linea);
  assert.equal(r.numero, 1);
  assert.equal(r.kg_antes, "30.000");
  assert.equal(r.kg_despues, "25.000");
  assert.equal(r.importe_antes, "63.00");
  assert.equal(r.importe_despues, "52.50");
  assert.equal(r.diferencia, "-10.50");
  assert.equal(r.autorizado_por, d.firma);
  assert.equal(r.registrado_por, d.e.mostrador);
  assert.equal(r.jornada_id, d.e.jornada);
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 25);
  assert.equal(await esperado(d), 947.5);
  assert.deepEqual(await original(d, c.op), antes);
  const m = await una(d.app, "SELECT a.* FROM movimiento_inventario a JOIN movimiento_inventario o ON a.referencia_id=o.id WHERE o.linea_id=$1", [c.linea]);
  assert.equal(m.tipo, "ajuste");
  assert.equal(m.cantidad_kg, "-5.000");
  assert.equal(m.costo, "-10.50");
  assert.match(m.motivo, /cuenta/i);
  assert.equal((await una(d.app, "SELECT valor FROM costo_material WHERE material_id=$1", [d.e.mat["Cartón"]])).valor, "52.50");
  const b = await una(d.app, "SELECT * FROM bitacora WHERE accion='corregir' AND entidad='operacion'");
  assert.equal(b.entidad_id, c.op);
  assert.equal(b.detalle.diferencia, -10.5);
  assert.equal(b.detalle.autoriza, Number(d.firma));
  assert.ok(b.detalle.antes && b.detalle['después']);
  await cerrar(d);
  const corte = await una(d.app, "SELECT * FROM caja_corte");
  assert.equal(corte.esperado, "947.50");
  assert.equal(corte.diferencia, "0.00");
}));

test("venta aumenta por transferencia sin mover cajón; sin patio rechaza antes de clave", () => conDia(async d => {
  await cuenta(d, "compra", "40");
  const c = await cuenta(d, "venta", "10");
  const caja = await esperado(d);
  const r = await corregir(d, c.linea, { kg: "15", liquidacion: "transferencia" });
  assert.equal(r.diferencia, "12.50");
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 25);
  assert.equal(await esperado(d), caja);
  await rechaza(corregir(d, c.linea, { kg: "41", vistas: 1, clave: "000000" }), "RC002");
  assert.equal(await fallos(d), 0);
  assert.equal(await contar(d.app, "correccion_de_cuenta"), 1);
}));

test("cambio de material usa lista histórica y la segunda corrección parte de la primera", () => conDia(async d => {
  const c = await cuenta(d);
  await d.db.query("UPDATE jornada SET fecha=fecha-1 WHERE id=$1", [d.e.jornada]);
  await cerrarSinCorte(d.db, d.e.jornada, 0, d.e.mostrador);
  const hoy = (await una(d.db, "SELECT hoy_en(1::smallint)::text AS f")).f;
  d.e.jornada = (await abrirJornada(d.db, d.firma, hoy)).id;
  await d.app.query("SELECT fijar_precio($1,99,100,$2)", [d.e.mat["PET"], d.firma]);
  await d.app.query("SELECT publicar_lista_de_hoy($1)", [d.firma]);
  const r = await corregir(d, c.linea, { mat: d.e.mat["PET"], kg: "20", liquidacion: "pendiente" });
  assert.equal(r.precio, "7.5000");
  assert.equal(r.diferencia, "87.00");
  assert.equal(r.jornada_id, d.e.jornada);
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 0);
  assert.equal(await existencia(d.app, d.e.mat["PET"]!), 20);
  // El ajuste positivo sin existencias se valora con la lista actual (0039), no con el cobro histórico.
  assert.equal((await una(d.app, "SELECT valor FROM costo_material WHERE material_id=$1", [d.e.mat["PET"]])).valor, "1980.00");
  const s = await corregir(d, c.linea, { mat: d.e.mat["PET"], kg: "18", vistas: 1, liquidacion: "pendiente" });
  assert.equal(s.numero, 2);
  assert.equal(s.kg_antes, "20.000");
  assert.equal(s.importe_antes, "150.00");
  assert.equal(s.precio, "7.5000");
  assert.equal(s.diferencia, "-15.00");
  assert.equal(await existencia(d.app, d.e.mat["PET"]!), 18);
  await rechaza(corregir(d, c.linea, { vistas: 0, clave: "000000" }), "RC011");
  assert.equal(await fallos(d), 0);
}));

test("mismo valor, cuenta abierta, material de baja o sin precio: no gastan clave", () => conDia(async d => {
  const c = await cuenta(d);
  await rechaza(corregir(d, c.linea, { kg: "30", clave: "000000" }), "RC005");
  const abierta = await cuenta(d, "compra", "30", false);
  await rechaza(corregir(d, abierta.linea, { clave: "000000" }), "RC005");
  const nuevo = (await una(d.db, "INSERT INTO material (sucursal_id,familia_id,nombre,nombre_corto) VALUES (1,5,'Sin precio histórico','Sin precio') RETURNING id")).id;
  await rechaza(corregir(d, c.linea, { mat: nuevo, clave: "000000" }), "RC009");
  await d.db.query("UPDATE material SET activo=false WHERE id=$1", [d.e.mat["PET"]]);
  await rechaza(corregir(d, c.linea, { mat: d.e.mat["PET"], clave: "000000" }), "RC005");
  assert.equal(await fallos(d), 0);
}));

test("sin jornada abierta: RC006 antes de clave", () => conDia(async d => {
  const c = await cuenta(d);
  await cerrar(d, "937");
  await rechaza(corregir(d, c.linea, { clave: "000000" }), "RC006");
  assert.equal(await fallos(d), 0);
}));

test("facultad, roles y clave mala: NULL cuenta intento pero no reserva envío", () => conDia(async d => {
  const c = await cuenta(d);
  const sin = await personaConClave(d.db, "Sin facultad", "responsable", CLAVE);
  await rechaza(corregir(d, c.linea, { autoriza: sin, clave: "000000" }), "RC008");
  assert.equal(await fallos(d, sin), 0);
  for (const quien of [d.e.patio, d.e.consulta]) await rechaza(corregir(d, c.linea, { quien }), "RC008");
  const envio = randomUUID();
  assert.equal((await corregir(d, c.linea, { envio, clave: "000000" })).id, null);
  assert.equal(await fallos(d), 1);
  assert.equal(await contar(d.app, "correccion_de_cuenta"), 0);
  assert.equal(await contar(d.db, "envio", "id=$1", [envio]), 0);
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 30);
  assert.ok((await corregir(d, c.linea, { envio, quien: d.firma })).id);
}));

test("envío repetido conserva resultado después de otra corrección y del cierre; cambiado y cancelado rechazan", () => conDia(async d => {
  const c = await cuenta(d);
  const envio = randomUUID();
  const r = await corregir(d, c.linea, { envio });
  await corregir(d, c.linea, { kg: "24", vistas: 1 });
  assert.deepEqual(await corregir(d, c.linea, { envio, kg: "25.000", clave: "000000" }), r);
  for (const cambio of [{ kg: "26" }, { vistas: 1 }, { liquidacion: "pendiente" }, { motivo: "Otro motivo" }]) {
    await rechaza(corregir(d, c.linea, { envio, ...cambio }), "RC012");
  }
  const cancelado = randomUUID();
  await d.app.query("SELECT cancelar_envio($1,$2)", [cancelado, d.e.mostrador]);
  await rechaza(corregir(d, c.linea, { envio: cancelado, clave: "000000" }), "RC012");
  await cerrar(d, "949.60");
  assert.deepEqual(await corregir(d, c.linea, { envio, clave: "000000" }), r);
  assert.equal(await fallos(d), 0);
}));

test("inmutable y solo SELECT para la aplicación", () => conDia(async d => {
  const c = await cuenta(d);
  await corregir(d, c.linea);
  for (const sql of ["UPDATE correccion_de_cuenta SET motivo='otro'", "DELETE FROM correccion_de_cuenta", "TRUNCATE correccion_de_cuenta"]) {
    await rechaza(d.app.query(sql), "42501");
    // Desde 0043 la refieren sus ajustes en el libro de inventario: vaciarla la detiene esa llave, antes que el guardián.
    await rechaza(d.db.query(sql), sql.startsWith("TRUNCATE") ? "0A000" : "RC001");
  }
  await rechaza(d.app.query("INSERT INTO correccion_de_cuenta DEFAULT VALUES"), "42501");
}));

test("kilos y forma inválidos se rechazan antes de clave; cero no es una cancelación", () => conDia(async d => {
  const c = await cuenta(d);
  for (const kg of ["0", "-1", "0.0001", "1000000", "NaN", "Infinity", "-Infinity"]) {
    await rechaza(corregir(d, c.linea, { kg, clave: "000000" }), "RC004");
  }
  for (const motivo of ["", "   ", "a".repeat(201)]) await rechaza(corregir(d, c.linea, { motivo }), "RC005");
  await rechaza(corregir(d, c.linea, { liquidacion: "cheque" }), "RC005");
  assert.equal(await fallos(d), 0);
}));

for (const mismoEnvio of [false, true]) {
  test(`concurrencia: ${mismoEnvio ? "envío igual devuelve lo mismo" : "dos correcciones rechazan la vista vieja"}, con espera demostrada`, () => conDia(async d => {
    const c = await cuenta(d);
    const otra = await comoApp(d.base);
    const envio = randomUUID();
    try {
      await otra.query("BEGIN");
      const primera = await corregir(d, c.linea, { envio }, otra);
      const pid = await pidDe(d.app);
      const segunda = corregir(d, c.linea, { envio: mismoEnvio ? envio : randomUUID(), clave: "000000" });
      const resultado = desenlace(segunda);
      await esperarQueEspere(d.db, pid);
      await otra.query("COMMIT");
      assert.equal(await resultado, mismoEnvio ? "pasó" : "RC011");
      if (mismoEnvio) assert.deepEqual(await segunda, primera);
      assert.equal(await contar(d.app, "correccion_de_cuenta"), 1);
      assert.equal(await fallos(d), 0);
    } finally { await otra.query("ROLLBACK"); await otra.end(); }
  }));
}

for (const primero of ["corrección", "corte"]) {
  test(`concurrencia: ${primero} primero, corte y corrección comparten jornada`, () => conDia(async d => {
    const c = await cuenta(d);
    const otra = await comoApp(d.base);
    try {
      await otra.query("BEGIN");
      if (primero === "corrección") await corregir(d, c.linea, {}, otra); else await cerrar(d, "937", otra);
      const pid = await pidDe(d.app);
      const resultado = desenlace(primero === "corrección" ? cerrar(d) : corregir(d, c.linea));
      await esperarQueEspere(d.db, pid);
      await otra.query("COMMIT");
      assert.equal(await resultado, primero === "corrección" ? "pasó" : "RC006");
      assert.equal((await una(d.app, "SELECT diferencia FROM caja_corte")).diferencia, "0.00");
    } finally { await otra.query("ROLLBACK"); await otra.end(); }
  }));
}

test("conserva precio especial al cambiar kilos; al cambiar material aplica precio de lista", () => conDia(async d => {
  const c = await cuenta(d, "compra", "30", false);
  await d.app.query("SELECT dar_precio_especial($1,$2,$3,NULL,NULL,'Don Luis',0.50,$4,$5,$6,$7)",
    [randomUUID(), c.op, c.linea, d.firma, CLAVE, d.huella, d.e.mostrador]);
  await cobrar(d, c.op);
  const antes = await original(d, c.op);
  const r = await corregir(d, c.linea);
  assert.equal(r.precio, "2.6000");
  assert.equal(r.importe_antes, "78.00");
  assert.equal(r.importe_despues, "65.00");
  assert.equal(r.diferencia, "-13.00");
  const s = await corregir(d, c.linea, { kg: "20", mat: d.e.mat["PET"], vistas: 1 });
  assert.equal(s.precio, "7.5000");
  assert.equal(s.importe_antes, "65.00");
  assert.equal(s.diferencia, "85.00");
  assert.deepEqual(await original(d, c.op), antes);
}));

test("usa peso liquidable y centavos, sin recalcular el redondeo ni el descuento del ticket", () => conDia(async d => {
  const c = await cuenta(d, "compra", "30.2", false);
  await d.app.query("SELECT poner_descuento($1,0.2,$2)", [c.linea, d.e.mostrador]);
  await cobrar(d, c.op);
  const antes = await original(d, c.op);
  const r = await corregir(d, c.linea);
  assert.equal(r.kg_antes, "30.000");
  assert.equal(r.diferencia, "-10.50");
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 25.2);
  assert.deepEqual(await original(d, c.op), antes);
  const s = await corregir(d, c.linea, { kg: "25.003", vistas: 1 });
  assert.equal(s.importe_antes, "52.50");
  assert.equal(s.importe_despues, "52.51");
  assert.equal(s.diferencia, "0.01");
  assert.equal(await esperado(d), 947.49);
}));

test("compra mayor sale del cajón; venta mayor entra y venta menor sale; pendiente no mueve dinero", () => conDia(async d => {
  const compra = await cuenta(d);
  await corregir(d, compra.linea, { kg: "40" });
  assert.equal(await esperado(d), 916);
  const venta = await cuenta(d, "venta", "10");
  assert.equal(await esperado(d), 941);
  await corregir(d, venta.linea, { kg: "12" });
  assert.equal(await esperado(d), 946);
  await corregir(d, venta.linea, { kg: "8", vistas: 1 });
  assert.equal(await esperado(d), 936);
  await corregir(d, venta.linea, { kg: "9", vistas: 2, liquidacion: "pendiente" });
  assert.equal(await esperado(d), 936);
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 31);
}));

test("venta cambia material: devuelve el anterior y saca el nuevo al precio histórico de venta", () => conDia(async d => {
  await cuenta(d, "compra", "30");
  await cuenta(d, "compra", "20", true, d.e.mat["PET"]!);
  const c = await cuenta(d, "venta", "10");
  const r = await corregir(d, c.linea, { mat: d.e.mat["PET"], kg: "5", liquidacion: "transferencia" });
  assert.equal(r.precio, "8.9000");
  assert.equal(r.importe_antes, "25.00");
  assert.equal(r.importe_despues, "44.50");
  assert.equal(await existencia(d.app, d.e.mat["Cartón"]!), 30);
  assert.equal(await existencia(d.app, d.e.mat["PET"]!), 15);
}));

test("conteo posterior impide corregir otra vez el patio y no consume clave", () => conDia(async d => {
  const c = await cuenta(d);
  await d.db.query("SELECT registrar_conteo($1,30,$2,$3)", [d.e.mat["Cartón"], d.firma, d.e.mostrador]);
  await rechaza(corregir(d, c.linea, { clave: "000000" }), "RC005");
  assert.equal(await fallos(d), 0);
  assert.equal(await contar(d.app, "correccion_de_cuenta"), 0);
}));
