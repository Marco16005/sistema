// El cajón se comprueba por las entradas de la aplicación, incluidos los cruces reales al cerrar.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrar } from "../db/migrar.ts";
import type pg from "pg";
import {
  abrirCuenta, agregarMaterial, abrirJornada, cerrarSinCorte, comoApp, conApp, contar,
  conBaseVacia, conectar, escenario, desenlace, equipoDeAlta, esperarQueEspere, personaConClave, pidDe, rechaza,
  revisionDe, segundaPesada, una,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const CLAVE = "481516";
interface Dia { app: pg.Client; db: pg.Client; e: Escenario; base: string; firma: string; huella: string }
const conCajon = (prueba: (d: Dia) => Promise<void>) => conApp(async (app, db, e, base) => {
  const firma = await personaConClave(db, "Rosa", "responsable", CLAVE, true);
  const huella = await equipoDeAlta(db);
  // Reabrir exige hoy. La fecha del escenario no depende del reloj con que corra la prueba.
  await db.query("UPDATE jornada SET fecha = hoy_en(1::smallint) WHERE id = $1", [e.jornada]);
  await prueba({ app, db, e, base, firma, huella });
});
const abrir = (d: Dia, contado = "100", envio = randomUUID(), quien = d.e.mostrador, jornada = d.e.jornada) =>
  una(d.app, "SELECT * FROM abrir_el_cajon($1, $2, $3, $4)", [envio, jornada, contado, quien]);
interface Movimiento { envio?: string; tipo?: string; importe?: string; motivo?: string; autoriza?: string; clave?: string; quien?: string; jornada?: string }
const mover = (d: Dia, o: Movimiento = {}, c = d.app) => una(c,
  "SELECT * FROM mover_caja($1, $2, $3, $4, $5, $6, $7, $8, $9)",
  [o.envio ?? randomUUID(), o.jornada ?? d.e.jornada, o.tipo ?? "meter", o.importe ?? "20", o.motivo ?? "Cambio",
    o.autoriza ?? d.firma, o.clave ?? CLAVE, d.huella, o.quien ?? d.e.mostrador]);
interface Corte { envio?: string; cierres?: number; contado?: string; queda?: string; hace?: string; clave?: string; quien?: string }
const cerrar = (d: Dia, o: Corte = {}, c = d.app) => una(c,
  "SELECT * FROM cerrar_el_dia($1, $2, $3, $4, $5, $6, $7, $8, $9)",
  [o.envio ?? randomUUID(), d.e.jornada, o.cierres ?? 0, o.contado ?? "100", o.queda ?? "30", o.hace ?? d.firma,
    o.clave ?? CLAVE, d.huella, o.quien ?? d.e.mostrador]);
const reabrir = (d: Dia, cierre = 1) => una(d.app,
  "SELECT * FROM reabrir_jornada($1, $2, $3, $4, $5, $6, $7)",
  [randomUUID(), d.e.jornada, cierre, d.firma, CLAVE, d.huella, d.e.mostrador]);
const esperado = async (d: Dia) => Number((await una(d.app, "SELECT esperado_en_cajon($1) AS n", [d.e.jornada])).n);
const fallos = async (d: Dia, persona = d.firma) => (await una(d.db, "SELECT * FROM intentos_de($1)", [persona])).fallos;
const permiso = (d: Dia, persona = d.e.mostrador, puede = true, quien = d.firma, clave = CLAVE) =>
  una(d.app, "SELECT permiso_de_corte($1, $2, $3, $4, $5) AS ok", [d.huella, quien, clave, persona, puede]);
async function cuentaLista(d: Dia, tipo = "compra", kg = "10") {
  const c = await abrirCuenta(d.app, tipo, d.e.mostrador);
  await agregarMaterial(d.app, c.id, d.e.mat["Cartón"]!, kg, d.e.mostrador);
  return { id: c.id as string, revision: await revisionDe(d.db, c.id) };
}
const confirmar = (d: Dia, c: { id: string; revision: number }, forma = "efectivo") =>
  una(d.app, "SELECT * FROM confirmar_cuenta($1, $2, $3, $4)", [c.id, d.e.mostrador, c.revision, forma]);

// Deja un vehículo de ayer listo para terminar hoy. No impide cerrar la jornada nueva.
async function vehiculoDeAyer(d: Dia) {
  await d.db.query("UPDATE jornada SET fecha = fecha - 1 WHERE id = $1", [d.e.jornada]);
  const c = await abrirCuenta(d.app, "compra", d.e.mostrador, randomUUID(), "ABC-123");
  const l = await agregarMaterial(d.app, c.id, d.e.mat["Cartón"]!, "100", d.e.mostrador, { bascula: 1 });
  await cerrarSinCorte(d.db, d.e.jornada, 0, d.e.mostrador);
  const hoy = (await una(d.db, "SELECT hoy_en(1::smallint)::text AS fecha")).fecha;
  d.e.jornada = (await abrirJornada(d.db, d.firma, hoy)).id;
  await segundaPesada(d.app, l.id, "90", d.e.mostrador);
  const revision = await revisionDe(d.db, c.id);
  return (caja = d.app, forma = "efectivo") => una(caja,
    "SELECT * FROM terminar_vehiculo($1, $2, $3, $4, $5, $6)", [c.id, revision, d.firma, CLAVE, d.huella, forma]);
}

test("forma de pago: omisión, transferencia, revisión e inmutabilidad", () => conCajon(async (d) => {
  const a = await cuentaLista(d);
  assert.equal((await una(d.app, "SELECT forma_de_pago FROM operacion WHERE id=$1", [a.id])).forma_de_pago, null);
  const efectivo = await una(d.app, "SELECT * FROM confirmar_cuenta($1,$2,$3)", [a.id, d.e.mostrador, a.revision]);
  assert.equal(efectivo.forma_de_pago, "efectivo");
  assert.equal(efectivo.revision, a.revision);
  // Repetir con otra forma de pago es otro pedido: se rechaza; con la misma, devuelve lo hecho (0043, H3).
  await rechaza(confirmar(d, a, "transferencia"), "RC011");
  assert.equal((await confirmar(d, a, "efectivo")).forma_de_pago, "efectivo");
  const b = await cuentaLista(d);
  await rechaza(confirmar(d, b, "cheque"), "RC005");
  const transferencia = await confirmar(d, b, "transferencia");
  assert.equal(transferencia.forma_de_pago, "transferencia");
  assert.equal(transferencia.revision, b.revision);
  await rechaza(d.db.query("UPDATE operacion SET forma_de_pago='efectivo' WHERE id=$1", [b.id]), "RC001");
  await rechaza(d.app.query("SELECT confirmar_cuenta(NULL,NULL,NULL,'cheque')"), "RC005");
}));

test("terminar vehículo conserva la forma y cuenta en la jornada en que se terminó", () => conCajon(async (d) => {
  const terminar = await vehiculoDeAyer(d);
  await abrir(d);
  await rechaza(terminar(d.app, "cheque"), "RC005");
  const c = await terminar(d.app, "transferencia");
  assert.equal(c.forma_de_pago, "transferencia");
  assert.equal(c.confirmada_en_jornada, d.e.jornada);
  assert.equal((await terminar(d.app, "transferencia")).forma_de_pago, "transferencia");
  await rechaza(terminar(), "RC011");
  assert.equal(await esperado(d), 100);
}));

test("apertura: un conteo, reintento, cancelación, roles y jornada", () => conCajon(async (d) => {
  assert.equal((await una(d.app, "SELECT esperado_en_cajon($1) AS n", [d.e.jornada])).n, null);
  for (const quien of [d.e.patio, d.e.consulta]) await rechaza(abrir(d, "100", randomUUID(), quien), "RC008");
  await rechaza(abrir(d, "100", randomUUID(), d.e.mostrador, "999999"), "RC006");
  const cancelado = randomUUID();
  await d.app.query("SELECT cancelar_envio($1,$2)", [cancelado, d.e.mostrador]);
  await rechaza(abrir(d, "100", cancelado), "RC012");
  const envio = randomUUID();
  const a = await abrir(d, "100", envio);
  assert.equal(a.contado, "100.00");
  assert.equal(a.anterior, null);
  assert.deepEqual(await abrir(d, "100.00", envio), a);
  await rechaza(abrir(d, "101", envio), "RC012");
  await assert.rejects(abrir(d), (err: any) => err.code === "RC005" && /Luis/.test(err.message) && /\d\d:\d\d/.test(err.message));
  await cerrar(d);
  assert.deepEqual(await abrir(d, "100", envio), a);
  await rechaza(abrir(d), "RC006");
}));

test("apertura guarda el último se_queda anterior: igual no avisa, distinto sí", () => conCajon(async (d) => {
  await d.db.query("UPDATE jornada SET fecha=fecha-2 WHERE id=$1", [d.e.jornada]);
  await abrir(d);
  await cerrar(d, { queda: "40" });
  const fecha = (await una(d.db, "SELECT (hoy_en(1::smallint)-1)::text AS f")).f;
  d.e.jornada = (await abrirJornada(d.db, d.firma, fecha)).id;
  assert.equal((await abrir(d, "40")).anterior, "40.00");
  assert.equal(await contar(d.db, "aviso"), 0);
  await cerrar(d, { contado: "40", queda: "25" });
  const hoy = (await una(d.db, "SELECT hoy_en(1::smallint)::text AS f")).f;
  d.e.jornada = (await abrirJornada(d.db, d.firma, hoy)).id;
  assert.equal((await abrir(d, "23")).anterior, "25.00");
  const a = await una(d.app, "SELECT * FROM aviso");
  assert.equal(a.clase, "apertura");
  assert.equal(a.diferencia, "-2.00");
  assert.equal(a.creado_por, d.e.mostrador);
  assert.equal(a.enviado_en, null);
}));

test("cantidades se rechazan sin redondear y antes de mirar la clave", () => conCajon(async (d) => {
  for (const importe of ["-1", "0.001", "100000000", "NaN", "Infinity", "-Infinity"]) {
    await rechaza(abrir(d, importe), "RC004");
  }
  await abrir(d);
  for (const importe of ["0", "-1", "0.001", "100000000", "NaN", "Infinity", "-Infinity"]) {
    await rechaza(mover(d, { importe, clave: "000000" }), "RC004");
  }
  for (const motivo of ["", "   ", "a".repeat(201)]) await rechaza(mover(d, { motivo, clave: "000000" }), "RC005");
  await rechaza(mover(d, { tipo: "prestar" }), "RC005");
  for (const contado of ["-1", "0.001", "100000000", "NaN", "Infinity"]) await rechaza(cerrar(d, { contado, clave: "000000" }), "RC004");
  await rechaza(cerrar(d, { queda: "101", clave: "000000" }), "RC004");
  await rechaza(cerrar(d, { queda: "0.001", clave: "000000" }), "RC004");
  assert.equal(await fallos(d), 0);
}));

test("movimientos: responsables sin facultad, firma, reintento y envío cancelado", () => conCajon(async (d) => {
  const responsable = await personaConClave(d.db, "Sin facultad", "responsable", CLAVE);
  await abrir(d);
  const envio = randomUUID();
  const m = await mover(d, { envio, autoriza: responsable, tipo: "sacar", importe: "150", motivo: "  Mandado  " });
  assert.equal(m.registrado_por, d.e.mostrador);
  assert.equal(m.autorizado_por, responsable);
  assert.equal(m.motivo, "Mandado");
  assert.equal(m.importe, "150.00");
  assert.deepEqual(await mover(d, { envio, autoriza: responsable, tipo: "sacar", importe: "150.00", motivo: "Mandado", clave: "000000" }), m);
  await rechaza(mover(d, { envio, autoriza: responsable, tipo: "sacar", importe: "151", motivo: "Mandado" }), "RC012");
  assert.equal(await contar(d.db, "caja_movimiento"), 1);
  assert.equal(await esperado(d), -50, "el dinero real permite sacar más del esperado");
  const cancelado = randomUUID();
  await d.app.query("SELECT cancelar_envio($1,$2)", [cancelado, d.e.mostrador]);
  await rechaza(mover(d, { envio: cancelado }), "RC012");
}));

test("movimientos: lo improcedente no prueba la clave; la clave mala cuenta y permite reintentar", () => conCajon(async (d) => {
  await rechaza(mover(d, { clave: "000000" }), "RC006");
  assert.equal(await fallos(d), 0);
  await abrir(d);
  for (const quien of [d.e.patio, d.e.consulta]) await rechaza(mover(d, { quien }), "RC008");
  const cajero = await personaConClave(d.db, "Cajero", "mostrador", CLAVE);
  await rechaza(mover(d, { autoriza: cajero, clave: "000000" }), "RC008");
  assert.equal(await fallos(d, cajero), 0);
  const envio = randomUUID();
  assert.equal((await mover(d, { envio, clave: "000000" })).id, null);
  assert.equal(await fallos(d), 1);
  assert.equal(await contar(d.db, "envio", "id=$1", [envio]), 0);
  assert.ok((await mover(d, { envio })).id);
}));

test("esperado suma solo efectivo y movimientos, con total en pesos cerrados", () => conCajon(async (d) => {
  await abrir(d, "1000.25");
  await confirmar(d, await cuentaLista(d, "compra", "30.2")); // 63
  await confirmar(d, await cuentaLista(d, "compra", "40"), "transferencia");
  await confirmar(d, await cuentaLista(d, "venta", "10")); // 25
  await confirmar(d, await cuentaLista(d, "venta", "10"), "transferencia");
  await mover(d, { importe: "30.50" });
  await mover(d, { tipo: "sacar", importe: "12.25" });
  assert.equal(await esperado(d), 980.5);
}));

test("corte: firma, reintento, aviso, permiso y día abierto ante clave mala", () => conCajon(async (d) => {
  await rechaza(cerrar(d, { hace: d.e.mostrador, clave: "000000" }), "RC008");
  await rechaza(cerrar(d, { clave: "000000" }), "RC006");
  assert.equal(await fallos(d), 0);
  await abrir(d);
  const envio = randomUUID();
  assert.equal((await cerrar(d, { envio, clave: "000000" })).jornada_id, null);
  assert.equal(await fallos(d), 1);
  assert.equal((await una(d.db, "SELECT cerrada_en FROM jornada WHERE id=$1", [d.e.jornada])).cerrada_en, null);
  assert.equal(await contar(d.db, "envio", "id=$1", [envio]), 0);
  assert.equal((await cerrar(d, { envio, contado: "95" })).cierre, 1);
  const c = await una(d.app, "SELECT * FROM caja_corte");
  assert.equal(c.esperado, "100.00");
  assert.equal(c.diferencia, "-5.00");
  assert.equal(c.retirado, "65.00");
  assert.equal(c.hecho_por, d.firma);
  assert.equal(c.registrado_por, d.e.mostrador);
  const a = await una(d.app, "SELECT * FROM aviso");
  assert.equal(a.clase, "corte");
  assert.equal(a.diferencia, "-5.00");
  assert.equal(a.creado_por, d.firma);
  assert.equal((await cerrar(d, { envio, contado: "95", clave: "000000" })).cierre, 1);
  await rechaza(cerrar(d, { envio, contado: "96" }), "RC012");
  await rechaza(cerrar(d), "RC011");
}));

test("reabrir exige otro corte y resta lo retirado; un reintento viejo no vuelve a cerrar", () => conCajon(async (d) => {
  await abrir(d);
  const envio = randomUUID();
  await cerrar(d, { envio });
  assert.equal(await contar(d.db, "aviso"), 0);
  await reabrir(d);
  assert.equal((await cerrar(d, { envio, clave: "000000" })).cierre, 1);
  assert.equal((await una(d.db, "SELECT cerrada_en FROM jornada WHERE id=$1", [d.e.jornada])).cerrada_en, null);
  assert.equal(await esperado(d), 30);
  await mover(d, { importe: "20" });
  assert.equal(await esperado(d), 50);
  await cerrar(d, { cierres: 1, contado: "50", queda: "10" });
  assert.equal((await una(d.app, "SELECT esperado FROM caja_corte WHERE cierre=2")).esperado, "50.00");
  assert.equal(await contar(d.db, "aviso"), 0);
}));

test("permiso: facultad, clave, destinatario, bitácora y lista de personas", () => conCajon(async (d) => {
  const cajero = await personaConClave(d.db, "Cajero", "mostrador", CLAVE);
  const sinFacultad = await personaConClave(d.db, "Sin facultad", "responsable", CLAVE);
  await rechaza(permiso(d, cajero, true, sinFacultad), "RC008");
  await rechaza(permiso(d, cajero, true, d.e.mostrador), "RC008");
  for (const persona of [d.e.patio, d.e.consulta, sinFacultad]) await rechaza(permiso(d, persona, true, d.firma, "000000"), "RC008");
  assert.equal(await fallos(d), 0);
  assert.equal((await permiso(d, cajero, true, d.firma, "000000")).ok, false);
  assert.equal(await fallos(d), 1);
  assert.equal((await permiso(d, cajero)).ok, true);
  assert.equal((await permiso(d, cajero)).ok, true);
  assert.equal(await contar(d.db, "bitacora", "accion='permiso_de_corte'"), 1);
  assert.deepEqual((await una(d.db, "SELECT detalle FROM bitacora WHERE accion='permiso_de_corte'")).detalle, { puede: true });
  const personas = (await d.app.query("SELECT * FROM personas_para_administrar($1)", [d.firma])).rows;
  assert.equal(personas.find(p => p.id === cajero).hace_corte, true);
  assert.equal(personas.find(p => p.id === sinFacultad).hace_corte, true);
  await abrir(d);
  await cerrar(d, { hace: cajero });
  assert.equal((await una(d.app, "SELECT hecho_por FROM caja_corte")).hecho_por, cajero);
  await permiso(d, cajero, false);
  assert.equal((await una(d.app, "SELECT puede_hacer_corte($1) AS ok", [cajero])).ok, false);
  await rechaza(d.db.query("UPDATE usuario SET hace_corte=true WHERE id=$1", [d.e.patio]), "23514");
}));

test("ver aviso: solo responsable y la primera persona que lo vio se conserva", () => conCajon(async (d) => {
  await abrir(d);
  await cerrar(d, { contado: "99" });
  const id = (await una(d.app, "SELECT id FROM aviso")).id;
  await rechaza(d.app.query("SELECT ver_aviso($1,$2)", [id, d.e.mostrador]), "RC008");
  const primero = await una(d.app, "SELECT * FROM ver_aviso($1,$2)", [id, d.firma]);
  assert.equal(primero.visto_por, d.firma);
  assert.ok(primero.visto_en);
  assert.deepEqual(await una(d.app, "SELECT * FROM ver_aviso($1,$2)", [id, d.e.responsable]), primero);
  assert.equal(await contar(d.db, "bitacora", "accion='ver' AND entidad='aviso'"), 1);
  await rechaza(d.db.query("UPDATE aviso SET diferencia=0"), "RC001");
  await rechaza(d.db.query("UPDATE aviso SET visto_por=NULL,visto_en=NULL"), "RC001");
  await d.db.query("UPDATE aviso SET enviado_en=now()");
  await rechaza(d.db.query("DELETE FROM aviso"), "RC001");
  await rechaza(d.db.query("TRUNCATE aviso"), "RC001");
}));

test("libros inmutables y ninguna entrada para cerrar sin corte desde la aplicación", () => conCajon(async (d) => {
  await abrir(d);
  await mover(d);
  await cerrar(d, { contado: "120" });
  for (const [tabla, columna] of [["caja_apertura", "contado"], ["caja_movimiento", "importe"], ["caja_corte", "contado"]]) {
    for (const sql of [`UPDATE ${tabla} SET ${columna}=0`, `DELETE FROM ${tabla}`, `TRUNCATE ${tabla} CASCADE`]) {
      await rechaza(d.app.query(sql), "42501");
      await rechaza(d.db.query(sql), "RC001");
    }
  }
  await rechaza(d.app.query("SELECT cerrar_el_dia($1,$2,0,$3)", [randomUUID(), d.e.jornada, d.e.mostrador]), "42501");
  await rechaza(d.app.query("SELECT cerrar_jornada($1,$2)", [d.e.jornada, d.e.mostrador]), "42501");
  assert.equal((await una(d.db, "SELECT to_regprocedure('cerrar_jornada_abierta(bigint)') AS f")).f, null);
}));

for (const primero of ["movimiento", "confirmación"] as const) {
  test(`concurrencia: ${primero} entra antes del corte, el corte espera y lo cuenta`, () => conCajon(async (d) => {
    const terminar = primero === "confirmación" ? await vehiculoDeAyer(d) : null;
    await abrir(d);
    const otra = await comoApp(d.base);
    try {
      await otra.query("BEGIN");
      if (terminar) await terminar(otra); else await mover(d, {}, otra);
      const pid = await pidDe(d.app);
      const corte = cerrar(d, { contado: terminar ? "79" : "120" });
      const resultado = desenlace(corte);
      await esperarQueEspere(d.db, pid);
      await otra.query("COMMIT");
      assert.equal(await resultado, "pasó");
      assert.equal((await una(d.app, "SELECT esperado FROM caja_corte")).esperado, terminar ? "79.00" : "120.00");
    } finally { await otra.query("ROLLBACK"); await otra.end(); }
  }));
  test(`concurrencia: corte entra antes, ${primero} espera y encuentra cerrado`, () => conCajon(async (d) => {
    const terminar = primero === "confirmación" ? await vehiculoDeAyer(d) : null;
    await abrir(d);
    const otra = await comoApp(d.base);
    try {
      await otra.query("BEGIN");
      await cerrar(d, {}, otra);
      const pid = await pidDe(d.app);
      const resultado = desenlace(terminar ? terminar() : mover(d));
      await esperarQueEspere(d.db, pid);
      await otra.query("COMMIT");
      assert.equal(await resultado, "RC006");
      assert.equal((await una(d.app, "SELECT esperado FROM caja_corte")).esperado, "100.00");
    } finally { await otra.query("ROLLBACK"); await otra.end(); }
  }));
}

test("el cierre cancelado y el cierre con cuentas abiertas no gastan clave ni dejan corte", () => conCajon(async (d) => {
  await abrir(d);
  const envio = randomUUID();
  await d.app.query("SELECT cancelar_envio($1,$2)", [envio, d.e.mostrador]);
  await rechaza(cerrar(d, { envio, clave: "000000" }), "RC012");
  const cuenta = await cuentaLista(d);
  await rechaza(cerrar(d, { clave: "000000" }), "RC006");
  assert.equal(await fallos(d), 0);
  assert.equal(await contar(d.db, "caja_corte"), 0);
  await confirmar(d, cuenta);
  await cerrar(d, { contado: "79" });
}));

test("ceros, centavos y tope exacto; motivo limpio y personas inactivas", () => conCajon(async (d) => {
  await abrir(d, "0");
  await rechaza(mover(d, { motivo: "\t\n", clave: "000000" }), "RC005");
  assert.equal(await fallos(d), 0);
  const m = await mover(d, { importe: "99999999.99", motivo: "  Fondo\n para\tcompras  " });
  assert.equal(m.motivo, "Fondo para compras");
  assert.equal(m.importe, "99999999.99");
  const baja = await personaConClave(d.db, "Inactiva", "responsable", CLAVE);
  await d.db.query("UPDATE usuario SET activo=false WHERE id=$1", [baja]);
  assert.equal((await una(d.app, "SELECT puede_hacer_corte($1) AS ok", [baja])).ok, false);
  await rechaza(mover(d, { autoriza: baja, clave: "000000" }), "RC008");
  await rechaza(cerrar(d, { hace: baja, clave: "000000" }), "RC008");
  for (const quien of [d.e.patio, d.e.consulta]) await rechaza(cerrar(d, { quien }), "RC008");
  await cerrar(d, { contado: "99999999.99", queda: "0" });
  assert.equal((await una(d.app, "SELECT retirado FROM caja_corte")).retirado, "99999999.99");
}));

for (const accion of ["apertura", "movimiento", "corte"] as const) {
  test(`dos envíos iguales de ${accion} a la vez esperan y devuelven el mismo resultado`, () => conCajon(async (d) => {
    if (accion !== "apertura") await abrir(d);
    const envio = randomUUID();
    const otra = await comoApp(d.base);
    const ejecutar = (c: pg.Client, clave = CLAVE) => accion === "apertura"
      ? una(c, "SELECT * FROM abrir_el_cajon($1,$2,100,$3)", [envio, d.e.jornada, d.e.mostrador])
      : accion === "movimiento" ? mover(d, { envio, clave }, c) : cerrar(d, { envio, clave }, c);
    try {
      await otra.query("BEGIN");
      const primero = await ejecutar(otra);
      const pid = await pidDe(d.app);
      const segunda = ejecutar(d.app, "000000");
      const resultado = desenlace(segunda);
      await esperarQueEspere(d.db, pid);
      await otra.query("COMMIT");
      assert.equal(await resultado, "pasó");
      assert.deepEqual(await segunda, primero);
      assert.equal(await fallos(d), 0);
      assert.equal(await contar(d.db, `caja_${accion}`), 1);
    } finally { await otra.query("ROLLBACK"); await otra.end(); }
  }));
}

test("una confirmación ordinaria en curso detiene el corte y su efectivo se cuenta", () => conCajon(async (d) => {
  await abrir(d);
  const cuenta = await cuentaLista(d);
  const otra = await comoApp(d.base);
  try {
    await otra.query("BEGIN");
    await una(otra, "SELECT * FROM confirmar_cuenta($1,$2,$3)", [cuenta.id, d.e.mostrador, cuenta.revision]);
    const pid = await pidDe(d.app);
    const corte = desenlace(cerrar(d, { contado: "79" }));
    await esperarQueEspere(d.db, pid);
    await otra.query("COMMIT");
    assert.equal(await corte, "pasó");
    assert.equal((await una(d.app, "SELECT esperado FROM caja_corte")).esperado, "79.00");
  } finally { await otra.query("ROLLBACK"); await otra.end(); }
}));

// También se prueba la actualización de una base con cuentas reales anteriores al cajón.
test("migrar conserva los importes y revisiones y marca efectivo en las cuentas antiguas", async () => {
  const carpeta = fileURLToPath(new URL("../db/migraciones/", import.meta.url));
  const antes = await mkdtemp(join(tmpdir(), "antes-del-cajon-"));
  try {
    for (const archivo of (await readdir(carpeta)).filter(a => a.endsWith(".sql") && a < "0038")) {
      await copyFile(join(carpeta, archivo), join(antes, archivo));
    }
    await conBaseVacia(async base => {
      const db = await conectar(base);
      try {
        await migrar(db, antes);
        const e = await escenario(db);
        const c = await abrirCuenta(db, "compra", e.mostrador);
        await agregarMaterial(db, c.id, e.mat["Cartón"]!, "30.2", e.mostrador);
        const original = await una(db, "SELECT * FROM confirmar_cuenta($1,$2,(SELECT revision FROM operacion WHERE id=$1))", [c.id, e.mostrador]);
        const borrador = await abrirCuenta(db, "venta", e.mostrador);
        await migrar(db);
        const actual = await una(db, "SELECT * FROM operacion WHERE id=$1", [c.id]);
        assert.equal(actual.forma_de_pago, "efectivo");
        delete actual.forma_de_pago;
        assert.deepEqual(actual, original);
        assert.equal((await una(db, "SELECT forma_de_pago FROM operacion WHERE id=$1", [borrador.id])).forma_de_pago, null);
        assert.equal(await contar(db, "usuario", "hace_corte"), 0);
      } finally { await db.end(); }
    });
  } finally { await rm(antes, { recursive: true, force: true }); }
});
