// Corregir una cuenta ya cobrada (respuesta 6 del negocio): se busca por su folio, se dice cuántos
// kilos eran de verdad, se liquida solo la diferencia y lo autoriza una persona facultada. El
// comprobante original no cambia; el cajón sí, si se liquidó en efectivo.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { baseNueva, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

const capturas = process.env.CAPTURAS === "1";
const foto = async (page: Page, nombre: string): Promise<void> => {
  if (!capturas) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `recorrido/capturas/demo-${nombre}.png`, fullPage: true });
};

test("se busca la cuenta por su folio, se corrigen los kilos, se devuelve la diferencia en efectivo y el cajón lo cuenta", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  // Una compra de 30 kg de cartón, pagada: $63.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  const folio = await page.locator(".ticket").first().getAttribute("data-folio");
  await page.getByRole("button", { name: "Listo" }).click();

  // Eran 25 kg: se pesó con el costal. Se busca la cuenta.
  await page.getByRole("link", { name: "Cierre" }).click();
  await page.getByLabel("Folio").fill(folio!);
  await page.getByRole("button", { name: "Buscar" }).click();
  const correcciones = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Correcciones" }) });
  await expect(correcciones).toContainText("No lleva ninguna corrección.");
  await correcciones.getByRole("button", { name: /^Cartón · 30\.000 kg · \$63\.00/ }).click();
  await teclear(page, "25");
  await expect(correcciones.locator(".queda")).toHaveText("Se pagó de más: el vendedor devuelve $10.50");
  await expect(page.getByRole("button", { name: "Pedir la clave de quien autoriza" })).toBeDisabled();
  await correcciones.getByRole("button", { name: "En efectivo, hoy" }).click();
  await page.getByPlaceholder("Se pesó con el costal, se anotó otro material…").fill("Se pesó con el costal");
  await foto(page, "23-corregir-una-cuenta");
  await page.getByRole("button", { name: "Pedir la clave de quien autoriza" }).click();
  const hoja = page.getByRole("dialog", { name: `Corregir la cuenta ${folio}` });
  await expect(hoja).toContainText("Cartón: 30.000 kg pasan a 25.000 kg.");
  await hoja.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await hoja.getByRole("button", { name: "Corregir a nombre de Servando" }).click();

  await expect(correcciones.locator(".okmsg")).toHaveText("Corregido. Se pagó de más: el vendedor devuelve $10.50, en efectivo.");
  await expect(correcciones).toContainText("Cartón: 30.000 → 25.000 kg");
  await expect(correcciones).toContainText("Se pesó con el costal · autorizó Servando, lo registró Luis");
  // El comprobante no cambió, y el cajón ya cuenta lo que devolvió el vendedor: 20,000 − 63 + 10.50.
  await expect(page.locator(".ticket").first()).toContainText("30.000 kg × $2.10");
  const cajon = page.locator(".card").filter({ has: page.getByRole("heading", { name: "El cajón" }) });
  await expect(cajon).toContainText("Debería haber$19,947.50");
  await foto(page, "24-cuenta-corregida");
});
