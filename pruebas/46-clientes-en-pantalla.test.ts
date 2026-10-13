// Los clientes desde la pantalla: un responsable da de alta a un cliente sin esperar a darle su
// primer precio especial en el mostrador, lo da de baja y lo reactiva. Antes la baja y la
// reactivación eran solo de la consola. Darle precio especial sigue pidiendo, cada vez, la clave de
// quien autoriza: tener al cliente en la lista no le da nada por sí solo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { conApp, conBase, conBaseVacia, conectar, esperarQueEspere, material, pidDe, rechaza, una, urlApp, usuario } from "./apoyo.ts";
import { migrar } from "../db/migrar.ts";
import { crearBd } from "../src/servidor/bd.ts";

const alta = (db: pg.Client, quien: string, nombre: string | null = "Fundidora del Norte") =>
  una(db, "SELECT * FROM alta_cliente($1, $2)", [nombre, quien]);
const cambio = (db: pg.Client, quien: string, id: string | number, activo: boolean | null) =>
  una(db, "SELECT * FROM cambiar_cliente($1, $2, $3)", [id, activo, quien]);
const falla = (p: Promise<unknown>, mensaje: string) => assert.rejects(p, (e: unknown) => {
  const error = e as { code: string; message: string };
  assert.equal(error.code, "RC005");
  assert.equal(error.message, mensaje);
  return true;
});
const anotado = async (db: pg.Client) =>
  (await db.query("SELECT usuario_id, accion, entidad_id, detalle FROM bitacora WHERE entidad = 'cliente' ORDER BY id")).rows;

test("base: el responsable da de alta a un cliente sin darle precio todavía: el nombre se limpia, nace activo, a su nombre, y queda anotado", () =>
  conBase(async (db) => {
    const quien = await usuario(db, "Dueño", "responsable");
    const c = await alta(db, quien, "  Fundidora   del\tNorte ");
    assert.deepEqual([c.nombre, c.activo, c.creado_por], ["Fundidora del Norte", true, quien]);
    assert.deepEqual(await anotado(db), [{ usuario_id: quien, accion: "alta", entidad_id: c.id, detalle: { nombre: "Fundidora del Norte" } }]);
    // No nace con ningún precio: eso se sigue dando en el mostrador, con la clave de quien autoriza.
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM precio_especial")).n, 0);
  }));

test("base: sin nombre, con más de 80 letras o repetido —esté activo o de baja, sin distinguir mayúsculas— no se da de alta, y se dice por qué", () =>
  conBase(async (db) => {
    const q = await usuario(db, "Dueño", "responsable");
    for (const nombre of ["", "   ", " \n\t ", null]) await falla(alta(db, q, nombre), "Falta el nombre del cliente");
    await falla(alta(db, q, "X".repeat(81)), "El nombre del cliente lleva hasta 80 letras");
    assert.equal((await alta(db, q, "X".repeat(80))).nombre.length, 80);
    const c = await alta(db, q);
    await falla(alta(db, q, "FUNDIDORA  DEL NORTE"), "Ya hay un cliente que se llama «Fundidora del Norte»");
    await cambio(db, q, c.id, false);
    await falla(alta(db, q, "fundidora del norte"), "«Fundidora del Norte» está dado de baja: reactívalo en vez de dar de alta otro igual");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM cliente")).n, 2);
  }));

test("base: solo un responsable da de alta, da de baja y reactiva; a los demás se les dice antes de mirar los datos", () =>
  conBase(async (db) => {
    for (const rol of ["mostrador", "patio", "consulta", "administracion"]) {
      const q = await usuario(db, rol, rol);
      await rechaza(alta(db, q, ""), "RC008");
      await rechaza(cambio(db, q, 999999, false), "RC008");
    }
    // Y un responsable dado de baja, tampoco.
    const fue = await usuario(db, "Fue", "responsable");
    await db.query("UPDATE usuario SET activo = false WHERE id = $1", [fue]);
    await rechaza(alta(db, fue), "RC008");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM cliente")).n, 0);
  }));

