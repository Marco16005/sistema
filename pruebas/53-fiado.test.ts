// Fiado por las entradas reales de la aplicación; los cruces usan conexiones independientes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import {
  abrirCuenta, agregarMaterial, comoApp, conApp, contar, desenlace, equipoDeAlta,
  esperarQueEspere, existencia, personaConClave, pidDe, rechaza, revisionDe, una,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const CLAVE = "481516";
interface Dia { app: pg.Client; db: pg.Client; e: Escenario; base: string; firma: string; huella: string; cliente: string; hoy: string }
const conFiado = (prueba: (d: Dia) => Promise<void>) => conApp(async (app, db, e, base) => {
  await db.query("UPDATE sucursal SET zona='Etc/GMT+12'");
  const hoy = (await una(db, "SELECT hoy_en(1::smallint)::text AS f")).f;
  await db.query("UPDATE jornada SET fecha=$1 WHERE id=$2", [hoy, e.jornada]);
  const firma = await personaConClave(db, "Rosa", "responsable", CLAVE, true);
  const huella = await equipoDeAlta(db);
  const cliente = (await una(app, "SELECT * FROM alta_cliente('Don Chuy',$1)", [firma])).id;
  // Existencia inicial comprada por transferencia: no altera el efectivo de estas pruebas.
  const c = await abrirCuenta(app, "compra", e.mostrador);
  await agregarMaterial(app, c.id, e.mat["Cartón"]!, "1000", e.mostrador);
  await app.query("SELECT confirmar_cuenta($1,$2,$3,'transferencia')", [c.id, e.mostrador, await revisionDe(db, c.id)]);
  await prueba({ app, db, e, base, firma, huella, cliente, hoy });
});
async function cuenta(d: Dia, tipo = "venta", kg = "100") {
  const c = await abrirCuenta(d.app, tipo, d.e.mostrador);
  const l = await agregarMaterial(d.app, c.id, d.e.mat["Cartón"]!, kg, d.e.mostrador);
  return { id: c.id as string, linea: l.id as string, revision: await revisionDe(d.db, c.id) };
}
interface Fiar { cliente?: string | null; nuevo?: string | null; vence?: string | null; autoriza?: string; clave?: string; quien?: string; revision?: number }
const fiar = (d: Dia, c: { id: string; revision: number }, o: Fiar = {}, conexion = d.app) => una(conexion,
  "SELECT * FROM cobrar_a_credito($1,$2,$3,$4,$5,$6,$7,$8,$9)",
  [c.id, o.quien ?? d.e.mostrador, o.revision ?? c.revision, o.cliente === undefined ? d.cliente : o.cliente,
    o.nuevo ?? null, o.vence ?? null, o.autoriza ?? d.firma, o.clave ?? CLAVE, d.huella]);
interface Abonar { envio?: string; cliente?: string; importe?: string; forma?: string; nota?: string | null; quien?: string }
const abonar = (d: Dia, o: Abonar = {}, conexion = d.app) => una(conexion,
  "SELECT * FROM registrar_abono($1,$2,$3,$4,$5,$6)",
  [o.envio ?? randomUUID(), o.cliente ?? d.cliente, o.importe ?? "50", o.forma ?? "efectivo", o.nota ?? null, o.quien ?? d.e.mostrador]);
const abrir = (d: Dia) => d.app.query("SELECT abrir_el_cajon($1,$2,100,$3)", [randomUUID(), d.e.jornada, d.e.mostrador]);
const esperado = async (d: Dia) => Number((await una(d.app, "SELECT esperado_en_cajon($1) AS n", [d.e.jornada])).n);
const saldo = (d: Dia) => una(d.app, "SELECT * FROM saldo_de_clientes WHERE cliente_id=$1", [d.cliente]);
const fallos = async (d: Dia, persona = d.firma) => (await una(d.db, "SELECT * FROM intentos_de($1)", [persona])).fallos;
const cerrar = (d: Dia, conexion = d.app, contado = "150") => una(conexion,
  "SELECT * FROM cerrar_el_dia($1,$2,0,$3,0,$4,$5,$6,$7)",
  [randomUUID(), d.e.jornada, contado, d.firma, CLAVE, d.huella, d.e.mostrador]);

