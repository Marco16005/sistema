// La bitácora cuenta lo sucedido sin entregar los datos internos del registro.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import type pg from "pg";
import { conBase, escenario, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
import { cerrarJornada } from "../src/servidor/dominio/cierre.ts";
import { bitacora, CON_FRASE } from "../src/servidor/dominio/bitacora.ts";
import { ErrorDeForma } from "../src/servidor/numeros.ts";

const conBitacora = (prueba: (bd: Bd, db: pg.Client, e: Escenario) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 2 });
    try { await prueba(bd, db, await escenario(db)); } finally { await bd.cerrar(); }
  });

async function anotar(db: pg.Client, accion: string, entidad: string, detalle: object = {}, entidadId: string | null = null, persona: string | null = null, momento = "2026-10-02T03:04:00Z") {
  const r = await db.query(`INSERT INTO bitacora (accion, entidad, detalle, entidad_id, usuario_id, ocurrido_en)
                           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`, [accion, entidad, detalle, entidadId, persona, momento]);
  return r.rows[0].id as string;
}

// Quitar una frase del registro o añadir una acción SQL sin frase rompe esta guardia.
test("GUARDIA: toda pareja anotada en las migraciones tiene frase propia", async () => {
  const carpeta = new URL("../db/migraciones/", import.meta.url);
  const parejas = new Set<string>();
  for (const archivo of (await readdir(carpeta)).filter((f) => f.endsWith(".sql"))) {
    const sql = await readFile(new URL(archivo, carpeta), "utf8");
    for (const m of sql.matchAll(/\banotar\s*\(\s*[^,]+,\s*'([^']+)'\s*,\s*'([^']+)'/g)) parejas.add(`${m[1]} ${m[2]}`);
  }
  // Los dos INSERT de 0001: anotar reenvía los argumentos; auditar usa lower(TG_OP)
  // y TG_TABLE_NAME. Sus disparadores están en usuario (0001) y material (0002).
  for (const pareja of ["insert usuario", "update usuario", "delete usuario", "insert material", "update material", "delete material"]) parejas.add(pareja);
  assert.equal(parejas.size, 31);
  for (const pareja of parejas) assert.ok(CON_FRASE.has(pareja), `Falta frase: ${pareja}`);
});

// Cambiar el orden, el actor, la zona o cualquiera de las tres frases rompe el contrato completo.
test("compra, merma y cierre salen recientes primero, con persona y hora del patio", () =>
  conBitacora(async (bd, db, e) => {
    await db.query("UPDATE sucursal SET zona = 'Pacific/Honolulu' WHERE id = 1");
    let c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: null });
    c = await agregarMaterial(bd, e.mostrador, c.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["Cartón"]!, bascula: 2, kg: "30.2" });
    const compra = await confirmar(bd, e.responsable, c.id, c.revision);
    await db.query("SELECT registrar_merma($1, 10, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]);
    await cerrarJornada(bd, e.responsable, { id: randomUUID(), jornada: e.jornada, cierres: 0 });
    const r = await bitacora(bd, { cuantos: 3 });
    const registros = await db.query(`SELECT b.id::text, to_char(b.ocurrido_en AT TIME ZONE 'Pacific/Honolulu', 'YYYY-MM-DD') fecha,
      to_char(b.ocurrido_en AT TIME ZONE 'Pacific/Honolulu', 'HH24:MI') hora, u.nombre quien, b.accion, b.entidad
      FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT 3`);
    const frases = ["cerró el día", "dio de baja 10 kg de Cartón: Mojado", `confirmó la compra ${compra.folio} por $63.00`];
    assert.deepEqual(r, { asientos: registros.rows.map((f, i) => ({ ...f, que: frases[i] })), hayMas: true });
    assert.deepEqual(r.asientos.map((a) => a.quien), ["Servando", registros.rows[1].quien, "Servando"]);
    for (const a of r.asientos) assert.match(a.hora, /^\d{2}:\d{2}$/);
  }));

