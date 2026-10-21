// Reabrir el día. Un cierre por error a media tarde dejaba al negocio sin atender hasta mañana.
// Ahora la jornada de HOY se puede reabrir, con la clave de quien autoriza, y queda registro.
//
// Se reabre un cierre en particular y se cierra una apertura en particular: la jornada lleva la
// cuenta de sus cierres, y tanto cerrar como reabrir dicen cuál vieron. Así una petición vieja —de
// otra pestaña, o un reintento con la respuesta perdida— no deshace lo que alguien hizo después.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import {
  CERRAR_EL_DIA, CHICA_2, GRANDE, PRECIOS, abrirCuenta, agregarMaterial, comoApp, compraDe, conApp, conBase, conBaseVacia, conectar, confirmar,
  contar, desenlace, equipoDeAlta, esperarQueEspere, material, personaConClave, pidDe, rechaza, una, usuario,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { migrar } from "../db/migrar.ts";

const CLAVE = "481516";

interface Dia {
  app: pg.Client;
  db: pg.Client;
  base: string;
  e: Escenario;
  /** Quien autoriza, con su clave. */
  duena: string;
  huella: string;
  hoy: string;
}

// El patio de estas pruebas vive en una zona que tiene otra exactamente veinticuatro horas adelante:
// cambiar de una a la otra es pasar la medianoche, a cualquier hora que se corra la batería.
const ZONA = "Etc/GMT+12";
const ZONA_DE_MANANA = "Etc/GMT-12";

/** Un día de HOY ya en marcha: jornada abierta con precios publicados, y alguien que autoriza con su clave. */
/** Quien firma los cortes de estas pruebas: la dueña, con su clave, desde el equipo dado de alta. */
let firma: { duena: string; huella: string };

const conHoy = (prueba: (d: Dia) => Promise<void>) =>
  conBase(async (db, base) => {
    await db.query("UPDATE sucursal SET zona = $1", [ZONA]);
    const duena = await personaConClave(db, "Zayra", "responsable", CLAVE, true);
    const mostrador = await usuario(db, "Luis", "mostrador");
    const patio = await usuario(db, "Beto", "patio");
    const consulta = await usuario(db, "Ana", "consulta");
    const huella = await equipoDeAlta(db);
    const hoy = (await una(db, "SELECT to_char(hoy_en(1::smallint), 'YYYY-MM-DD') AS d")).d as string;
    const j = await una(db, "SELECT * FROM abrir_jornada(1::smallint, $1::date, $2)", [hoy, duena]);
    const lista = (await una(db, "SELECT id FROM lista_precios WHERE jornada_id = $1", [j.id])).id as string;
    const mat: Record<string, number> = {};
    for (const [nombre, [compra, venta]] of Object.entries(PRECIOS)) {
      mat[nombre] = await material(db, nombre);
      await db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, $3, $4)", [lista, mat[nombre], compra, venta]);
    }
    await db.query("SELECT publicar_lista($1, $2)", [lista, duena]);
    const app = await comoApp(base);
    firma = { duena, huella };
    try {
      await prueba({ app, db, base, duena, huella, hoy, e: { responsable: duena, mostrador, patio, consulta, jornada: j.id, lista, mat } });
    } finally {
      await app.end();
    }
  });

const verJornada = (c: pg.Client, id: string) =>
  una(c, "SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, cerrada_en, cerrada_por, cierres FROM jornada WHERE id = $1", [id]);

/**
 * Cierra como la pantalla, con su corte (0038): el cajón se cuenta al abrir si no se había contado,
 * se cuenta lo que debería haber y firma la dueña con su clave. Repetirlo con el mismo envío y sin
 * que nada cambie entre tanto manda lo mismo.
 */
