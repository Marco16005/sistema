// Datos inventados de demostración: únicamente bases desechables.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { abrirJornada, conBase, personaConClave, rechaza, una, urlDe } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
import { recorrer } from "../consola/demo.ts";

const excluidas = ['sesion', 'equipo', 'codigo_alta', 'credencial', 'migracion', 'vida', 'restauracion', 'mantenimiento', 'mantenimiento_publicacion', 'respaldo_diario'];
const identificador = (s: string) => '"' + s.replaceAll('"', '""') + '"';
async function columnas(db: pg.Client) {
  return (await db.query(`SELECT c.table_name AS tabla, c.column_name AS columna
    FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp with time zone' AND NOT (c.table_name = ANY($1))
    ORDER BY 1, 2`, [excluidas])).rows;
}
async function marcas(db: pg.Client) {
  const salida: Record<string, string[]> = {};
  for (const { tabla, columna } of await columnas(db)) {
    const col = identificador(columna);
    salida[`${tabla}.${columna}`] = (await db.query(`SELECT (extract(epoch FROM ${col}) * 1000000)::bigint::text AS t
      FROM ${identificador(tabla)} WHERE ${col} IS NOT NULL ORDER BY ${col}`)).rows.map(f => f.t);
  }
  return salida;
}
const disparadores = async (db: pg.Client) => (await db.query(`SELECT tgrelid::regclass::text AS tabla, tgname, tgenabled
  FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace) ORDER BY 1, 2`)).rows;

// Si se omite una columna, se recorre también lo antiguo o se dejan apagados los disparadores, falla.
test("C.1 recorrer conserva intervalos, deja lo anterior y restaura los disparadores", () => conBase(async (db, base) => {
  const quien = await personaConClave(db, 'Marta', 'responsable', '412345', true);
  const anteriores = await marcas(db);
  const triggers = await disparadores(db);
  const desde: Date = (await una(db, 'SELECT clock_timestamp() AS t')).t;
  const j = await abrirJornada(db, quien);
  const mat = (await una(db, 'SELECT id FROM material WHERE activo ORDER BY id LIMIT 1')).id;
  await db.query('SELECT fijar_precio($1, $2, $3, $4)', [mat, '10', '12', quien]);
  await db.query('SELECT publicar_lista($1, $2)', [j.lista, quien]);
  const bd = crearBd(urlDe(base));
  try {
    let c = await abrirCuenta(bd, quien, { id: randomUUID(), tipo: 'compra', etiqueta: null });
    c = await agregarMaterial(bd, quien, c.id, { linea: randomUUID(), captura: randomUUID(), material: mat, bascula: 2, kg: '12.350' });
    await confirmar(bd, quien, c.id, c.revision);
    const antes = await marcas(db);
    const destino = new Date(desde.getTime() - 10 * 86400000);
    await recorrer(db, desde, destino);
    const despues = await marcas(db);
    const umbral = BigInt(desde.getTime()) * 1000n;
    const diferencia = BigInt(destino.getTime() - desde.getTime()) * 1000n;
    for (const [col, valores] of Object.entries(antes)) {
      assert.deepEqual(despues[col], valores.map(t => (BigInt(t) >= umbral ? BigInt(t) + diferencia : BigInt(t)).toString()).sort((a, b) => Number(BigInt(a) - BigInt(b))), col);
      for (const viejo of anteriores[col]!) assert.ok(despues[col]!.includes(viejo), col);
    }
    assert.deepEqual(await disparadores(db), triggers);
    assert.equal((await una(db, 'SHOW session_replication_role')).session_replication_role, 'origin');
    await rechaza(db.query('UPDATE bitacora SET ocurrido_en = ocurrido_en'), 'RC001');
  } finally { await bd.cerrar(); }
}));

import { sembrarDemo } from "../consola/demo.ts";
import { estadoDelDia } from "../src/servidor/dominio/dia.ts";
import { cerrarJornada, resumenDelCierre } from "../src/servidor/dominio/cierre.ts";
import { panel } from "../src/servidor/dominio/panel.ts";
import { diasDelHistorial } from "../src/servidor/dominio/historial.ts";