// <= en el cursor, ordenar como texto o calcular mal el excedente repite/salta asientos.
test("pagina sin repetir ni saltar; entrega 50 por omisión y limita a 200", () =>
  conBitacora(async (bd, db) => {
    await db.query("INSERT INTO bitacora (accion, entidad) SELECT 'futura', 'prueba' FROM generate_series(1, 205)");
    const todos = (await db.query("SELECT b.id::text FROM bitacora b ORDER BY b.id DESC")).rows.map((f) => f.id);
    assert.equal((await bitacora(bd)).asientos.length, 50);
    assert.equal((await bitacora(bd)).hayMas, true);
    assert.equal((await bitacora(bd, { cuantos: 999 })).asientos.length, 200);
    const vistos: string[] = [];
    let antes: string | null = null;
    for (;;) {
      const r = await bitacora(bd, { cuantos: 17, antes });
      vistos.push(...r.asientos.map((a) => a.id));
      assert.equal(r.hayMas, vistos.length < todos.length);
      if (!r.hayMas) break;
      antes = r.asientos.at(-1)!.id;
    }
    assert.deepEqual(vistos, todos);
    assert.deepEqual(await bitacora(bd, { antes: todos.at(-1)! }), { asientos: [], hayMas: false });
  }));

// Filtrar por fecha UTC en lugar de la zona del patio mezcla ambos días.
test("filtra persona y día local, incluso juntos, y no expone detalle desconocido", () =>
  conBitacora(async (bd, db, e) => {
    await db.query("UPDATE sucursal SET zona = 'Pacific/Honolulu' WHERE id = 1");
    const a = await anotar(db, "nueva", "cosa", { secreto: "NO MOSTRAR", nombre: "Tampoco", kg: 99 }, null, e.responsable);
    const b = await anotar(db, "nueva", "cosa", {}, null, e.mostrador);
    const c = await anotar(db, "nueva", "cosa", {}, null, e.responsable, "2026-10-02T10:00:00Z");
    const d = await anotar(db, "nueva", "cosa", {}, null, null, "2026-10-01T09:59:00Z");
    const r = await bitacora(bd, { dia: "2026-10-01" });
    assert.deepEqual(r.asientos.map((f) => f.id), [b, a]);
    assert.deepEqual((await bitacora(bd, { dia: "2026-10-01", persona: e.responsable })).asientos, [r.asientos[1]]);
    const propios = await bitacora(bd, { persona: e.responsable, cuantos: 200 });
    assert.ok(propios.asientos.some((f) => f.id === c));
    assert.ok(propios.asientos.every((f) => f.quien === "Servando"));
    assert.ok(!propios.asientos.some((f) => f.id === b || f.id === d));
    assert.deepEqual(r.asientos[1], { id: a, fecha: "2026-10-01", hora: "17:04", quien: "Servando", accion: "nueva", entidad: "cosa", que: "hizo un cambio (nueva · cosa)" });
    const sistema = (await bitacora(bd, { dia: "2026-09-30" })).asientos;
    assert.deepEqual(sistema.map((f) => [f.id, f.quien]), [[d, null]]);
    assert.ok(!JSON.stringify(r).includes("NO MOSTRAR"));
    assert.ok(!JSON.stringify(r).includes("detalle"));
  }));