async function cerrar(c: pg.Client, jornada: string, cierres: number, quien: string, envio: string = randomUUID()) {
  if ((await c.query("SELECT 1 FROM caja_apertura WHERE jornada_id = $1", [jornada])).rows.length === 0) {
    await c.query("SELECT abrir_el_cajon(gen_random_uuid(), $1, 100000, $2)", [jornada, quien]);
  }
  const { esperado } = await una(c, "SELECT esperado_en_cajon($1)::text AS esperado", [jornada]);
  return una(c, "SELECT * FROM cerrar_el_dia($1, $2, $3, $4, $4, $5, $6, $7, $8)", [envio, jornada, cierres, esperado, firma.duena, CLAVE, firma.huella, quien]);
}

interface Pedido { envio?: string; cierre: number; quien?: string; autoriza?: string; clave?: string; huella?: string; jornada?: string }
const reabrir = (c: pg.Client, d: Dia, p: Pedido) =>
  una(c, "SELECT * FROM reabrir_jornada($1, $2, $3, $4, $5, $6, $7)", [
    p.envio ?? randomUUID(), p.jornada ?? d.e.jornada, p.cierre, p.autoriza ?? d.duena, p.clave ?? CLAVE, p.huella ?? d.huella, p.quien ?? d.e.mostrador,
  ]);

// ── cerrar y reabrir ───────────────────────────────────────────────────────

test("cerrar dice cuál jornada y cuántos cierres llevaba, y la cuenta de cierres sube de uno en uno", () =>
  conHoy(async ({ app, e, duena }) => {
    assert.equal((await verJornada(app, e.jornada)).cierres, 0);
    const hecho = await cerrar(app, e.jornada, 0, e.mostrador);
    assert.deepEqual({ jornada: hecho.jornada_id, cierre: hecho.cierre }, { jornada: e.jornada, cierre: 1 });
    const j = await verJornada(app, e.jornada);
    assert.ok(j.cerrada_en);
    assert.equal(j.cerrada_por, duena);           // quien firmó el corte (0038)
    assert.equal(j.cierres, 1);
  }));

test("la jornada de hoy se reabre con la clave de quien autoriza: queda abierta, la misma, y queda registro", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    const cerrada = await verJornada(db, e.jornada);

    const r = await reabrir(app, d, { cierre: 1 });
    assert.ok(r.id, "no reabrió");
    const j = await verJornada(db, e.jornada);
    assert.equal(j.cerrada_en, null);
    assert.equal(j.cerrada_por, null);
    assert.equal(j.cierres, 1, "reabrir no mueve la cuenta de cierres");
    assert.equal(j.fecha, d.hoy);

    // El registro: qué jornada y qué cierre, cuándo se había cerrado y quién, quién lo pidió y quién lo autorizó.
    const reg = await una(db, "SELECT * FROM reapertura WHERE id = $1", [r.id]);
    assert.deepEqual(
      { jornada: reg.jornada_id, cierre: reg.cierre, cerradaPor: reg.cerrada_por, pidio: reg.pedida_por, autorizo: reg.autorizada_por },
      { jornada: e.jornada, cierre: 1, cerradaPor: d.duena, pidio: e.mostrador, autorizo: d.duena },
    );
    assert.equal(reg.cerrada_en.getTime(), cerrada.cerrada_en.getTime());
    assert.ok(reg.reabierta_en.getTime() >= cerrada.cerrada_en.getTime());
    const nota = await una(db, "SELECT usuario_id, detalle FROM bitacora WHERE accion = 'reabrir' AND entidad = 'jornada' AND entidad_id = $1", [e.jornada]);
    assert.equal(nota.usuario_id, e.mostrador);
    assert.equal(nota.detalle.cierre, 1);
    assert.equal(String(nota.detalle.autoriza), d.duena);

    // Se puede reabrir más de una vez el mismo día; cada vez con su registro.
    assert.equal((await cerrar(app, e.jornada, 1, e.mostrador)).cierre, 2);
    assert.ok((await reabrir(app, d, { cierre: 2 })).id);
    assert.equal(await contar(db, "reapertura", "jornada_id = $1", [e.jornada]), 2);
  }));