async function desarrollo<T>(accion: () => Promise<T>): Promise<T> {
  const antes = process.env.MODO;
  process.env.MODO = 'desarrollo';
  try { return await accion(); } finally {
    if (antes === undefined) delete process.env.MODO; else process.env.MODO = antes;
  }
}
const filas = (db: pg.Client) => una(db, `SELECT (SELECT count(*) FROM jornada) AS jornadas,
  (SELECT count(*) FROM operacion) AS cuentas, (SELECT count(*) FROM bitacora) AS bitacora,
  (SELECT count(*) FROM usuario) AS personas`);

// Abrir domingos históricos, olvidar publicar hoy o confirmar todas a una hora rompe esta prueba.
test('C.2–C.5 jornadas, horas, panel, precios e inventario verosímiles', () => desarrollo(() => conBase(async (db, base) => {
  const avances: string[] = [];
  const r = await sembrarDemo({ url: urlDe(base), dias: 10, semilla: 71, decir: s => avances.push(s) });
  const bd = crearBd(urlDe(base));
  try {
    const esperadas = (await db.query(`SELECT to_char(f, 'YYYY-MM-DD') AS fecha FROM
      generate_series(hoy_en(1::smallint) - 10, hoy_en(1::smallint) - 1, interval '1 day') f
      WHERE extract(dow FROM f) <> 0 ORDER BY f`)).rows.map(f => f.fecha);
    const hoy = await estadoDelDia(bd);
    assert.equal(hoy.arranqueTerminado, true);
    assert.equal(hoy.jornada!.esDeHoy, true);
    assert.equal(hoy.listo, true);
    assert.equal(hoy.lista!.precios, (await una(db, 'SELECT count(*)::int AS n FROM material WHERE activo')).n);
    const historia = (await diasDelHistorial(bd)).dias;
    assert.deepEqual(historia.filter(d => !d.abierta).map(d => d.fecha).reverse(), esperadas);
    assert.equal(historia.filter(d => d.abierta).length, 1);
    assert.equal(r.dias, esperadas.length);
    assert.equal(avances.length, esperadas.length + 1);
    assert.equal(r.cuentas, (await una(db, "SELECT count(*)::int AS n FROM operacion WHERE estado = 'confirmada'")).n);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion WHERE estado <> 'confirmada'")).n, 0);
    const domingo = (await una(db, 'SELECT extract(dow FROM hoy_en(1::smallint)) = 0 AS si')).si;
    if (domingo) assert.equal(historia[0]!.cuentas, 0);
    for (const { tabla, columna } of await columnas(db)) {
      assert.equal((await una(db, `SELECT count(*)::int AS n FROM ${identificador(tabla)} WHERE ${identificador(columna)} > clock_timestamp()`)).n, 0, `${tabla}.${columna}: futuro`);
    }
    assert.equal((await una(db, `SELECT count(*)::int AS n FROM operacion o JOIN jornada j ON j.id = o.confirmada_en_jornada
      JOIN sucursal s ON s.id = j.sucursal_id WHERE
      (o.confirmada_en AT TIME ZONE s.zona)::date <> j.fecha OR
      extract(hour FROM o.confirmada_en AT TIME ZONE s.zona) NOT BETWEEN 8 AND 18 OR
      o.creada_en > o.confirmada_en OR j.abierta_en >= o.creada_en OR
      (j.cerrada_en IS NOT NULL AND j.cerrada_en <= o.confirmada_en)`)).n, 0);
    const p = await panel(bd, { dias: 7 });
    assert.ok(p.serie.filter(d => d.cuentas > 0).length >= 4);
    assert.ok(p.horas.length > 3);
    assert.ok(p.horas.filter(h => h.hora >= 9 && h.hora < 13).reduce((s, h) => s + h.cuentas, 0) > p.totales.cuentas / 2);
    for (const d of p.serie) {
      const j = historia.find(j => j.fecha === d.desde);
      if (!j) { assert.equal(d.cuentas, 0); continue; }
      const c = (await resumenDelCierre(bd, j.jornada))!;
      assert.deepEqual([d.cuentas, d.pagado, d.cobrado], [c.operaciones, c.aPagar, c.aCobrar]);
    }
    assert.equal((await una(db, 'SELECT count(*)::int AS n FROM existencia WHERE kg < 0')).n, 0);
    assert.ok(p.totales.compras > 0 && p.totales.ventas > 0);
    assert.equal((await una(db, `SELECT count(*)::int AS n FROM (
      SELECT sum(cantidad_kg) OVER (PARTITION BY material_id ORDER BY efectivo_en, id) AS kg FROM movimiento_inventario
    ) x WHERE kg < 0`)).n, 0, 'tampoco hubo inventario negativo en el pasado');
    // Los precios se mueven de un día a otro, son redondos —nadie dice «a 88.4225 el kilo»— y se vende más caro de lo que se compra.
    assert.ok((await una(db, 'SELECT count(*)::int AS n FROM (SELECT material_id FROM precio GROUP BY 1 HAVING count(DISTINCT compra) > 1) x')).n > 0);
    assert.equal((await una(db, 'SELECT count(*)::int AS n FROM precio WHERE compra <> round(compra, 1) OR venta <> round(venta, 1)')).n, 0);
    assert.equal((await una(db, 'SELECT count(*)::int AS n FROM precio WHERE venta <= compra OR venta > compra * 1.4')).n, 0);
    // Y al arrancar no hay una fortuna de cobre en el patio: lo que hay vale del orden de lo que se mueve en unos días.
    assert.ok(Number((await una(db, "SELECT coalesce(sum(m.cantidad_kg * p.compra), 0)::text AS v FROM movimiento_inventario m JOIN precio p ON p.material_id = m.material_id AND p.lista_id = (SELECT min(id) FROM lista_precios) WHERE m.tipo = 'apertura'")).v) < 150000);
    for (const persona of r.personas) assert.match(persona.clave, /^\d{4,6}$/);
    assert.ok(r.personas.some(p => p.rol === 'responsable'));
    assert.ok(r.personas.filter(p => p.rol === 'mostrador').length >= 2);
    assert.ok(r.personas.some(p => p.rol === 'patio') && r.personas.some(p => p.rol === 'consulta'));
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM pg_trigger WHERE tgenabled = 'D'")).n, 0);
  } finally { await bd.cerrar(); }
})));

