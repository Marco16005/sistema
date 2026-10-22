// El fiado (respuestas 4 y 5 del negocio): en cargas grandes, a clientes conocidos, una venta se
// cobra a crédito con la clave de quien autoriza; los abonos se registran en el cierre y los de
// efectivo cuentan en el corte; en el Panel se ve quién debe cuánto.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { adentro, baseNueva, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, pesar, salir, teclear } from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const capturas = process.env.CAPTURAS === "1";
const foto = async (page: Page, nombre: string): Promise<void> => {
  if (!capturas) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `recorrido/capturas/demo-${nombre}.png`, fullPage: true });
};
const cajon = (page: Page) => page.locator(".card").filter({ has: page.getByRole("heading", { name: "El cajón" }) });

/** Una venta de 300 kg de cartón ($750) fiada a un cliente nuevo, con la clave de Servando. */
async function fiarUnaVenta(page: Page, g: Gente): Promise<void> {
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "300");
  await page.getByRole("button", { name: "A crédito" }).click();
  await page.getByRole("button", { name: "Fiar la venta" }).click();
  await expect(page.getByText("No pasa por el cajón: queda a cuenta del cliente hasta que abone.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pedir la clave de quien autoriza" })).toBeDisabled();
  await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
  await page.getByLabel("Nombre del cliente nuevo").fill("Fundidora del Norte");
  await foto(page, "25-fiar-una-venta");
  await page.getByRole("button", { name: "Pedir la clave de quien autoriza" }).click();
  const hoja = page.getByRole("dialog", { name: "Fiar la venta" });
  await expect(hoja).toContainText("$750 a nombre de Fundidora del Norte.");
  await hoja.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await hoja.getByRole("button", { name: "Fiar a nombre de Servando" }).click();
}

test("una venta se fía a un cliente nuevo; no pasa por el cajón; el abono en efectivo sí, y el Panel dice cuánto debe", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  await fiarUnaVenta(page, g);
  const ticket = page.locator(".ticket").first();
  await expect(ticket).toContainText("Cliente: Fundidora del Norte");
  await expect(ticket).toContainText("A crédito");
  await page.getByRole("button", { name: "Listo" }).click();

  // En el cajón no entró nada: se fió.
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(cajon(page)).toContainText("Se fiaron $750.00: no pasan por el cajón hasta que el cliente abone.");
  await expect(cajon(page)).toContainText("Debería haber$20,000.00");

  // Abona $500 en efectivo.
  await page.getByRole("button", { name: "Registrar un abono de lo fiado" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Fundidora del Norte/ }).click();
  await teclear(page, "800");
  await expect(page.getByText("No puede abonar más de lo que debe.")).toBeVisible();
  for (let k = 0; k < 3; k += 1) await page.locator(".teclado").getByRole("button", { name: "Borrar" }).click();
  await teclear(page, "500");
  await foto(page, "26-un-abono");
  await page.getByRole("button", { name: "Registrar el abono de $500.00" }).click();
  await expect(page.locator(".okmsg")).toContainText("Fundidora del Norte abonó $500.00 en efectivo. Debe $250.00.");
  await expect(cajon(page)).toContainText("Abonos de lo fiado+$500.00");
  await expect(cajon(page)).toContainText("Debería haber$20,500.00");
  await salir(page);

  await adentro(page, g.servando);
  await page.goto("/panel/fiado");
  const quien = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Quién debe" }) });
  await expect(quien.locator(".exrow")).toHaveCount(1);
  await expect(quien).toContainText("Fundidora del Norte");
  await expect(quien).toContainText("Se le fiaron $750.00, ha abonado $500.00");
  await expect(quien.locator(".ri")).toHaveText("$250.00");
  await foto(page, "27-el-fiado-en-el-panel");
});

test("una compra no se fía: la opción solo aparece al vender", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "10");
  await expect(page.getByRole("button", { name: "A crédito" })).toHaveCount(0);
});

for (const [ancho, alto] of [[1280, 620], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, fiar y abonar miden lo que deben y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    // De sobra para dos ventas: la primera se deja abierta al regresar, la segunda se fía.
    await diaListo(g, [["Cartón", "1000"]]);
    await contarImpresiones(page);
    await darDeAltaEquipo(page);
    await entrar(page, g.luis);
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };
    await page.getByRole("button", { name: "+ Venta" }).click();
    await pesar(page, "Cartón", "Báscula 2", "300");
    await page.getByRole("button", { name: "A crédito" }).click();
    await medir("la cuenta, a crédito");
    await page.getByRole("button", { name: "Fiar la venta" }).click();
    await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
    await page.getByLabel("Nombre del cliente nuevo").fill("Fundidora del Norte de Monterrey");
    await medir("fiar la venta");
    await page.getByRole("button", { name: "No fiar: regresar a la cuenta" }).click();
    await fiarUnaVenta(page, g);
    await page.getByRole("button", { name: "Listo" }).click();
    await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Cierre" }).click();
    await page.getByRole("button", { name: "Registrar un abono de lo fiado" }).click();
    await page.locator(".grid").getByRole("button", { name: /^Fundidora/ }).click();
    await teclear(page, "100");
    await medir("un abono");
  });
}
