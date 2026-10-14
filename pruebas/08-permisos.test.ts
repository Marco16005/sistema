import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  CERRAR_EL_DIA,  CHICA_2, abrirCuenta, agregarMaterial, comoApp, compraDe, conApp, conBase, cuenta, equipoDeAlta, escenario, existencia, material,
  personaConClave, rechaza, renglon, una, usuario,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import type pg from "pg";

const SIN_PERMISO = "42501";

// ── lo que la aplicación no puede hacer aunque quiera ──────────────────────

test("la aplicación no escribe directo en el libro de inventario", () =>
  conApp(async (app, db, e) => {
    await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(
      app.query(
        `INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, autorizado_por, creado_por)
         VALUES (1, $1, 'ajuste', 500, $2, 'porque sí', $3, $3)`,
        [e.mat["Cartón"], e.jornada, e.responsable],
      ),
      SIN_PERMISO,
    );
    await rechaza(app.query("UPDATE movimiento_inventario SET cantidad_kg = 1"), SIN_PERMISO);
    await rechaza(app.query("DELETE FROM movimiento_inventario"), SIN_PERMISO);
    await rechaza(app.query("TRUNCATE movimiento_inventario"), SIN_PERMISO);
    assert.equal(await existencia(db, e.mat["Cartón"]), 10);
  }));

test("la aplicación no escribe, cambia ni borra la bitácora", () =>
  conApp(async (app) => {
    await rechaza(app.query("INSERT INTO bitacora (accion, entidad) VALUES ('inventada', 'x')"), SIN_PERMISO);
    await rechaza(app.query("UPDATE bitacora SET accion = 'otra'"), SIN_PERMISO);
    await rechaza(app.query("DELETE FROM bitacora"), SIN_PERMISO);
    await rechaza(app.query("SELECT anotar(NULL, 'inventada', 'x', NULL)"), SIN_PERMISO);
  }));

test("la aplicación no confirma una cuenta por su lado ni le pone folio", () =>
  conApp(async (app, db, e) => {
    const op = await cuenta(db, e, "compra");
    await rechaza(app.query("UPDATE operacion SET estado = 'confirmada' WHERE id = $1", [op]), SIN_PERMISO);
    await rechaza(app.query("UPDATE operacion SET folio = 1, total = 100 WHERE id = $1", [op]), SIN_PERMISO);
    await rechaza(app.query("UPDATE operacion SET estado_pago = 'liquidada' WHERE id = $1", [op]), SIN_PERMISO);
  }));

test("la aplicación no escribe el peso ni el precio de un renglón", () =>
  conApp(async (app, db, e) => {
    const op = await cuenta(db, e, "compra");
    await rechaza(
      app.query("INSERT INTO operacion_linea (operacion_id, material_id, instrumento_id, peso_bruto) VALUES ($1, $2, $3, 500)", [
        op, e.mat["Cartón"], CHICA_2,
      ]),
      SIN_PERMISO,
    );
    await rechaza(
      app.query("INSERT INTO operacion_linea (operacion_id, material_id, instrumento_id, precio_unitario) VALUES ($1, $2, $3, 0.01)", [
        op, e.mat["Cartón"], CHICA_2,
      ]),
      SIN_PERMISO,
    );
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    await rechaza(app.query("UPDATE operacion_linea SET peso_bruto = 500 WHERE id = $1", [linea]), SIN_PERMISO);
    await rechaza(app.query("UPDATE operacion_linea SET precio_unitario = 0.01 WHERE id = $1", [linea]), SIN_PERMISO);
  }));

test("la aplicación cambia y quita renglones solo por las funciones que dicen quién lo hace", () =>
  conApp(async (app, db, e) => {
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    await rechaza(app.query("UPDATE operacion_linea SET descuento_kg = 1 WHERE id = $1", [linea]), SIN_PERMISO);
    await rechaza(app.query("DELETE FROM operacion_linea WHERE id = $1", [linea]), SIN_PERMISO);
    // Las funciones internas, que no reciben persona, tampoco son suyas.
    await rechaza(app.query("SELECT fijar_descuento($1, 1)", [linea]), SIN_PERMISO);
    await rechaza(app.query("SELECT quitar_renglon($1)", [linea]), SIN_PERMISO);
    await app.query("SELECT poner_descuento($1, 1, $2)", [linea, e.mostrador]);
    await app.query("SELECT quitar_material($1, $2)", [linea, e.mostrador]);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea WHERE operacion_id = $1", [op])).n, 0);
  }));

