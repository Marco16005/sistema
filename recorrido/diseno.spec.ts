// Las piezas del diseño nuevo, y lo que prometen. Aquí la hoja: lo que interrumpe —autorizar—
// tapa lo demás. Se prueba donde vive, autorizando la reapertura del día.
//
// La hoja no decide nada: se muestra porque su dueño lo dice, y cerrarla nunca suelta un envío.
import { expect, test, type Page } from "@playwright/test";
import { baseNueva, cerrarConCorte, conConsola, darDeAltaEquipo, diaListo, entrar, gente, teclear } from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const hoja = (page: Page) => page.getByRole("dialog", { name: "Reabrir el día" });
const REABRIR = /\/api\/jornada\/reabrir$/;

/** El día de hoy, cerrado, y la hoja de reabrirlo a la vista. */
async function conLaHoja(page: Page): Promise<Gente> {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Cierre" }).click();
  await cerrarConCorte(page, g.servando);
  await page.getByRole("button", { name: "Reabrir el día" }).click();
  await expect(hoja(page)).toBeVisible();
  return g;
}

/** ¿Dónde está el foco? Dentro de la hoja, en la página sin nada elegido, o fuera en algo de atrás. */
const foco = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return "en nada";
    return a.closest("dialog.hoja") ? "en la hoja" : "atrás";
  });

const reaperturas = () => conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM reapertura")).rows[0].n as number);

test("la hoja tapa lo demás: lo de atrás queda inerte y no se desplaza, y el foco no sale de ella", async ({ page }) => {
  await conLaHoja(page);
  // Es un diálogo de los que el navegador pone encima de todo, no uno pintado a mano.
  expect(await hoja(page).evaluate((d) => d.matches(":modal"))).toBe(true);
  expect(await foco(page)).toBe("en la hoja");

  // El tabulador da la vuelta por dentro, hacia adelante y hacia atrás.
  for (let k = 0; k < 14; k++) {
    await page.keyboard.press(k % 5 === 4 ? "Shift+Tab" : "Tab");
    expect(await foco(page), `después de ${k + 1} tabuladores`).not.toBe("atrás");
  }

  // Lo de atrás no se puede tocar: el enlace del mostrador está ahí, pero un toque encima no lleva a ningún lado.
  const enlace = await page.getByRole("link", { name: "Mostrador", includeHidden: true }).boundingBox();
  await page.mouse.click(enlace!.x + enlace!.width / 2, enlace!.y + enlace!.height / 2);
  await expect(page).toHaveURL(/\/cierre$/);
  await expect(hoja(page)).toBeVisible();
  // Ni se desplaza mientras la hoja está abierta.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe("hidden");
});

test("lo que se toca en la hoja mide 60 px o más, y en una pantalla angosta la hoja sube desde abajo", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await conLaHoja(page);
  const medidas = async (): Promise<string[]> =>
    hoja(page).evaluate((d) =>
      Array.from(d.querySelectorAll<HTMLElement>("button")).filter((b) => b.offsetParent !== null)
        .map((b) => ({ que: (b.textContent ?? "").trim(), alto: b.getBoundingClientRect().height, ancho: b.getBoundingClientRect().width }))
        .filter((b) => b.alto < 59.5 || b.ancho < 59.5).map((b) => `${b.que}: ${Math.round(b.ancho)}×${Math.round(b.alto)}`));
  expect(await medidas(), "al elegir quién autoriza").toEqual([]);
  await page.getByRole("button", { name: /^Servando/ }).click();
  expect(await medidas(), "al teclear la clave").toEqual([]);

  // Pegada abajo y de orilla a orilla.
  const caja = await hoja(page).boundingBox();
  expect(Math.abs(caja!.y + caja!.height - 800)).toBeLessThan(1);
  expect(Math.abs(caja!.width - 420)).toBeLessThan(1);
  expect(caja!.x).toBeLessThan(1);
});

