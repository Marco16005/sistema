// Las demás pantallas de adentro —el comprobante en pantalla, inventario, precios, cierre y
// arranque—, con las medidas de patio: lo que se toca mide 60 px o más y está separado de lo de
// junto, el texto se lee, y nada se sale de lado. En pantalla ancha y en dos teléfonos.
import { expect, test } from "@playwright/test";
import { baseNueva, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, pesar } from "./apoyo.ts";

test.beforeEach(baseNueva);

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, en el comprobante, inventario, precios y cierre todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await diaListo(g, [["Cartón", "500"]]);
    await contarImpresiones(page);
    await darDeAltaEquipo(page);
    await entrar(page, g.luis);
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };
    const pantallas = page.getByRole("navigation", { name: "Pantallas" });

    // Una compra terminada: su comprobante en pantalla. El papel mismo no se mide: es papel, con su letra.
    await page.getByRole("button", { name: "+ Compra" }).click();
    await pesar(page, "Cartón", "Báscula 2", "30");
    await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
    await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
    await medir("el comprobante en pantalla", 'header.barra, nav[aria-label="Pantallas"], .rail, .main button, .main header');

    await pantallas.getByRole("link", { name: "Inventario" }).click();
    await expect(page.getByRole("heading", { name: "Lo que hay en el patio" })).toBeVisible();
    await medir("inventario: lo que hay");
    await page.getByRole("button", { name: "Contar", exact: true }).click();
    await expect(page.locator(".grid")).toBeVisible();
    await medir("inventario: contar, qué material");
    await page.getByRole("button", { name: "Papel", exact: true }).click();
    await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
    await expect(page.locator(".teclado")).toBeVisible();
    await medir("inventario: contar, cuántos kilos");

    await pantallas.getByRole("link", { name: "Precios" }).click();
    await expect(page.getByText("Cartón").first()).toBeVisible();
    await medir("precios");

    await pantallas.getByRole("link", { name: "Cierre" }).click();
    await expect(page.getByRole("heading", { name: "Dinero del día" })).toBeVisible();
    await medir("cierre");
  });

  test(`a ${ancho}×${alto}, en los precios, como los ve quien los pone, y en los movimientos de un material, todo mide lo que debe`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await diaListo(g, [["Cartón", "500"]]);
    await darDeAltaEquipo(page);
    await entrar(page, g.servando);
    const medir = async (donde: string): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page), donde).toEqual([]);
    };
    const pantallas = page.getByRole("navigation", { name: "Pantallas" });
    await pantallas.getByRole("link", { name: "Precios" }).click();
    await expect(page.getByText("Cartón").first()).toBeVisible();
    await medir("precios, del responsable");
    await pantallas.getByRole("link", { name: "Inventario" }).click();
    await page.getByRole("button", { name: /^Cartón/ }).click();
    await expect(page.getByRole("button", { name: /existencias|Regresar/i }).first()).toBeVisible();
    await medir("inventario: los movimientos de un material");
  });

  test(`a ${ancho}×${alto}, en el arranque todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await darDeAltaEquipo(page);
    await entrar(page, g.servando);
    const medir = async (donde: string): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page), donde).toEqual([]);
    };
    await medir("sin el día listo");
    await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Arranque" }).click();
    await expect(page.getByRole("heading", { name: "Lo que ya hay en el patio" })).toBeVisible();
    await medir("el arranque, vacío");
    await page.locator(".saldorow input").first().fill("212.75");
    await medir("el arranque, con un material capturado");
  });
}
