// Los gastos del negocio (0042): se capturan a mano, por tipo, y se escoge cuáles se restan en la
// utilidad. Uno que salió del cajón es también un «sacar»: baja lo que debería haber una sola vez.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { conApp, equipoDeAlta, personaConClave, rechaza, una } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const tipo = async (c: pg.Client, nombre: string): Promise<string> => (await una(c, "SELECT id FROM tipo_de_gasto WHERE nombre = $1", [nombre])).id;
const gastar = (c: pg.Client, quien: string, o: { envio?: string; fecha: string; tipo: string; concepto?: string; importe: string; de?: string; movimiento?: string | null }) =>
  una(c, "SELECT * FROM registrar_gasto($1, $2, $3, $4, $5, $6, $7, $8)", [
    o.envio ?? randomUUID(), o.fecha, o.tipo, o.concepto ?? "Algo", o.importe, o.de ?? "otro", o.movimiento ?? null, quien,
  ]);
const fechaDeHoy = async (c: pg.Client, e: Escenario): Promise<string> => (await una(c, "SELECT to_char(fecha, 'YYYY-MM-DD') AS f FROM jornada WHERE id = $1", [e.jornada])).f;
const esperado = async (c: pg.Client, e: Escenario): Promise<number> => Number((await una(c, "SELECT esperado_en_cajon($1) AS x", [e.jornada])).x);
const contarElCajon = (db: pg.Client, e: Escenario) => db.query("SELECT abrir_el_cajon(gen_random_uuid(), $1, 5000, $2)", [e.jornada, e.mostrador]);

test("la migración deja los tipos de siempre, todos cuentan; un responsable da de alta otro, lo desactiva o dice que no cuenta", () =>
  conApp(async (app, _db, e) => {
    const tipos = (await app.query("SELECT nombre, cuenta, activo FROM tipo_de_gasto ORDER BY id")).rows;
    assert.deepEqual(tipos.map((t) => t.nombre), ["Sueldos", "Renta", "Luz y agua", "Fletes", "Gasolina", "Mantenimiento", "Otro"]);
    assert.ok(tipos.every((t) => t.cuenta && t.activo));
    const tel = await una(app, "SELECT * FROM alta_tipo_de_gasto('  Teléfono  ', $1)", [e.responsable]);
    assert.equal(tel.nombre, "Teléfono");
    await rechaza(app.query("SELECT alta_tipo_de_gasto('teléfono', $1)", [e.responsable]), "RC005");
    await rechaza(app.query("SELECT alta_tipo_de_gasto('', $1)", [e.responsable]), "RC005");
    const noCuenta = await una(app, "SELECT * FROM cambiar_tipo_de_gasto($1, false, true, $2)", [tel.id, e.responsable]);
    assert.deepEqual([noCuenta.cuenta, noCuenta.activo], [false, true]);
    const inactivo = await una(app, "SELECT * FROM cambiar_tipo_de_gasto($1, false, false, $2)", [tel.id, e.responsable]);
    assert.equal(inactivo.activo, false);
    await rechaza(gastar(app, e.responsable, { fecha: await fechaDeHoy(app, e), tipo: tel.id, importe: "100" }), "RC005");
  }));

test("un gasto de otro lado se captura con su fecha, pasada si se quiere, y no toca el cajón", () =>
  conApp(async (app, db, e) => {
    await contarElCajon(db, e);
    const antes = await esperado(app, e);
    const g = await gastar(app, e.responsable, { fecha: "2026-09-15", tipo: await tipo(app, "Renta"), concepto: "Renta de septiembre", importe: "8000" });
    assert.deepEqual([g.de_donde, g.caja_movimiento_id, g.importe], ["otro", null, "8000.00"]);
    assert.equal(await esperado(app, e), antes);
    await rechaza(gastar(app, e.responsable, { fecha: "2099-01-01", tipo: await tipo(app, "Renta"), importe: "1" }), "RC004");
    for (const malo of ["0", "-5", "1.005", "100000000"]) {
      await rechaza(gastar(app, e.responsable, { fecha: "2026-09-15", tipo: await tipo(app, "Renta"), importe: malo }), "RC004");
    }
    await rechaza(gastar(app, e.responsable, { fecha: "2026-09-15", tipo: await tipo(app, "Renta"), importe: "5", concepto: "   " }), "RC005");
    await rechaza(gastar(app, e.responsable, { fecha: "2026-09-15", tipo: await tipo(app, "Renta"), importe: "5", de: "banco" }), "RC005");
  }));