test("no se reabre un día que no es hoy, ni lo que no está cerrado, ni una jornada que no existe", async () => {
  // El escenario de siempre abre una jornada de otro día.
  await conApp(async (app, db, e) => {
    const duena = await personaConClave(db, "Zayra", "responsable", CLAVE, true);
    const huella = await equipoDeAlta(db);
    firma = { duena, huella };
    await cerrar(app, e.jornada, 0, e.mostrador);
    await rechaza(app.query("SELECT * FROM reabrir_jornada($1, $2, 1, $3, $4, $5, $6)", [randomUUID(), e.jornada, duena, CLAVE, huella, e.mostrador]), "RC006");
    assert.ok((await verJornada(db, e.jornada)).cerrada_en);
    assert.equal(await contar(db, "reapertura"), 0);
  });
  await conHoy(async (d) => {
    // Abierta: no hay cierre que reabrir.
    await rechaza(reabrir(d.app, d, { cierre: 1 }), "RC011");
    await rechaza(reabrir(d.app, d, { cierre: 0 }), "RC005");
    await rechaza(reabrir(d.app, d, { cierre: 1, jornada: "999999" }), "RC006");
    assert.equal(await contar(d.db, "reapertura"), 0);
  });
});

test("quien autoriza debe poder autorizar y estar activo; la clave mal no reabre, queda contada y deja el envío sin gastar", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    const sinFacultad = await personaConClave(db, "Rosa", "responsable", "271828");
    await rechaza(reabrir(app, d, { cierre: 1, autoriza: sinFacultad, clave: "271828" }), "RC008");
    await rechaza(reabrir(app, d, { cierre: 1, autoriza: e.mostrador }), "RC008");

    const envio = randomUUID();
    const mal = await reabrir(app, d, { envio, cierre: 1, clave: "000000" });
    assert.equal(mal.id, null, "una clave equivocada reabrió el día");
    assert.ok((await verJornada(db, e.jornada)).cerrada_en);
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [d.duena])).fallos, 1, "el intento fallido no quedó contado");
    assert.equal(await contar(db, "envio", "id = $1", [envio]), 0);
    // El mismo envío, ya con la clave buena, pasa.
    assert.ok((await reabrir(app, d, { envio, cierre: 1 })).id);

    // El bloqueo por intentos es de verdad: después de fallar de más, ni la buena pasa.
    await cerrar(app, e.jornada, 1, e.mostrador);
    for (let k = 0; k < 6; k++) assert.equal((await reabrir(app, d, { cierre: 2, clave: "000000" })).id, null);
    assert.ok((await una(db, "SELECT bloqueada_hasta FROM credencial WHERE usuario_id = $1", [d.duena])).bloqueada_hasta);
    assert.equal((await reabrir(app, d, { cierre: 2 })).id, null);
    assert.ok((await verJornada(db, e.jornada)).cerrada_en);

    // Dada de baja, ya no autoriza.
    await db.query("UPDATE credencial SET fallos = 0, bloqueos = 0, bloqueada_hasta = NULL WHERE usuario_id = $1", [d.duena]);
    await db.query("SELECT baja_persona($1)", [d.duena]);
    await rechaza(reabrir(app, d, { cierre: 2 }), "RC008");
  }));

