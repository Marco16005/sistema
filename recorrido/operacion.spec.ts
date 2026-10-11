// La operación tal como queda servida: por HTTPS, detrás del proxy, con un certificado que el
// navegador valida. Sin banderas de origen seguro y sin ignorar errores de certificado. Lo corre
// el ensayo, contra el Compose de operación levantado con un dominio de mentira.
import { expect, test } from "@playwright/test";
import { conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar } from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

const DOMINIO = process.env.DOMINIO!;
let g: Gente;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  g = await gente();
  await diaListo(g);
});

test("por HTTP no se atiende: solo se redirige a HTTPS", async ({ request }) => {
  const r = await request.get(`http://${DOMINIO}/api/salud`, { maxRedirects: 0 });
  expect([301, 308]).toContain(r.status());
  expect(r.headers().location).toBe(`https://${DOMINIO}/api/salud`);
});

test("por HTTPS el sitio contesta con certificado válido, sus cabeceras, y el navegador lo trata como origen seguro", async ({ page, request }) => {
  const salud = await request.get("/api/salud");
  expect(salud.status()).toBe(200);
  expect(await salud.json()).toEqual({ bien: true, abierta: true });

  const respuesta = (await page.goto("/"))!;
  expect(respuesta.status()).toBe(200);
  // Que la página haya cargado ya dice que el navegador validó el certificado para este dominio
  // (no se ignoran sus errores). Aquí se ve además quién lo emitió y con qué protocolo.
  const seguridad = (await respuesta.securityDetails())!;
  expect(seguridad.issuer).toContain("Caddy Local Authority");
  expect(seguridad.protocol).toMatch(/^TLS 1\.[23]$/);
  const cabeceras = respuesta.headers();
  expect(cabeceras["strict-transport-security"]).toContain("max-age=31536000");
  expect(cabeceras["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(cabeceras["x-frame-options"]).toBe("DENY");
  // Lo que el navegador reserva a los orígenes seguros está disponible sin pedirlo con banderas.
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  expect(await page.evaluate(() => navigator.locks.request("ensayo", async () => "con candado"))).toBe("con candado");
});

test("los candados son entre pestañas: lo que una tiene tomado, la otra no lo consigue", async ({ context }) => {
  const [una, otra] = [await context.newPage(), await context.newPage()];
  await una.goto("/");
  await otra.goto("/");
  // La primera toma el candado y no lo suelta.
  await una.evaluate(() => {
    void navigator.locks.request("feruga.ensayo", () => new Promise(() => {}));
  });
  await expect.poll(() => una.evaluate(async () => (await navigator.locks.query()).held?.some((c) => c.name === "feruga.ensayo"))).toBe(true);
  // La segunda, si lo pide sin esperar, se queda sin él.
  expect(await otra.evaluate(() => navigator.locks.request("feruga.ensayo", { ifAvailable: true }, async (candado) => candado === null))).toBe(true);
  // Y al cerrarse la primera, la segunda lo consigue.
  await una.close();
  await expect.poll(() => otra.evaluate(() => navigator.locks.request("feruga.ensayo", { ifAvailable: true }, async (candado) => candado !== null))).toBe(true);
});

test("alta de equipo, entrada y una compra, con la cookie marcada como segura", async ({ page, context }) => {
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  const cookie = (await context.cookies()).find((c) => c.name === "feruga")!;
  expect({ segura: cookie.secure, soloHttp: cookie.httpOnly, mismoSitio: cookie.sameSite }).toEqual({ segura: true, soloHttp: true, mismoSitio: "Strict" });

  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30.2");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  const ticket = page.locator(".ticket");
  await expect(ticket).toContainText("COMPRA");
  const folio = await ticket.getAttribute("data-folio");
  expect(Number(folio)).toBeGreaterThan(0);
  // Quedó asentada en la base de la operación.
  expect(await conConsola(async (db) => (await db.query("SELECT estado FROM operacion WHERE folio = $1", [folio])).rows[0]?.estado)).toBe("confirmada");
});

test("una petición que escribe pasa si viene del sitio y se rechaza, sin efecto, si viene de otro", async ({ page, context }) => {
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const abiertas = (): Promise<number> =>
    conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM sesion WHERE usuario_id = $1 AND cerrada_en IS NULL", [g.luis.id])).rows[0].n);
  const antes = await abiertas();
  expect(antes).toBeGreaterThan(0);

  // Con la sesión y el cuerpo válidos, pero dicho desde otro sitio.
  const deOtro = await context.request.post("/api/sesion/salir", { data: {}, headers: { origin: "https://otro.test", "x-persona": g.luis.id } });
  expect(deOtro.status()).toBe(403);
  expect((await deOtro.json()).error.codigo).toBe("ORIGEN");
  expect(await abiertas()).toBe(antes);
  expect((await (await context.request.get("/api/sesion")).json()).persona?.id).toBe(g.luis.id);

  // La misma, desde el sitio.
  const propia = await context.request.post("/api/sesion/salir", { data: {}, headers: { origin: `https://${DOMINIO}`, "x-persona": g.luis.id } });
  expect(propia.status()).toBe(200);
  expect(await abiertas()).toBe(antes - 1);
});

test("si la base deja de ser la que la aplicación espera, por el proxy tampoco se atiende: ni con sesión válida se asienta nada", async ({ page, context }) => {
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const propio = { origin: `https://${DOMINIO}`, "x-persona": g.luis.id };
  const abrir = () => context.request.post("/api/cuentas", { data: { id: crypto.randomUUID(), tipo: "compra", etiqueta: null }, headers: propio });
  const cuentas = (): Promise<number> => conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM operacion")).rows[0].n);
  expect((await abrir()).status()).toBe(200);
  const antes = await cuentas();

  // Alguien le aplica a la base una migración que esta versión de la aplicación no conoce.
  await conConsola((db) => db.query("INSERT INTO migracion (archivo) VALUES ('9999_de_otra_version.sql')"));
  try {
    expect((await context.request.get("/api/salud")).status()).toBe(503);
    const negada = await abrir();
    expect(negada.status()).toBe(503);
    expect(await cuentas()).toBe(antes);
    // En la pantalla, lo mismo: no se puede abrir una compra.
    await page.reload();
    await expect(page.getByRole("button", { name: "+ Compra" })).toHaveCount(0);
  } finally {
    await conConsola((db) => db.query("DELETE FROM migracion WHERE archivo = '9999_de_otra_version.sql'"));
  }
  expect((await context.request.get("/api/salud")).status()).toBe(200);
  expect((await abrir()).status()).toBe(200);
});
