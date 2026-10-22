// Lo que encontró la revisión de Codex de la caja y la ganancia (21 de octubre, informe 31), con lo
// que debe pasar. Sus demostraciones están en docs/revisiones/2026-10-21-codex-revision-de-caja-y-
// ganancia-incompleta.md; el arreglo, en la migración 0043.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import {
  abrirCuenta, abrirJornada, agregarMaterial, cerrarSinCorte, comoApp, conApp, conectar, desenlace, equipoDeAlta,
  esperarQueEspere, personaConClave, pidDe, rechaza, revisionDe, segundaPesada, una, urlApp,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { resumenDelCierre } from "../src/servidor/dominio/cierre.ts";
import { ganancia } from "../src/servidor/dominio/ganancia.ts";

const CLAVE = "481516";

interface Dia {
  app: pg.Client;
  db: pg.Client;
  e: Escenario;
  base: string;
  firma: string;
  huella: string;
  cliente: string;
  bd: Bd;
}

/** Un día de hoy, con el cajón contado con $1,000, una responsable que firma y un cliente. */
const conDia = (prueba: (d: Dia) => Promise<void>) =>
  conApp(async (app, db, e, base) => {
    await db.query("UPDATE jornada SET fecha = hoy_en(1::smallint) WHERE id = $1", [e.jornada]);
    const firma = await personaConClave(db, "Firma", "responsable", CLAVE, true);
    const huella = await equipoDeAlta(db);
    const cliente = (await una(app, "SELECT * FROM alta_cliente('Fundidora', $1)", [firma])).id;
    await app.query("SELECT abrir_el_cajon($1, $2, 1000, $3)", [randomUUID(), e.jornada, e.mostrador]);
    const bd = crearBd(await urlApp(base), { conexiones: 2 });
    try {
      await prueba({ app, db, e, base, firma, huella, cliente, bd });
    } finally {
      await bd.cerrar();
    }
  });

/** Una cuenta de cartón de tantos kilos; con forma, ya cobrada. */
async function cuenta(d: Dia, tipo: string, kg: string, forma: string | null = "efectivo", bascula?: number) {
  const op = await abrirCuenta(d.app, tipo, d.e.mostrador);
  const l = await agregarMaterial(d.app, op.id, d.e.mat["Cartón"], kg, d.e.mostrador, bascula ? { bascula } : {});
  const revision = await revisionDe(d.db, op.id);
  if (forma) await d.app.query("SELECT confirmar_cuenta($1, $2, $3, $4)", [op.id, d.e.mostrador, revision, forma]);
  return { id: op.id as string, linea: l.id as string, revision };
}
const fiar = (d: Dia, c: { id: string; revision: number }, cliente = d.cliente, vence: string | null = null, conexion = d.app) =>
  una(conexion, "SELECT * FROM cobrar_a_credito($1, $2, $3, $4, NULL, $5, $6, $7, $8)",
    [c.id, d.e.mostrador, c.revision, cliente, vence, d.firma, CLAVE, d.huella]);
const corregir = (d: Dia, c: { linea: string }, kg: string, liquidacion: string, vistas = 0, conexion = d.app) =>
  una(conexion, "SELECT * FROM corregir_cuenta($1, $2, $3, $4, $5, $6, 'Se pesó mal', $7, $8, $9, $10)",
    [randomUUID(), c.linea, kg, d.e.mat["Cartón"], vistas, liquidacion, d.firma, CLAVE, d.huella, d.e.mostrador]);
const abonar = (d: Dia, importe: string, forma = "efectivo") =>
  una(d.app, "SELECT * FROM registrar_abono($1, $2, $3, $4, NULL, $5)", [randomUUID(), d.cliente, importe, forma, d.e.mostrador]);
const debe = async (d: Dia): Promise<string> => (await una(d.app, "SELECT debe::text FROM saldo_de_clientes WHERE cliente_id = $1", [d.cliente])).debe;
const esperado = async (d: Dia): Promise<number> => Number((await una(d.app, "SELECT esperado_en_cajon($1) AS n", [d.e.jornada])).n);
const hoy = async (d: Dia): Promise<string> => (await una(d.app, "SELECT fecha::text AS f FROM jornada WHERE id = $1", [d.e.jornada])).f;

