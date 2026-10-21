// El historial conserva el día en que se confirmó cada cuenta, aunque haya llegado antes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { GRANDE, abrirJornada, cerrarSinCorte, conBase, equipoDeAlta, escenario, personaConClave, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { resumenDelCierre } from "../src/servidor/dominio/cierre.ts";
import { abrirCuenta, agregarMaterial, confirmar, segundaPesada, terminarVehiculo } from "../src/servidor/dominio/cuentas.ts";
import { cuentasDelDia, diasDelHistorial } from "../src/servidor/dominio/historial.ts";
import { ErrorDeForma } from "../src/servidor/numeros.ts";

const conHistorial = (prueba: (bd: Bd, db: pg.Client, e: Escenario) => Promise<void>) =>
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

const envio = (material: number, kg: string, bascula = 2) => ({ linea: randomUUID(), captura: randomUUID(), material, bascula, kg });
const cerrar = (db: pg.Client, e: Escenario) => cerrarSinCorte(db, e.jornada, 0, e.responsable);

async function hecha(bd: Bd, e: Escenario, tipo: "compra" | "venta", materiales: Array<[string, string]>, etiqueta: string | null = null) {
  let c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo, etiqueta });
  for (const [nombre, kg] of materiales) c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat[nombre]!, kg));
  return confirmar(bd, e.responsable, c.id, c.revision);
}

test("los dos días salen del reciente al viejo y sus cuentas y totales coinciden con cada cierre", () =>
  conHistorial(async (bd, db, e) => {
    await hecha(bd, e, "compra", [["Cartón", "30.2"], ["PET", "4"]]);
    await hecha(bd, e, "venta", [["Cartón", "200.3"]]);
    await cerrar(db, e);
    const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
    await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
    await hecha(bd, e, "compra", [["Cartón", "10"]]);
    const r = await diasDelHistorial(bd);
    assert.deepEqual(r, { dias: [
      { jornada: hoy.id, fecha: "2026-10-02", abierta: true, cierres: 0, cuentas: 1, aPagar: "21", aCobrar: "0" },
      { jornada: e.jornada, fecha: "2026-10-01", abierta: false, cierres: 1, cuentas: 2, aPagar: "93", aCobrar: "501" },
    ], hayMas: false });
    for (const dia of r.dias) {
      const cierre = (await resumenDelCierre(bd, dia.jornada))!;
      assert.deepEqual([dia.cuentas, dia.aPagar, dia.aCobrar], [cierre.operaciones, cierre.aPagar, cierre.aCobrar]);
    }
    assert.deepEqual(await diasDelHistorial(bd, { cuantos: 1 }), { dias: [r.dias[0]], hayMas: true });
    assert.deepEqual(await diasDelHistorial(bd, { antes: "2026-10-02", cuantos: 1 }), { dias: [r.dias[1]], hayMas: false });
    assert.deepEqual(await diasDelHistorial(bd, { antes: "2026-10-01" }), { dias: [], hayMas: false });
  }));

test("un día sin cuentas tiene ceros y una cuenta sin confirmar no altera el historial ni el detalle", () =>
  conHistorial(async (bd, _db, e) => {
    const esperado = { dias: [{ jornada: e.jornada, fecha: "2026-10-01", abierta: true, cierres: 0, cuentas: 0, aPagar: "0", aCobrar: "0" }], hayMas: false };
    assert.deepEqual(await diasDelHistorial(bd), esperado);
    assert.deepEqual(await cuentasDelDia(bd, e.jornada), []);
    const c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: "Pendiente" });
    await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"]!, "10"));
    assert.deepEqual(await diasDelHistorial(bd), esperado);
    assert.deepEqual(await cuentasDelDia(bd, e.jornada), []);
  }));

test("el detalle ordena por folio numérico y trae hora del patio, tipo, total, renglones y quien confirmó", () =>
  conHistorial(async (bd, db, e) => {
    await db.query("UPDATE sucursal SET zona = 'Pacific/Honolulu' WHERE id = 1");
    // El salto de 9 a 10 distingue el orden numérico del alfabético.
    const hechas = [];
    for (let i = 0; i < 11; i++) hechas.push(await hecha(bd, e, "compra", [["Cartón", "30.2"], ["PET", "4"]], "Don Chuy"));
    hechas.push(await hecha(bd, e, "venta", [["Cartón", "200.3"]]));
    const cuentas = (await cuentasDelDia(bd, e.jornada))!;
    assert.deepEqual(cuentas.map((c) => c.id), hechas.map((c) => c.id));
    for (const [i, c] of cuentas.entries()) {
      const hora = (await una(db, "SELECT to_char(confirmada_en AT TIME ZONE 'Pacific/Honolulu', 'HH24:MI') AS hora FROM operacion WHERE id = $1", [c.id])).hora;
      assert.deepEqual(c, { id: hechas[i]!.id, folio: hechas[i]!.folio, tipo: i === 11 ? "venta" : "compra", hora, cliente: null, etiqueta: i === 11 ? null : "Don Chuy", materiales: i === 11 ? 1 : 2, total: i === 11 ? "501" : "93", atendio: "Servando" });
      assert.match(c.hora, /^\d{2}:\d{2}$/);
    }
    assert.equal(await cuentasDelDia(bd, "999999999999999999"), null);
    for (const id of ["ayer", "0", "-1", "1.5", "", "999999999999999999999", "1 OR 1=1"]) {
      await assert.rejects(cuentasDelDia(bd, id), ErrorDeForma);
    }
  }));