test("lo piden mostrador y responsable; patio, consulta y administración no. La aplicación no quita el cierre por su cuenta ni toca el registro", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    const administra = await usuario(db, "Marco", "administracion");
    for (const quien of [e.patio, e.consulta, administra]) {
      await rechaza(reabrir(app, d, { cierre: 1, quien }), "RC008");
      await rechaza(app.query("SELECT * FROM cerrar_el_dia($1, $2, 1, 0, 0, $3, $4, $5, $6)", [randomUUID(), e.jornada, d.duena, CLAVE, d.huella, quien]), "RC008");
    }
    await rechaza(app.query("UPDATE jornada SET cerrada_en = NULL, cerrada_por = NULL WHERE id = $1", [e.jornada]), "42501");
    await rechaza(app.query("INSERT INTO reapertura (jornada_id, cierre, cerrada_en, cerrada_por, pedida_por, autorizada_por) VALUES ($1, 1, now(), $2, $2, $3)", [e.jornada, e.mostrador, d.duena]), "42501");
    assert.ok((await reabrir(app, d, { cierre: 1, quien: d.duena })).id);          // la responsable también lo pide
    await rechaza(app.query("UPDATE reapertura SET cierre = 9"), "42501");
    for (const sql of ["UPDATE reapertura SET cierre = 9", "DELETE FROM reapertura", "TRUNCATE reapertura CASCADE"]) await rechaza(db.query(sql), "RC001");
  }));

// ── el guardián ────────────────────────────────────────────────────────────

test("una jornada cerrada sigue sin poder modificarse por ningún otro camino, tampoco para el dueño de la base", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    const quitar = "UPDATE jornada SET cerrada_en = NULL, cerrada_por = NULL WHERE id = $1";
    for (const sql of [
      "UPDATE jornada SET fecha = fecha + 1 WHERE id = $1",
      "UPDATE jornada SET cerrada_por = abierta_por WHERE id = $1",
      "UPDATE jornada SET cierres = 0 WHERE id = $1",
      "DELETE FROM jornada WHERE id = $1",
      quitar,                                                     // sin registro
    ]) await rechaza(db.query(sql, [e.jornada]), "RC001");

    // Un registro escrito suelto, sin reabrir, no se queda.
    const suelto = `INSERT INTO reapertura (jornada_id, cierre, cerrada_en, cerrada_por, pedida_por, autorizada_por)
                    SELECT id, cierres, cerrada_en, cerrada_por, $2, $3 FROM jornada WHERE id = $1`;
    await rechaza(db.query(suelto, [e.jornada, e.mostrador, d.duena]), "RC001");
    assert.equal(await contar(db, "reapertura"), 0);

    // Con el registro bueno, pero cambiando otra cosa a la vez: no.
    await db.query("BEGIN");
    await db.query(suelto, [e.jornada, e.mostrador, d.duena]);
    await rechaza(db.query("UPDATE jornada SET cerrada_en = NULL, cerrada_por = NULL, fecha = fecha + 1 WHERE id = $1", [e.jornada]), "RC001");
    await db.query("ROLLBACK");

    // Un registro que no es de este cierre tampoco sirve: ni de otro número, ni con otra hora.
    for (const [cierre, cuando] of [["cierres + 1", "cerrada_en"], ["cierres", "cerrada_en - interval '1 second'"]] as const) {
      await rechaza(db.query(
        `INSERT INTO reapertura (jornada_id, cierre, cerrada_en, cerrada_por, pedida_por, autorizada_por)
         SELECT id, ${cierre}, ${cuando}, cerrada_por, $2, $3 FROM jornada WHERE id = $1`, [e.jornada, e.mostrador, d.duena]), "RC001");
    }

    // Reabierta de verdad, el registro de ese cierre ya se gastó: cerrar otra vez y quitar el cierre
    // en la misma transacción no pasa, porque el cierre de ahora es otro.
    await db.query("BEGIN");
    assert.ok((await reabrir(db, d, { cierre: 1 })).id);
    await db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $2, cierres = cierres + 1 WHERE id = $1", [e.jornada, e.mostrador]);
    await rechaza(db.query(quitar, [e.jornada]), "RC001");
    await db.query("ROLLBACK");
    assert.equal((await verJornada(db, e.jornada)).cierres, 1);
  }));