test("H4: una corrección cuenta en la ganancia con su dinero y su material, aparte de bajas y conteos", () =>
  conDia(async (d) => {
    // Se compran 100 kg a $2.10 y se venden 10 kg a $2.50; la venta eran 20 kg y se cobran $25 más.
    await cuenta(d, "compra", "100");
    const venta = await cuenta(d, "venta", "10");
    await corregir(d, venta, "20", "efectivo");
    const g = await ganancia(d.bd, { desde: await hoy(d), hasta: await hoy(d), agrupar: "dia" });
    // Lo que de verdad dejó: lo que hay en el cajón y en el patio contra lo que había.
    assert.equal(await esperado(d) + Number(g.patio.valor) - 1000, 8);
    assert.deepEqual(
      { resultado: g.totales.resultado, correcciones: g.totales.correcciones, perdidas: g.totales.perdidas, aFavor: g.totales.aFavor },
      { resultado: "8.00", correcciones: "4.00", perdidas: "0.00", aFavor: "0.00" },
    );
    assert.equal(g.materiales[0]!.resultado, "8.00");
  }));

test("H4: corregir una compra a menos kilos, con lo pagado de más devuelto, no es pérdida", () =>
  conDia(async (d) => {
    const compra = await cuenta(d, "compra", "100");
    await corregir(d, compra, "90", "efectivo");
    const g = await ganancia(d.bd, { desde: await hoy(d), hasta: await hoy(d), agrupar: "dia" });
    assert.equal(await esperado(d) + Number(g.patio.valor) - 1000, 0);
    assert.deepEqual({ resultado: g.totales.resultado, correcciones: g.totales.correcciones, perdidas: g.totales.perdidas },
      { resultado: "0.00", correcciones: "0.00", perdidas: "0.00" });
  }));

test("H5: lo que se gana o se pierde al pagar y cobrar en pesos cerrados entra en lo que dejó, aparte", () =>
  conDia(async (d) => {
    await cuenta(d, "compra", "1"); // $2.10: se pagan $2
    await cuenta(d, "venta", "1"); // $2.50: se cobran $3
    const g = await ganancia(d.bd, { desde: await hoy(d), hasta: await hoy(d), agrupar: "dia" });
    assert.equal(await esperado(d), 1001);
    assert.deepEqual({ margen: g.totales.margen, redondeo: g.totales.redondeo, resultado: g.totales.resultado, utilidad: g.totales.utilidad },
      { margen: "0.40", redondeo: "0.60", resultado: "1.00", utilidad: "1.00" });
    assert.equal(g.serie[0]!.redondeo, "0.60");
  }));

test("H7: corregir una venta fiada cambia lo que debe el cliente; «pendiente» no aplica, y no se le debe a él", () =>
  conDia(async (d) => {
    await cuenta(d, "compra", "300", "transferencia");
    const v = await cuenta(d, "venta", "100", null);
    await fiar(d, v); // $250
    await rechaza(corregir(d, v, "50", "pendiente"), "RC005");
    const c = await corregir(d, v, "50", "credito");
    assert.deepEqual([c.diferencia, c.liquidacion], ["-125.00", "credito"]);
    assert.equal(await debe(d), "125.00");
    assert.equal(await esperado(d), 1000, "no movió el cajón");
    await rechaza(abonar(d, "250"), "RC004");
    await abonar(d, "125");
    assert.equal(await debe(d), "0.00");
    // Ya pagó: bajarle otra vez a lo fiado lo dejaría con saldo a favor, y no hay adelantos. Se le devuelve.
    await rechaza(corregir(d, v, "40", "credito", 1), "RC004");
    await corregir(d, v, "40", "efectivo", 1);
    assert.equal(await esperado(d), 1125 - 25);
    // Subirla queda a deber.
    await corregir(d, v, "60", "credito", 2);
    assert.equal(await debe(d), "50.00");
    // «A lo fiado» es solo de una venta fiada.
    const contado = await cuenta(d, "venta", "10");
    await rechaza(corregir(d, contado, "12", "credito"), "RC005");
  }));

test("H7: lo vencido toma en cuenta lo corregido", () =>
  conDia(async (d) => {
    await cuenta(d, "compra", "300", "transferencia");
    const v = await cuenta(d, "venta", "100", null);
    await fiar(d, v, d.cliente, await hoy(d));
    await corregir(d, v, "60", "credito");
    // Mañana ya venció: lo vencido es lo corregido, $150, no los $250 de antes.
    await d.db.query("BEGIN; SET LOCAL session_replication_role = replica; UPDATE credito SET vence_el = vence_el - 1; COMMIT");
    assert.equal((await una(d.app, "SELECT vencido::text FROM saldo_de_clientes WHERE cliente_id = $1", [d.cliente])).vencido, "150.00");
  }));

