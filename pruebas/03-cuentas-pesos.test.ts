import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  CHICA_2, CHICA_3, GRANDE, abrirJornada, asentar, conBase, cuenta, escenario, material, pesada, rechaza, renglon,
  renglonSinPeso, una, usuario, verRenglon,
} from "./apoyo.ts";

// ── la cuenta ──────────────────────────────────────────────────────────────

test("una cuenta no nace si la lista de precios del día no está publicada", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const j = await abrirJornada(db, responsable);
    await rechaza(
      db.query("INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, creada_por) VALUES ($1, 1, $2, 'compra', $3)", [
        randomUUID(), j.id, responsable,
      ]),
      "RC009",
    );
  }));

test("una cuenta nace abierta, sin folio ni totales, atada a la lista de su jornada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await una(db, "SELECT * FROM operacion WHERE id = $1", [await cuenta(db, e, "compra")]);
    assert.equal(op.estado, "borrador");
    assert.equal(op.estado_pago, "pendiente");
    assert.equal(op.folio, null);
    assert.equal(op.total, null);
    assert.equal(op.lista_id, e.lista);
  }));

test("no se abre una cuenta en una jornada cerrada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $1, cierres = cierres + 1 WHERE id = $2", [e.responsable, e.jornada]);
    await rechaza(cuenta(db, e, "compra"), "RC006");
  }));

test("el identificador de la cuenta lo pone la estación: repetirlo se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const id = await cuenta(db, e, "compra");
    await rechaza(
      db.query("INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, creada_por) VALUES ($1, 1, $2, 'venta', $3)", [
        id, e.jornada, e.mostrador,
      ]),
      "23505",
    );
  }));

test("puede haber varias cuentas abiertas a la vez, de compra y de venta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    for (const tipo of ["compra", "venta", "compra", "venta"] as const) await cuenta(db, e, tipo);
    const f = await una(db, "SELECT count(*)::int AS n FROM operacion WHERE estado = 'borrador'");
    assert.equal(f.n, 4);
  }));

// ── el precio del renglón ──────────────────────────────────────────────────

test("en una compra el renglón toma el precio de compra de la lista", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const l = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Aluminio bote"], CHICA_2);
    assert.equal((await verRenglon(db, l)).precio_unitario, "28.0000");
  }));

test("en una venta el renglón toma el precio de venta de la lista", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const l = await renglonSinPeso(db, await cuenta(db, e, "venta"), e.mat["Aluminio bote"], CHICA_2);
    assert.equal((await verRenglon(db, l)).precio_unitario, "33.0000");
  }));

test("quien captura no decide el precio: el que mande se ignora", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const f = await una(
      db,
      "INSERT INTO operacion_linea (operacion_id, material_id, instrumento_id, precio_unitario) VALUES ($1, $2, $3, 999) RETURNING precio_unitario",
      [await cuenta(db, e, "compra"), e.mat["Aluminio bote"], CHICA_2],
    );
    assert.equal(f.precio_unitario, "28.0000");
  }));

test("un material sin precio en la lista de hoy no entra a la cuenta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(renglonSinPeso(db, await cuenta(db, e, "compra"), await material(db, "Plomo"), CHICA_2), "RC009");
  }));

// ── el peso del renglón ────────────────────────────────────────────────────

test("el peso del renglón sale de la pesada, y recibido, liquidable e importe se calculan solos", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const l = await verRenglon(db, await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Aluminio bote"], 12.35));
    assert.equal(l.peso_bruto, "12.350");
    assert.equal(l.tara, "0.000");
    assert.equal(l.peso_recibido, "12.350");
    assert.equal(l.peso_liquidable, "12.350");
    assert.equal(l.importe, "345.80");
  }));

test("un renglón recién agregado todavía no tiene peso", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const l = await verRenglon(db, await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2));
    assert.equal(l.peso_bruto, null);
    assert.equal(l.importe, null);
  }));

test("el importe de cada renglón se redondea a centavos", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    // 1.005 kg × $6.20 = $6.231
    const l = await verRenglon(db, await renglon(db, e, op, e.mat["Fierro lámina"], 1.005));
    assert.equal(l.importe, "6.23");
  }));

test("el descuento comercial baja lo que se paga y no lo que entra al patio", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 100);
    await db.query("UPDATE operacion_linea SET descuento_kg = 3 WHERE id = $1", [linea]);
    const l = await verRenglon(db, linea);
    assert.equal(l.peso_recibido, "100.000");
    assert.equal(l.peso_liquidable, "97.000");
    assert.equal(l.importe, "203.70");
  }));

test("el descuento no puede ser mayor que el peso recibido", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion_linea SET descuento_kg = 11 WHERE id = $1", [linea]), "23514");
  }));