test("base: la baja y la reactivación se anotan una vez cada una; repetirlas no cambia ni anota nada; y lo que no existe o no dice qué, se rechaza", () =>
  conBase(async (db) => {
    const q = await usuario(db, "Dueño", "responsable");
    const c = await alta(db, q);
    assert.equal((await cambio(db, q, c.id, false)).activo, false);
    assert.equal((await cambio(db, q, c.id, false)).activo, false);
    assert.equal((await cambio(db, q, c.id, true)).activo, true);
    assert.equal((await cambio(db, q, c.id, true)).activo, true);
    assert.deepEqual((await anotado(db)).map((a) => [a.accion, a.entidad_id, a.detalle.nombre, a.usuario_id]), [
      ["alta", c.id, "Fundidora del Norte", q], ["baja", c.id, "Fundidora del Norte", q], ["reactivar", c.id, "Fundidora del Norte", q],
    ]);
    await falla(cambio(db, q, 999999, false), "Ese cliente no existe");
    await falla(cambio(db, q, c.id, null), "Falta decir si el cliente queda activo o dado de baja");
  }));

test("base: la aplicación llama las dos entradas, pero sigue sin escribir la tabla de clientes ni llamar las de la consola", () =>
  conApp(async (app, _db, e) => {
    const c = await alta(app, e.responsable);
    assert.equal((await cambio(app, e.responsable, c.id, false)).activo, false);
    await rechaza(app.query("INSERT INTO cliente (nombre) VALUES ('Otro')"), "42501");
    await rechaza(app.query("UPDATE cliente SET activo = true WHERE id = $1", [c.id]), "42501");
    await rechaza(app.query("DELETE FROM cliente WHERE id = $1", [c.id]), "42501");
    for (const consola of ["baja_de_cliente($1)", "reactivar_cliente($1)", "renombrar_cliente($1, 'Otro')"]) {
      await rechaza(app.query(`SELECT ${consola}`, [c.id]), "42501");
    }
  }));

test("a la vez: dos altas del mismo cliente dejan uno solo, y la segunda recibe el mensaje de negocio, no un error de la base", () =>
  conBase(async (db, base) => {
    const q = await usuario(db, "Dueño", "responsable");
    const otro = await conectar(base);
    const vigia = await conectar(base);
    try {
      const pid = await pidDe(otro);
      await db.query("BEGIN");
      await alta(db, q);
      const pendiente = falla(alta(otro, q, "FUNDIDORA DEL NORTE"), "Ya hay un cliente que se llama «Fundidora del Norte»");
      await esperarQueEspere(vigia, pid);
      await db.query("COMMIT");
      await pendiente;
      assert.equal((await una(db, "SELECT count(*)::int AS n FROM cliente")).n, 1);
      assert.equal((await anotado(db)).length, 1);
    } finally { await db.query("ROLLBACK"); await otro.end(); await vigia.end(); }
  }));

test("dominio: el alta y el cambio devuelven al cliente como quedó, con su número como texto", () =>
  conApp(async (_app, _db, e, base) => {
    const { altaDeCliente, cambiarCliente, resumenDeClientes } = await import("../src/servidor/dominio/clientes.ts");
    const bd = crearBd(await urlApp(base));
    try {
      const c = await altaDeCliente(bd, e.responsable, "  Doña   Mari ");
      assert.deepEqual(c, { id: c.id, nombre: "Doña Mari", activo: true });
      assert.equal(typeof c.id, "string");
      assert.deepEqual(await cambiarCliente(bd, e.responsable, c.id, false), { ...c, activo: false });
      // En la lista de quien administra salen todos, también el dado de baja y el que no tiene cuentas.
      const lista = (await resumenDeClientes(bd)).clientes;
      assert.deepEqual(lista.map((x) => [x.id, x.nombre, x.activo, x.cuentas, x.ultimaVez]), [[c.id, "Doña Mari", false, 0, null]]);
      assert.deepEqual(await cambiarCliente(bd, e.responsable, c.id, true), c);
    } finally { await bd.cerrar(); }
  }));

// ── por las rutas ───────────────────────────────────────────────────────────