test("el vehículo terminado mañana aparece solo mañana aunque su jornada de llegada sea ayer", () =>
  conHistorial(async (bd, db, e) => {
    const c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: "Torton" });
    const vehiculo = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"]!, "5200", GRANDE));
    await cerrar(db, e);
    const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
    await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
    const pesado = await segundaPesada(bd, e.mostrador, c.id, vehiculo.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    const marco = await personaConClave(db, "Marco", "responsable", "481516", true);
    assert.ok(await terminarVehiculo(bd, await equipoDeAlta(db), { responsable: marco, clave: "481516" }, c.id, pesado.revision));
    assert.deepEqual(await cuentasDelDia(bd, e.jornada), []);
    const cuentas = (await cuentasDelDia(bd, hoy.id))!;
    assert.equal(cuentas.length, 1);
    assert.deepEqual([cuentas[0]!.id, cuentas[0]!.total, cuentas[0]!.atendio], [c.id, "12240", "Marco"]);
    const { dias } = await diasDelHistorial(bd);
    assert.deepEqual(dias.map((d) => [d.cuentas, d.aPagar, d.aCobrar]), [[1, "12240", "0"], [0, "0", "0"]]);
    for (const dia of dias) {
      const cierre = (await resumenDelCierre(bd, dia.jornada))!;
      assert.deepEqual([dia.cuentas, dia.aPagar, dia.aCobrar], [cierre.operaciones, cierre.aPagar, cierre.aCobrar]);
    }
  }));

test("el historial entrega 31 días por omisión y nunca más de 100", () =>
  conHistorial(async (bd, db, e) => {
    await db.query(`INSERT INTO jornada (sucursal_id, fecha, abierta_por, cerrada_en, cerrada_por, cierres)
                    SELECT 1, '2026-06-01'::date + n, $1, now(), $1, 1 FROM generate_series(0, 100) n`, [e.responsable]);
    const normal = await diasDelHistorial(bd);
    assert.equal(normal.dias.length, 31);
    assert.equal(normal.hayMas, true);
    const grande = await diasDelHistorial(bd, { cuantos: 200 });
    assert.equal(grande.dias.length, 100);
    assert.equal(grande.hayMas, true);
    const resto = await diasDelHistorial(bd, { antes: grande.dias.at(-1)!.fecha });
    assert.equal(resto.dias.length, 2);
    assert.equal(resto.hayMas, false);
    for (const cuantos of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(diasDelHistorial(bd, { cuantos }), ErrorDeForma);
  }));

import { conMundo, ruta, TODOS } from "./mundo.ts";

test("ambas rutas dejan leer a responsable y consulta, rechazan los otros roles y piden persona", () =>
  conMundo(async (m) => {
    const e = await escenario(m.db);
    const bd = crearBd(await urlApp(m.base), { conexiones: 1 });
    try {
      await hecha(bd, e, "compra", [["Cartón", "10"]]);
      await cerrar(m.db, e);
      await abrirJornada(m.db, e.responsable, "2026-10-02");
      const listado = await diasDelHistorial(bd);
      const detalle = { cierre: await resumenDelCierre(bd, e.jornada), cuentas: await cuentasDelDia(bd, e.jornada) };
      for (const rol of TODOS) {
        const n = await m.adentro(rol);
        for (const [camino, direccion, esperado] of [
          ["historial", "/api/historial", listado],
          ["historial/[jornada]", `/api/historial/${e.jornada}`, detalle],
        ] as const) {
          const respuesta = await n.pedir(await ruta(camino, "GET"), "GET", direccion, undefined, { parametros: { jornada: e.jornada } });
          if (rol === "responsable" || rol === "consulta") {
            assert.equal(respuesta.status, 200, `${rol}: ${camino}`);
            assert.deepEqual(await respuesta.json(), esperado);
          } else {
            assert.equal(respuesta.status, 403, `${rol}: ${camino}`);
            assert.equal((await respuesta.json()).error.codigo, "ROL");
          }
        }
      }
      const equipo = await m.equipo();
      for (const camino of ["historial", "historial/[jornada]"]) {
        const respuesta = await equipo.pedir(await ruta(camino, "GET"), "GET", "/api/historial", undefined, { parametros: { jornada: e.jornada } });
        assert.equal(respuesta.status, 401);
      }
      const n = await m.adentro("consulta");
      const filtrado = await n.bien(await ruta("historial", "GET"), "GET", "/api/historial?antes=2026-10-02");
      assert.deepEqual(filtrado, { dias: [listado.dias[1]], hayMas: false });
    } finally {
      await bd.cerrar();
    }
  }));

test("las rutas rechazan fechas e identificadores inválidos con FORMA y un día inexistente con NO_EXISTE", () =>
  conMundo(async (m) => {
    const n = await m.adentro("responsable");
    const listado = await ruta("historial", "GET");
    const detalle = await ruta("historial/[jornada]", "GET");
    for (const antes of ["ayer", "", "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01"]) {
      const r = await n.pedir(listado, "GET", `/api/historial?antes=${antes}`);
      assert.equal(r.status, 400, antes);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    assert.deepEqual(await n.bien(listado, "GET", "/api/historial?antes=2024-02-29"), { dias: [], hayMas: false });
    for (const jornada of ["ayer", "0", "-1", "1.2", "999999999999999999999"]) {
      const r = await n.pedir(detalle, "GET", `/api/historial/${jornada}`, undefined, { parametros: { jornada } });
      assert.equal(r.status, 400, jornada);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    const r = await n.pedir(detalle, "GET", "/api/historial/999999999999999999", undefined, { parametros: { jornada: "999999999999999999" } });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: { codigo: "NO_EXISTE", mensaje: "Ese día no está en el historial" } });
  }));
