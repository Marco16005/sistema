import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRANDE, abrirJornada, asentar, compraDe, conBase, conectar, confirmar, cuenta, desenlace, escenario, esperarQueEspere,
  existencia, pesada, pidDe, rechaza, renglon, renglonSinPeso, una,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import type pg from "pg";

const cerrar = (db: pg.Client, e: Escenario, jornada = e.jornada, quien = e.mostrador) =>
  una(db, "SELECT * FROM cerrar_jornada($1, $2)", [jornada, quien]);

/** Abre y publica la jornada del día siguiente; opcionalmente con otro precio de compra para un material. */
async function diaSiguiente(db: pg.Client, e: Escenario, nuevoPrecio?: [number, number]): Promise<Escenario> {
  const j = await abrirJornada(db, e.responsable, "2026-10-02");
  if (nuevoPrecio) await db.query("UPDATE precio SET compra = $1 WHERE lista_id = $2 AND material_id = $3", [nuevoPrecio[1], j.lista, nuevoPrecio[0]]);
  await db.query("SELECT publicar_lista($1, $2)", [j.lista, e.responsable]);
  return { ...e, jornada: j.id, lista: j.lista };
}
/** Una camioneta que ya se pesó cargada y todavía no vuelve a pesarse vacía. */
async function camionetaPendiente(db: pg.Client, e: Escenario): Promise<{ op: string; linea: string }> {
  const op = await cuenta(db, e, "compra");
  const linea = await renglonSinPeso(db, op, e.mat["Fierro pesado"], GRANDE);
  await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
  return { op, linea };
}
const reporte = async (db: pg.Client, jornada: string) =>
  Object.fromEntries(
    (await db.query("SELECT nombre, entro_kg, salio_kg FROM cierre_material WHERE jornada_id = $1", [jornada])).rows.map(
      (f) => [f.nombre, [f.entro_kg, f.salio_kg]],
    ),
  );

// ── cerrar ─────────────────────────────────────────────────────────────────

test("la jornada no cierra mientras haya una cuenta abierta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(cerrar(db, e), "RC006");
  }));

test("terminadas o descartadas las cuentas, la jornada cierra", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 10);
    const descartada = await cuenta(db, e, "venta");
    await db.query("DELETE FROM operacion WHERE id = $1", [descartada]);
    const j = await cerrar(db, e);
    assert.ok(j.cerrada_en);
    assert.equal(j.cerrada_por, e.mostrador);
  }));

test("una jornada no se cierra dos veces", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await cerrar(db, e);
    await rechaza(cerrar(db, e), "RC006");
  }));

test("una jornada cerrada no se reabre ni se modifica", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await cerrar(db, e);
    await rechaza(db.query("UPDATE jornada SET cerrada_en = NULL, cerrada_por = NULL WHERE id = $1", [e.jornada]), "RC001");
  }));

test("quien solo consulta no cierra la jornada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(cerrar(db, e, e.jornada, e.consulta), "RC008");
  }));

test("quien abre una cuenta mientras la jornada se cierra espera, y su cuenta tardía se rechaza", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await cerrar(db, e);
      const apertura = desenlace(
        otra.query("INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, creada_por) VALUES (gen_random_uuid(), 1, $1, 'compra', $2)", [
          e.jornada, e.mostrador,
        ]),
      );
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await apertura, "RC006");
    } finally {
      await otra.end();
    }
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion")).n, 0);
  }));

test("quien asienta un movimiento mientras la jornada se cierra espera, y su movimiento tardío se rechaza", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await cerrar(db, e);
      const merma = desenlace(otra.query("SELECT registrar_merma($1, 10, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await merma, "RC006");
    } finally {
      await otra.end();
    }
    assert.equal(await existencia(db, e.mat["Cartón"]), 100, "la jornada cerrada no recibió la merma");
  }));

test("una jornada cerrada ya no recibe movimientos", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 10);
    await cerrar(db, e);
    await rechaza(
      db.query(
        `INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, autorizado_por, creado_por)
         VALUES (1, $1, 'ajuste', 5, $2, 'tardío', $3, $3)`,
        [e.mat["Cartón"], e.jornada, e.responsable],
      ),
      "RC006",
    );
  }));

// ── el reporte ─────────────────────────────────────────────────────────────

