// La sesión en el servidor: qué pide cada ruta antes de dejar pasar, y las rutas con que un equipo
// se da de alta y una persona entra y sale. Las rutas se llaman como funciones, con peticiones
// armadas aquí; la cookie va y viene por los encabezados, como en el navegador.
import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { conBase, contar, una, urlApp } from "./apoyo.ts";
import { POST as altaDeEquipo } from "../src/app/api/equipo/alta/route.ts";
import { GET as personas } from "../src/app/api/personas/route.ts";
import { GET as salud } from "../src/app/api/salud/route.ts";
import { GET as sesion } from "../src/app/api/sesion/route.ts";
import { POST as entrar } from "../src/app/api/sesion/entrar/route.ts";
import { POST as salir } from "../src/app/api/sesion/salir/route.ts";
import { crearBd, usarBd } from "../src/servidor/bd.ts";
import { ErrorDeNegocio } from "../src/servidor/errores.ts";
import { ErrorDeForma } from "../src/servidor/numeros.ts";
import { ruta } from "../src/servidor/ruta.ts";

import { Navegador } from "./navegador.ts";

interface Mundo {
  db: pg.Client;
  servando: string;
  luis: string;
  beto: string;
  ana: string;
  /** Un navegador en un equipo ya dado de alta. */
  equipo(): Promise<Navegador>;
  /** Un navegador con esa persona ya adentro. */
  adentro(persona: string, clave: string): Promise<Navegador>;
}

const conMundo = (prueba: (m: Mundo) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 4 });
    usarBd(bd);
    try {
      const alta = async (nombre: string, rol: string, clave: string, autoriza = false): Promise<string> => {
        return (await una(db, "SELECT * FROM alta_persona($1, $2, $3, $4)", [nombre, rol, autoriza, clave])).id as string;
      };
      const m: Mundo = {
        db,
        servando: await alta("Servando", "responsable", "481516", true),
        luis: await alta("Luis", "mostrador", "4815"),
        beto: await alta("Beto", "patio", "2718"),
        ana: await alta("Ana", "consulta", "3141"),
        async equipo() {
          const n = new Navegador();
          const codigo = (await una(db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
          const r = await n.pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo });
          assert.equal(r.status, 200);
          return n;
        },
        async adentro(persona, clave) {
          const n = await m.equipo();
          const r = await n.pedir(entrar, "POST", "/api/sesion/entrar", { persona, clave });
          assert.equal(r.status, 200);
          n.persona = persona;
          return n;
        },
      };
      await prueba(m);
    } finally {
      usarBd(null);
      await bd.cerrar();
    }
  });

const error = async (r: Response) => (await r.json()).error as { codigo: string; mensaje: string };

// Rutas de mentira, para probar la puerta sin depender de lo que hay detrás.
const abierta = ruta({ acceso: "publico" }, async () => ({ bien: true }));
const deEquipo = ruta({ acceso: "equipo" }, async ({ persona }) => ({ persona: persona?.nombre ?? null }));
const deCualquiera = ruta({}, async ({ persona }) => ({ id: persona.id, nombre: persona.nombre, rol: persona.rol }));
const deMostrador = ruta({ roles: ["mostrador", "responsable"] }, async ({ persona, cuerpo }) => ({ quien: persona.id, cuerpo }));
const deResponsable = ruta({ roles: ["responsable"] }, async () => ({ bien: true }));

// ── la puerta ──────────────────────────────────────────────────────────────

test("una ruta pública responde sin equipo ni persona", () =>
  conMundo(async () => {
    const r = await new Navegador().pedir(abierta, "GET", "/api/x");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { bien: true });
  }));

test("sin equipo dado de alta no se pasa", () =>
  conMundo(async () => {
    for (const manejador of [deEquipo, deCualquiera, deMostrador]) {
      const r = await new Navegador().pedir(manejador, "GET", "/api/x");
      assert.equal(r.status, 401);
      assert.equal((await error(r)).codigo, "EQUIPO");
    }
  }));

test("una cookie alterada o inventada no vale", () =>
  conMundo(async (m) => {
    const bueno = await m.adentro(m.luis, "4815");
    for (const mala of [bueno.cookie.slice(0, -4) + "AAAA", "feruga=cualquier-cosa", "feruga=", "otra=" + bueno.cookie.split("=")[1]]) {
      const n = new Navegador();
      n.cookie = mala;
      const r = await n.pedir(deCualquiera, "GET", "/api/x");
      assert.equal(r.status, 401, `pasó con ${mala.slice(0, 24)}…`);
      assert.equal((await error(r)).codigo, "EQUIPO");
    }
  }));