test("rutas: el responsable da de alta, da de baja y reactiva; el cliente nuevo se ofrece en el mostrador, el dado de baja no, y el reactivado otra vez", async () => {
  const { conMundo, ruta } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const jefe = await m.adentro("responsable");
    const caja = await m.adentro("mostrador");
    const [nuevo, cambiar, enMostrador, resumen] = [
      await ruta("clientes", "POST"), await ruta("clientes/[cliente]", "POST"), await ruta("clientes", "GET"), await ruta("clientes/resumen", "GET"),
    ];
    const ofrecidos = async () => (await caja.bien(enMostrador, "GET", "/api/clientes")).clientes;
    assert.deepEqual(await ofrecidos(), []);

    const { cliente } = await jefe.bien(nuevo, "POST", "/api/clientes", { nombre: "  Fundidora   del Norte " });
    assert.deepEqual(cliente, { id: cliente.id, nombre: "Fundidora del Norte", activo: true });
    assert.deepEqual(await ofrecidos(), [{ id: cliente.id, nombre: "Fundidora del Norte" }]);

    const par = { parametros: { cliente: cliente.id } };
    assert.deepEqual((await jefe.bien(cambiar, "POST", `/api/clientes/${cliente.id}`, { activo: false }, par)).cliente, { ...cliente, activo: false });
    assert.deepEqual(await ofrecidos(), []);
    // Sigue en la lista de quien administra, como dado de baja.
    assert.deepEqual((await jefe.bien(resumen, "GET", "/api/clientes/resumen")).clientes.map((c: any) => [c.nombre, c.activo]), [["Fundidora del Norte", false]]);
    assert.deepEqual((await jefe.bien(cambiar, "POST", `/api/clientes/${cliente.id}`, { activo: true }, par)).cliente, cliente);
    assert.deepEqual(await ofrecidos(), [{ id: cliente.id, nombre: "Fundidora del Norte" }]);
    // Quedó a nombre de quien lo hizo.
    assert.deepEqual((await anotado(m.db)).map((a) => [a.accion, a.usuario_id]), [
      ["alta", m.personas.responsable], ["baja", m.personas.responsable], ["reactivar", m.personas.responsable],
    ]);
  });
});

test("rutas: dar de alta, dar de baja y reactivar clientes es del responsable: los otros roles reciben 403 ROL, y sin persona, 401", async () => {
  const { conMundo, ruta } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const jefe = await m.adentro("responsable");
    const { cliente } = await jefe.bien(await ruta("clientes", "POST"), "POST", "/api/clientes", { nombre: "Don Chuy" });
    for (const rol of ["consulta", "mostrador", "patio", "administracion", null] as const) {
      const n = rol === null ? await m.equipo() : await m.adentro(rol);
      for (const [camino, cuerpo] of [["clientes", { nombre: "Otro" }], ["clientes/[cliente]", { activo: false }]] as const) {
        const r = await n.pedir(await ruta(camino, "POST"), "POST", "/api/clientes", cuerpo, { parametros: { cliente: cliente.id } });
        assert.equal(r.status, rol === null ? 401 : 403, `${rol}: ${camino}`);
        if (rol !== null) assert.equal((await r.json()).error.codigo, "ROL");
      }
    }
    assert.deepEqual((await m.db.query("SELECT nombre, activo FROM cliente")).rows, [{ nombre: "Don Chuy", activo: true }]);
  });
});