test("la aplicación no altera ni quita una pesada", () =>
  conApp(async (app, db, e) => {
    const linea = await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Cartón"], 10);
    await rechaza(app.query("UPDATE captura_peso SET valor_kg = 500"), SIN_PERMISO);
    await rechaza(app.query("DELETE FROM linea_pesada WHERE linea_id = $1", [linea]), SIN_PERMISO);
    await rechaza(app.query("DELETE FROM captura_usada"), SIN_PERMISO);
  }));

test("la aplicación no se da de alta personas ni se sube el rol", () =>
  conApp(async (app, _db, e) => {
    await rechaza(
      app.query("INSERT INTO usuario (sucursal_id, nombre, rol, puede_autorizar) VALUES (1, 'Colado', 'responsable', true)"),
      SIN_PERMISO,
    );
    await rechaza(app.query("UPDATE usuario SET rol = 'responsable', puede_autorizar = true WHERE id = $1", [e.mostrador]), SIN_PERMISO);
  }));

test("la aplicación no abre, cierra ni publica saltándose las funciones", () =>
  conApp(async (app, _db, e) => {
    await rechaza(app.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $1", [e.mostrador]), SIN_PERMISO);
    await rechaza(app.query("UPDATE lista_precios SET publicada_en = NULL, publicada_por = NULL"), SIN_PERMISO);
    await rechaza(app.query("UPDATE sucursal SET corte_cerrado_en = NULL"), SIN_PERMISO);
    await rechaza(app.query("UPDATE instrumento SET division_kg = 100"), SIN_PERMISO);
  }));

test("la aplicación no puede apagar los disparadores", () =>
  conApp(async (app) => {
    await rechaza(app.query("SET session_replication_role = replica"), SIN_PERMISO);
    await rechaza(app.query("ALTER TABLE movimiento_inventario DISABLE TRIGGER ALL"), SIN_PERMISO);
    await rechaza(app.query("DROP TRIGGER movimiento_inmutable ON movimiento_inventario"), SIN_PERMISO);
  }));

test("la aplicación no crea objetos en el esquema", () =>
  conApp(async (app) => {
    await rechaza(app.query("CREATE TABLE colada (x int)"), SIN_PERMISO);
    await rechaza(app.query("CREATE FUNCTION colada() RETURNS int LANGUAGE sql AS 'SELECT 1'"), SIN_PERMISO);
  }));

test("una tabla temporal con el nombre de una real no engaña a las funciones", () =>
  conApp(async (app) => {
    await app.query("CREATE TEMP TABLE usuario (LIKE public.usuario)");
    await app.query("INSERT INTO usuario (id, sucursal_id, nombre, rol, puede_autorizar, activo) OVERRIDING SYSTEM VALUE VALUES (424242, 1, 'Falso', 'responsable', true, true)");
    // La función busca en la tabla real, donde esa persona no existe.
    await rechaza(app.query("SELECT publicar_lista_de_hoy(424242)"), "RC008");
  }));

test("una tabla temporal de básculas no engaña a la validación de la pesada", () =>
  conApp(async (app, db, e) => {
    await db.query("UPDATE instrumento SET capacidad_kg = 300 WHERE id = $1", [CHICA_2]);
    await app.query("CREATE TEMP TABLE instrumento AS SELECT * FROM public.instrumento");
    await app.query("UPDATE pg_temp.instrumento SET capacidad_kg = 5000 WHERE id = $1", [CHICA_2]);
    // La báscula real aguanta 300 kg; la copia temporal dice 5000. Vale la real.
    const op = await cuenta(db, e, "compra");
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "500", e.mostrador), "RC004");
  }));