for (const nuevo of [false, true]) test(`venta a crédito para cliente ${nuevo ? "nuevo y normalizado" : "existente"}: nombre, inventario, cajón y repetición`, () => conFiado(async d => {
  await abrir(d);
  const c = await cuenta(d);
  const op = await fiar(d, c, nuevo ? { cliente: null, nuevo: "  Jose\u200b\u0301\u00a0  Paz  " } : {});
  assert.equal(op.estado, "confirmada");
  assert.equal(op.forma_de_pago, "credito");
  assert.equal(op.total, "250");
  assert.equal(op.cliente_nombre, nuevo ? "José Paz" : "Don Chuy");
  if (!nuevo) assert.equal(op.cliente_id, d.cliente);
  assert.equal(op.confirmada_por, d.e.mostrador);
  assert.equal(await existencia(d.db, d.e.mat["Cartón"]!), 900);
  assert.equal(await esperado(d), 100);
  const cr = await una(d.app, "SELECT * FROM credito WHERE operacion_id=$1", [c.id]);
  assert.equal(cr.cliente_id, op.cliente_id);
  assert.equal(Number(cr.importe), 250);
  assert.equal(cr.autorizado_por, d.firma);
  assert.equal(cr.vence_el, null);
  assert.deepEqual(await fiar(d, c, { cliente: null, nuevo: null, clave: "000000", revision: -1 }), op);
  assert.equal(await contar(d.db, "credito"), 1);
  assert.equal(await contar(d.db, "bitacora", "accion='fiar'"), 1);
  const b = await una(d.db, "SELECT usuario_id, detalle FROM bitacora WHERE accion='fiar'");
  assert.equal(b.usuario_id, d.e.mostrador);
  assert.deepEqual(b.detalle, { folio: Number(op.folio), cliente: Number(op.cliente_id), importe: 250, vence: null, autoriza: Number(d.firma) });
  assert.equal(await fallos(d), 0);
}));

test("rechaza compra, clientes ambiguos, vencimiento pasado y revisión vieja antes de la clave", () => conFiado(async d => {
  await rechaza(fiar(d, await cuenta(d, "compra"), { clave: "000000" }), "RC005");
  const c = await cuenta(d);
  for (const o of [{ cliente: null }, { nuevo: "Otro" }, { cliente: null, nuevo: "\u200b" }, { cliente: null, nuevo: "a".repeat(81) }, { vence: "2000-01-01" }, { vence: "infinity" }, { cliente: "999999" }]) {
    await rechaza(fiar(d, c, { ...o, clave: "000000" }), "RC005");
  }
  await rechaza(fiar(d, c, { revision: -1, clave: "000000" }), "RC011");
  await rechaza(d.app.query("SELECT confirmar_cuenta($1,$2,$3,'credito')", [c.id, d.e.mostrador, c.revision]), "RC005");
  assert.equal(await fallos(d), 0);
  assert.equal(await contar(d.db, "credito"), 0);
}));

test("precio especial: solo se fía al mismo cliente", () => conFiado(async d => {
  const c = await cuenta(d);
  await d.app.query("SELECT dar_precio_especial($1,$2,$3,NULL,$4,NULL,0.1,$5,$6,$7,$8)",
    [randomUUID(), c.id, c.linea, d.cliente, d.firma, CLAVE, d.huella, d.e.mostrador]);
  c.revision = await revisionDe(d.db, c.id);
  const otro = (await una(d.app, "SELECT * FROM alta_cliente('Otro',$1)", [d.firma])).id;
  await rechaza(fiar(d, c, { cliente: otro, clave: "000000" }), "RC005");
  await rechaza(fiar(d, c, { cliente: null, nuevo: "Nuevo", clave: "000000" }), "RC005");
  assert.equal(await fallos(d), 0);
  const op = await fiar(d, c, { vence: d.hoy });
  assert.equal(op.cliente_id, d.cliente);
  assert.equal(op.total, "260");
}));

test("clave mala devuelve NULL y cuenta intento; facultad y roles se exigen sin gastarlo", () => conFiado(async d => {
  const c = await cuenta(d);
  const sin = await personaConClave(d.db, "Sin facultad", "responsable", CLAVE);
  await rechaza(fiar(d, c, { autoriza: sin, clave: "000000" }), "RC008");
  assert.equal(await fallos(d, sin), 0);
  for (const quien of [d.e.patio, d.e.consulta]) {
    await rechaza(fiar(d, c, { quien }), "RC008");
    await rechaza(abonar(d, { quien }), "RC008");
  }
  assert.equal((await fiar(d, c, { cliente: null, nuevo: "No debe nacer", clave: "000000" })).id, null);
  assert.equal(await fallos(d), 1);
  assert.equal(await contar(d.db, "cliente", "nombre='No debe nacer'"), 0);
  assert.equal(await contar(d.db, "credito"), 0);
  assert.equal((await una(d.app, "SELECT estado FROM operacion WHERE id=$1", [c.id])).estado, "borrador");
  assert.equal((await fiar(d, c, { quien: d.firma })).confirmada_por, d.firma);
}));

