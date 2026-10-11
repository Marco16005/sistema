// «Más contraste, para el sol». Es un interruptor manual, a un toque, en todas las pantallas —la de
// entrada incluida—, y se recuerda por equipo: salir de la sesión, cerrar el navegador o reiniciar
// no lo cambia. La tableta del patio se queda en contraste alto aunque cambie quién la usa.
import { expect, test, type Page } from "@playwright/test";
import { baseCaida, baseNueva, conConsola, darDeAltaEquipo, diaListo, entrar, gente, salir, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

const interruptor = (page: Page) => page.getByRole("switch", { name: "Más contraste" });
const CONTRASTE = /\/api\/equipo\/contraste$/;

/** Cómo se ve la página: lo que el interruptor dice, lo que la raíz lleva, y de qué color es el fondo. */
const comoSeVe = (page: Page) =>
  page.evaluate(() => ({
    raiz: document.documentElement.dataset.contraste ?? null,
    fondo: getComputedStyle(document.body).backgroundColor,
    vidrio: getComputedStyle(document.documentElement).getPropertyValue("--desenfoque").trim(),
  }));
const ALTO = { raiz: "alto", fondo: "rgb(255, 255, 255)", vidrio: "none" };

test("se activa con un toque, y sigue activo al salir de la sesión, al volver a entrar, al recargar y al abrir otra vez el navegador", async ({ page, context, browser }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).raiz).toBe(null);

  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);
  // Lo guardó el servidor, en una galleta que el código de la página no puede leer ni tocar.
  const galleta = (await context.cookies()).find((c) => c.name === "contraste");
  expect({ valor: galleta?.value, soloServidor: galleta?.httpOnly }).toEqual({ valor: "alto", soloServidor: true });
  // Dura: el servidor la pide por 400 días (pruebas/17-rutas.test.ts), y cada navegador guarda lo que su tope le
  // deja —Chromium, 400 días; el WebKit de estas pruebas, 365—. Un año, pues: si en un año nadie la toca, caduca.
  expect(galleta!.expires - Date.now() / 1000).toBeGreaterThan(60 * 60 * 24 * 364);
  expect(await page.evaluate(() => document.cookie)).not.toContain("contraste");

  // Salir no lo cambia: en la pantalla de entrada sigue, y el interruptor también está ahí.
  await salir(page);
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);
  await entrar(page, g.servando);
  expect(await comoSeVe(page)).toEqual(ALTO);
  // La página ya llega del servidor con el contraste puesto: no espera a que corra nada.
  const respuesta = await page.request.get("/");
  expect(await respuesta.text()).toMatch(/<html[^>]*data-contraste="alto"/);
  // Y como cada equipo recibe la suya, no se guarda en ninguna caché de paso.
  expect(respuesta.headers()["cache-control"] ?? "").toMatch(/no-store|private/);
  await page.reload();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);

  // Se cierra el navegador y se abre otro con lo que aquel guardó (una recarga no acredita esto; esto sí).
  const guardado = await context.storageState();
  const otro = await browser.newContext({ storageState: guardado, baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: false });
  try {
    const nueva = await otro.newPage();
    await nueva.goto("/");
    await expect(interruptor(nueva)).toHaveAttribute("aria-checked", "true");
    expect(await comoSeVe(nueva)).toEqual(ALTO);
  } finally {
    await otro.close();
  }

  // Se desactiva, y se queda desactivado.
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).raiz).toBe("normal");
  await page.reload();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).fondo).not.toBe("rgb(255, 255, 255)");
});

test("está en la pantalla de entrada, antes de que nadie entre y antes de dar de alta el equipo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dar de alta este equipo" })).toBeVisible();
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);
  await darDeAltaEquipo(page);
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);
  // Y mide lo que todo lo que se toca.
  const caja = await interruptor(page).boundingBox();
  expect(caja!.height).toBeGreaterThanOrEqual(59.5);
  expect(caja!.width).toBeGreaterThanOrEqual(59.5);
});