test("todas las funciones del esquema fijan dónde buscan sus tablas", () =>
  conBase(async (db) => {
    const r = await db.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
       ORDER BY 1`,
    );
    assert.deepEqual(r.rows.map((f) => f.proname), []);
  }));

// La lista completa. Una función nueva no entra aquí sola: si la aplicación puede ejecutarla, alguien lo decidió.
const ENTRADAS = [
  "abrir_cuenta", "abrir_jornada_de_hoy", "agregar_material", "alta_cliente", "alta_de_persona", "alta_material", "baja_de_equipo", "baja_de_persona",
  "cambiar_clave_de_persona", "cambiar_cliente", "cambiar_material", "cambiar_nombre_de_cliente", "cancelar_envio", "canjear_codigo", "cerrar_el_dia", "codigo_para_equipo", "confirmar_cuenta",
  "contar_material", "corregir_movimiento", "dar_merma", "dar_precio_especial", "descartar_cuenta", "entrar", "equipo_vigente",
  "equipos_para_administrar", "estado_de_movimiento", "etiquetar_cuenta", "fijar_precio", "hoy_en", "personas_para_administrar", "poner_descuento", "poner_recipiente",
  "precios_especiales_del_dia", "previa_de_conteo", "previa_de_separacion", "publicar_lista_de_hoy", "quitar_material", "quitar_precio",
  "quitar_precio_especial", "reabrir_jornada", "registrar_impresion", "salir", "segunda_pesada", "separar_material", "sesion_vigente",
  "terminar_arranque", "terminar_vehiculo", "verificar_clave", "vida_vigente",
];

test("la aplicación ejecuta las funciones de entrada y ninguna otra", () =>
  conBase(async (db) => {
    const r = await db.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND has_function_privilege('feruga_app', p.oid, 'EXECUTE')
       ORDER BY 1`,
    );
    assert.deepEqual(r.rows.map((f) => f.proname), ENTRADAS);
  }));

test("ninguna función del esquema queda abierta a cualquiera", () =>
  conBase(async (db) => {
    const r = await db.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND has_function_privilege('public', p.oid, 'EXECUTE')
       ORDER BY 1`,
    );
    assert.deepEqual(r.rows.map((f) => f.proname), []);
  }));

test("una función creada después nace cerrada para la aplicación", () =>
  conApp(async (app, db) => {
    await db.query("CREATE FUNCTION nueva() RETURNS int LANGUAGE sql SET search_path = public, pg_temp AS 'SELECT 1'");
    await rechaza(app.query("SELECT nueva()"), SIN_PERMISO);
  }));

test("la aplicación no escribe directo en ninguna tabla, y no lee las de identidad", () =>
  conBase(async (db) => {
    const escribe = await db.query(
      `SELECT table_name || ': ' || privilege_type AS permiso FROM information_schema.role_table_grants
       WHERE grantee = 'feruga_app' AND privilege_type <> 'SELECT'
       UNION
       SELECT table_name || '.' || column_name || ': ' || privilege_type FROM information_schema.column_privileges
       WHERE grantee = 'feruga_app' AND privilege_type <> 'SELECT'
       ORDER BY 1`,
    );
    assert.deepEqual(escribe.rows.map((f) => f.permiso), []);
    const lee = await db.query(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'feruga_app' AND privilege_type = 'SELECT'
         AND table_name IN ('credencial', 'equipo', 'codigo_alta', 'sesion')`,
    );
    assert.deepEqual(lee.rows.map((f) => f.table_name), []);
  }));

test("la aplicación no puede fijar la revisión de una cuenta", () =>
  conApp(async (app, db, e) => {
    const op = await cuenta(db, e, "compra");
    await rechaza(app.query("UPDATE operacion SET revision = 0 WHERE id = $1", [op]), SIN_PERMISO);
  }));

// ── lo que sí puede: el día completo por las vías previstas ────────────────