test("cuenta vacía, pesada pendiente y jornada cerrada se rechazan antes de la clave", () => conFiado(async d => {
  const c = await abrirCuenta(d.app, "venta", d.e.mostrador);
  await rechaza(fiar(d, { id: c.id, revision: await revisionDe(d.db, c.id) }, { clave: "000000" }), "RC005");
  await agregarMaterial(d.app, c.id, d.e.mat["Cartón"]!, "100", d.e.mostrador, { bascula: 1 });
  await rechaza(fiar(d, { id: c.id, revision: await revisionDe(d.db, c.id) }, { clave: "000000" }), "RC005");
  assert.equal(await fallos(d), 0);
}));

test("abonos: efectivo suma al cajón, transferencia no; se limpia la nota y nunca se adelanta", () => conFiado(async d => {
  await abrir(d);
  await rechaza(abonar(d), "RC004");
  await fiar(d, await cuenta(d));
  const a = await abonar(d, { nota: "  Pago\n de\t hoy  " });
  assert.equal(a.nota, "Pago de hoy");
  assert.equal(a.registrado_por, d.e.mostrador);
  assert.equal(a.jornada_id, d.e.jornada);
  assert.equal(await esperado(d), 150);
  await abonar(d, { forma: "transferencia", importe: "20.25", quien: d.firma });
  assert.equal(await esperado(d), 150);
  await assert.rejects(abonar(d, { importe: "180" }), (e: any) => e.code === "RC004" && /179.75/.test(e.message));
  const s = await saldo(d);
  assert.equal(Number(s.fiado), 250);
  assert.equal(Number(s.abonado), 70.25);
  assert.equal(Number(s.debe), 179.75);
  assert.equal(Number(s.vencido), 0);
  assert.equal(s.tiene_deuda, true);
  assert.ok(s.primera_venta && s.ultima_venta && s.ultimo_abono);
  assert.equal(await contar(d.db, "bitacora", "accion='abonar' AND entidad='cliente'"), 2);
}));

test("abonos: cantidades, formas y notas inválidas; efectivo exige cajón contado", () => conFiado(async d => {
  await fiar(d, await cuenta(d));
  await rechaza(abonar(d), "RC006");
  for (const importe of ["0", "-1", "0.001", "100000000", "NaN", "Infinity", "-Infinity"]) {
    await rechaza(abonar(d, { importe, forma: "transferencia" }), "RC004");
  }
  await rechaza(abonar(d, { forma: "credito" }), "RC005");
  await rechaza(abonar(d, { nota: "a".repeat(201) }), "RC005");
  assert.ok((await abonar(d, { forma: "transferencia", nota: "  \n " })).id);
  await abrir(d);
  await cerrar(d, d.app, "100");
  await rechaza(abonar(d, { forma: "transferencia" }), "RC006");
}));

test("abonos: envío repetido, cambiado y cancelado, incluso tras el corte", () => conFiado(async d => {
  await abrir(d);
  await fiar(d, await cuenta(d));
  const envio = randomUUID();
  const a = await abonar(d, { envio, nota: " Pago " });
  assert.deepEqual(await abonar(d, { envio, importe: "50.00", nota: "Pago" }), a);
  for (const cambio of [{ importe: "51" }, { forma: "transferencia" }, { nota: "Otro" }, { cliente: "999999" }]) {
    await rechaza(abonar(d, { envio, nota: "Pago", ...cambio }), "RC012");
  }
  const cancelado = randomUUID();
  await d.app.query("SELECT cancelar_envio($1,$2)", [cancelado, d.e.mostrador]);
  await rechaza(abonar(d, { envio: cancelado }), "RC012");
  await cerrar(d);
  assert.deepEqual(await abonar(d, { envio, nota: "Pago" }), a);
  assert.equal(await contar(d.db, "abono"), 1);
}));

test("cliente de baja no recibe fiado nuevo, pero sí abonos; el nombre cobrado se conserva", () => conFiado(async d => {
  const op = await fiar(d, await cuenta(d));
  await d.app.query("SELECT cambiar_cliente($1,false,$2)", [d.cliente, d.firma]);
  await rechaza(fiar(d, await cuenta(d), { clave: "000000" }), "RC005");
  await rechaza(fiar(d, await cuenta(d), { cliente: null, nuevo: "don chuy", clave: "000000" }), "RC005");
  assert.equal(await fallos(d), 0);
  await abonar(d, { forma: "transferencia" });
  await d.app.query("SELECT cambiar_nombre_de_cliente($1,'Jesús',$2)", [d.cliente, d.firma]);
  assert.equal((await saldo(d)).nombre, "Jesús");
  assert.equal((await una(d.app, "SELECT cliente_nombre FROM operacion WHERE id=$1", [op.id])).cliente_nombre, "Don Chuy");
}));