test("una cuenta admite varios materiales", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Aluminio bote"], 12.35);
    await renglon(db, e, op, e.mat["Cartón"], 30.2, CHICA_3);
    await renglon(db, e, op, e.mat["Cobre de primera"], 4.1);
    const f = await una(db, "SELECT count(*)::int AS n, sum(importe) AS suma FROM operacion_linea WHERE operacion_id = $1", [op]);
    assert.equal(f.n, 3);
    assert.equal(f.suma, "1024.22");
  }));

// ── la pesada ──────────────────────────────────────────────────────────────

test("una pesada no sirve para dos renglones", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const captura = await pesada(db, e, CHICA_2, 18.45);
    await asentar(db, await renglonSinPeso(db, op, e.mat["Cartón"], CHICA_2), captura);
    await rechaza(asentar(db, await renglonSinPeso(db, op, e.mat["PET"], CHICA_2), captura), "23505");
  }));

test("una pesada no sirve para dos cuentas", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const captura = await pesada(db, e, CHICA_2, 18.45);
    await asentar(db, await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2), captura);
    await rechaza(
      asentar(db, await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2), captura),
      "23505",
    );
  }));

test("una pesada de otra báscula no entra al renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2);
    await rechaza(asentar(db, linea, await pesada(db, e, CHICA_3, 5)), "RC004");
  }));

test("una pesada vencida no entra al renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2);
    const vieja = await una(
      db,
      `INSERT INTO captura_peso (instrumento_id, valor_kg, origen, tomada_por, tomada_en, vence_en)
       VALUES ($1, 5, 'tecleada', $2, now() - interval '10 minutes', now() - interval '5 minutes') RETURNING id`,
      [CHICA_2, e.mostrador],
    );
    await rechaza(asentar(db, linea, vieja.id), "RC004");
  }));

test("una pesada mayor que la capacidad de la báscula se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("UPDATE instrumento SET capacidad_kg = 300 WHERE id = $1", [CHICA_2]);
    await rechaza(pesada(db, e, CHICA_2, 300.5), "RC004");
  }));

test("una pesada que la báscula no puede marcar se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("UPDATE instrumento SET division_kg = 0.005 WHERE id = $1", [CHICA_2]);
    await pesada(db, e, CHICA_2, 7.215);
    await rechaza(pesada(db, e, CHICA_2, 7.213), "RC004");
  }));

test("una pesada registrada no se modifica", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const captura = await pesada(db, e, CHICA_2, 7.215);
    await rechaza(db.query("UPDATE captura_peso SET valor_kg = 72.15 WHERE id = $1", [captura]), "RC001");
  }));

test("una pesada registrada no se borra", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const captura = await pesada(db, e, CHICA_2, 7.215);
    await rechaza(db.query("DELETE FROM captura_peso WHERE id = $1", [captura]), "RC001");
  }));

test("una báscula chica pesa una sola vez", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(asentar(db, linea, await pesada(db, e, CHICA_2, 4), 2), "RC004");
  }));

// ── doble pesaje en la báscula grande ──────────────────────────────────────

test("compra por vehículo: con la primera pesada el renglón todavía no tiene peso", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    assert.equal((await verRenglon(db, linea)).peso_bruto, null);
  }));

test("compra por vehículo: cargado y después vacío, el peso sale de la diferencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    await asentar(db, linea, await pesada(db, e, GRANDE, 1940), 2);
    const l = await verRenglon(db, linea);
    assert.equal(l.peso_bruto, "2860.000");
    assert.equal(l.tara, "1940.000");
    assert.equal(l.peso_recibido, "920.000");
    assert.equal(l.importe, "6256.00");
  }));

test("compra por vehículo: vacío no puede pesar más que cargado", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 1940), 1);
    await rechaza(asentar(db, linea, await pesada(db, e, GRANDE, 2860), 2), "RC004");
  }));

test("venta por vehículo: vacío y después cargado, el peso sale de la diferencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "venta"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 1940), 1);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 2);
    const l = await verRenglon(db, linea);
    assert.equal(l.peso_bruto, "2860.000");
    assert.equal(l.tara, "1940.000");
    assert.equal(l.peso_recibido, "920.000");
    assert.equal(l.importe, "7360.00");
  }));

test("venta por vehículo: cargado no puede pesar menos que vacío", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "venta"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    await rechaza(asentar(db, linea, await pesada(db, e, GRANDE, 1940), 2), "RC004");
  }));

test("en la báscula grande no hay segunda pesada sin la primera", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await rechaza(asentar(db, linea, await pesada(db, e, GRANDE, 1940), 2), "RC004");
  }));

// ── cambios mientras la cuenta está abierta ────────────────────────────────