test("con las credenciales de la aplicación se hace un día completo", () =>
  conBase(async (db, base) => {
    const responsable = await personaConClave(db, "Servando", "responsable", "481516", true);
    const mostrador = await usuario(db, "Luis", "mostrador");
    const carton = await material(db, "Cartón");
    const huella = await equipoDeAlta(db);
    const app = await comoApp(base);
    try {
      const j = await una(app, "SELECT * FROM abrir_jornada_de_hoy($1)", [mostrador]);
      await app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, responsable]);
      await app.query("SELECT publicar_lista_de_hoy($1)", [responsable]);

      const op = (await abrirCuenta(app, "compra", mostrador, randomUUID(), "Camioneta roja")).id;
      const linea = (await agregarMaterial(app, op, carton, "30.2", mostrador)).id;
      await app.query("SELECT poner_descuento($1, 0.2, $2)", [linea, mostrador]);
      const c = await una(app, "SELECT * FROM confirmar_cuenta($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [op, mostrador]);
      assert.equal(c.total, "63");

      assert.equal((await una(app, "SELECT kg FROM existencia WHERE material_id = $1", [carton])).kg, "30.200");
      // Se cuenta (30, con la clave de quien autoriza) y se da merma (1).
      const visto = await una(app, "SELECT contado_en::text AS contado_en, registrado_kg FROM previa_de_conteo($1, 30, NULL)", [carton]);
      const conteo = await una(app, "SELECT * FROM contar_material($1, $2, 30, $3, $4, NULL, $5, '481516', $6, $7)", [
        randomUUID(), carton, visto.contado_en, visto.registrado_kg, responsable, huella, mostrador,
      ]);
      assert.equal(conteo.diferencia_kg, "-0.200");
      await app.query("SELECT dar_merma($1, $2, 1, 'Mojado', $3)", [randomUUID(), carton, mostrador]);
      const descartable = (await abrirCuenta(app, "venta", mostrador)).id;
      await app.query("SELECT descartar_cuenta($1, $2)", [descartable, mostrador]);
      const cerrada = await una(app, CERRAR_EL_DIA, [mostrador]);
      assert.equal(cerrada.jornada_id, j.id);
      assert.equal(cerrada.cierre, 1);
      assert.equal((await una(app, "SELECT kg FROM existencia WHERE material_id = $1", [carton])).kg, "29.000");
    } finally {
      await app.end();
    }
  }));

// ── cada función comprueba a la persona, no solo a la conexión ─────────────

const LLAMADAS: Array<[string, (db: pg.Client, e: Escenario, quien: string) => Promise<unknown>]> = [
  ["abrir_jornada", (db, _e, q) => db.query("SELECT abrir_jornada(1::smallint, '2026-10-05', $1)", [q])],
  ["publicar_lista", (db, e, q) => db.query("SELECT publicar_lista($1, $2)", [e.lista, q])],
  ["confirmar_operacion", async (db, e, q) => {
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    return db.query("SELECT confirmar_operacion($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [op, q]);
  }],
  ["registrar_apertura", (db, e, q) => db.query("SELECT registrar_apertura($1, 10, 'contado', $2)", [e.mat["Cartón"], q])],
  ["cerrar_corte", (db, _e, q) => db.query("SELECT cerrar_corte(1::smallint, $1)", [q])],
  ["registrar_conteo", (db, e, q) => db.query("SELECT registrar_conteo($1, 10, $2, $3)", [e.mat["Cartón"], e.responsable, q])],
  ["registrar_merma", (db, e, q) => db.query("SELECT registrar_merma($1, 1, 'Se tiró', $2)", [e.mat["Cartón"], q])],
  ["registrar_transformacion", (db, e, q) =>
    db.query("SELECT registrar_transformacion($1, 1, $2::jsonb, NULL, $3)", [e.mat["Cartón"], JSON.stringify([{ material: e.mat["PET"], kg: 1 }]), q])],
  ["cerrar_jornada", (db, e, q) => db.query("SELECT cerrar_jornada($1, $2)", [e.jornada, q])],
];
for (const [nombre, llamar] of LLAMADAS) {
  test(`${nombre} rechaza a quien solo consulta`, () =>
    conBase(async (db) => {
      const e = await escenario(db);
      await rechaza(llamar(db, e, e.consulta), "RC008");
    }));
  test(`${nombre} rechaza a una persona dada de baja`, () =>
    conBase(async (db) => {
      const e = await escenario(db);
      const baja = await usuario(db, "Ya no está", "responsable", true);
      await db.query("UPDATE usuario SET activo = false WHERE id = $1", [baja]);
      await rechaza(llamar(db, e, baja), "RC008");
    }));
}