// Usar Math.random, UUID para escoger materiales o el reloj para importes rompe la repetibilidad.
test('C.6 misma semilla, misma historia; otra semilla cambia los importes', () => desarrollo(async () => {
  async function historia(semilla: number) {
    let salida: unknown;
    await conBase(async (_db, base) => {
      await sembrarDemo({ url: urlDe(base), dias: 9, semilla });
      const bd = crearBd(urlDe(base));
      try { salida = (await diasDelHistorial(bd)).dias.filter(d => !d.abierta).map(({ fecha, cuentas, aPagar, aCobrar }) => ({ fecha, cuentas, aPagar, aCobrar })); }
      finally { await bd.cerrar(); }
    });
    return salida;
  }
  const primera = await historia(17);
  assert.deepEqual(await historia(17), primera);
  assert.notDeepEqual(await historia(18), primera);
}));

// Si la validación ocurre después de dar altas, los conteos de filas cambian.
test('C.7 rechaza fuera de desarrollo, parámetros inválidos y segunda corrida sin escribir', () => conBase(async (db, base) => {
  const antes = await filas(db);
  const modo = process.env.MODO;
  process.env.MODO = 'produccion';
  try { await assert.rejects(sembrarDemo({ url: urlDe(base) }), /desarrollo/); }
  finally { if (modo === undefined) delete process.env.MODO; else process.env.MODO = modo; }
  assert.deepEqual(await filas(db), antes);
  await desarrollo(async () => {
    for (const dias of [1, 121, 2.5, NaN]) await assert.rejects(sembrarDemo({ url: urlDe(base), dias }), /días|dias/);
    assert.deepEqual(await filas(db), antes);
    await sembrarDemo({ url: urlDe(base), dias: 9 });
    const sembrada = await filas(db);
    await assert.rejects(sembrarDemo({ url: urlDe(base), dias: 9 }), /la demostración ya tiene movimiento/);
    assert.deepEqual(await filas(db), sembrada);
  });
}));

