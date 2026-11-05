// Las cabeceras de seguridad como las recibe el navegador, y que con ellas todo funciona: ninguna
// pantalla pierde un script ni un estilo por la política de contenido. Las pidió la revisión de
// seguridad de Codex del 5 de noviembre (R40-02, R40-03, R40-04). Lo que dicen, en pruebas/60-cabeceras.
import { expect, test, type Page } from "@playwright/test";
import { adentro, baseNueva, darDeAltaEquipo, diaListo, gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

// Lo que el navegador niega por la política de contenido, desde que se abre cada página. (Lo que
// Playwright pone antes de la página no pasa por la política: así se escucha desde el principio.)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).negado = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as any).negado.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
});
const negado = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).negado);
/** Que React ya tomó la página: corrieron los scripts que la política deja correr. */
const tomada = (page: Page): Promise<boolean> =>
  page.evaluate(() => Object.keys(document.querySelector(".wrap") ?? {}).some((k) => k.startsWith("__reactFiber")));
const nonceDe = (politica: string | undefined): string | undefined => /'nonce-([A-Za-z0-9+/=]+)'/.exec(politica ?? "")?.[1];

const PANTALLAS = [
  "/mostrador", "/inventario", "/precios", "/cierre",
  "/panel", "/panel/ajustes", "/panel/bitacora", "/panel/clientes", "/panel/dias", "/panel/fiado",
  "/panel/ganancia", "/panel/gastos", "/panel/materiales", "/panel/precios", "/panel/reportes",
];

test("cada pantalla llega con su política y un nonce nuevo, se arma completa, y el navegador no le niega nada", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  const nonces = new Set<string>();
  const revisar = async (camino: string, r: Awaited<ReturnType<Page["goto"]>>) => {
    expect(r?.ok(), camino).toBe(true);
    const nonce = nonceDe(r!.headers()["content-security-policy"]);
    expect(nonce, `${camino} llegó sin nonce`).toBeTruthy();
    nonces.add(nonce!);
    expect(r!.headers()["x-content-type-options"], camino).toBe("nosniff");
    await expect.poll(() => tomada(page), { message: `${camino}: no corrieron sus scripts` }).toBe(true);
    expect(await negado(page), camino).toEqual([]);
  };
  // La de entrada, sin sesión.
  await revisar("/", await page.goto("/"));
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  for (const camino of PANTALLAS) await revisar(camino, await page.goto(camino));
  expect(nonces.size, "se repitió un nonce").toBe(PANTALLAS.length + 1);
});

test("cada script que escribe la página lleva el nonce de su respuesta", async ({ page }) => {
  const r = await page.request.get("/");
  const nonce = nonceDe(r.headers()["content-security-policy"]);
  expect(nonce).toBeTruthy();
  const scripts = [...(await r.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s).toContain(`nonce="${nonce}"`);
});

test("un nombre con HTML que alguien lograra colar en la página no ejecuta nada: el navegador lo niega", async ({ page }) => {
  // También en una página que no existe, aunque su ruta empiece como la de la API (Codex, R41-01).
  for (const camino of ["/", "/no-existe", "/apicualquiera"]) {
    await page.goto(camino);
    await page.waitForLoadState("load");
    if (camino === "/") await expect.poll(() => tomada(page)).toBe(true);
    expect(await negado(page), camino).toEqual([]);
    // Como llegaría un XSS guardado: HTML con un manejador en línea, metido por el analizador.
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<img src="/no-existe.png" onerror="window.colado = true">`));
    await expect.poll(() => negado(page), { message: camino }).toContainEqual(expect.stringMatching(/^script-src/));
    expect(await page.evaluate(() => (window as any).colado), camino).toBeUndefined();
  }
});

// La regla de qué es una página dejaba fuera todo lo que empezara con «api», «favicon.ico» o
// «_next/image», y lo pedido por adelantado: salían como HTML sin política (verificación de Codex
// del 5 de noviembre, R41-01).
test("ninguna página sale sin su política: tampoco las que no existen ni lo pedido por adelantado, y la política que diga quien pide no cuenta", async ({ page }) => {
  const elegida = { "content-security-policy": "script-src 'nonce-elegido'" };
  const casos: Array<[string, Record<string, string>]> = [
    ["/no-existe", {}], ["/apicualquiera", {}], ["/favicon.ico", {}], ["/favicon.ico/no-existe", {}], ["/_next/imagenes", {}],
    ["/", { purpose: "prefetch" }], ["/", { "sec-purpose": "prefetch" }], ["/", { "next-router-prefetch": "1" }],
    ["/", elegida], ["/", { purpose: "prefetch", ...elegida }], ["/no-existe", elegida],
  ];
  for (const [camino, cabeceras] of casos) {
    const dicho = `${camino} ${JSON.stringify(cabeceras)}`;
    const r = await page.request.get(camino, { headers: cabeceras });
    expect(r.headers()["content-type"], dicho).toContain("text/html");
    const nonce = nonceDe(r.headers()["content-security-policy"]);
    expect(nonce, `${dicho} llegó sin nonce`).toBeTruthy();
    expect(nonce, dicho).not.toBe("elegido");
    const scripts = [...(await r.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length, dicho).toBeGreaterThan(0);
    for (const s of scripts) expect(s, dicho).toContain(`nonce="${nonce}"`);
  }
  // Bajo /api lo que no existe lleva la política de la API, que no deja correr nada.
  for (const camino of ["/api", "/api/no-existe"]) {
    const r = await page.request.get(camino, { headers: elegida });
    expect(r.headers()["content-security-policy"], camino).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  }
});

test("lo de la API no se guarda en ningún caché, no es una página y no se adivina su tipo", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  // Sin sesión y con sesión (datos de quien entró).
  for (const camino of ["/api/salud", "/api/sesion", "/api/fiado"]) {
    const r = await page.request.get(camino);
    expect(r.status(), camino).toBe(200);
    const h = r.headers();
    expect({ cache: h["cache-control"], tipo: h["x-content-type-options"], politica: h["content-security-policy"], marco: h["x-frame-options"] }, camino).toEqual({
      cache: "private, no-store",
      tipo: "nosniff",
      politica: "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      marco: "DENY",
    });
  }
});