test("la cuenta de cierres no se mueve a mano ni retrocede: solo sube, de uno en uno, al cerrar", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    // Abierta, sin cierres.
    await rechaza(db.query("UPDATE jornada SET cierres = 5 WHERE id = $1", [e.jornada]), "RC001");
    await rechaza(db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $2 WHERE id = $1", [e.jornada, e.mostrador]), "RC001");                    // cerrar sin contar
    await rechaza(db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $2, cierres = cierres + 2 WHERE id = $1", [e.jornada, e.mostrador]), "RC001");
    await cerrar(app, e.jornada, 0, e.mostrador);
    await reabrir(app, d, { cierre: 1 });
    // Reabierta: lleva un cierre, y no se le quita.
    await rechaza(db.query("UPDATE jornada SET cierres = 0 WHERE id = $1", [e.jornada]), "RC001");
    await rechaza(db.query("DELETE FROM jornada WHERE id = $1", [e.jornada]), "RC001");
    assert.equal((await verJornada(db, e.jornada)).cierres, 1);
  }));

test("al llegar la migración, las jornadas que ya estaban cerradas quedan con un cierre y la abierta con ninguno", async () => {
  const todas = join(fileURLToPath(new URL("..", import.meta.url)), "db/migraciones");
  const antes = await mkdtemp(join(tmpdir(), "antes-de-reabrir-"));
  for (const archivo of (await readdir(todas)).filter((a) => a < "0024")) await copyFile(join(todas, archivo), join(antes, archivo));
  try {
    await conBaseVacia(async (base) => {
      const db = await conectar(base);
      try {
        await migrar(db, antes);
        const quien = await usuario(db, "Servando", "responsable", true);
        const ayer = await una(db, "SELECT * FROM abrir_jornada(1::smallint, '2026-09-30', $1)", [quien]);
        await db.query("SELECT cerrar_jornada($1, $2)", [ayer.id, quien]);
        const hoy = await una(db, "SELECT * FROM abrir_jornada(1::smallint, '2026-10-01', $1)", [quien]);
        await migrar(db);
        assert.equal((await verJornada(db, ayer.id)).cierres, 1);
        assert.equal((await verJornada(db, hoy.id)).cierres, 0);
        assert.ok((await verJornada(db, ayer.id)).cerrada_en, "la migración no debe reabrir nada");
      } finally {
        await db.end();
      }
    });
  } finally {
    await rm(antes, { recursive: true, force: true });
  }
});

// ── las peticiones que llegan tarde ────────────────────────────────────────

test("una petición nueva de reabrir un cierre que ya no es el vigente se rechaza; repetir el mismo envío devuelve lo que hizo y no reabre otra vez", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);                                   // cierre 1
    const envio = randomUUID();
    const primera = await reabrir(app, d, { envio, cierre: 1 });
    await cerrar(app, e.jornada, 1, e.mostrador);                                   // cierre 2: alguien atendió y volvió a cerrar

    // Otra pestaña, que seguía viendo el cierre 1.
    await rechaza(reabrir(app, d, { cierre: 1 }), "RC011");
    // El reintento del que ya había reabierto: su resultado de entonces, sin tocar el cierre 2.
    const repetida = await reabrir(app, d, { envio, cierre: 1 });
    assert.equal(repetida.id, primera.id);
    // Repetirlo no pide la clave otra vez.
    assert.equal((await reabrir(app, d, { envio, cierre: 1, clave: "000000" })).id, primera.id);
    const j = await verJornada(db, e.jornada);
    assert.ok(j.cerrada_en, "una petición vieja reabrió un cierre que nadie pidió reabrir");
    assert.equal(j.cierres, 2);
    assert.equal(await contar(db, "reapertura"), 1);
  }));