test("rutas: lo mal formado es 400 FORMA y no toca nada; lo que la base no deja es 409 con su mensaje", async () => {
  const { conMundo, ruta } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const n = await m.adentro("responsable");
    const [nuevo, cambiar] = [await ruta("clientes", "POST"), await ruta("clientes/[cliente]", "POST")];
    for (const cuerpo of [[], {}, { nombre: 42 }, { nombre: null }, { nombre: ["Don Chuy"] }, { nombre: "X".repeat(1001) }]) {
      const r = await n.pedir(nuevo, "POST", "/api/clientes", cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo).slice(0, 40));
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    const { cliente } = await n.bien(nuevo, "POST", "/api/clientes", { nombre: "Don Chuy" });
    for (const cuerpo of [[], {}, { activo: "false" }, { activo: 0 }, { activo: null }]) {
      const r = await n.pedir(cambiar, "POST", "/api/clientes/x", cuerpo, { parametros: { cliente: cliente.id } });
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    for (const id of ["0", "abc", "-1", "1.5", "9".repeat(19)]) {
      const r = await n.pedir(cambiar, "POST", "/api/clientes/x", { activo: false }, { parametros: { cliente: id } });
      assert.equal(r.status, 400, id);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    const mensaje = async (r: Response) => { assert.equal(r.status, 409); return (await r.json()).error; };
    assert.deepEqual(await mensaje(await n.pedir(nuevo, "POST", "/api/clientes", { nombre: "   " })), { codigo: "RC005", mensaje: "Falta el nombre del cliente" });
    assert.deepEqual(await mensaje(await n.pedir(nuevo, "POST", "/api/clientes", { nombre: "don chuy" })), { codigo: "RC005", mensaje: "Ya hay un cliente que se llama «Don Chuy»" });
    assert.deepEqual(await mensaje(await n.pedir(nuevo, "POST", "/api/clientes", { nombre: "X".repeat(81) })), { codigo: "RC005", mensaje: "El nombre del cliente lleva hasta 80 letras" });
    assert.deepEqual(await mensaje(await n.pedir(cambiar, "POST", "/api/clientes/x", { activo: false }, { parametros: { cliente: "999999" } })), { codigo: "RC005", mensaje: "Ese cliente no existe" });
    assert.deepEqual((await m.db.query("SELECT nombre, activo FROM cliente")).rows, [{ nombre: "Don Chuy", activo: true }]);
  });
});