test("sin haber elegido, sigue lo que pida el equipo; «normal», elegido, le gana; y con el equipo en oscuro, más contraste es claro", async ({ page }) => {
  await page.emulateMedia({ contrast: "more", colorScheme: "dark" });
  await page.goto("/");
  // Nadie ha tocado nada: el equipo pide más contraste, y se le da; el interruptor lo dice.
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual({ ...ALTO, raiz: null });
  // Se elige «normal»: gana, aunque el equipo siga pidiendo contraste. Como el equipo está en oscuro, se ve oscuro.
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  const normal = await comoSeVe(page);
  expect(normal.raiz).toBe("normal");
  expect(normal.fondo).toBe("rgb(0, 0, 0)");
  expect(normal.vidrio).not.toBe("none");
  // Y si se elige «alto» en un equipo en oscuro, es claro igual.
  await interruptor(page).click();
  expect(await comoSeVe(page)).toEqual(ALTO);
  // El equipo deja de pedirlo: lo elegido se queda.
  await page.emulateMedia({ contrast: "no-preference", colorScheme: "dark" });
  await page.reload();
  expect(await comoSeVe(page)).toEqual(ALTO);
});

test("sin haber elegido, si el equipo cambia de parecer la pantalla y el interruptor lo siguen al momento, sin recargar", async ({ page }) => {
  await page.goto("/");
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => { (window as any).sigoAqui = true; });
  await page.emulateMedia({ contrast: "more" });
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual({ ...ALTO, raiz: null });
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).fondo).not.toBe("rgb(255, 255, 255)");
  expect(await page.evaluate(() => (window as any).sigoAqui === true)).toBe(true);
  // Nadie eligió nada: no se guardó ninguna galleta.
  expect((await page.context().cookies()).some((c) => c.name === "contraste")).toBe(false);
});

test("con el sistema en mantenimiento, y con la base caída, el interruptor sigue ahí, funciona y se recuerda", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  // En mantenimiento: a la base le aplicaron una versión que esta aplicación no conoce, y ninguna ruta atiende.
  await conConsola((db) => db.query("INSERT INTO migracion (archivo) VALUES ('9999_de_otra_version.sql')"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(page)).toEqual(ALTO);

  // Con la base caída: ya no existe. La página se arma igual, y el interruptor se puede regresar.
  await baseCaida();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).raiz).toBe("normal");
});

test("si no se pudo guardar, vuelve a como estaba y lo dice; y mientras guarda no admite otro toque", async ({ page }) => {
  await page.goto("/");
  // La red falla.
  await page.route(CONTRASTE, (ruta) => ruta.abort(), { times: 1 });
  await interruptor(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo guardar" })).toBeVisible();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).raiz).toBe(null);
  expect((await page.context().cookies()).some((c) => c.name === "contraste")).toBe(false);

  // Ahora la respuesta tarda: el segundo toque no cuenta, y queda como dice el primero.
  let soltar!: () => void;
  const paso = new Promise<void>((listo) => { soltar = listo; });
  const pedidas: string[] = [];
  await page.route(CONTRASTE, async (ruta) => {
    pedidas.push(ruta.request().postData() ?? "");
    await paso;
    await ruta.fallback();
  });
  await interruptor(page).click();
  await expect(interruptor(page)).toBeDisabled();
  await interruptor(page).click({ force: true, timeout: 1000 }).catch(() => {});
  soltar();
  await expect(interruptor(page)).toBeEnabled();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(pedidas).toEqual(['{"contraste":"alto"}']);
  expect(await comoSeVe(page)).toEqual(ALTO);
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo guardar" })).toHaveCount(0);
});

// Lo encontró Codex en su décima revisión: al fallar el guardado se quitaba lo elegido —y la pantalla volvía a seguir
// al equipo, que para entonces ya pedía más contraste—, pero el interruptor regresaba a «apagado»: decía una cosa y se
// veía otra, y el toque siguiente pedía lo que ya se veía.
test("si mientras se guarda el equipo cambia de parecer y el guardado falla, el interruptor dice lo que se ve", async ({ page }) => {
  await page.goto("/");
  let soltar!: () => void;
  const paso = new Promise<void>((listo) => { soltar = listo; });
  await page.route(CONTRASTE, async (ruta) => {
    await paso;
    await ruta.abort();
  }, { times: 1 });
  await interruptor(page).click();
  await expect(interruptor(page)).toBeDisabled();
  await page.emulateMedia({ contrast: "more" });
  soltar();
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo guardar" })).toBeVisible();
  expect(await comoSeVe(page)).toEqual({ ...ALTO, raiz: null });
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  // Y otro toque hace lo que dice: lo quita.
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).raiz).toBe("normal");
});

