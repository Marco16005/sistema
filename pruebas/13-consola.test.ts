// La consola de administración: el primer arranque, y dar de alta y de baja personas y equipos.
// Corre con las credenciales de administración, que la aplicación nunca tiene.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { comoApp, conBase, contar, rechaza, una } from "./apoyo.ts";
import {
  altaDePersona, arranque, bajaDeCliente, bajaDeEquipo, bajaDePersona, cambiarClave, codigoDeEquipo, listaDeClientes, listaDeEquipos, listaDePersonas,
  reactivarCliente, renombrarCliente,
} from "../consola/acciones.ts";

const huellaDe = (secreto: string) => createHash("sha256").update(secreto).digest("hex");

/** Con el código da de alta un equipo y entra esa persona: devuelve la sesión, o nada. */
async function entrarCon(app: pg.Client, codigo: string, persona: string, clave: string): Promise<string | null> {
  const huella = huellaDe(randomUUID());
  assert.ok((await una(app, "SELECT canjear_codigo($1, $2) AS equipo", [codigo, huella])).equipo, "el código no sirvió");
  return (await una(app, "SELECT entrar($1, $2, $3) AS sesion", [huella, persona, clave])).sesion;
}

const conConsola = (prueba: (db: pg.Client, app: pg.Client) => Promise<void>) =>
  conBase(async (db, base) => {
    const app = await comoApp(base);
    try {
      await prueba(db, app);
    } finally {
      await app.end();
    }
  });

test("el primer arranque deja un responsable que autoriza y un código para el primer equipo", () =>
  conConsola(async (db, app) => {
    const r = await arranque(db, { responsable: "Servando", equipo: "Mostrador" });
    assert.ok(r.persona && r.codigo);
    assert.equal(r.persona.nombre, "Servando");
    assert.match(r.persona.clave, /^[0-9]{6}$/);
    const u = await una(db, "SELECT * FROM usuario WHERE id = $1", [r.persona.id]);
    assert.equal(u.rol, "responsable");
    assert.equal(u.puede_autorizar, true);
    assert.ok(await entrarCon(app, r.codigo, r.persona.id, r.persona.clave));
  }));

test("arrancar de nuevo no duplica personas, no cambia claves ni reparte otro código", () =>
  conConsola(async (db, app) => {
    const primero = await arranque(db, { responsable: "Servando", equipo: "Mostrador" });
    assert.ok(await entrarCon(app, primero.codigo!, primero.persona!.id, primero.persona!.clave));
    const huella = (await una(db, "SELECT huella FROM credencial")).huella;

    const segundo = await arranque(db, { responsable: "Servando", equipo: "Mostrador" });
    assert.deepEqual(segundo, { persona: null, codigo: null });
    assert.equal(await contar(db, "usuario"), 1);
    assert.equal(await contar(db, "codigo_alta"), 1);
    assert.equal((await una(db, "SELECT huella FROM credencial")).huella, huella);
  }));

test("si ya hay responsable pero ningún equipo, el arranque solo reparte un código", () =>
  conConsola(async (db) => {
    const primero = await arranque(db, { responsable: "Servando", equipo: "Mostrador" });
    // El código no se canjeó: al arrancar de nuevo se da otro.
    const segundo = await arranque(db, { responsable: "Servando", equipo: "Mostrador" });
    assert.equal(segundo.persona, null);
    assert.ok(segundo.codigo);
    assert.notEqual(segundo.codigo, primero.codigo);
    assert.equal(await contar(db, "usuario"), 1);
  }));

test("la clave que se genera tiene el largo que pide el rol, y con ella se entra", () =>
  conConsola(async (db, app) => {
    const luis = await altaDePersona(db, { nombre: "Luis", rol: "mostrador" });
    const servando = await altaDePersona(db, { nombre: "Servando", rol: "responsable", autoriza: true });
    assert.match(luis.clave, /^[0-9]{4}$/);
    assert.match(servando.clave, /^[0-9]{6}$/);
    assert.ok(await entrarCon(app, await codigoDeEquipo(db, "Mostrador"), luis.id, luis.clave));
    assert.ok(await entrarCon(app, await codigoDeEquipo(db, "Oficina"), servando.id, servando.clave));
  }));

test("las claves generadas no se repiten como costumbre", () =>
  conConsola(async (db) => {
    const claves = new Set<string>();
    for (let k = 0; k < 12; k++) claves.add((await altaDePersona(db, { nombre: `Persona ${k}`, rol: "responsable" })).clave);
    assert.ok(claves.size >= 11, `solo ${claves.size} claves distintas en 12`);
  }));