test("un renglón se quita mientras la cuenta está abierta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    await db.query("DELETE FROM operacion_linea WHERE id = $1", [linea]);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea WHERE operacion_id = $1", [op])).n, 0);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM linea_pesada")).n, 0);
  }));

test("descartar una cuenta abierta se lleva sus renglones", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await db.query("DELETE FROM operacion WHERE id = $1", [op]);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea")).n, 0);
  }));

test("a un renglón no se le cambia el material: se quita y se agrega otro", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion_linea SET material_id = $1 WHERE id = $2", [e.mat["Cobre de primera"], linea]), "RC005");
  }));

test("a una cuenta abierta no se le cambia el sentido de compra a venta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await rechaza(db.query("UPDATE operacion SET tipo = 'venta' WHERE id = $1", [op]), "RC005");
  }));

// ── tras la revisión de Codex ──────────────────────────────────────────────

test("aunque se mande otra lista, la cuenta queda atada a la de su jornada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const f = await una(
      db,
      "INSERT INTO operacion (id, sucursal_id, jornada_id, lista_id, tipo, creada_por) VALUES ($1, 1, $2, 999999, 'compra', $3) RETURNING lista_id",
      [randomUUID(), e.jornada, e.mostrador],
    );
    assert.equal(f.lista_id, e.lista);
  }));

test("una cuenta no puede insertarse ya confirmada: siempre nace abierta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const f = await una(
      db,
      `INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, creada_por, estado, folio, suma, ajuste_redondeo, total, confirmada_en, confirmada_por)
       VALUES ($1, 1, $2, 'compra', $3, 'confirmada', 77, 100, 0, 100, now(), $3) RETURNING estado, folio, total`,
      [randomUUID(), e.jornada, e.mostrador],
    );
    assert.deepEqual(f, { estado: "borrador", folio: null, total: null });
  }));

test("un renglón no se pasa a otra cuenta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion_linea SET operacion_id = $1 WHERE id = $2", [await cuenta(db, e, "compra"), linea]), "RC005");
  }));

test("a una cuenta que quedó de una jornada ya cerrada no se le agregan materiales", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $1, cierres = cierres + 1 WHERE id = $2", [e.responsable, e.jornada]);
    await rechaza(renglonSinPeso(db, op, e.mat["Cartón"], CHICA_2), "RC006");
  }));

test("una tercera pesada no cabe en un renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    await asentar(db, linea, await pesada(db, e, GRANDE, 1940), 2);
    await rechaza(asentar(db, linea, await pesada(db, e, GRANDE, 1000), 3), "23514");
  }));

test("la misma posición de un renglón no se pesa dos veces", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    await rechaza(asentar(db, linea, await pesada(db, e, GRANDE, 2900), 1), "23505");
  }));

test("en doble pesaje, dos pesos iguales no dan material", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    await rechaza(asentar(db, linea, await pesada(db, e, GRANDE, 2860), 2), "RC004");
  }));

test("una pesada usada no vuelve a servir aunque se quite su renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const captura = await pesada(db, e, CHICA_2, 18.45);
    const deUno = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2);
    await asentar(db, deUno, captura);
    await db.query("DELETE FROM operacion_linea WHERE id = $1", [deUno]);
    const deOtro = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cartón"], CHICA_2);
    await rechaza(asentar(db, deOtro, captura), "23505");
  }));

test("una pesada suelta no se quita de un renglón: se quita el renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(db.query("DELETE FROM linea_pesada WHERE linea_id = $1", [linea]), "RC005");
  }));

test("una pesada tiene que ser un número", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(
      db.query("INSERT INTO captura_peso (instrumento_id, valor_kg, origen, tomada_por) VALUES ($1, 'NaN', 'tecleada', $2)", [
        CHICA_2, e.mostrador,
      ]),
      "RC004",
    );
  }));

test("los renglones no se vacían de un golpe", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(db.query("TRUNCATE operacion_linea CASCADE"), "RC001");
  }));

// ── cuánto dinero expone cada pesada, según la báscula ─────────────────────

test("valor en riesgo: media división de la báscula por el precio del material", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("UPDATE instrumento SET division_kg = 10 WHERE id = $1", [GRANDE]);
    const linea = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Cobre de primera"], GRANDE);
    const f = await una(db, "SELECT valor_en_riesgo FROM renglon_riesgo WHERE linea_id = $1", [linea]);
    assert.equal(f.valor_en_riesgo, "750.00");
  }));

test("error relativo: la división de la báscula entre el peso del renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("UPDATE instrumento SET division_kg = 10, doble_pesaje = false WHERE id = $1", [GRANDE]);
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 30, GRANDE);
    const f = await una(db, "SELECT error_relativo FROM renglon_riesgo WHERE linea_id = $1", [linea]);
    assert.equal(f.error_relativo, "0.3333");
  }));
