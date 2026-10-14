// El mostrador, con las medidas de patio: se usa con guantes y al sol. En cada paso —material,
// báscula, el peso con y sin recipiente, la cuenta, su nombre, el recipiente puesto después, el
// precio especial y su hoja de autorizar— todo lo que se toca mide
// 60 px o más y está separado de lo de junto, el texto se lee, y nada se sale de lado. En pantalla
// ancha y en dos teléfonos.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { baseNueva, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, en el mostrador todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await diaListo(g, [["Cartón", "500"]]);
    await contarImpresiones(page);
    await darDeAltaEquipo(page);
    await entrar(page, g.luis);
    // Se mide con la página arriba: en un teléfono las cuentas se quedan fijas al bajar, y lo que pasa por
    // debajo de ellas —que para eso se desplaza— no cuenta como encimado.
    const medir = async (donde: string): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page), donde).toEqual([]);
    };

    await expect(page.getByRole("button", { name: "+ Compra" })).toBeVisible();
    await medir("sin cuentas abiertas");
    await page.getByRole("button", { name: "+ Compra" }).click();
    await expect(page.locator(".grid")).toBeVisible();
    await medir("el paso del material");
    await page.getByRole("button", { name: "Fierro", exact: true }).click();
    await medir("el paso del material, en otra familia");
    await page.getByRole("button", { name: "Frecuentes", exact: true }).click();
    await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
    await expect(page.getByText("Toca la báscula donde está")).toBeVisible();
    await medir("el paso de la báscula");
    await page.getByRole("button", { name: /^Báscula 2/ }).click();
    await medir("el peso, sin teclear");
    await teclear(page, "100.5");
    await medir("el peso, tecleado");
    await page.getByRole("button", { name: "¿Viene en algo? Costal, carretilla…" }).click();
    await teclear(page, "0.5");
    await medir("el peso, con recipiente");
    await page.getByRole("button", { name: "No viene en nada" }).click();
    await page.getByRole("button", { name: /^(Agregar a la cuenta|Guardar peso)/ }).click();
    await expect(page.getByText(/^En esta cuenta/)).toBeVisible();
    await medir("la cuenta, con un material");
    await page.getByRole("button", { name: "Recipiente de Cartón" }).click();
    await teclear(page, "0.5");
    await medir("el recipiente, puesto desde la cuenta");
    await page.getByRole("button", { name: "Regresar a la cuenta" }).click();
    await page.getByRole("button", { name: /^Cambiarle el nombre a/ }).click();
    await page.getByLabel("Cómo se llama esta cuenta").fill("Don Chuy, el de la camioneta roja");
    await medir("el nombre de la cuenta, cambiándolo");
    await page.getByRole("button", { name: "Guardar el nombre" }).click();
    await expect(page.getByRole("heading", { name: "Don Chuy, el de la camioneta roja" })).toBeVisible();
    await medir("la cuenta, con su nombre");

    // El precio especial, y su hoja.
    await page.getByRole("button", { name: "Precio especial para Cartón" }).click();
    await medir("el precio especial, sin llenar");
    await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
    await page.getByLabel("Nombre del cliente nuevo").fill("Recicladora del Norte de Monterrey");
    await teclear(page, "0.5");
    await medir("el precio especial, lleno");
    await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja.getByText("¿Quién autoriza?")).toBeVisible();
    expect(await loQueNoMide(page, "dialog"), "la hoja de autorizar, al elegir quién").toEqual([]);
    await hoja.getByRole("button", { name: /^Servando/ }).click();
    expect(await loQueNoMide(page, "dialog"), "la hoja de autorizar, con el teclado").toEqual([]);
    await teclear(page, g.servando.clave);
    await hoja.getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
    await expect(page.locator(".especial")).toBeVisible();
    await medir("la cuenta, con precio especial");

    // Una segunda cuenta, de venta, y un vehículo que espera su segunda pesada: los dos grupos de cuentas.
    await page.getByRole("button", { name: "+ Venta" }).click();
    await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
    await page.getByRole("button", { name: /^Báscula 1/ }).click();
    await teclear(page, "5200");
    await page.getByRole("button", { name: /^(Agregar a la cuenta|Guardar peso)/ }).click();
    await expect(page.getByText(/^En esta cuenta/)).toBeVisible();
    await medir("una cuenta que espera la segunda pesada, con otra abierta");
    await page.getByRole("button", { name: /^Pesar / }).click();
    await medir("la segunda pesada");
  });
}

// Para verlo: el mostrador y el inventario en oscuro y con «más contraste». Solo cuando se piden capturas.
for (const [modo, medios] of [["oscuro", { colorScheme: "dark" }], ["contraste", { contrast: "more" }]] as const) {
  test(`capturas del mostrador en ${modo}`, async ({ page }) => {
    test.skip(process.env.CAPTURAS !== "1", "solo cuando se piden capturas");
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.emulateMedia(medios);
    const g = await gente();
    await diaListo(g, [["Cartón", "500"]]);
    await contarImpresiones(page);
    await darDeAltaEquipo(page);
    await entrar(page, g.luis);
    const foto = async (nombre: string): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `recorrido/capturas/rediseno/3-${nombre}-${modo}.png` });
    };
    await page.getByRole("button", { name: "+ Compra" }).click();
    await expect(page.locator(".grid")).toBeVisible();
    await foto("material");
    await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
    await page.getByRole("button", { name: /^Báscula 2/ }).click();
    await teclear(page, "100.5");
    await foto("peso");
    await page.getByRole("button", { name: /^(Agregar a la cuenta|Guardar peso)/ }).click();
    await expect(page.getByText(/^En esta cuenta/)).toBeVisible();
    await foto("cuenta");
    await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Inventario" }).click();
    await expect(page.getByRole("heading", { name: "Lo que hay en el patio" })).toBeVisible();
    await foto("inventario");
  });
}