test("una orden vieja de cerrar no cierra un día recién reabierto, ni la jornada del día siguiente", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const envio = randomUUID();
    assert.equal((await cerrar(app, e.jornada, 0, e.mostrador, envio)).cierre, 1);  // se asienta, y se pierde la respuesta
    await reabrir(app, d, { cierre: 1 });                                           // otra persona reabre

    // El reintento, con el mismo envío: «cerrado, cierre 1», que es lo que hizo. No cierra otra vez.
    const repetido = await cerrar(app, e.jornada, 0, e.mostrador, envio);
    assert.deepEqual({ jornada: repetido.jornada_id, cierre: repetido.cierre }, { jornada: e.jornada, cierre: 1 });
    assert.equal((await verJornada(db, e.jornada)).cerrada_en, null, "el reintento del cierre volvió a cerrar un día reabierto");
    // Una petición nueva, de una pestaña que vio el día con cero cierres.
    await rechaza(cerrar(app, e.jornada, 0, e.mostrador), "RC011");
    assert.equal((await verJornada(db, e.jornada)).cerrada_en, null);
    // Quien lo ve como está, sí lo cierra.
    assert.equal((await cerrar(app, e.jornada, 1, e.mostrador)).cierre, 2);

    // Una orden de cerrar aquella jornada, retenida hasta que ya hay otra abierta: no cierra la nueva.
    await db.query("UPDATE sucursal SET zona = $1", [ZONA_DE_MANANA]);              // el patio amanece en otro día
    const otra = await una(app, "SELECT * FROM abrir_jornada_de_hoy($1)", [e.mostrador]);
    assert.notEqual(otra.id, e.jornada);
    await rechaza(cerrar(app, e.jornada, 1, e.mostrador), "RC011");
    await rechaza(cerrar(app, e.jornada, 0, e.mostrador), "RC011");
    assert.equal((await verJornada(db, otra.id)).cerrada_en, null);
  }));

test("el envío de cerrar y el de reabrir: con otro contenido, o cancelado, ya no sirve", () =>
  conHoy(async (d) => {
    const { app, e } = d;
    const cancelado = randomUUID();
    await app.query("SELECT cancelar_envio($1, $2)", [cancelado, e.mostrador]);
    await rechaza(cerrar(app, e.jornada, 0, e.mostrador, cancelado), "RC012");
    const c1 = randomUUID();
    await cerrar(app, e.jornada, 0, e.mostrador, c1);
    await rechaza(cerrar(app, e.jornada, 1, e.mostrador, c1), "RC012");             // el mismo envío, diciendo otra cosa

    await rechaza(reabrir(app, d, { envio: cancelado, cierre: 1 }), "RC012");
    await rechaza(reabrir(app, d, { envio: c1, cierre: 1 }), "RC012");              // ese identificador es de un cierre
    const r1 = randomUUID();
    await reabrir(app, d, { envio: r1, cierre: 1 });
    await rechaza(reabrir(app, d, { envio: r1, cierre: 2 }), "RC012");
    await rechaza(app.query("SELECT * FROM cerrar_el_dia(NULL, $1, 1, 0, 0, $2, $3, $4, $5)", [e.jornada, d.duena, CLAVE, d.huella, e.mostrador]), "RC005");
    await rechaza(app.query("SELECT * FROM reabrir_jornada(NULL, $1, 1, $2, $3, $4, $5)", [e.jornada, d.duena, CLAVE, d.huella, e.mostrador]), "RC005");
  }));

// ── después de reabrir ─────────────────────────────────────────────────────