test("al cliente dado de alta en los ajustes se le da precio especial en el mostrador, con la clave de quien autoriza; dado de baja ya no —ni por su nombre, y se dice dónde se reactiva—; y la cuenta abierta que ya lo llevaba se cobra como estaba", async () => {
  const { conMundo, ruta, CLAVES } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const carton = await material(m.db, "Cartón");
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/arranque/terminar", { saldos: [{ material: carton, kg: "500", origen: "contado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/precios", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar");
    const { cliente } = await jefe.bien(await ruta("clientes", "POST"), "POST", "/api/clientes", { nombre: "Fundidora del Norte" });

    const caja = await m.adentro("mostrador");
    const [abrir, agregar, dar, cambiar] = [
      await ruta("cuentas", "POST"), await ruta("cuentas/[cuenta]/materiales", "POST"), await ruta("cuentas/[cuenta]/precio-especial", "POST"), await ruta("clientes/[cliente]", "POST"),
    ];
    /** Una venta de cartón abierta, y el pedido de precio especial para su único material. */
    const venta = async (kg: string) => {
      const [cuenta, linea] = [randomUUID(), randomUUID()];
      const p = { parametros: { cuenta } };
      await caja.bien(abrir, "POST", "/api/cuentas", { id: cuenta, tipo: "venta", etiqueta: null });
      await caja.bien(agregar, "POST", `/api/cuentas/${cuenta}/materiales`, { linea, captura: randomUUID(), material: carton, bascula: 2, kg }, p);
      const pedir = (quien: { cliente: string | null; clienteNuevo: string | null }) => caja.pedir(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`,
        { id: randomUUID(), linea, visto: null, ...quien, diferencia: "-0.3", autoriza: m.personas.responsable, clave: CLAVES.responsable }, p);
      return { cuenta, p, pedir };
    };

    // Sin haber tenido nunca un precio, ya está en la lista y se le da.
    const primera = await venta("40");
    const dada = await primera.pedir({ cliente: cliente.id, clienteNuevo: null });
    assert.equal(dada.status, 200);
    const cuenta = (await dada.json()).cuenta;
    assert.deepEqual([cuenta.cliente, cuenta.materiales[0].precio], [{ id: cliente.id, nombre: "Fundidora del Norte" }, "2.2000"]);

    // Dado de baja: a otra cuenta ya no se le da, ni eligiéndolo ni escribiendo su nombre como si fuera nuevo.
    await jefe.bien(cambiar, "POST", `/api/clientes/${cliente.id}`, { activo: false }, { parametros: { cliente: cliente.id } });
    const segunda = await venta("10");
    const porNumero = await segunda.pedir({ cliente: cliente.id, clienteNuevo: null });
    assert.equal(porNumero.status, 409);
    assert.deepEqual((await porNumero.json()).error, { codigo: "RC005", mensaje: "Ese cliente no existe o está dado de baja" });
    const porNombre = await segunda.pedir({ cliente: null, clienteNuevo: "fundidora del norte" });
    assert.equal(porNombre.status, 409);
    assert.deepEqual((await porNombre.json()).error, {
      codigo: "RC005", mensaje: "«Fundidora del Norte» está dado de baja: lo reactiva un responsable en Ajustes, no se da de alta otro igual",
    });
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM cliente")).n, 1);

    // La cuenta que ya llevaba su precio —autorizado cuando el cliente estaba activo— se cobra como estaba.
    const cobrada = await caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", `/api/cuentas/${primera.cuenta}/confirmar`, { revision: cuenta.revision }, primera.p);
    assert.equal(cobrada.cuenta.estado, "confirmada");
    assert.deepEqual([cobrada.cuenta.cliente.nombre, cobrada.cuenta.resumen.total], ["Fundidora del Norte", "88"]);

    // Reactivado, se le vuelve a dar.
    await jefe.bien(cambiar, "POST", `/api/clientes/${cliente.id}`, { activo: true }, { parametros: { cliente: cliente.id } });
    assert.equal((await segunda.pedir({ cliente: cliente.id, clienteNuevo: null })).status, 200);
  });
});

test("bitácora: el alta, la baja y la reactivación se dicen con el nombre del cliente, y nada más", () =>
  conApp(async (app, _db, e, base) => {
    const { bitacora } = await import("../src/servidor/dominio/bitacora.ts");
    const bd = crearBd(await urlApp(base));
    try {
      const c = await alta(app, e.responsable);
      const ultimo = async () => (await bitacora(bd, { cuantos: 1 })).asientos[0]!;
      assert.equal((await ultimo()).que, "dio de alta al cliente Fundidora del Norte");
      await cambio(app, e.responsable, c.id, false);
      assert.equal((await ultimo()).que, "dio de baja al cliente Fundidora del Norte");
      await cambio(app, e.responsable, c.id, true);
      const r = await ultimo();
      assert.equal(r.que, "reactivó al cliente Fundidora del Norte");
      assert.equal(r.quien, "Servando");
      assert.deepEqual(Object.keys(r).sort(), ["accion", "entidad", "fecha", "hora", "id", "que", "quien"]);
    } finally { await bd.cerrar(); }
  }));

// ── los nombres ─────────────────────────────────────────────────────────────
//
// Lo encontró la revisión de Codex del 13 de octubre (docs/revisiones): la regla de nombres de la
// 0025 solo recortaba espacios comunes. Un nombre de puros caracteres que no se ven daba un cliente
// invisible; «Ana Paz» con un espacio duro, o «José» con el acento escrito aparte, daban un segundo
// cliente igual a la vista; y en el mostrador, un blanco raro al principio daba un nombre en blanco
// o un error crudo de la base. Ahora hay una sola regla, para los ajustes, el mostrador y la consola.

test("nombres: lo que se ve igual es el mismo cliente —blancos de cualquier clase, la misma letra escrita de dos maneras, lo invisible metido en medio—, y lo que no se ve no es un nombre", () =>
  conBase(async (db) => {
    const q = await usuario(db, "Dueño", "responsable");
    const limpio = async (t: string | null) => (await una(db, "SELECT nombre_de_cliente($1) AS n", [t])).n;
    assert.equal(await limpio("Ana\u00A0Paz"), "Ana Paz");
    assert.equal(await limpio("\u2003Empresa\u2003del\u3000Norte\u00A0"), "Empresa del Norte");
    assert.equal(await limpio("Jose\u0301"), "Jos\u00E9");
    assert.equal(await limpio("Do\u200Bn\uFEFF Chuy\u200D"), "Don Chuy");
    assert.equal(await limpio("  Don   Chuy "), "Don Chuy");
    for (const nada of ["", "   ", "\u200B", "\u200B\u00A0\u2003", "\uFEFF\u2060", " \u00AD ", null]) assert.equal(await limpio(nada), null, JSON.stringify(nada));
    // Las 80 letras se cuentan sobre lo que queda.
    assert.equal((await limpio("\u200B" + "X".repeat(80) + "\u00A0")).length, 80);

    await alta(db, q, "Ana Paz");
    await falla(alta(db, q, "Ana\u00A0Paz"), "Ya hay un cliente que se llama «Ana Paz»");
    await falla(alta(db, q, "ana\u2003\u200Bpaz"), "Ya hay un cliente que se llama «Ana Paz»");
    assert.equal((await alta(db, q, "JOSE\u0301")).nombre, "JOS\u00C9");
    await falla(alta(db, q, "Jos\u00E9"), "Ya hay un cliente que se llama «JOS\u00C9»");
    await falla(alta(db, q, "\u200B"), "Falta el nombre del cliente");
    await falla(alta(db, q, "\u2003\u00A0"), "Falta el nombre del cliente");
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM cliente")).n, 2);

    // Y la tabla no guarda lo que la regla no deja, lo escriba quien lo escriba.
    for (const malo of [" ", "\u200B", "Ana\u00A0Paz2", "Jose\u0301 Luis", " Con espacio", "Dos  espacios"]) {
      await rechaza(db.query("INSERT INTO cliente (nombre) VALUES ($1)", [malo]), "23514");
    }
  }));

test("nombres, en el mostrador: un cliente nuevo hecho de puros blancos no es nadie, y el que trae blancos raros alrededor queda limpio; ya no hay nombre en blanco ni error crudo de la base", async () => {
  const { conMundo, ruta, CLAVES } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const carton = await material(m.db, "Cartón");
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/arranque/terminar", { saldos: [{ material: carton, kg: "500", origen: "contado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/precios", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar");
    const caja = await m.adentro("mostrador");
    const [cuenta, linea] = [randomUUID(), randomUUID()];
    const p = { parametros: { cuenta } };
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: cuenta, tipo: "compra", etiqueta: null });
    await caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", `/api/cuentas/${cuenta}/materiales`, { linea, captura: randomUUID(), material: carton, bascula: 2, kg: "100" }, p);
    const dar = await ruta("cuentas/[cuenta]/precio-especial", "POST");
    const pedir = (clienteNuevo: string) => caja.pedir(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`,
      { id: randomUUID(), linea, visto: null, cliente: null, clienteNuevo, diferencia: "0.5", autoriza: m.personas.responsable, clave: CLAVES.responsable }, p);

    for (const nadie of ["\u2003", "\u200B", "\u00A0\u200B\u2003"]) {
      const r = await pedir(nadie);
      assert.equal(r.status, 409, JSON.stringify(nadie));
      assert.deepEqual((await r.json()).error, { codigo: "RC005", mensaje: "El precio especial es para un cliente: uno de la lista, o uno nuevo con su nombre" });
    }
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM cliente")).n, 0);
    // Rechazado antes de mirar la clave: no gastó ningún intento de quien autoriza.
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM precio_especial")).n, 0);

    const dada = await pedir("\u2003Empresa\u200B del\u00A0Norte ");
    assert.equal(dada.status, 200);
    assert.equal((await dada.json()).cuenta.cliente.nombre, "Empresa del Norte");
    assert.deepEqual((await m.db.query("SELECT nombre FROM cliente")).rows, [{ nombre: "Empresa del Norte" }]);
  });
});