test("los totales por material del cierre coinciden con la cuenta hecha aparte, con todo tipo de movimiento", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    await compraDe(db, e, e.mat["Cartón"], 50);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 30);
    await confirmar(db, venta, e.mostrador);
    await db.query("SELECT registrar_merma($1, 4, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]);
    await db.query("SELECT registrar_conteo($1, 118, $2, $3)", [e.mat["Cartón"], e.responsable, e.mostrador]);   // había 116: +2
    await db.query("SELECT registrar_transformacion($1, 100, $2::jsonb, NULL, $3)", [
      e.mat["Fierro lámina"],
      JSON.stringify([{ material: e.mat["Fierro pesado"], kg: 60 }, { material: e.mat["Cartón"], kg: 35 }]),
      e.mostrador,
    ]);
    await cerrar(db, e);
    // La cuenta aparte, con las cantidades que se acaban de capturar:
    assert.deepEqual(await reporte(db, e.jornada), {
      "Cartón": ["187.000", "34.000"],          // entró 100 + 50 + 2 + 35; salió 30 + 4
      "Fierro lámina": ["100.000", "100.000"],  // se compró y se separó completo
      "Fierro pesado": ["60.000", "0.000"],
    });
    assert.equal(await existencia(db, e.mat["Cartón"]), 153);
  }));

test("el resumen del cierre da operaciones, totales de compra y de venta, y los ajustes por redondeo", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 30.2);        // 63.42 → 63
    await compraDe(db, e, e.mat["Aluminio bote"], 12.35); // 345.80 → 346
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 10);      // 25.00 → 25
    await confirmar(db, venta, e.mostrador);
    const r = await una(db, "SELECT * FROM cierre_resumen WHERE jornada_id = $1", [e.jornada]);
    assert.equal(r.operaciones, 3);
    assert.equal(r.total_compras, "409");
    assert.equal(r.total_ventas, "25");
    assert.equal(r.ajustes_redondeo, "-0.22");
  }));

test("un ajuste de mañana no cambia el cierre de hoy", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    await cerrar(db, e);
    const antes = await reporte(db, e.jornada);
    const manana = await diaSiguiente(db, e);
    await db.query("SELECT registrar_conteo($1, 90, $2, $3)", [e.mat["Cartón"], e.responsable, e.mostrador]);
    assert.deepEqual(await reporte(db, e.jornada), antes);
    assert.deepEqual(await reporte(db, manana.jornada), { "Cartón": ["0.000", "10.000"] });
  }));

// ── el vehículo que no volvió a pesarse el mismo día ───────────────────────

test("una cuenta con un vehículo pendiente de su segunda pesada no impide cerrar la jornada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await camionetaPendiente(db, e);
    assert.ok((await cerrar(db, e)).cerrada_en);
    assert.equal((await una(db, "SELECT cuentas_pendientes FROM cierre_resumen WHERE jornada_id = $1", [e.jornada])).cuentas_pendientes, 1);
  }));

test("un renglón que nunca se pesó no cuenta como vehículo pendiente: esa cuenta sí impide cerrar", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await rechaza(cerrar(db, e), "RC006");
  }));

test("la segunda pesada del día siguiente la termina un responsable, con el precio del día en que llegó", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const { op, linea } = await camionetaPendiente(db, e);
    await cerrar(db, e);
    const cierreDeAyer = await reporte(db, e.jornada);
    const manana = await diaSiguiente(db, e, [e.mat["Fierro pesado"], 9]);        // hoy el fierro pesado se paga a $9
    await asentar(db, linea, await pesada(db, manana, GRANDE, 1940), 2);

    await rechaza(confirmar(db, op, e.mostrador), "RC008");                        // el mostrador solo no puede
    const c = await confirmar(db, op, e.responsable);
    assert.equal(c.suma, "6256.00", "920 kg al precio de ayer, $6.80, no al de hoy");
    assert.equal(c.jornada_id, e.jornada);
    assert.equal(c.confirmada_en_jornada, manana.jornada);
    const mov = await una(db, "SELECT jornada_id, cantidad_kg FROM movimiento_inventario WHERE linea_id = $1", [linea]);
    assert.equal(mov.jornada_id, manana.jornada, "el material entra al libro el día en que se terminó de pesar");
    assert.deepEqual(await reporte(db, e.jornada), cierreDeAyer, "el cierre de ayer no cambia");
    assert.equal((await una(db, "SELECT detalle FROM bitacora WHERE accion = 'confirmar' AND entidad_id = $1", [op])).detalle.excepcion,
      "segunda pesada en otra jornada");
  }));

test("la cuenta pendiente de ayer no se termina si hoy no hay jornada abierta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const { op, linea } = await camionetaPendiente(db, e);
    await cerrar(db, e);
    await asentar(db, linea, await pesada(db, e, GRANDE, 1940), 2);
    await rechaza(confirmar(db, op, e.responsable), "RC006");
  }));

test("una cuenta común que quedó en una jornada cerrada no se termina después", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $1, cierres = cierres + 1 WHERE id = $2", [e.responsable, e.jornada]);
    await diaSiguiente(db, e);
    await rechaza(confirmar(db, op, e.responsable), "RC006");
  }));

test("al día siguiente se puede abrir jornada aunque quede un vehículo pendiente de ayer", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await camionetaPendiente(db, e);
    await cerrar(db, e);
    const manana = await diaSiguiente(db, e);
    assert.ok(manana.jornada);
  }));
