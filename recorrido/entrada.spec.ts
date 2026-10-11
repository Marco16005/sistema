// La entrada, por HTTP de verdad contra la aplicación en su contenedor: dar de alta el equipo,
// entrar, la sesión y salir. Sin navegador: lo que se prueba es el servidor tal como queda servido
// —cookies, origen y encabezados reales—, que las pruebas de rutas como funciones no ven.
import { expect, test } from "@playwright/test";
import { altaDePersona, baseNueva, codigoDeEquipo } from "./apoyo.ts";

test.beforeEach(baseNueva);

test("la aplicación está en pie", async ({ request }) => {
  const r = await request.get("/api/salud");
  expect(r.status()).toBe(200);
  // Lista, y abierta: lo mínimo, que es lo que la salud le dice a cualquiera.
  expect(await r.json()).toEqual({ bien: true, abierta: true });
});

test("un equipo sin dar de alta no pasa", async ({ request }) => {
  const r = await request.get("/api/sesion");
  expect(r.status()).toBe(401);
  expect((await r.json()).error.codigo).toBe("EQUIPO");
});

test("alta de equipo, entrar, sesión y salir", async ({ request, baseURL }) => {
  const servando = await altaDePersona("Servando", "responsable", "481516", true);
  const propio = { origin: baseURL! };

  const alta = await request.post("/api/equipo/alta", { data: { codigo: await codigoDeEquipo() }, headers: propio });
  expect(alta.status()).toBe(200);
  const cookie = alta.headers()["set-cookie"]!;
  expect(cookie).toMatch(/^feruga=Fe26\.2\*/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);

  expect((await (await request.get("/api/personas")).json()).personas).toEqual([{ id: servando.id, nombre: "Servando", rol: "responsable" }]);
  expect(await (await request.get("/api/sesion")).json()).toEqual({ persona: null });

  const mala = await request.post("/api/sesion/entrar", { data: { persona: servando.id, clave: "000000" }, headers: propio });
  expect(mala.status()).toBe(401);

  const entrar = await request.post("/api/sesion/entrar", { data: { persona: servando.id, clave: servando.clave }, headers: propio });
  expect(entrar.status()).toBe(200);
  const persona = { id: servando.id, nombre: "Servando", rol: "responsable", puedeAutorizar: true };
  expect(await (await request.get("/api/sesion")).json()).toEqual({ persona });
  expect((await (await request.get("/api/dia")).json()).dia.listo).toBe(false);

  // Salir, como cualquier acción que escribe, dice como quién cree estar actuando.
  const sinDecirQuien = await request.post("/api/sesion/salir", { data: {}, headers: propio });
  expect(sinDecirQuien.status()).toBe(409);
  const salir = await request.post("/api/sesion/salir", { data: {}, headers: { ...propio, "x-persona": servando.id } });
  expect(salir.status()).toBe(200);
  expect(await (await request.get("/api/sesion")).json()).toEqual({ persona: null });
  expect((await request.get("/api/dia")).status()).toBe(401);
});

test("una petición que escribe sin venir de la aplicación se rechaza, tal como llega a un servidor real", async ({ request }) => {
  const codigo = await codigoDeEquipo();
  const sinOrigen = await request.post("/api/equipo/alta", { data: { codigo } });
  expect(sinOrigen.status()).toBe(403);
  const deOtro = await request.post("/api/equipo/alta", { data: { codigo }, headers: { origin: "http://otro.sitio" } });
  expect(deOtro.status()).toBe(403);
  expect((await deOtro.json()).error.codigo).toBe("ORIGEN");
});

test("lo que la aplicación sirve no dice con qué está hecha", async ({ request }) => {
  const r = await request.get("/api/salud");
  expect(r.headers()["x-powered-by"]).toBeUndefined();
});