const DESDE_LA_0033 = ["0033_clientes_en_pantalla.sql", "0034_nombres_de_cliente_sin_resquicios.sql"];

test("al migrar, los clientes que ya existían pasan por la regla nueva: se limpian; al que quedaría sin nombre o igual a otro se le pone uno que dice cuál es; ninguno se pierde, y la tabla ya no admite los de antes", () =>
  conBaseVacia(async (base) => {
    const MIGRACIONES = fileURLToPath(new URL("../db/migraciones", import.meta.url));
    const antes = await mkdtemp(join(tmpdir(), "antes-de-0033-"));
    const db = await conectar(base);
    try {
      await cp(MIGRACIONES, antes, { recursive: true });
      for (const nueva of DESDE_LA_0033) await rm(join(antes, nueva));
      await migrar(db, antes);
      // Todos estos los dejaba pasar la regla de la 0025.
      const viejos = ["Don Chuy", " ", "Ana\u00A0Paz", "Ana Paz", "\u200B", "Jose\u0301", "\u200BDon\u200B Chuy"];
      for (const nombre of viejos) await db.query("INSERT INTO cliente (nombre) VALUES ($1)", [nombre]);
      await db.query("UPDATE cliente SET activo = false WHERE nombre = ' '");

      assert.deepEqual(await migrar(db), DESDE_LA_0033);
      assert.deepEqual((await db.query("SELECT id::int, nombre, activo FROM cliente ORDER BY id")).rows, [
        { id: 1, nombre: "Don Chuy", activo: true },
        { id: 2, nombre: "Cliente sin nombre (2)", activo: false },
        { id: 3, nombre: "Ana Paz (3)", activo: true },
        { id: 4, nombre: "Ana Paz", activo: true },
        { id: 5, nombre: "Cliente sin nombre (5)", activo: true },
        { id: 6, nombre: "Jos\u00E9", activo: true },
        { id: 7, nombre: "Don Chuy (7)", activo: true },
      ]);
      for (const nombre of viejos.slice(1)) await rechaza(db.query("INSERT INTO cliente (nombre) VALUES ($1)", [nombre + "\u200B x"]), "23514");
    } finally {
      await db.end();
      await rm(antes, { recursive: true, force: true });
    }
  }));