test("después de reabrir se atiende como si nada: se cobra, los precios siguen publicados y sin editarse, y los folios siguen su cuenta", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const antes = await compraDe(db, e, e.mat["Cartón"]!, 10);
    const folio = Number((await una(db, "SELECT folio FROM operacion WHERE id = $1", [antes])).folio);
    await cerrar(app, e.jornada, 0, e.mostrador);
    await rechaza(abrirCuenta(app, "compra", e.mostrador), "RC006");                // cerrado: no se atiende
    await reabrir(app, d, { cierre: 1 });

    const c = await abrirCuenta(app, "compra", e.mostrador);
    await agregarMaterial(app, c.id, e.mat["Cartón"]!, "30", e.mostrador);
    const hecha = await confirmar(db, c.id, e.mostrador);
    assert.equal(Number(hecha.folio), folio + 1);
    assert.equal(hecha.confirmada_en_jornada, e.jornada);
    assert.ok((await una(db, "SELECT publicada_en FROM lista_precios WHERE id = $1", [e.lista])).publicada_en);
    await rechaza(db.query("UPDATE precio SET compra = compra + 1 WHERE lista_id = $1", [e.lista]), "RC001");
    assert.equal(await contar(db, "jornada"), 1, "reabrir no abre otra jornada");
  }));

test("lo que pasó con el día cerrado no se deshace al reabrir: un vehículo descartado en ese rato no vuelve", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const vehiculo = await abrirCuenta(app, "compra", e.mostrador, randomUUID(), "ABC-123");
    await agregarMaterial(app, vehiculo.id, e.mat["Fierro pesado"]!, "5200", e.mostrador, { bascula: GRANDE });
    const otro = await abrirCuenta(app, "compra", e.mostrador, randomUUID(), "XYZ-987");
    await agregarMaterial(app, otro.id, e.mat["Fierro pesado"]!, "4100", e.mostrador, { bascula: GRANDE });
    await cerrar(app, e.jornada, 0, e.mostrador);                                   // los vehículos pendientes no impiden cerrar

    // Con el día cerrado: uno se descarta, y el otro vuelve a pesarse.
    assert.equal((await una(app, "SELECT descartar_cuenta($1, $2) AS ok", [vehiculo.id, e.mostrador])).ok, true);
    const linea = (await una(db, "SELECT id FROM operacion_linea WHERE operacion_id = $1", [otro.id])).id as string;
    await una(app, "SELECT * FROM segunda_pesada($1, $2, $3, $4)", [linea, randomUUID(), "1800", e.mostrador]);

    await reabrir(app, d, { cierre: 1 });
    assert.equal(await contar(db, "operacion", "id = $1", [vehiculo.id]), 0);
    assert.equal(Number((await una(db, "SELECT peso_liquidable FROM operacion_linea WHERE id = $1", [linea])).peso_liquidable), 2300);
    // Y ya abierto, el que volvió a pesarse se cobra en esta jornada.
    const hecha = await confirmar(db, otro.id, e.mostrador);
    assert.equal(hecha.confirmada_en_jornada, e.jornada);
  }));

test("con la de hoy cerrada, abrir la jornada de hoy dice que se puede reabrir, no que «ya existe»", () =>
  conHoy(async (d) => {
    const { app, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    await assert.rejects(app.query("SELECT abrir_jornada_de_hoy($1)", [e.mostrador]), (err: unknown) => {
      const x = err as { code: string; message: string };
      assert.equal(x.code, "RC006");
      assert.match(x.message, /ya se cerró/);
      assert.match(x.message, /reabrir/);
      return true;
    });
  }));

// ── cruces ─────────────────────────────────────────────────────────────────

/** Dos sesiones más de la aplicación, y una que mira quién espera. */
async function conTres(d: Dia, prueba: (a: pg.Client, b: pg.Client, vigia: pg.Client) => Promise<void>): Promise<void> {
  const [a, b, vigia] = [await comoApp(d.base), await comoApp(d.base), await conectar(d.base)];
  try {
    await prueba(a, b, vigia);
  } finally {
    await Promise.all([a.end(), b.end(), vigia.end()]);
  }
}

test("dos reaperturas del mismo cierre a la vez: una reabre y la otra se entera de que ya no hay qué reabrir", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    await conTres(d, async (a, b, vigia) => {
      await a.query("BEGIN");
      assert.ok((await reabrir(a, d, { cierre: 1 })).id);
      const pid = await pidDe(b);
      const segunda = desenlace(reabrir(b, d, { cierre: 1 }));
      await esperarQueEspere(vigia, pid);
      await a.query("COMMIT");
      assert.equal(await segunda, "RC011");
    });
    assert.equal(await contar(db, "reapertura"), 1);
    assert.equal((await verJornada(db, e.jornada)).cerrada_en, null);
  }));