test("la cookie no deja ver el secreto del equipo ni la sesión", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    const valor = n.cookie.split("=")[1]!;
    assert.match(valor, /^Fe26\.2\*/);
    const sesionId = (await una(m.db, "SELECT id FROM sesion WHERE cerrada_en IS NULL")).id as string;
    assert.ok(!valor.includes(sesionId));
  }));

test("con equipo pero sin persona, las rutas de trabajo piden entrar", () =>
  conMundo(async (m) => {
    const n = await m.equipo();
    assert.deepEqual(await (await n.pedir(deEquipo, "GET", "/api/x")).json(), { persona: null });
    const r = await n.pedir(deCualquiera, "GET", "/api/x");
    assert.equal(r.status, 401);
    assert.equal((await error(r)).codigo, "SESION");
  }));

test("la persona que recibe la ruta es la de la sesión", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    assert.deepEqual(await (await n.pedir(deCualquiera, "GET", "/api/x")).json(), { id: m.luis, nombre: "Luis", rol: "mostrador" });
  }));

test("una persona en el cuerpo de la petición no cambia quién actúa", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    const r = await n.pedir(deMostrador, "POST", "/api/x", { persona: m.servando, usuario: m.servando, p_usuario: m.servando });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).quien, m.luis);
  }));

test("cada ruta deja pasar solo a los roles que nombra", () =>
  conMundo(async (m) => {
    const esperado: Array<[string, string, number, number]> = [
      [m.servando, "481516", 200, 200],
      [m.luis, "4815", 200, 403],
      [m.beto, "2718", 403, 403],
      [m.ana, "3141", 403, 403],
    ];
    for (const [persona, clave, enMostrador, enResponsable] of esperado) {
      const n = await m.adentro(persona, clave);
      const a = await n.pedir(deMostrador, "POST", "/api/x", {});
      assert.equal(a.status, enMostrador);
      if (enMostrador === 403) assert.equal((await error(a)).codigo, "ROL");
      assert.equal((await n.pedir(deResponsable, "GET", "/api/x")).status, enResponsable);
    }
  }));

test("una petición que escribe y viene de otro origen se rechaza", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    for (const origen of ["http://otro.sitio", "https://mostrador.test", "http://mostrador.test:8080", "null", null]) {
      const r = await n.pedir(deMostrador, "POST", "/api/x", {}, { origen });
      assert.equal(r.status, 403, `pasó desde ${origen}`);
      assert.equal((await error(r)).codigo, "ORIGEN");
    }
    // Leer no escribe nada: no lleva origen y pasa.
    assert.equal((await n.pedir(deCualquiera, "GET", "/api/x")).status, 200);
  }));

test("una petición que escribe trae un objeto JSON, o no pasa", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    for (const crudo of ["{no es json", "[1, 2]", "\"texto\"", "12", "null"]) {
      const r = await n.pedir(deMostrador, "POST", "/api/x", undefined, { crudo });
      assert.equal(r.status, 400, `pasó con ${crudo}`);
      assert.equal((await error(r)).codigo, "FORMA");
    }
    const formulario = await n.pedir(deMostrador, "POST", "/api/x", undefined, { crudo: "a=1", tipo: "application/x-www-form-urlencoded" });
    assert.equal(formulario.status, 400);
    const sinTipo = await n.pedir(deMostrador, "POST", "/api/x", {}, { tipo: null });
    assert.equal(sinTipo.status, 400);
  }));

test("la pestaña que cree que atiende otra persona no escribe", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    for (const persona of [m.servando, null]) {
      const r = await n.pedir(deMostrador, "POST", "/api/x", {}, { persona });
      assert.equal(r.status, 409);
      assert.equal((await error(r)).codigo, "PERSONA");
    }
    assert.equal((await n.pedir(deMostrador, "POST", "/api/x", {})).status, 200);
  }));

test("la sesión vencida responde como si no hubiera entrado, y el equipo sigue dado de alta", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    await m.db.query("UPDATE sesion SET vista_en = now() - interval '31 minutes'");
    const r = await n.pedir(deCualquiera, "GET", "/api/x");
    assert.equal(r.status, 401);
    assert.equal((await error(r)).codigo, "SESION");
    assert.deepEqual(await (await n.pedir(deEquipo, "GET", "/api/x")).json(), { persona: null });
  }));