// ── los nombres, sin resquicios ─────────────────────────────────────────────
//
// La revisión de seguridad del guardado 1f6f489 señaló que la regla de la 0033 todavía dejaba
// hacerse pasar por otro cliente. Comprobado: quitaba lo invisible DESPUÉS de juntar las letras
// con sus acentos, así que un invisible metido entre la «e» y su acento dejaba una «é» escrita en
// dos piezas —distinta para la base, igual a la vista, y que la propia tabla rechazaba con un
// error crudo—; no conocía lo invisible de fuera del plano básico (selectores de variación,
// etiquetas), ni los caracteres de control, ni el blanco braille. La 0034 lo cierra.

const DISFRACES: Array<[string, string]> = [
  ["Jose\u034F\u0301", "Jos\u00E9"],                  // un invisible entre la «e» y su acento
  ["Jose\u200B\u0301", "Jos\u00E9"],
  ["Don Chuy\u{E0100}", "Don Chuy"],                   // selector de variación del plano 14
  ["Don\u{E0041}\u{E007F} Chuy", "Don Chuy"],          // etiquetas
  ["\u{1D173}Don Chuy\uFFF9", "Don Chuy"],             // marcas de formato
  ["Don\u2800Chuy", "Don Chuy"],                       // blanco braille
  ["Don\u0001 Chu\u009Fy", "Don Chuy"],                // caracteres de control
  ["\u0085Don\u0085\u0085Chuy\u0085", "Don Chuy"],     // el salto de línea de otros sistemas
];

