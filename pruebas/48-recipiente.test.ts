// El recipiente en la báscula chica: el costal, la carretilla o la cubeta en que viene el material.
// Lo que pesa vacío se teclea al pesar —o después, mientras la cuenta siga abierta— y se descuenta
// de lo que se paga o se cobra y también de lo que entra o sale del patio. En la báscula grande no
// hay recipiente: ahí el vehículo se pesa lleno y vacío.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { CHICA_2, CHICA_3, GRANDE, conApp, conBase, escenario, existencia, rechaza, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { comprobante } from "../src/servidor/dominio/comprobante.ts";
import { abrirCuenta, agregarMaterial, confirmar, ponerDescuento, ponerRecipiente } from "../src/servidor/dominio/cuentas.ts";
import { ErrorDeNegocio } from "../src/servidor/errores.ts";

const conCuentas = (prueba: (bd: Bd, db: pg.Client, e: Escenario) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 3 });
    try {
      await prueba(bd, db, await escenario(db));
    } finally {
      await bd.cerrar();
    }
  });

const rechazaCon = (promesa: Promise<unknown>, codigo: string) =>
  assert.rejects(promesa, (e: unknown) => {
    assert.ok(e instanceof ErrorDeNegocio, `se esperaba ${codigo} y llegó ${e}`);
    assert.equal(e.codigo, codigo, e.message);
    return true;
  });

const envio = (material: number, kg: string, recipiente?: string, bascula = CHICA_2) =>
  ({ linea: randomUUID(), captura: randomUUID(), material, bascula, kg, ...(recipiente === undefined ? {} : { recipiente }) });

const nueva = (bd: Bd, e: Escenario, tipo: "compra" | "venta") => abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo, etiqueta: null });

/** Agrega un material como lo llama la aplicación, con lo que pesa el recipiente. */
const agregarCon = (app: pg.Client, cuenta: string, material: number, kg: string, recipiente: unknown, quien: string,
  ids: { linea?: string; captura?: string; bascula?: number } = {}) =>
  una(app, "SELECT * FROM agregar_material($1, $2, $3, $4::smallint, $5, $6, $7, $8)", [
    cuenta, ids.linea ?? randomUUID(), material, ids.bascula ?? CHICA_2, ids.captura ?? randomUUID(), kg, quien, recipiente,
  ]);

const abrir = async (app: pg.Client, tipo: string, quien: string): Promise<string> =>
  (await una(app, "SELECT * FROM abrir_cuenta($1, $2, NULL, $3)", [randomUUID(), tipo, quien])).id;

// ── al pesar ───────────────────────────────────────────────────────────────

test("en la báscula chica, el recipiente se descuenta de lo que se paga y de lo que entra al patio", () =>
  conCuentas(async (bd, db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cobre de primera"], "15.4", "0.4"));
    const m = c.materiales[0]!;
    assert.deepEqual(
      { bruto: m.bruto, tara: m.tara, recipiente: m.recipiente, kg: m.kg, importe: m.importe },
      { bruto: "15.400", tara: "0.400", recipiente: "0.400", kg: "15.000", importe: "2250.00" },
    );
    const hecha = await confirmar(bd, e.mostrador, c.id, c.revision);
    assert.equal(hecha.resumen.total, "2250");
    assert.equal(await existencia(db, e.mat["Cobre de primera"]), 15);

    const t = await comprobante(bd, c.id);
    assert.deepEqual(
      { bruto: t!.materiales[0]!.bruto, tara: t!.materiales[0]!.tara, recipiente: t!.materiales[0]!.recipiente, kg: t!.materiales[0]!.kg },
      { bruto: "15.400", tara: "0.400", recipiente: "0.400", kg: "15.000" },
    );
  }));