test("saldo FIFO: abona lo más viejo aunque lo siguiente venza antes, sin multiplicar sumas", () => conFiado(async d => {
  // Sin cambiar el libro inmutable ni esperar al reloj: dos zonas separadas por un día.
  await fiar(d, await cuenta(d, "venta", "40")); // 100 sin plazo, la más vieja
  await fiar(d, await cuenta(d, "venta", "80"), { vence: d.hoy }); // 200, vence al pasar al día siguiente
  await fiar(d, await cuenta(d, "venta", "20"), { vence: d.hoy }); // 50
  await d.db.query("UPDATE sucursal SET zona='Etc/GMT-12'");
  assert.equal(Number((await saldo(d)).vencido), 250);
  await abonar(d, { forma: "transferencia", importe: "150" });
  let s = await saldo(d);
  assert.deepEqual([s.fiado, s.abonado, s.debe, s.vencido].map(Number), [350, 150, 200, 200]);
  await abonar(d, { forma: "transferencia", importe: "180" });
  s = await saldo(d);
  assert.deepEqual([s.fiado, s.abonado, s.debe, s.vencido].map(Number), [350, 330, 20, 20]);
  await abonar(d, { forma: "transferencia", importe: "20" });
  s = await saldo(d);
  assert.equal(Number(s.debe), 0);
  assert.equal(Number(s.vencido), 0);
  assert.equal(s.tiene_deuda, false);
}));

test("corte de una venta fiada y un abono en efectivo cuadra", () => conFiado(async d => {
  await abrir(d);
  await fiar(d, await cuenta(d));
  await abonar(d);
  await cerrar(d);
  const c = await una(d.app, "SELECT * FROM caja_corte");
  assert.equal(c.esperado, "150.00");
  assert.equal(c.diferencia, "0.00");
  assert.equal(await contar(d.db, "aviso"), 0);
}));

test("libros inmutables, SELECT para la aplicación y sin escritura directa", () => conFiado(async d => {
  await fiar(d, await cuenta(d));
  await abonar(d, { forma: "transferencia" });
  for (const tabla of ["credito", "abono"]) {
    for (const sql of [`UPDATE ${tabla} SET importe=1`, `DELETE FROM ${tabla}`, `TRUNCATE ${tabla} CASCADE`]) {
      await rechaza(d.app.query(sql), "42501");
      await rechaza(d.db.query(sql), "RC001");
    }
    await rechaza(d.app.query(`INSERT INTO ${tabla} DEFAULT VALUES`), "42501");
    assert.equal(await contar(d.app, tabla), 1);
  }
}));

test("concurrencia: dos abonos que exceden el saldo esperan y el segundo se rechaza", () => conFiado(async d => {
  await abrir(d);
  await fiar(d, await cuenta(d));
  const otra = await comoApp(d.base);
  try {
    await otra.query("BEGIN");
    await abonar(d, { importe: "150" }, otra);
    const pid = await pidDe(d.app);
    const segundo = desenlace(abonar(d, { importe: "150" }));
    await esperarQueEspere(d.db, pid);
    await otra.query("COMMIT");
    assert.equal(await segundo, "RC004");
    assert.equal(await contar(d.app, "abono"), 1);
    assert.equal(Number((await saldo(d)).debe), 100);
    assert.equal(await esperado(d), 250);
  } finally { await otra.query("ROLLBACK"); await otra.end(); }
}));

for (const primero of ["abono", "corte"]) test(`concurrencia con ${primero} primero: el corte y el abono se esperan`, () => conFiado(async d => {
  await abrir(d);
  await fiar(d, await cuenta(d));
  const otra = await comoApp(d.base);
  try {
    await otra.query("BEGIN");
    if (primero === "abono") await abonar(d, {}, otra); else await cerrar(d, otra, "100");
    const pid = await pidDe(d.app);
    const segundo = desenlace(primero === "abono" ? cerrar(d) : abonar(d));
    await esperarQueEspere(d.db, pid);
    await otra.query("COMMIT");
    assert.equal(await segundo, primero === "abono" ? "pasó" : "RC006");
    assert.equal((await una(d.app, "SELECT esperado FROM caja_corte")).esperado, primero === "abono" ? "150.00" : "100.00");
  } finally { await otra.query("ROLLBACK"); await otra.end(); }
}));