test("un gasto del cajón sale hoy, se registra también como un «sacar», y baja lo que debería haber una sola vez", () =>
  conApp(async (app, db, e) => {
    const hoy = await fechaDeHoy(app, e);
    await rechaza(gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Gasolina"), importe: "300", de: "cajon" }), "RC006");
    await contarElCajon(db, e);
    const g = await gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Gasolina"), concepto: "Gasolina de la camioneta", importe: "300", de: "cajon" });
    const m = await una(app, "SELECT * FROM caja_movimiento WHERE id = $1", [g.caja_movimiento_id]);
    assert.deepEqual([m.tipo, m.importe, m.motivo, m.autorizado_por, m.registrado_por], ["sacar", "300.00", "Gasolina de la camioneta", e.responsable, e.responsable]);
    assert.equal(await esperado(app, e), 4700);
    // Del cajón solo hoy: con otra fecha no.
    await rechaza(gastar(app, e.responsable, { fecha: "2026-09-15", tipo: await tipo(app, "Gasolina"), importe: "10", de: "cajon" }), "RC005");
  }));

test("un «sacar» ya registrado se clasifica como gasto sin volver a bajar el cajón; con otro importe o dos veces, no", () =>
  conApp(async (app, db, e) => {
    await contarElCajon(db, e);
    const huella = await equipoDeAlta(db);
    const marco = await personaConClave(db, "Marco", "responsable", "481516");
    const m = await una(app, "SELECT * FROM mover_caja($1, $2, 'sacar', 250, 'Comida', $3, '481516', $4, $5)", [randomUUID(), e.jornada, marco, huella, e.mostrador]);
    assert.equal(await esperado(app, e), 4750);
    const hoy = await fechaDeHoy(app, e);
    await rechaza(gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Otro"), importe: "200", de: "cajon", movimiento: m.id }), "RC004");
    const g = await gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Otro"), concepto: "Comida de la cuadrilla", importe: "250", de: "cajon", movimiento: m.id });
    assert.equal(g.caja_movimiento_id, m.id);
    assert.equal(await esperado(app, e), 4750);
    await rechaza(gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Otro"), importe: "250", de: "cajon", movimiento: m.id }), "RC005");
    // Un «meter» no es gasto.
    const metido = await una(app, "SELECT * FROM mover_caja($1, $2, 'meter', 1000, 'El dueño', $3, '481516', $4, $5)", [randomUUID(), e.jornada, marco, huella, e.mostrador]);
    await rechaza(gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Otro"), importe: "1000", de: "cajon", movimiento: metido.id }), "RC005");
  }));

test("anular deja el registro y deja de sumar; uno del cajón solo mientras su día siga abierto, y no le devuelve dinero al cajón", () =>
  conApp(async (app, db, e) => {
    await contarElCajon(db, e);
    const hoy = await fechaDeHoy(app, e);
    const otro = await gastar(app, e.responsable, { fecha: "2026-09-20", tipo: await tipo(app, "Fletes"), importe: "1500" });
    const anulado = await una(app, "SELECT * FROM anular_gasto($1, 'Se capturó dos veces', $2)", [otro.id, e.responsable]);
    assert.ok(anulado.anulado_en);
    assert.equal(anulado.anulado_por, e.responsable);
    await rechaza(app.query("SELECT anular_gasto($1, 'Otra vez', $2)", [otro.id, e.responsable]), "RC005");
    await rechaza(app.query("SELECT anular_gasto($1, '', $2)", [otro.id, e.responsable]), "RC005");
    const delCajon = await gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Gasolina"), importe: "300", de: "cajon" });
    await una(app, "SELECT * FROM anular_gasto($1, 'No era del negocio', $2)", [delCajon.id, e.responsable]);
    assert.equal(await esperado(app, e), 4700, "anular no devuelve el dinero: el movimiento del cajón se queda");
    const tarde = await gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Gasolina"), importe: "100", de: "cajon" });
    await db.query("SELECT * FROM cerrar_el_dia(gen_random_uuid(), $1, 0, $2)", [e.jornada, e.responsable]);
    await rechaza(app.query("SELECT anular_gasto($1, 'Ya cerrado', $2)", [tarde.id, e.responsable]), "RC006");
  }));

test("si el gasto de lo que se sacó se anula (por ejemplo, el tipo estaba mal), ese «sacar» se vuelve a clasificar; dos vivos a la vez, no", () =>
  conApp(async (app, db, e) => {
    await contarElCajon(db, e);
    const hoy = await fechaDeHoy(app, e);
    const mal = await gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Renta"), concepto: "Diésel", importe: "400", de: "cajon" });
    const movimiento = mal.caja_movimiento_id;
    await rechaza(gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Gasolina"), importe: "400", de: "cajon", movimiento }), "RC005");
    await app.query("SELECT anular_gasto($1, 'El tipo estaba mal', $2)", [mal.id, e.responsable]);
    const bien = await gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Gasolina"), concepto: "Diésel", importe: "400", de: "cajon", movimiento });
    assert.equal(bien.caja_movimiento_id, movimiento);
    assert.equal(await esperado(app, e), 4600, "el dinero salió una sola vez");
    await rechaza(gastar(app, e.responsable, { fecha: hoy, tipo: await tipo(app, "Otro"), importe: "400", de: "cajon", movimiento }), "RC005");
  }));

test("los gastos de un periodo, por tipo y sin los anulados, con el total de los que cuentan", () =>
  conApp(async (app, _db, e) => {
    const luz = await tipo(app, "Luz y agua");
    await gastar(app, e.responsable, { fecha: "2026-09-10", tipo: await tipo(app, "Renta"), importe: "8000" });
    await gastar(app, e.responsable, { fecha: "2026-09-12", tipo: luz, importe: "900" });
    await gastar(app, e.responsable, { fecha: "2026-09-25", tipo: luz, importe: "100.50" });
    const fuera = await gastar(app, e.responsable, { fecha: "2026-08-31", tipo: luz, importe: "999" });
    const anulado = await gastar(app, e.responsable, { fecha: "2026-09-13", tipo: luz, importe: "70" });
    await app.query("SELECT anular_gasto($1, 'Repetido', $2)", [anulado.id, e.responsable]);
    await app.query("SELECT cambiar_tipo_de_gasto($1, false, true, $2)", [await tipo(app, "Renta"), e.responsable]);
    const filas = (await app.query("SELECT tipo, cuenta, total::text, cuantos FROM gastos_del_periodo('2026-09-01', '2026-09-30') ORDER BY tipo")).rows;
    assert.deepEqual(filas, [
      { tipo: "Luz y agua", cuenta: true, total: "1000.50", cuantos: 2 },
      { tipo: "Renta", cuenta: false, total: "8000.00", cuantos: 1 },
    ]);
    assert.ok(fuera.id);
  }));

test("los gastos son de un responsable: mostrador, patio y consulta no", () =>
  conApp(async (app, _db, e) => {
    for (const quien of [e.mostrador, e.patio, e.consulta]) {
      await rechaza(gastar(app, quien, { fecha: "2026-09-10", tipo: await tipo(app, "Renta"), importe: "1" }), "RC008");
      await rechaza(app.query("SELECT alta_tipo_de_gasto('X', $1)", [quien]), "RC008");
    }
  }));

test("repetir el envío no gasta dos veces; con otros datos o cancelado se rechaza", () =>
  conApp(async (app, db, e) => {
    const renta = await tipo(app, "Renta");
    const envio = randomUUID();
    const a = await gastar(app, e.responsable, { envio, fecha: "2026-09-10", tipo: renta, importe: "8000" });
    const b = await gastar(app, e.responsable, { envio, fecha: "2026-09-10", tipo: renta, importe: "8000.00" });
    assert.equal(b.id, a.id);
    await rechaza(gastar(app, e.responsable, { envio, fecha: "2026-09-10", tipo: renta, importe: "7000" }), "RC012");
    const cancelado = randomUUID();
    await app.query("SELECT cancelar_envio($1, $2)", [cancelado, e.responsable]);
    await rechaza(gastar(app, e.responsable, { envio: cancelado, fecha: "2026-09-10", tipo: renta, importe: "1" }), "RC012");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM gasto")).n, 1);
  }));