test("rechaza cursores, personas, cantidades y fechas mal formados", () =>
  conBitacora(async (bd) => {
    for (const valor of ["x", "", "0", "-1", "1.5", "999999999999999999999", "1 OR 1=1"]) {
      await assert.rejects(bitacora(bd, { antes: valor }), ErrorDeForma);
      await assert.rejects(bitacora(bd, { persona: valor }), ErrorDeForma);
    }
    for (const dia of ["ayer", "", "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01"]) await assert.rejects(bitacora(bd, { dia }), ErrorDeForma);
    for (const cuantos of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(bitacora(bd, { cuantos }), ErrorDeForma);
    assert.deepEqual(await bitacora(bd, { dia: "2024-02-29" }), { asientos: [], hayMas: false });
  }));

// Una frase genérica para una pareja conocida o volcar cualquier campo adicional falla aquí.
test("las treinta parejas tienen frases completas y resuelven nombres sin revelar datos internos", () =>
  conBitacora(async (bd, db, e) => {
    const cliente = (await db.query("INSERT INTO cliente (nombre) VALUES ('Don Chuy') RETURNING id::text")).rows[0].id;
    const equipo = randomUUID();
    await db.query("INSERT INTO equipo (id, sucursal_id, nombre, huella) VALUES ($1, 1, 'Báscula', $2)", [equipo, randomUUID()]);
    const material = String(e.mat["Cartón"]);
    const casos: Array<[string, string, object, string | null, string]> = [
      ["abrir", "jornada", {}, null, "abrió el día"],
      ["cerrar", "jornada", {}, null, "cerró el día"],
      ["reabrir", "jornada", { cierre: 2 }, null, "reabrió el día (cierre 2)"],
      ["publicar", "lista_precios", {}, null, "publicó los precios"],
      ["confirmar", "operacion", { tipo: "venta", folio: 12, total: "1234.5" }, null, "confirmó la venta 12 por $1,234.50"],
      ["apertura", "material", { kg: "1000.000" }, material, "registró 1,000 kg de Cartón al arrancar"],
      ["cerrar_corte", "sucursal", {}, null, "cerró el inventario de arranque"],
      ["conteo", "material", { contado: "12.350", autoriza: e.responsable }, material, "contó 12.35 kg de Cartón"],
      ["ajuste", "material", { kg: "-2.125", motivo: "Corrección" }, material, "ajustó -2.125 kg de Cartón: Corrección"],
      ["corregir_material", "movimiento_inventario", { de: e.mat["Cartón"], a: e.mat["PET"], kg: "10", motivo: "Corrección" }, null, "cambió 10 kg de Cartón a PET: Corrección"],
      ["merma", "material", { kg: "10.000", motivo: "Mojado" }, material, "dio de baja 10 kg de Cartón: Mojado"],
      ["transformar", "transformacion", { origen: e.mat["Cartón"], kg: "10", merma: "1" }, null, "separó 10 kg de Cartón (merma: 1 kg)"],
      ["descartar", "operacion", { tipo: "compra" }, null, "descartó una compra sin confirmar"],
      ["bloquear", "credencial", {}, e.responsable, "bloqueó temporalmente el acceso de Servando"],
      ["alta", "equipo", { nombre: "Báscula" }, equipo, "dio de alta el equipo Báscula"],
      ["clave", "credencial", {}, e.responsable, "cambió la clave de Servando"],
      ["baja", "usuario", {}, e.responsable, "dio de baja a Servando"],
      ["baja", "equipo", {}, equipo, "dio de baja el equipo Báscula"],
      ["reimprimir", "operacion", { folio: 12, motivo: "Extraviado" }, null, "reimprimió el comprobante 12: Extraviado"],
      ["corregir", "movimiento_inventario", { material: e.mat["Cartón"], kg: "10", motivo: "Corrección" }, null, "corrigió un movimiento a 10 kg de Cartón: Corrección"],
      ["cancelar_envio", "envio", {}, null, "canceló un envío pendiente"],
      ["registrar_restauracion", "restauracion", {}, null, "restauró un respaldo"],
      ["precio_especial", "operacion", { clase: "dar", material: e.mat["Cartón"], cliente, queda: "2.6", autoriza: e.responsable }, null, "aplicó un precio especial de $2.60 por kilo de Cartón a Don Chuy (autorizó Servando)"],
      ["precio_especial", "operacion", { clase: "quitar", material: e.mat["Cartón"], cliente }, null, "quitó el precio especial de Cartón a Don Chuy"],
      ["mantenimiento", "publicacion", { paso: "cerrar" }, null, "cerró el acceso por mantenimiento"],
      ["mantenimiento", "publicacion", { paso: "decidir" }, null, "preparó la reapertura después del mantenimiento"],
      ["mantenimiento", "publicacion", { paso: "abrir" }, null, "abrió el acceso después del mantenimiento"],
      ["insert", "usuario", { despues: { nombre: "Luis", secreto: "NO MOSTRAR" } }, null, "dio de alta a Luis"],
      ["update", "usuario", { antes: { nombre: "Luis" }, despues: { nombre: "Luis" } }, null, "actualizó los datos de Luis"],
      ["delete", "usuario", { antes: { nombre: "Luis" } }, null, "eliminó a Luis"],
      ["insert", "material", { despues: { nombre: "Cartón" } }, null, "dio de alta el material Cartón"],
      ["update", "material", { despues: { nombre: "Cartón" } }, null, "actualizó el material Cartón"],
      ["delete", "material", { antes: { nombre: "Cartón" } }, null, "eliminó el material Cartón"],
      ["merma", "material", { kg: "1.001", motivo: "Mojado" }, "999999999", "dio de baja 1.001 kg: Mojado"],
      ["precio_especial", "operacion", { clase: "dar", material: "inexistente", cliente: "inexistente", autoriza: "inexistente", queda: "2.6" }, null, "aplicó un precio especial de $2.60 por kilo"],
    ];
    const esperados = [];
    for (const [accion, entidad, detalle, id, que] of casos) {
      esperados.push({ id: await anotar(db, accion, entidad, { ...detalle, secreto: "NO MOSTRAR" }, id), que });
    }
    const r = await bitacora(bd, { cuantos: casos.length });
    assert.deepEqual(r.asientos.map(({ id, que }) => ({ id, que })), esperados.reverse());
    assert.ok(!JSON.stringify(r).includes("NO MOSTRAR"));
    for (const a of r.asientos) assert.deepEqual(Object.keys(a).sort(), ["accion", "entidad", "fecha", "hora", "id", "que", "quien"]);
  }));

import { conMundo, ruta, TODOS } from "./mundo.ts";

// Ampliar roles, quitar la sesión o no pasar un filtro cambia status o contenido.
test("ruta: responsable y consulta leen, los otros roles reciben ROL y sin persona da 401", () =>
  conMundo(async (m) => {
    const e = await escenario(m.db);
    const bd = crearBd(await urlApp(m.base), { conexiones: 1 });
    try {
      const leer = await ruta("bitacora", "GET");
      for (const rol of TODOS) {
        const n = await m.adentro(rol);
        const r = await n.pedir(leer, "GET", "/api/bitacora");
        if (rol === "responsable" || rol === "consulta") {
          assert.equal(r.status, 200, rol);
          assert.deepEqual(await r.json(), await bitacora(bd));
        } else {
          assert.equal(r.status, 403, rol);
          assert.equal((await r.json()).error.codigo, "ROL");
        }
      }
      const equipo = await m.equipo();
      assert.equal((await equipo.pedir(leer, "GET", "/api/bitacora")).status, 401);
      await m.db.query("UPDATE sucursal SET zona = 'Pacific/Honolulu' WHERE id = 1");
      const a = await anotar(m.db, "cerrar", "jornada", {}, null, e.responsable);
      await anotar(m.db, "abrir", "jornada", {}, null, e.mostrador);
      const ultimo = await anotar(m.db, "reabrir", "jornada", { cierre: 2 }, null, e.responsable);
      const n = await m.adentro("consulta");
      const filtrado = await n.bien(leer, "GET", `/api/bitacora?antes=${ultimo}&persona=${e.responsable}&dia=2026-10-01`);
      assert.deepEqual(filtrado, { asientos: [{ id: a, fecha: "2026-10-01", hora: "17:04", quien: "Servando", accion: "cerrar", entidad: "jornada", que: "cerró el día" }], hayMas: false });
    } finally { await bd.cerrar(); }
  }));

test("ruta: antes, persona o día inválidos devuelven 400 FORMA", () =>
  conMundo(async (m) => {
    const n = await m.adentro("responsable");
    const leer = await ruta("bitacora", "GET");
    for (const consulta of ["antes=x", "persona=x", "dia=ayer", "antes=", "persona=", "dia=", "dia=2026-02-29"]) {
      const r = await n.pedir(leer, "GET", `/api/bitacora?${consulta}`);
      assert.equal(r.status, 400, consulta);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
  }));
