// El cierre del día visto desde el servidor: qué falta por terminar, cuánto entró y salió, cuánto
// hay que pagar y cobrar. Y que cerrar no se lleve de paso lo que debe seguir abierto.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { GRANDE, abrirJornada, conBase, equipoDeAlta, escenario, personaConClave, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { cerrarJornada as cerrarEsa, resumenDelCierre } from "../src/servidor/dominio/cierre.ts";
import { abrirCuenta, agregarMaterial, confirmar, segundaPesada, terminarVehiculo } from "../src/servidor/dominio/cuentas.ts";
import { estadoDelDia } from "../src/servidor/dominio/dia.ts";
import { ErrorDeNegocio } from "../src/servidor/errores.ts";

const conCierre = (prueba: (bd: Bd, db: pg.Client, e: Escenario) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 3 });
    try {
      const e = await escenario(db);
      await db.query("SELECT registrar_apertura($1, 1000, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
      await prueba(bd, db, e);
    } finally {
      await bd.cerrar();
    }
  });

/** Cierra la jornada abierta diciendo lo que ve de ella, como la pantalla del cierre. */
async function cerrarJornada(bd: Bd, quien: string) {
  const dia = await estadoDelDia(bd);
  if (!dia.jornada) throw new ErrorDeNegocio("RC006", "No hay jornada abierta");
  return cerrarEsa(bd, quien, { id: randomUUID(), jornada: dia.jornada.id, cierres: dia.jornada.cierres });
}

const rechazaCon = (promesa: Promise<unknown>, codigo: string, mensaje?: RegExp) =>
  assert.rejects(promesa, (e: unknown) => {
    assert.ok(e instanceof ErrorDeNegocio, `se esperaba ${codigo} y llegó ${e}`);
    assert.equal(e.codigo, codigo, e.message);
    if (mensaje) assert.match(e.message, mensaje);
    return true;
  });

const envio = (material: number, kg: string, bascula = 2) => ({ linea: randomUUID(), captura: randomUUID(), material, bascula, kg });

/** Una cuenta con esos materiales, ya confirmada. */
async function hecha(bd: Bd, e: Escenario, tipo: "compra" | "venta", materiales: Array<[string, string]>): Promise<void> {
  let c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo, etiqueta: null });
  for (const [nombre, kg] of materiales) c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat[nombre]!, kg));
  await confirmar(bd, e.mostrador, c.id, c.revision);
}

/** Un vehículo que ya se pesó cargado y falta que vuelva vacío. */
async function vehiculoCargado(bd: Bd, e: Escenario, etiqueta: string) {
  const c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta });
  return agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"]!, "5200", GRANDE));
}

test("el resumen del día trae lo que entró y salió por material, y cuánto hay que pagar y cobrar", () =>
  conCierre(async (bd, _db, e) => {
    await hecha(bd, e, "compra", [["Cartón", "30.2"], ["PET", "4"]]);   // 63.42 + 30.00 = 93.42 → 93
    await hecha(bd, e, "compra", [["Cartón", "10"]]);                   // 21.00 → 21
    await hecha(bd, e, "venta", [["Cartón", "200.3"]]);                 // 500.75 → 501
    const r = await resumenDelCierre(bd);
    assert.ok(r);
    assert.deepEqual(
      { fecha: r.jornada.fecha, abierta: r.jornada.abierta, operaciones: r.operaciones, aPagar: r.aPagar, aCobrar: r.aCobrar, ajustes: r.ajustes },
      { fecha: "2026-10-01", abierta: true, operaciones: 3, aPagar: "114", aCobrar: "501", ajustes: "-0.17" },
    );
    assert.deepEqual(r.materiales, [
      { nombre: "Cartón", entro: "40.200", salio: "200.300" },
      { nombre: "PET", entro: "4.000", salio: "0.000" },
    ]);
    assert.deepEqual(r.porTerminar, []);
    assert.deepEqual(r.vehiculosPorVolver, []);
  }));

test("con cuentas por terminar no se cierra, y el resumen dice cuáles", () =>
  conCierre(async (bd, _db, e) => {
    let abierta = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: "Don Chuy" });
    abierta = await agregarMaterial(bd, e.mostrador, abierta.id, envio(e.mat["Cartón"]!, "10"));
    const vacia = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "venta", etiqueta: null });
    const vehiculo = await vehiculoCargado(bd, e, "Torton azul");

    const r = (await resumenDelCierre(bd))!;
    assert.deepEqual(r.porTerminar, [
      { id: abierta.id, tipo: "compra", etiqueta: "Don Chuy", materiales: 1 },
      { id: vacia.id, tipo: "venta", etiqueta: null, materiales: 0 },
    ]);
    assert.deepEqual(r.vehiculosPorVolver, [{ id: vehiculo.id, tipo: "compra", etiqueta: "Torton azul", materiales: 1 }]);
    await rechazaCon(cerrarJornada(bd, e.mostrador), "RC006", /2 cuentas abiertas/);
    assert.equal((await estadoDelDia(bd)).jornada?.id, e.jornada);
  }));