test("los plazos de la sesión salen de la configuración", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    await m.db.query("UPDATE sesion SET vista_en = now() - interval '6 minutes'");
    process.env.SESION_INACTIVIDAD_MIN = "5";
    try {
      assert.equal((await n.pedir(deCualquiera, "GET", "/api/x")).status, 401);
    } finally {
      delete process.env.SESION_INACTIVIDAD_MIN;
    }
  }));

test("un equipo dado de baja deja de pasar", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    await m.db.query("SELECT baja_equipo(id) FROM equipo");
    const r = await n.pedir(deEquipo, "GET", "/api/x");
    assert.equal(r.status, 401);
    assert.equal((await error(r)).codigo, "EQUIPO");
  }));

// ── cómo salen los errores ─────────────────────────────────────────────────

test("una regla del negocio sale con su código y su mensaje", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    const conRegla = ruta({}, async () => {
      throw new ErrorDeNegocio("RC002", "No hay Cartón suficiente: hay 10 kg");
    });
    const r = await n.pedir(conRegla, "GET", "/api/x");
    assert.equal(r.status, 409);
    assert.deepEqual(await error(r), { codigo: "RC002", mensaje: "No hay Cartón suficiente: hay 10 kg" });
  }));

test("lo que la base niega por rol sale como falta de permiso", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    const publicar = ruta({}, async ({ bd, persona }) => {
      await bd.enTransaccion(persona.id, (c) => c.query("SELECT publicar_lista_de_hoy($1)", [persona.id]));
      return {};
    });
    const r = await n.pedir(publicar, "GET", "/api/x");
    assert.equal(r.status, 403);
    assert.equal((await error(r)).codigo, "RC008");
  }));

test("un dato mal formado sale como error de forma, con su mensaje", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    const conForma = ruta({}, async () => {
      throw new ErrorDeForma("El peso se escribe en kilos");
    });
    const r = await n.pedir(conForma, "GET", "/api/x");
    assert.equal(r.status, 400);
    assert.deepEqual(await error(r), { codigo: "FORMA", mensaje: "El peso se escribe en kilos" });
  }));

test("una falla inesperada no cuenta nada de lo que pasó adentro", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    const rota = ruta({}, async ({ bd }) => {
      await bd.leer("SELECT * FROM tabla_que_no_existe");
      return {};
    });
    const callado = console.error;
    console.error = () => {};
    try {
      const r = await n.pedir(rota, "GET", "/api/x");
      assert.equal(r.status, 500);
      const texto = await r.text();
      assert.equal(JSON.parse(texto).error.codigo, "INTERNO");
      assert.doesNotMatch(texto, /tabla_que_no_existe|relation|42P01|SELECT/);
    } finally {
      console.error = callado;
    }
  }));

// ── dar de alta el equipo ──────────────────────────────────────────────────

test("el código de alta deja al equipo con su cookie", () =>
  conMundo(async (m) => {
    const n = new Navegador();
    const codigo = (await una(m.db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
    const r = await n.pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo });
    assert.equal(r.status, 200);
    const puesta = r.headers.get("set-cookie")!;
    assert.match(puesta, /^feruga=Fe26\.2\*/);
    assert.match(puesta, /; HttpOnly/i);
    assert.match(puesta, /; SameSite=Strict/i);
    assert.match(puesta, /; Path=\//i);
    assert.match(puesta, /; Max-Age=\d{7,}/i);
    assert.doesNotMatch(puesta, /; Secure/i);
    assert.equal(await contar(m.db, "equipo"), 1);
    assert.equal((await n.pedir(sesion, "GET", "/api/sesion")).status, 200);
  }));

test("con HTTPS la cookie solo viaja cifrada", () =>
  conMundo(async (m) => {
    process.env.COOKIE_SEGURA = "1";
    try {
      const codigo = (await una(m.db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
      const r = await new Navegador().pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo });
      assert.match(r.headers.get("set-cookie")!, /; Secure/i);
    } finally {
      delete process.env.COOKIE_SEGURA;
    }
  }));

test("un código que no sirve no da de alta nada ni deja cookie", () =>
  conMundo(async (m) => {
    const codigo = (await una(m.db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
    assert.equal((await new Navegador().pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo })).status, 200);
    for (const malo of [codigo, "AAAAAAAAAA", ""]) {
      const n = new Navegador();
      const r = await n.pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo: malo });
      assert.equal(r.status, 409);
      assert.equal((await error(r)).codigo, "CODIGO");
      assert.equal(r.headers.get("set-cookie"), null);
    }
    for (const sinForma of [{}, { codigo: 12 }, { codigo: null }, { codigo: "x".repeat(200) }]) {
      assert.equal((await new Navegador().pedir(altaDeEquipo, "POST", "/api/equipo/alta", sinForma)).status, 400);
    }
    assert.equal(await contar(m.db, "equipo"), 1);
  }));