test("en una venta, sale del patio solo el material, sin el recipiente", () =>
  conCuentas(async (bd, db, e) => {
    await db.query("SELECT registrar_apertura($1, 100, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
    let c = await nueva(bd, e, "venta");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "32", "2"));
    assert.deepEqual([c.materiales[0]!.kg, c.materiales[0]!.importe], ["30.000", "75.00"]);
    await confirmar(bd, e.mostrador, c.id, c.revision);
    assert.equal(await existencia(db, e.mat["Cartón"]), 70);
  }));

test("sin recipiente se pesa como siempre, y el recipiente de la báscula grande nunca se dice recipiente", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "30.2"));
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["PET"], "2", "0"));
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"], "5200", undefined, GRANDE));
    assert.deepEqual(c.materiales.map((m) => [m.tara, m.recipiente, m.kg]), [
      ["0.000", "0.000", "30.200"],
      ["0.000", "0.000", "2.000"],
      [null, "0.000", null],
    ]);
  }));

test("el recipiente tiene que pesar menos que lo que marcó, y si no, no queda nada agregado", () =>
  conApp(async (app, db, e) => {
    const op = await abrir(app, "compra", e.mostrador);
    const ids = { linea: randomUUID(), captura: randomUUID() };
    await rechaza(agregarCon(app, op, e.mat["Cartón"], "2", "2", e.mostrador, ids), "RC004");
    await rechaza(agregarCon(app, op, e.mat["Cartón"], "2", "2.5", e.mostrador, ids), "RC004");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea WHERE operacion_id = $1", [op])).n, 0);
    // El mismo envío, ya con un recipiente que cabe, entra: lo rechazado no se quedó con sus identificadores.
    const l = await agregarCon(app, op, e.mat["Cartón"], "2", "1.999", e.mostrador, ids);
    assert.equal(l.peso_recibido, "0.001");
  }));

test("en la báscula grande no se pone recipiente: el vehículo se pesa lleno y vacío", () =>
  conApp(async (app, _db, e) => {
    const op = await abrir(app, "compra", e.mostrador);
    await rechaza(agregarCon(app, op, e.mat["Fierro pesado"], "5200", "20", e.mostrador, { bascula: GRANDE }), "RC004");
    const l = await agregarCon(app, op, e.mat["Fierro pesado"], "5200", "0", e.mostrador, { bascula: GRANDE });
    await una(app, "SELECT * FROM segunda_pesada($1, $2, '3400', $3)", [l.id, randomUUID(), e.mostrador]);
    await rechaza(app.query("SELECT poner_recipiente($1, '20', $2)", [l.id, e.mostrador]), "RC004");
    await rechaza(app.query("SELECT poner_recipiente($1, '1800', $2)", [l.id, e.mostrador]), "RC004");
  }));

test("lo que pesa el recipiente es un número de cero en adelante, con hasta tres decimales", () =>
  conApp(async (app, _db, e) => {
    const op = await abrir(app, "compra", e.mostrador);
    for (const malo of ["-0.2", "0.0005", "NaN", "Infinity", "1000000", null]) {
      await rechaza(agregarCon(app, op, e.mat["Cartón"], "30", malo, e.mostrador), "RC004");
    }
    const l = await agregarCon(app, op, e.mat["Cartón"], "30", "0", e.mostrador);
    for (const malo of ["-0.2", "0.0005", "NaN", "Infinity", "1000000", null]) {
      await rechaza(app.query("SELECT poner_recipiente($1, $2, $3)", [l.id, malo, e.mostrador]), "RC004");
    }
    await rechaza(app.query("SELECT poner_recipiente($1, '1', $2)", [randomUUID(), e.mostrador]), "RC005");
  }));