test("nombres, sin resquicios: ningún disfraz hace un nombre distinto —ni un invisible entre una letra y su acento, ni los de fuera del plano básico, ni los de control, ni el blanco braille—, y la regla aplicada dos veces da lo mismo", () =>
  conBase(async (db) => {
    const q = await usuario(db, "Dueño", "responsable");
    const limpio = async (t: string) => (await una(db, "SELECT nombre_de_cliente($1) AS n", [t])).n as string | null;
    for (const [disfraz, nombre] of DISFRACES) {
      const una = await limpio(disfraz);
      assert.equal(una, nombre, JSON.stringify(disfraz));
      assert.equal(await limpio(una!), una, `estable: ${JSON.stringify(disfraz)}`);
    }
    for (const nada of ["\u{E0100}", "\u2800", "\u0001\u{E0020}", "\u034F"]) assert.equal(await limpio(nada), null, JSON.stringify(nada));

    await alta(db, q, "Jos\u00E9");
    await alta(db, q, "Don Chuy");
    for (const [disfraz, nombre] of DISFRACES) await falla(alta(db, q, disfraz), `Ya hay un cliente que se llama «${nombre}»`);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM cliente")).n, 2);
    // Ni escribiendo directo en la tabla.
    for (const [disfraz] of DISFRACES) await rechaza(db.query("INSERT INTO cliente (nombre) VALUES ($1)", [disfraz + " 2"]), "23514");
  }));

test("nombres, sin resquicios, en el mostrador: el disfraz de un cliente que ya existe es ese cliente, no uno nuevo", async () => {
  const { conMundo, ruta, CLAVES } = await import("./mundo.ts");
  await conMundo(async (m) => {
    const carton = await material(m.db, "Cartón");
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/arranque/terminar", { saldos: [{ material: carton, kg: "500", origen: "contado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/precios", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar");
    const { cliente } = await jefe.bien(await ruta("clientes", "POST"), "POST", "/api/clientes", { nombre: "Jos\u00E9" });
    const caja = await m.adentro("mostrador");
    const [cuenta, linea] = [randomUUID(), randomUUID()];
    const p = { parametros: { cuenta } };
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: cuenta, tipo: "compra", etiqueta: null });
    await caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", `/api/cuentas/${cuenta}/materiales`, { linea, captura: randomUUID(), material: carton, bascula: 2, kg: "100" }, p);
    const dada = await caja.pedir(await ruta("cuentas/[cuenta]/precio-especial", "POST"), "POST", `/api/cuentas/${cuenta}/precio-especial`,
      { id: randomUUID(), linea, visto: null, cliente: null, clienteNuevo: "Jose\u034F\u0301\u{E0100}", diferencia: "0.5", autoriza: m.personas.responsable, clave: CLAVES.responsable }, p);
    assert.equal(dada.status, 200);
    assert.deepEqual((await dada.json()).cuenta.cliente, { id: cliente.id, nombre: "Jos\u00E9" });
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM cliente")).n, 1);
  });
});

test("al migrar a la 0034, los clientes que la 0033 dejó pasar con un disfraz se limpian, y el que quedaría igual a otro lleva su número", () =>
  conBaseVacia(async (base) => {
    const MIGRACIONES = fileURLToPath(new URL("../db/migraciones", import.meta.url));
    const antes = await mkdtemp(join(tmpdir(), "antes-de-0034-"));
    const db = await conectar(base);
    try {
      await cp(MIGRACIONES, antes, { recursive: true });
      await rm(join(antes, "0034_nombres_de_cliente_sin_resquicios.sql"));
      await migrar(db, antes);
      // Todos estos pasaban la regla de la 0033.
      for (const nombre of ["Don Chuy", "Don Chuy\u{E0100}", "Don\u2800Chuy", "Taller\u0001 L\u00F3pez", "\u{E0041}"]) await db.query("INSERT INTO cliente (nombre) VALUES ($1)", [nombre]);

      assert.deepEqual(await migrar(db), ["0034_nombres_de_cliente_sin_resquicios.sql"]);
      assert.deepEqual((await db.query("SELECT id::int, nombre FROM cliente ORDER BY id")).rows, [
        { id: 1, nombre: "Don Chuy" },
        { id: 2, nombre: "Don Chuy (2)" },
        { id: 3, nombre: "Don Chuy (3)" },
        { id: 4, nombre: "Taller L\u00F3pez" },
        { id: 5, nombre: "Cliente sin nombre (5)" },
      ]);
      await rechaza(db.query("INSERT INTO cliente (nombre) VALUES ($1)", ["Otro\u{E0100}"]), "23514");
    } finally {
      await db.end();
      await rm(antes, { recursive: true, force: true });
    }
  }));