test("dar de alta el equipo también exige el origen", () =>
  conMundo(async (m) => {
    const codigo = (await una(m.db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
    const r = await new Navegador().pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo }, { origen: "http://otro.sitio" });
    assert.equal(r.status, 403);
    assert.equal(await contar(m.db, "equipo"), 0);
  }));

// ── entrar y salir ─────────────────────────────────────────────────────────

test("la lista de personas para entrar pide equipo, y no trae a quien está de baja", () =>
  conMundo(async (m) => {
    assert.equal((await new Navegador().pedir(personas, "GET", "/api/personas")).status, 401);
    await m.db.query("SELECT baja_persona($1)", [m.ana]);
    const n = await m.equipo();
    const r = await n.pedir(personas, "GET", "/api/personas");
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).personas, [
      { id: m.beto, nombre: "Beto", rol: "patio", haceCorte: false },
      { id: m.luis, nombre: "Luis", rol: "mostrador", haceCorte: false },
      { id: m.servando, nombre: "Servando", rol: "responsable", haceCorte: true },
    ]);
  }));

test("con su clave la persona entra, y la sesión lo dice", () =>
  conMundo(async (m) => {
    const n = await m.equipo();
    assert.deepEqual(await (await n.pedir(sesion, "GET", "/api/sesion")).json(), { persona: null });
    const r = await n.pedir(entrar, "POST", "/api/sesion/entrar", { persona: m.servando, clave: "481516" });
    assert.equal(r.status, 200);
    const persona = { id: m.servando, nombre: "Servando", rol: "responsable", puedeAutorizar: true };
    assert.deepEqual(await r.json(), { persona });
    assert.deepEqual(await (await n.pedir(sesion, "GET", "/api/sesion")).json(), { persona });
  }));

test("no entrar se ve igual sea cual sea la razón", () =>
  conMundo(async (m) => {
    const n = await m.equipo();
    await m.db.query("SELECT baja_persona($1)", [m.ana]);
    const respuestas = [];
    for (const cuerpo of [
      { persona: m.luis, clave: "0000" },
      { persona: m.ana, clave: "3141" },
      { persona: "999999", clave: "4815" },
    ]) {
      const r = await n.pedir(entrar, "POST", "/api/sesion/entrar", cuerpo);
      assert.equal(r.status, 401);
      respuestas.push(await r.text());
    }
    assert.equal(new Set(respuestas).size, 1);
    assert.equal(JSON.parse(respuestas[0]!).error.codigo, "CLAVE");
    assert.equal(await contar(m.db, "sesion"), 0);
    for (const sinForma of [{}, { persona: m.luis }, { clave: "4815" }, { persona: 1.5, clave: "4815" }, { persona: -3, clave: "4815" },
      { persona: m.luis, clave: 4815 }, { persona: "abc", clave: "4815" }, { persona: [m.luis], clave: "4815" }]) {
      assert.equal((await n.pedir(entrar, "POST", "/api/sesion/entrar", sinForma)).status, 400);
    }
  }));

test("los fallos quedan contados aunque la respuesta sea un rechazo", () =>
  conMundo(async (m) => {
    const n = await m.equipo();
    for (let k = 0; k < 5; k++) {
      assert.equal((await n.pedir(entrar, "POST", "/api/sesion/entrar", { persona: m.luis, clave: "0000" })).status, 401);
    }
    assert.equal((await n.pedir(entrar, "POST", "/api/sesion/entrar", { persona: m.luis, clave: "4815" })).status, 401);
    assert.ok((await una(m.db, "SELECT bloqueada_hasta FROM credencial WHERE usuario_id = $1", [m.luis])).bloqueada_hasta);
  }));