test("se puede dar de alta con una clave elegida, si cumple", () =>
  conConsola(async (db, app) => {
    const luis = await altaDePersona(db, { nombre: "Luis", rol: "mostrador", clave: "4815" });
    assert.equal(luis.clave, "4815");
    assert.ok(await entrarCon(app, await codigoDeEquipo(db, "Mostrador"), luis.id, "4815"));
    await rechaza(altaDePersona(db, { nombre: "Beto", rol: "patio", clave: "1234" }), "RC005");
    await rechaza(altaDePersona(db, { nombre: "Servando", rol: "responsable", clave: "4815" }), "RC005");
    assert.equal(await contar(db, "usuario"), 1);
  }));

test("cambiar la clave de alguien, por su nombre o por su número", () =>
  conConsola(async (db, app) => {
    const luis = await altaDePersona(db, { nombre: "Luis", rol: "mostrador", clave: "4815" });
    const nueva = await cambiarClave(db, "luis");
    assert.match(nueva.clave, /^[0-9]{4}$/);
    assert.equal(nueva.id, luis.id);
    const elegida = await cambiarClave(db, luis.id, "2718");
    assert.equal(elegida.clave, "2718");
    assert.ok(await entrarCon(app, await codigoDeEquipo(db, "Mostrador"), luis.id, "2718"));
    await assert.rejects(cambiarClave(db, "Nadie"), /No hay ninguna persona/);
  }));

test("dar de baja a una persona, y verla en la lista", () =>
  conConsola(async (db) => {
    const luis = await altaDePersona(db, { nombre: "Luis", rol: "mostrador" });
    await altaDePersona(db, { nombre: "Servando", rol: "responsable", autoriza: true });
    await bajaDePersona(db, "Luis");
    assert.deepEqual(await listaDePersonas(db), [
      { id: luis.id, nombre: "Luis", rol: "mostrador", autoriza: false, activa: false, bloqueada: false },
      { id: String(Number(luis.id) + 1), nombre: "Servando", rol: "responsable", autoriza: true, activa: true, bloqueada: false },
    ]);
    await assert.rejects(bajaDePersona(db, "Luis"), /No hay ninguna persona/);
  }));

test("los equipos se ven en la lista con quién atiende, y se dan de baja", () =>
  conConsola(async (db, app) => {
    const luis = await altaDePersona(db, { nombre: "Luis", rol: "mostrador", clave: "4815" });
    assert.ok(await entrarCon(app, await codigoDeEquipo(db, "Mostrador"), luis.id, "4815"));
    const lista = await listaDeEquipos(db);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.nombre, "Mostrador");
    assert.equal(lista[0]!.vigente, true);
    assert.equal(lista[0]!.atiende, "Luis");
    await bajaDeEquipo(db, lista[0]!.id);
    const despues = await listaDeEquipos(db);
    assert.equal(despues[0]!.vigente, false);
    assert.equal(despues[0]!.atiende, null);
    await rechaza(bajaDeEquipo(db, lista[0]!.id), "RC005");
  }));

// ── clientes con precio especial ───────────────────────────────────────────
//
// Un cliente se da de alta en la pantalla, al darle su primer precio especial y con la clave de un
// dueño. Lo demás —corregirle el nombre, darlo de baja, reactivarlo— es de la consola.

test("los clientes se ven en la lista, se renombran, se dan de baja y se reactivan, por su número o por su nombre", () =>
  conConsola(async (db) => {
    const quien = (await una(db, "SELECT * FROM alta_persona('Servando', 'responsable', true, '481516')")).id;
    const alta = async (nombre: string): Promise<string> => (await una(db, "INSERT INTO cliente (nombre, creado_por) VALUES ($1, $2) RETURNING id", [nombre, quien])).id;
    const [chuy, mari] = [await alta("Don Chuy"), await alta("Doña Mari")];
    assert.deepEqual(await listaDeClientes(db), [
      { id: chuy, nombre: "Don Chuy", activo: true, preciosDados: 0 },
      { id: mari, nombre: "Doña Mari", activo: true, preciosDados: 0 },
    ]);

    assert.deepEqual(await renombrarCliente(db, "don chuy", "  Jesús   Pérez "), { id: chuy, nombre: "Jesús Pérez" });
    assert.deepEqual(await renombrarCliente(db, chuy, "Jesús Pérez Soto"), { id: chuy, nombre: "Jesús Pérez Soto" });
    await assert.rejects(renombrarCliente(db, chuy, "DOÑA MARI"), /Ya hay un cliente/);
    await assert.rejects(renombrarCliente(db, "Nadie", "Alguien"), /No hay ningún cliente/);

    assert.deepEqual(await bajaDeCliente(db, "Doña Mari"), { id: mari, nombre: "Doña Mari" });
    assert.equal((await listaDeClientes(db))[1]!.activo, false);
    // Dado de baja se le encuentra por su número, o por su nombre al reactivarlo.
    assert.deepEqual(await reactivarCliente(db, "doña mari"), { id: mari, nombre: "Doña Mari" });
    assert.equal((await listaDeClientes(db))[1]!.activo, true);
    await rechaza(db.query("SELECT baja_de_cliente(999999)"), "RC005");
  }));