test("con solo vehículos por volver sí se cierra, y quedan pendientes para después", () =>
  conCierre(async (bd, db, e) => {
    await hecha(bd, e, "compra", [["Cartón", "10"]]);
    const vehiculo = await vehiculoCargado(bd, e, "Torton azul");
    const cerrada = await cerrarJornada(bd, e.mostrador);
    assert.equal(cerrada.jornada.abierta, false);
    assert.equal(cerrada.jornada.fecha, "2026-10-01");
    assert.deepEqual(cerrada.vehiculosPorVolver, [{ id: vehiculo.id, tipo: "compra", etiqueta: "Torton azul", materiales: 1 }]);
    assert.equal((await una(db, "SELECT cerrada_por FROM jornada WHERE id = $1", [e.jornada])).cerrada_por, e.mostrador);
    const dia = await estadoDelDia(bd);
    assert.equal(dia.jornada, null);
    assert.equal(dia.vehiculosPorVolver, 1);
  }));

test("una cuenta con un vehículo y además otro material ya pesado también deja cerrar", () =>
  conCierre(async (bd, _db, e) => {
    const vehiculo = await vehiculoCargado(bd, e, "Torton azul");
    await agregarMaterial(bd, e.mostrador, vehiculo.id, envio(e.mat["Cartón"]!, "10"));
    const r = (await resumenDelCierre(bd))!;
    assert.deepEqual(r.porTerminar, []);
    assert.equal(r.vehiculosPorVolver.length, 1);
    await cerrarJornada(bd, e.mostrador);
  }));

test("cerrado el día, el resumen sigue mostrando ese día, ya cerrado", () =>
  conCierre(async (bd, _db, e) => {
    await hecha(bd, e, "compra", [["Cartón", "10"]]);
    await cerrarJornada(bd, e.responsable);
    const r = (await resumenDelCierre(bd))!;
    assert.deepEqual({ fecha: r.jornada.fecha, abierta: r.jornada.abierta, aPagar: r.aPagar }, { fecha: "2026-10-01", abierta: false, aPagar: "21" });
    // Una orden nueva de cerrarla otra vez la rechaza el servidor: lo que esa orden vio ya cambió.
    await rechazaCon(cerrarEsa(bd, e.responsable, { id: randomUUID(), jornada: r.jornada.id, cierres: 0 }), "RC011");
    await rechazaCon(cerrarEsa(bd, e.responsable, { id: randomUUID(), jornada: r.jornada.id, cierres: 1 }), "RC011");
  }));

test("sin ninguna jornada no hay resumen", () =>
  conBase(async (_db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 1 });
    try {
      assert.equal(await resumenDelCierre(bd), null);
    } finally {
      await bd.cerrar();
    }
  }));

test("cierra quien cobra: ni patio ni quien solo consulta", () =>
  conCierre(async (bd, _db, e) => {
    for (const quien of [e.patio, e.consulta]) {
      await rechazaCon(cerrarJornada(bd, quien), "RC008");
    }
    assert.equal((await estadoDelDia(bd)).jornada?.id, e.jornada);
  }));

test("el vehículo que se termina al día siguiente no cambia el cierre de ayer y aparece en el de hoy", () =>
  conCierre(async (bd, db, e) => {
    await hecha(bd, e, "compra", [["Cartón", "10"]]);
    const vehiculo = await vehiculoCargado(bd, e, "Torton azul");
    const ayer = await cerrarJornada(bd, e.mostrador);

    const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
    await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
    const pesado = await segundaPesada(bd, e.mostrador, vehiculo.id, vehiculo.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    const huella = await equipoDeAlta(db);
    const marco = await personaConClave(db, "Marco", "responsable", "481516", true);
    assert.ok(await terminarVehiculo(bd, huella, { responsable: marco, clave: "481516" }, pesado.id, pesado.revision));

    const deHoy = (await resumenDelCierre(bd))!;
    assert.deepEqual(
      { fecha: deHoy.jornada.fecha, operaciones: deHoy.operaciones, aPagar: deHoy.aPagar, materiales: deHoy.materiales, vehiculos: deHoy.vehiculosPorVolver },
      { fecha: "2026-10-02", operaciones: 1, aPagar: "12240", materiales: [{ nombre: "Fierro pesado", entro: "1800.000", salio: "0.000" }], vehiculos: [] },
    );
    await cerrarJornada(bd, e.mostrador);

    const deAyer = (await resumenDelCierre(bd, e.jornada))!;
    assert.deepEqual(
      { operaciones: deAyer.operaciones, aPagar: deAyer.aPagar, ajustes: deAyer.ajustes, materiales: deAyer.materiales },
      { operaciones: ayer.operaciones, aPagar: ayer.aPagar, ajustes: ayer.ajustes, materiales: ayer.materiales },
    );
    assert.equal(deAyer.aPagar, "21");
    // El vehículo ya no está pendiente en ningún lado.
    assert.deepEqual(deAyer.vehiculosPorVolver, []);
  }));