test("sin equipo no se puede ni intentar una clave", () =>
  conMundo(async (m) => {
    const r = await new Navegador().pedir(entrar, "POST", "/api/sesion/entrar", { persona: m.luis, clave: "0000" });
    assert.equal(r.status, 401);
    assert.equal((await error(r)).codigo, "EQUIPO");
    assert.equal((await una(m.db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [m.luis])).fallos, 0);
  }));

test("salir deja al equipo dado de alta y sin persona", () =>
  conMundo(async (m) => {
    const n = await m.adentro(m.luis, "4815");
    assert.equal((await n.pedir(salir, "POST", "/api/sesion/salir")).status, 200);
    assert.deepEqual(await (await n.pedir(sesion, "GET", "/api/sesion")).json(), { persona: null });
    assert.equal(await contar(m.db, "sesion", "cerrada_en IS NULL"), 0);
    // Salir otra vez, ya sin persona, no falla.
    assert.equal((await n.pedir(salir, "POST", "/api/sesion/salir", {}, { persona: null })).status, 200);
  }));

test("cuando entra otra persona en el mismo equipo, la pestaña de la anterior ya no escribe", () =>
  conMundo(async (m) => {
    const pestanaDeLuis = await m.adentro(m.luis, "4815");
    // Otra pestaña del mismo navegador comparte la cookie.
    const otraPestana = new Navegador();
    otraPestana.cookie = pestanaDeLuis.cookie;
    assert.equal((await otraPestana.pedir(entrar, "POST", "/api/sesion/entrar", { persona: m.servando, clave: "481516" })).status, 200);
    pestanaDeLuis.cookie = otraPestana.cookie;

    const r = await pestanaDeLuis.pedir(deMostrador, "POST", "/api/x", {});
    assert.equal(r.status, 409);
    assert.equal((await error(r)).codigo, "PERSONA");
    assert.deepEqual((await (await pestanaDeLuis.pedir(sesion, "GET", "/api/sesion")).json()).persona.nombre, "Servando");
  }));

test("«Salir» desde una pestaña que se quedó atrás no saca a quien atiende ahora", () =>
  conMundo(async (m) => {
    const pestanaDeLuis = await m.adentro(m.luis, "4815");
    const otraPestana = new Navegador();
    otraPestana.cookie = pestanaDeLuis.cookie;
    assert.equal((await otraPestana.pedir(entrar, "POST", "/api/sesion/entrar", { persona: m.servando, clave: "481516" })).status, 200);
    pestanaDeLuis.cookie = otraPestana.cookie;

    // La pestaña vieja cree que atiende Luis y toca «Salir».
    const r = await pestanaDeLuis.pedir(salir, "POST", "/api/sesion/salir");
    assert.equal(r.status, 409);
    assert.equal((await error(r)).codigo, "PERSONA");
    assert.equal((await (await otraPestana.pedir(sesion, "GET", "/api/sesion")).json()).persona.nombre, "Servando");
    assert.equal(await contar(m.db, "sesion", "cerrada_en IS NULL"), 1);
    // Sin decir quién cree ser, tampoco.
    assert.equal((await pestanaDeLuis.pedir(salir, "POST", "/api/sesion/salir", {}, { persona: null })).status, 409);
    // Quien sí atiende, sale.
    otraPestana.persona = m.servando;
    assert.equal((await otraPestana.pedir(salir, "POST", "/api/sesion/salir")).status, 200);
  }));

test("si la clave con que se sella la cookie falta o es corta, el alta no gasta el código", () =>
  conMundo(async (m) => {
    const codigo = (await una(m.db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
    const buena = process.env.SESION_CLAVE;
    const callado = console.error;
    console.error = () => {};
    try {
      for (const mala of [undefined, "corta"]) {
        if (mala === undefined) delete process.env.SESION_CLAVE;
        else process.env.SESION_CLAVE = mala;
        const r = await new Navegador().pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo });
        assert.equal(r.status, 500);
        assert.equal(await contar(m.db, "equipo"), 0);
        // Y la ruta de salud lo delata: así el contenedor no queda como sano.
        assert.equal((await salud()).status, 503);
      }
    } finally {
      process.env.SESION_CLAVE = buena;
      console.error = callado;
    }
    // Arreglada la configuración, el mismo código todavía sirve.
    assert.equal((await new Navegador().pedir(altaDeEquipo, "POST", "/api/equipo/alta", { codigo })).status, 200);
    assert.equal((await salud()).status, 200);
  }));