test("libre, Escape la cierra y el foco vuelve a la página; en pantalla ancha va al centro", async ({ page }) => {
  await conLaHoja(page);
  const caja = await hoja(page).boundingBox();
  const ancho = page.viewportSize()!.width;
  expect(Math.abs(caja!.x + caja!.width / 2 - ancho / 2)).toBeLessThan(2);      // al centro
  await page.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, "48");
  await page.keyboard.press("Escape");
  await expect(hoja(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reabrir el día" })).toBeVisible();
  expect(await foco(page)).not.toBe("en la hoja");
  expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-regreso-del-foco") ?? false)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe("hidden");
  // Al volver a abrirla empieza de cero: la clave a medias no se quedó guardada.
  await page.getByRole("button", { name: "Reabrir el día" }).click();
  await expect(page.getByText("¿Quién autoriza?")).toBeVisible();
});

test("ocupada, o con un envío del que no se supo, la hoja no se cierra ni con Escape dos veces, y el envío sigue ahí", async ({ page }) => {
  const g = await conLaHoja(page);
  // La petición sale y se queda en camino hasta que se le dé paso; al dárselo, se asienta y su respuesta se pierde.
  let soltar!: () => void;
  const paso = new Promise<void>((listo) => { soltar = listo; });
  let ya = false;
  await page.route(REABRIR, async (ruta) => {
    if (ya) return ruta.fallback();
    ya = true;
    await paso;
    await ruta.fetch();
    await ruta.abort();
  });
  await page.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await page.getByRole("button", { name: "Reabrir a nombre de Servando" }).click();

  // Ocupada: en camino.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(hoja(page)).toBeVisible();
  const guardado = await page.evaluate(() => JSON.parse(sessionStorage.getItem("feruga.cierre") ?? "null")?.reapertura?.id as string | undefined);
  expect(guardado).toBeTruthy();

  // No se supo.
  soltar();
  await expect(page.getByText("No se supo si el día se reabrió.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(hoja(page)).toBeVisible();
  expect(await hoja(page).evaluate((d) => d.matches(":modal"))).toBe(true);
  expect(await foco(page)).not.toBe("atrás");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("feruga.cierre") ?? "null")?.reapertura?.id)).toBe(guardado);

  // Y se resuelve como siempre: ese mismo envío, una sola reapertura.
  await teclear(page, g.servando.clave);
  await page.getByRole("button", { name: "Reabrir a nombre de Servando" }).click();
  await expect(page.locator(".okmsg")).toContainText("El día quedó abierto otra vez");
  await expect(hoja(page)).toHaveCount(0);
  expect(await reaperturas()).toBe(1);
});

test("con menos movimiento la hoja no se desplaza al aparecer; y vista como la ve la impresora, no sale", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await conLaHoja(page);
  expect(await hoja(page).evaluate((d) => getComputedStyle(d).animationName)).toBe("none");
  await page.emulateMedia({ media: "print" });
  await expect(hoja(page)).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(hoja(page)).toBeVisible();             // no se cerró para imprimir
});

test("con movimiento, la hoja sube al aparecer", async ({ page }) => {
  await conLaHoja(page);
  expect(await hoja(page).evaluate((d) => getComputedStyle(d).animationName)).toBe("hoja-sube");
});

// Lo que Codex dejó reproducido en su registro cuando se le acabó la cuota (novena pasada): la hoja
// volvía a mostrarse, pero con el foco en su primer control y no en el que lo tenía.
test("si el navegador cierra la hoja por su cuenta, reaparece con el foco donde estaba; y cuando la cierra su dueño, la página queda libre", async ({ page }) => {
  await conLaHoja(page);
  await page.getByRole("button", { name: /^Servando/ }).click();
  const tecla = page.locator(".teclado").getByRole("button", { name: "8", exact: true });
  await tecla.focus();
  await expect(tecla).toBeFocused();
  // Lo que algunos navegadores hacen al segundo Escape, pase lo que pase: cerrarla sin preguntar.
  await hoja(page).evaluate((d) => (d as HTMLDialogElement).close());
  await expect.poll(() => hoja(page).evaluate((d) => d.matches(":modal"))).toBe(true);
  await expect(tecla).toBeFocused();
  // Otra vez, ahora desde otro control: no se queda con el de la primera vez.
  const otra = page.getByRole("button", { name: "Autoriza otra persona" });
  await otra.focus();
  await hoja(page).evaluate((d) => (d as HTMLDialogElement).close());
  await expect.poll(() => hoja(page).evaluate((d) => d.matches(":modal"))).toBe(true);
  await expect(otra).toBeFocused();

  // Libre: Escape la cierra, nada queda encima y lo de atrás se puede usar.
  await page.keyboard.press("Escape");
  await expect(hoja(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector(":modal") !== null)).toBe(false);
  await page.getByRole("link", { name: "Mostrador" }).click();
  await expect(page).toHaveURL(/\/mostrador$/);
});
