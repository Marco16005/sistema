import assert from "node:assert/strict";
import { test } from "node:test";
import { conBase, rechaza, una, usuario } from "./apoyo.ts";

test("la bitácora no admite modificar un registro", () =>
  conBase(async (db) => {
    await db.query("INSERT INTO bitacora (accion, entidad) VALUES ('prueba', 'x')");
    await rechaza(db.query("UPDATE bitacora SET accion = 'otra'"), "RC001");
  }));

test("la bitácora no admite borrar un registro", () =>
  conBase(async (db) => {
    await db.query("INSERT INTO bitacora (accion, entidad) VALUES ('prueba', 'x')");
    await rechaza(db.query("DELETE FROM bitacora"), "RC001");
  }));

test("la bitácora no admite vaciarse de un golpe", () =>
  conBase(async (db) => {
    await db.query("INSERT INTO bitacora (accion, entidad) VALUES ('prueba', 'x')");
    await rechaza(db.query("TRUNCATE bitacora"), "RC001");
  }));

test("exigir_rol deja pasar a quien tiene uno de los roles pedidos", () =>
  conBase(async (db) => {
    const luis = await usuario(db, "Luis", "mostrador");
    const f = await una(db, "SELECT (exigir_rol($1, 'mostrador', 'responsable')).nombre", [luis]);
    assert.equal(f.nombre, "Luis");
  }));

test("exigir_rol rechaza a quien tiene otro rol", () =>
  conBase(async (db) => {
    const ana = await usuario(db, "Ana", "consulta");
    await rechaza(db.query("SELECT exigir_rol($1, 'mostrador', 'responsable')", [ana]), "RC008");
  }));

test("exigir_rol rechaza a un usuario dado de baja", () =>
  conBase(async (db) => {
    const luis = await usuario(db, "Luis", "mostrador");
    await db.query("UPDATE usuario SET activo = false WHERE id = $1", [luis]);
    await rechaza(db.query("SELECT exigir_rol($1, 'mostrador')", [luis]), "RC008");
  }));

test("cambiar un usuario deja en la bitácora cómo estaba y cómo quedó", () =>
  conBase(async (db) => {
    const luis = await usuario(db, "Luis", "mostrador");
    await db.query("UPDATE usuario SET rol = 'patio' WHERE id = $1", [luis]);
    const f = await una(
      db,
      "SELECT detalle FROM bitacora WHERE entidad = 'usuario' AND accion = 'update'",
    );
    assert.equal(f.detalle.antes.rol, "mostrador");
    assert.equal(f.detalle.despues.rol, "patio");
  }));

test("solo un responsable puede ser persona facultada para autorizar", () =>
  conBase(async (db) => {
    await rechaza(usuario(db, "Luis", "mostrador", true), "23514");
    const servando = await usuario(db, "Servando", "responsable", true);
    assert.ok(servando);
  }));

test("no existe un sexto rol", () =>
  conBase(async (db) => {
    await rechaza(usuario(db, "Quien sea", "gerente"), "23514");
  }));
