import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abrirJornada, conBase, conectar, desenlace, escenario, esperarQueEspere, material, pidDe, rechaza, una, usuario,
} from "./apoyo.ts";

test("el catálogo trae los 27 materiales levantados en campo, en 6 familias", () =>
  conBase(async (db) => {
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM material")).n, 27);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM familia")).n, 6);
    const porFamilia = await db.query(
      "SELECT f.nombre, count(*)::int AS n FROM material m JOIN familia f ON f.id = m.familia_id GROUP BY f.nombre ORDER BY f.nombre",
    );
    assert.deepEqual(
      Object.fromEntries(porFamilia.rows.map((r) => [r.nombre, r.n])),
      { Aluminio: 10, "Cobre y bronce": 4, Fierro: 3, "Otros metales": 4, Papel: 2, Plástico: 4 },
    );
  }));

test("los frecuentes son los cuatro que confirmó el personal", () =>
  conBase(async (db) => {
    const r = await db.query("SELECT nombre FROM material WHERE frecuente ORDER BY nombre");
    assert.deepEqual(r.rows.map((f) => f.nombre), ["Aluminio bote", "Cartón", "Cobre de primera", "Fierro lámina"]);
  }));

test("dentro de su familia el material se nombra sin repetir el prefijo", () =>
  conBase(async (db) => {
    const f = await una(db, "SELECT nombre_corto FROM material WHERE nombre = 'Aluminio rin de tráiler'");
    assert.equal(f.nombre_corto, "Rin de tráiler");
  }));

test("no puede haber dos materiales con el mismo nombre", () =>
  conBase(async (db) => {
    await rechaza(
      db.query("INSERT INTO material (sucursal_id, familia_id, nombre, nombre_corto) VALUES (1, 5, 'Cartón', 'Cartón')"),
      "23505",
    );
  }));

test("cambiar un material deja rastro en la bitácora", () =>
  conBase(async (db) => {
    await db.query("UPDATE material SET frecuente = true WHERE nombre = 'PET'");
    const f = await una(db, "SELECT detalle FROM bitacora WHERE entidad = 'material' AND accion = 'update'");
    assert.equal(f.detalle.antes.frecuente, false);
    assert.equal(f.detalle.despues.frecuente, true);
  }));

test("abrir la jornada crea su lista de precios sin publicar", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const j = await abrirJornada(db, responsable);
    const lista = await una(db, "SELECT publicada_en FROM lista_precios WHERE id = $1", [j.lista]);
    assert.equal(lista.publicada_en, null);
  }));

test("no puede haber dos jornadas abiertas a la vez", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    await abrirJornada(db, responsable, "2026-10-01");
    await rechaza(abrirJornada(db, responsable, "2026-10-02"), "RC006");
  }));

test("quien solo consulta no puede abrir la jornada", () =>
  conBase(async (db) => {
    const ana = await usuario(db, "Ana", "consulta");
    await rechaza(abrirJornada(db, ana), "RC008");
  }));

test("solo un responsable publica la lista de precios", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const luis = await usuario(db, "Luis", "mostrador");
    const j = await abrirJornada(db, responsable);
    await db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, 2.1, 2.5)", [
      j.lista, await material(db, "Cartón"),
    ]);
    await rechaza(db.query("SELECT publicar_lista($1, $2)", [j.lista, luis]), "RC008");
    await db.query("SELECT publicar_lista($1, $2)", [j.lista, responsable]);
    const lista = await una(db, "SELECT publicada_por FROM lista_precios WHERE id = $1", [j.lista]);
    assert.equal(lista.publicada_por, responsable);
  }));

test("una lista sin precios no se publica", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const j = await abrirJornada(db, responsable);
    await rechaza(db.query("SELECT publicar_lista($1, $2)", [j.lista, responsable]), "RC009");
  }));

test("en una lista publicada no se cambia un precio", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(db.query("UPDATE precio SET compra = 1 WHERE lista_id = $1", [e.lista]), "RC001");
  }));

test("a una lista publicada no se le agrega un precio", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(
      db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, 1, 2)", [
        e.lista, await material(db, "Plomo"),
      ]),
      "RC001",
    );
  }));

test("a una lista publicada no se le quita un precio", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(db.query("DELETE FROM precio WHERE lista_id = $1", [e.lista]), "RC001");
  }));

test("una lista publicada no se puede despublicar", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(
      db.query("UPDATE lista_precios SET publicada_en = NULL, publicada_por = NULL WHERE id = $1", [e.lista]),
      "RC001",
    );
  }));

test("un precio no puede ser negativo", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const j = await abrirJornada(db, responsable);
    await rechaza(
      db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, -1, 2)", [
        j.lista, await material(db, "Cartón"),
      ]),
      "23514",
    );
  }));

test("el precio se guarda exacto, con cuatro decimales", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const f = await una(db, "SELECT compra, venta FROM precio WHERE lista_id = $1 AND material_id = $2", [
      e.lista, e.mat["Fierro lámina"],
    ]);
    assert.equal(f.compra, "6.2000");
    assert.equal(f.venta, "7.3000");
  }));

test("abrir la jornada siguiente copia los precios de la última lista publicada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $1, cierres = cierres + 1 WHERE id = $2", [e.responsable, e.jornada]);
    const manana = await abrirJornada(db, e.responsable, "2026-10-02");
    const copia = await una(db, "SELECT count(*)::int AS n FROM precio WHERE lista_id = $1", [manana.lista]);
    assert.equal(copia.n, 7);
    const cobre = await una(db, "SELECT compra FROM precio WHERE lista_id = $1 AND material_id = $2", [
      manana.lista, e.mat["Cobre de primera"],
    ]);
    assert.equal(cobre.compra, "150.0000");
    const lista = await una(db, "SELECT publicada_en FROM lista_precios WHERE id = $1", [manana.lista]);
    assert.equal(lista.publicada_en, null, "la copia nace sin publicar: el responsable la revisa y la publica");
  }));

// ── tras la revisión de Codex ──────────────────────────────────────────────

test("un precio tiene que ser un número", () =>
  conBase(async (db) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const j = await abrirJornada(db, responsable);
    await rechaza(
      db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, 'NaN', 2)", [
        j.lista, await material(db, "Cartón"),
      ]),
      "23514",
    );
  }));

test("quien cambia un precio mientras la lista se publica espera, y su cambio tardío se rechaza", () =>
  conBase(async (db, base) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const j = await abrirJornada(db, responsable);
    await db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, 2.1, 2.5)", [
      j.lista, await material(db, "Cartón"),
    ]);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await db.query("SELECT publicar_lista($1, $2)", [j.lista, responsable]);
      const cambio = desenlace(otra.query("UPDATE precio SET compra = 9 WHERE lista_id = $1", [j.lista]));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await cambio, "RC001");
    } finally {
      await otra.end();
    }
    assert.equal((await una(db, "SELECT compra FROM precio WHERE lista_id = $1", [j.lista])).compra, "2.1000");
  }));

test("los precios no se vacían de un golpe", () =>
  conBase(async (db) => {
    await escenario(db);
    await rechaza(db.query("TRUNCATE precio"), "RC001");
  }));