test("repetir el envío con el mismo recipiente no agrega otro; con otro recipiente se rechaza", () =>
  conApp(async (app, db, e) => {
    const op = await abrir(app, "compra", e.mostrador);
    const ids = { linea: randomUUID(), captura: randomUUID() };
    const a = await agregarCon(app, op, e.mat["Cartón"], "30", "1.5", e.mostrador, ids);
    const b = await agregarCon(app, op, e.mat["Cartón"], "30", "1.50", e.mostrador, ids);
    assert.equal(b.id, a.id);
    assert.equal(b.tara, "1.500");
    // Un envío que cambió es RC012 (0018): ese identificador ya no sirve para otra cosa.
    await rechaza(agregarCon(app, op, e.mat["Cartón"], "30", "1", e.mostrador, ids), "RC012");
    await rechaza(agregarCon(app, op, e.mat["Cartón"], "30", "0", e.mostrador, ids), "RC012");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea WHERE operacion_id = $1", [op])).n, 1);
  }));

test("un envío sin recipiente se guarda igual que antes de que hubiera recipientes", () =>
  conApp(async (app, db, e) => {
    const op = await abrir(app, "compra", e.mostrador);
    const linea = randomUUID();
    // Las siete entradas de siempre siguen valiendo.
    await una(app, "SELECT * FROM agregar_material($1, $2, $3, 2::smallint, $4, '30', $5)", [op, linea, e.mat["Cartón"], randomUUID(), e.mostrador]);
    const { contenido } = await una(db, "SELECT contenido FROM envio WHERE id = $1", [linea]);
    assert.deepEqual(Object.keys(contenido).sort(), ["bascula", "cuenta", "kg", "material", "pesada"]);
  }));

// ── después de pesar ───────────────────────────────────────────────────────

test("el recipiente se pone, se cambia o se quita desde la cuenta mientras está abierta", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cobre de primera"], "15.4"));
    const linea = c.materiales[0]!.id;
    let antes = c.revision;

    c = await ponerRecipiente(bd, e.patio, c.id, linea, "0.6");
    assert.deepEqual([c.materiales[0]!.recipiente, c.materiales[0]!.kg, c.resumen.total], ["0.600", "14.800", "2220"]);
    assert.ok(c.revision > antes);

    antes = c.revision;
    c = await ponerRecipiente(bd, e.mostrador, c.id, linea, "0.600");
    assert.equal(c.revision, antes, "poner el mismo peso no es un cambio de la cuenta");

    c = await ponerRecipiente(bd, e.mostrador, c.id, linea, "0");
    assert.deepEqual([c.materiales[0]!.recipiente, c.materiales[0]!.kg], ["0.000", "15.400"]);

    c = await ponerRecipiente(bd, e.mostrador, c.id, linea, "0.2");
    await rechazaCon(confirmar(bd, e.mostrador, c.id, antes), "RC011");
    const hecha = await confirmar(bd, e.mostrador, c.id, c.revision);
    await rechazaCon(ponerRecipiente(bd, e.mostrador, c.id, linea, "0.3"), "RC001");
    assert.equal(hecha.materiales[0]!.kg, "15.200");
  }));

test("con un descuento puesto, el recipiente no puede comerse lo descontado", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "15.4", undefined, CHICA_3));
    const linea = c.materiales[0]!.id;
    c = await ponerDescuento(bd, e.mostrador, c.id, linea, "1");
    await rechazaCon(ponerRecipiente(bd, e.mostrador, c.id, linea, "14.5"), "RC004");
    c = await ponerRecipiente(bd, e.mostrador, c.id, linea, "14.4");
    assert.deepEqual([c.materiales[0]!.kg, c.materiales[0]!.importe], ["0.000", "0.00"]);
  }));

test("desde una cuenta no se le pone recipiente al material de otra", () =>
  conCuentas(async (bd, _db, e) => {
    let a = await nueva(bd, e, "compra");
    const b = await nueva(bd, e, "compra");
    a = await agregarMaterial(bd, e.mostrador, a.id, envio(e.mat["Cartón"], "30"));
    await rechazaCon(ponerRecipiente(bd, e.mostrador, b.id, a.materiales[0]!.id, "1"), "RC005");
  }));