test("cambiarlo no recarga la página ni pierde una captura a medias; y otra pestaña lo ve al recargar", async ({ page, context }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "30.2");
  await expect(page.locator(".visor")).toContainText("30.2");
  const marca = await page.evaluate(() => { (window as any).sigoAqui = true; return sessionStorage.getItem("feruga.mostrador"); });
  // De aquí en adelante esta página no vuelve a cargarse: ni al tocar el interruptor, ni cuando termina de guardar.
  let cargas = 0;
  page.on("load", () => { cargas += 1; });

  const otra = await context.newPage();
  await otra.goto("/mostrador");
  await expect(interruptor(otra)).toHaveAttribute("aria-checked", "false");

  const guardado = page.waitForResponse(CONTRASTE);
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect((await guardado).status()).toBe(200);
  await expect(interruptor(page)).toBeEnabled();
  // La misma página, con lo tecleado donde estaba.
  expect(await page.evaluate(() => (window as any).sigoAqui === true)).toBe(true);
  await expect(page.locator(".visor")).toContainText("30.2");
  expect(await page.evaluate(() => sessionStorage.getItem("feruga.mostrador"))).toBe(marca);
  await page.getByRole("button", { name: /^Agregar a la cuenta/ }).click();
  await expect(page.getByText(/^En esta cuenta/)).toBeVisible();

  await otra.reload();
  await expect(interruptor(otra)).toHaveAttribute("aria-checked", "true");
  expect(await comoSeVe(otra)).toEqual(ALTO);
  // Y al final, con todo guardado y la captura ya agregada, la primera página sigue siendo la misma: no se
  // recargó en ningún momento. (Mirarlo solo al instante de tocar no basta: una recarga que llegara al
  // terminar de guardar pasaría, porque la captura a medias sobrevive a recargar.)
  expect(await page.evaluate(() => (window as any).sigoAqui === true)).toBe(true);
  expect(cargas).toBe(0);
});

// La otra pista de Codex en su novena pasada: el interruptor vive en varias pantallas (la barra, la de
// entrada), y si la pantalla cambia mientras se guarda, el que aparece es otro. Tiene que saber lo
// mismo que el que se fue: que se está guardando, y qué pasó al final.
test("si la pantalla cambia mientras se guarda, el interruptor que aparece sigue ocupado; y si no se pudo guardar, él también vuelve a como estaba y lo dice", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  // La petición de guardar sale y se queda en camino hasta que se le dé paso.
  let soltar!: (como: "falla" | "pasa") => void;
  const paso = new Promise<"falla" | "pasa">((listo) => { soltar = listo; });
  const pedidas: string[] = [];
  await page.route(CONTRASTE, async (ruta) => {
    pedidas.push(ruta.request().postData() ?? "");
    if ((await paso) === "falla") await ruta.abort();
    else await ruta.fallback();
  }, { times: 1 });
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  await expect(interruptor(page)).toBeDisabled();

  // Mientras tanto se sale de la sesión: la barra se va, y en la pantalla de entrada hay otro interruptor.
  await salir(page);
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  await expect(interruptor(page)).toBeDisabled();                    // sigue guardando: no admite otro toque
  await interruptor(page).click({ force: true, timeout: 1000 }).catch(() => {});
  expect(pedidas).toHaveLength(1);

  // No se pudo guardar: la pantalla vuelve a como estaba, y el interruptor que hay ahora lo dice.
  soltar("falla");
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo guardar" })).toBeVisible();
  await expect(interruptor(page)).toBeEnabled();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect((await comoSeVe(page)).raiz).toBe(null);
  expect((await page.context().cookies()).some((c) => c.name === "contraste")).toBe(false);

  // Y al volver a entrar, la barra dice lo mismo; el aviso ya no hace falta cuando el siguiente toque sí guarda.
  await entrar(page, g.luis);
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  await interruptor(page).click();
  await expect(interruptor(page)).toBeEnabled();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo guardar" })).toHaveCount(0);
  expect(await comoSeVe(page)).toEqual(ALTO);
});