test("H3: repetir fiar o cobrar con otro contenido se rechaza; con el mismo, devuelve lo hecho", () =>
  conDia(async (d) => {
    await cuenta(d, "compra", "100", "transferencia");
    const v = await cuenta(d, "venta", "20", null);
    const primero = await fiar(d, v);
    assert.equal((await fiar(d, v)).folio, primero.folio, "el mismo pedido devuelve lo hecho");
    const otro = (await una(d.app, "SELECT * FROM alta_cliente('Otro', $1)", [d.firma])).id;
    await rechaza(fiar(d, v, otro), "RC011");
    await rechaza(fiar(d, v, d.cliente, "2099-01-01"), "RC011");
    await rechaza(d.app.query("SELECT confirmar_cuenta($1, $2, $3, 'efectivo')", [v.id, d.e.mostrador, v.revision]), "RC011");
    const contado = await cuenta(d, "venta", "10", "efectivo");
    await rechaza(fiar(d, contado), "RC011");
    await rechaza(d.app.query("SELECT confirmar_cuenta($1, $2, $3, 'transferencia')", [contado.id, d.e.mostrador, contado.revision]), "RC011");
    const otraVez = await una(d.app, "SELECT * FROM confirmar_cuenta($1, $2, $3, 'efectivo')", [contado.id, d.e.mostrador, contado.revision]);
    assert.equal(otraVez.forma_de_pago, "efectivo");
  }));

/** Un vehículo de ayer, con su primera pesada, listo para terminarse hoy, y una compra de hoy que se puede corregir. */
async function vehiculoDeAyer(d: Dia) {
  const compra = await cuenta(d, "compra", "100", "transferencia");
  const vehiculo = await cuenta(d, "compra", "100", null, 1);
  await d.db.query("UPDATE jornada SET fecha = fecha - 1 WHERE id = $1", [d.e.jornada]);
  await cerrarSinCorte(d.db, d.e.jornada, 0, d.e.mostrador);
  d.e.jornada = (await abrirJornada(d.db, d.firma, (await una(d.db, "SELECT hoy_en(1::smallint)::text AS f")).f)).id;
  await d.app.query("SELECT abrir_el_cajon($1, $2, 1000, $3)", [randomUUID(), d.e.jornada, d.e.mostrador]);
  await segundaPesada(d.app, vehiculo.linea, "90", d.e.mostrador);
  vehiculo.revision = await revisionDe(d.db, vehiculo.id);
  return { compra, vehiculo };
}

test("H1: terminar un vehículo y corregir una cuenta a la vez no se bloquean: jornada, patio y luego la clave", () =>
  conDia(async (d) => {
    const { compra, vehiculo } = await vehiculoDeAyer(d);
    const otra = await conectar(d.base);
    try {
      // Detiene la corrección justo después de sus dos primeros candados, los de verdad: jornada y patio.
      await otra.query("BEGIN");
      await otra.query("SELECT id FROM jornada WHERE id = $1 FOR SHARE", [d.e.jornada]);
      await otra.query("SELECT pg_advisory_xact_lock(7151, 1)");
      const pid = await pidDe(d.app);
      const terminar = desenlace(d.app.query("SELECT terminar_vehiculo($1, $2, $3, $4, $5)", [vehiculo.id, vehiculo.revision, d.firma, CLAVE, d.huella]));
      await esperarQueEspere(d.db, pid);
      const correccion = await desenlace(corregir(d, compra, "90", "efectivo", 0, otra));
      await otra.query("COMMIT");
      assert.deepEqual([correccion, await terminar], ["pasó", "pasó"]);
    } finally {
      await otra.query("ROLLBACK").catch(() => {});
      await otra.end();
    }
  }));

test("H2: el resumen del cierre sale de una sola foto de la base, aunque el día se cierre a media lectura", () =>
  conDia(async (d) => {
    const otra = await comoApp(d.base);
    try {
      let lecturas = 0;
      const espia: Bd = {
        ...d.bd,
        instantanea: (accion) => d.bd.instantanea((b) => accion({
          ...b,
          leer: async (sql, valores) => {
            const filas = await b.leer(sql, valores);
            if (++lecturas === 1) {
              await otra.query("SELECT * FROM cerrar_el_dia($1, $2, 0, 1000, 100, $3, $4, $5, $6)",
                [randomUUID(), d.e.jornada, d.firma, CLAVE, d.huella, d.e.mostrador]);
            }
            return filas as never;
          },
        })),
      };
      const r = (await resumenDelCierre(espia))!;
      assert.ok(lecturas >= 2, "leyó en más de una consulta");
      assert.equal(r.jornada.abierta, r.cajon.jornada.abierta, "la jornada y su cajón dicen lo mismo");
      assert.equal(r.cajon.cortes.length, 0);
    } finally {
      await otra.end();
    }
  }));