// Borrar/recrear la jornada o las personas, o volver a cargar saldos iniciales rompe este caso.
test('C.7 conserva el arranque, personas e id de la jornada del dueño', () => desarrollo(() => conBase(async (db, base) => {
  const responsable = await personaConClave(db, 'Marta', 'responsable', '412345', true);
  const mostrador = await personaConClave(db, 'Rosa', 'mostrador', '512345');
  const mat = (await una(db, "SELECT id FROM material WHERE nombre = 'Cartón'")).id;
  await db.query('SELECT terminar_arranque($1::jsonb, $2)', [JSON.stringify([{ material: mat, kg: '1234.500', origen: 'estimado' }]), responsable]);
  const fecha = (await una(db, "SELECT to_char(hoy_en(1::smallint) - 7, 'YYYY-MM-DD') AS f")).f;
  const j = await abrirJornada(db, responsable, fecha);
  const r = await sembrarDemo({ url: urlDe(base), dias: 10 });
  assert.deepEqual((await db.query('SELECT id, nombre FROM usuario WHERE id = ANY($1) ORDER BY id', [[responsable, mostrador]])).rows,
    [{ id: responsable, nombre: 'Marta' }, { id: mostrador, nombre: 'Rosa' }]);
  assert.equal(r.personas.length, 4);
  assert.ok(r.personas.every(p => p.nombre !== 'Marta' && p.nombre !== 'Rosa'));
  assert.equal((await una(db, 'SELECT id FROM jornada ORDER BY fecha LIMIT 1')).id, j.id);
  assert.deepEqual((await db.query("SELECT material_id, cantidad_kg::text FROM movimiento_inventario WHERE tipo = 'apertura'")).rows,
    [{ material_id: mat, cantidad_kg: '1234.500' }]);
  assert.equal((await una(db, "SELECT count(*)::int AS n FROM usuario WHERE activo AND rol = 'mostrador'")).n, 2);
})));

test('C.7 rechaza una jornada cerrada o varias jornadas sin movimiento', () => desarrollo(async () => {
  for (const varias of [false, true]) await conBase(async (db, base) => {
    const quien = await personaConClave(db, 'Marta', 'responsable', '412345', true);
    const j = await abrirJornada(db, quien, '2026-01-01');
    await db.query('SELECT fijar_precio(22, $1, $2, $3)', ['2.10', '2.50', quien]);
    await db.query('SELECT publicar_lista($1, $2)', [j.lista, quien]);
    const bd = crearBd(urlDe(base));
    try { await cerrarJornada(bd, quien, { id: randomUUID(), jornada: j.id, cierres: 0 }); }
    finally { await bd.cerrar(); }
    if (varias) await abrirJornada(db, quien, '2026-01-02');
    const antes = await filas(db);
    await assert.rejects(sembrarDemo({ url: urlDe(base), dias: 9 }), /jornada/);
    assert.deepEqual(await filas(db), antes);
  });
}));

// Omitir una vía del dominio, no recorrer sus fechas o no confirmar la compra especial rompe el panel.
test('C.8 mermas, conteos semanales y precios especiales aparecen en el panel', () => desarrollo(() => conBase(async (db, base) => {
  await sembrarDemo({ url: urlDe(base), dias: 10, semilla: 71 });
  const bd = crearBd(urlDe(base));
  try {
    const p = await panel(bd, { dias: 30 });
    assert.ok(p.control.mermas >= 1);
    assert.ok(p.control.ajustes >= 1);
    assert.ok(p.control.preciosEspeciales >= 1);
    assert.equal(p.control.mermas, (await una(db, "SELECT count(*)::int AS n FROM movimiento_inventario WHERE tipo = 'merma'")).n);
    assert.equal(p.control.ajustes, (await una(db, 'SELECT count(*)::int AS n FROM conteo')).n);
    assert.equal(p.control.preciosEspeciales, (await una(db, 'SELECT count(*)::int AS n FROM operacion_linea WHERE precio_autorizado_por IS NOT NULL')).n);
    assert.equal((await una(db, `SELECT count(*)::int AS n FROM (
      SELECT date_trunc('week', c.contado_en AT TIME ZONE s.zona), count(*)
      FROM conteo c, sucursal s GROUP BY 1 HAVING count(*) > 1) x`)).n, 0);
    assert.equal((await una(db, 'SELECT count(*)::int AS n FROM existencia WHERE kg < 0')).n, 0);
    assert.ok(Number(p.control.mermaKg) > 0 && Number(p.control.diferenciaEnCompras) > 0);
    assert.ok((await una(db, 'SELECT count(*)::int AS n FROM equipo')).n > 0);
    for (const { tabla, columna } of await columnas(db)) {
      assert.equal((await una(db, `SELECT count(*)::int AS n FROM ${identificador(tabla)} WHERE ${identificador(columna)} > clock_timestamp()`)).n, 0, `${tabla}.${columna}`);
    }
  } finally { await bd.cerrar(); }
})));