test("reabrir y volver a cerrar a la vez pasan uno tras otro, y cada uno deja lo suyo", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    await conTres(d, async (a, b, vigia) => {
      await a.query("BEGIN");
      await reabrir(a, d, { cierre: 1 });
      // Quien cierra ve todavía el día cerrado (un cierre): su orden espera, y al pasar ya puede cerrar el reabierto.
      const pid = await pidDe(b);
      const cierre = desenlace(cerrar(b, e.jornada, 1, e.mostrador));
      await esperarQueEspere(vigia, pid);
      await a.query("COMMIT");
      assert.equal(await cierre, "pasó");
    });
    const j = await verJornada(db, e.jornada);
    assert.ok(j.cerrada_en);
    assert.equal(j.cierres, 2);
  }));

test("la reapertura que empezó antes de la medianoche y obtuvo el candado después se rechaza", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    await conTres(d, async (_a, b, vigia) => {
      // Alguien tiene tomada la jornada mientras el reloj del patio pasa de día.
      await db.query("BEGIN");
      await db.query("SELECT 1 FROM jornada WHERE id = $1 FOR UPDATE", [e.jornada]);
      const pid = await pidDe(b);
      const pedida = desenlace(reabrir(b, d, { cierre: 1 }));
      await esperarQueEspere(vigia, pid);
      await db.query("UPDATE sucursal SET zona = $1", [ZONA_DE_MANANA]);
      await db.query("COMMIT");
      assert.equal(await pedida, "RC006");
    });
    assert.ok((await verJornada(db, e.jornada)).cerrada_en, "se reabrió un día que ya no era hoy");
    assert.equal(await contar(db, "reapertura"), 0);
  }));

test("reabrir mientras otra sesión intenta abrir la jornada de hoy: se reabre la misma y no nace otra", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    await cerrar(app, e.jornada, 0, e.mostrador);
    await conTres(d, async (a, b) => {
      await a.query("BEGIN");
      await reabrir(a, d, { cierre: 1 });
      // Mientras la reapertura no se confirma, la de hoy sigue viéndose cerrada: «ya se cerró».
      assert.equal(await desenlace(b.query("SELECT abrir_jornada_de_hoy($1)", [e.mostrador])), "RC006");
      await a.query("COMMIT");
      assert.equal(await desenlace(b.query("SELECT abrir_jornada_de_hoy($1)", [e.mostrador])), "RC006");   // ya hay una abierta
    });
    assert.equal(await contar(db, "jornada"), 1);
  }));

test("cerrar con cuentas por terminar sigue sin pasar, y no gasta el envío", () =>
  conHoy(async (d) => {
    const { app, db, e } = d;
    const c = await abrirCuenta(app, "compra", e.mostrador);
    const envio = randomUUID();
    await rechaza(cerrar(app, e.jornada, 0, e.mostrador, envio), "RC006");
    assert.equal(await contar(db, "envio", "id = $1", [envio]), 0);
    await app.query("SELECT descartar_cuenta($1, $2)", [c.id, e.mostrador]);
    assert.equal((await cerrar(app, e.jornada, 0, e.mostrador, envio)).cierre, 1);
    // El atajo de las pruebas cierra «la que está abierta» diciendo lo que ve: aquí ya no hay ninguna.
    // (Es de la conexión del dueño: la aplicación ya no cierra sin corte.)
    assert.equal((await db.query(CERRAR_EL_DIA, [e.mostrador])).rows.length, 0);
    assert.equal(CHICA_2, 2);
  }));
