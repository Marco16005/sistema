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

/** Vende 300 kg de cartón ($750) y la fía a un cliente nuevo, con la clave de Servando. Devuelve el folio. */
async function fiarTrescientos(page: Page, g: Awaited<ReturnType<typeof gente>>): Promise<string> {
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "300");
  await page.getByRole("button", { name: "A crédito" }).click();
  await page.getByRole("button", { name: "Fiar la venta" }).click();
  await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
  await page.getByLabel("Nombre del cliente nuevo").fill("Fundidora del Norte");
  await page.getByRole("button", { name: "Pedir la clave de quien autoriza" }).click();
  const hoja = page.getByRole("dialog", { name: "Fiar la venta" });
  await hoja.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await hoja.getByRole("button", { name: "Fiar a nombre de Servando" }).click();
  const folio = await page.locator(".ticket").first().getAttribute("data-folio");
  await page.getByRole("button", { name: "Listo" }).click();
  return folio!;
}

test("una venta fiada se corrige sobre lo que debe el cliente; «No se liquidó» no se ofrece", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const folio = await fiarTrescientos(page, g);

  // Eran 250 kg: se fiaron $125 de más.
  await page.getByRole("link", { name: "Cierre" }).click();
  await page.getByLabel("Folio").fill(folio);
  await page.getByRole("button", { name: "Buscar" }).click();
  const correcciones = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Correcciones" }) });
  await correcciones.getByRole("button", { name: /^Cartón · 300\.000 kg/ }).click();
  await teclear(page, "250");
  await expect(correcciones.locator(".queda")).toHaveText("Se fió de más: $125.00");
  const como = correcciones.getByRole("group", { name: "Cómo se liquida" });
  await expect(como.getByRole("button")).toHaveText(["A lo que debe el cliente", "En efectivo, hoy", "Por transferencia"]);
  await como.getByRole("button", { name: "A lo que debe el cliente" }).click();
  await page.getByPlaceholder("Se pesó con el costal, se anotó otro material…").fill("Se pesó con la tarima");
  await page.getByRole("button", { name: "Pedir la clave de quien autoriza" }).click();
  const hoja = page.getByRole("dialog", { name: `Corregir la cuenta ${folio}` });
  await hoja.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await hoja.getByRole("button", { name: "Corregir a nombre de Servando" }).click();
  await expect(correcciones.locator(".okmsg")).toHaveText("Corregido. Se fió de más: $125.00, a lo que debe el cliente.");

  // Lo que debe ya es lo corregido: $625. El cajón no se movió.
  await page.getByRole("button", { name: "Registrar un abono de lo fiado" }).click();
  await expect(page.locator(".grid").getByRole("button", { name: /^Fundidora del Norte/ })).toContainText("Debe $625.00");
  const cajon = page.locator(".card").filter({ has: page.getByRole("heading", { name: "El cajón" }) });
  await expect(cajon).toContainText("Debería haber$20,000.00");
});

test("una corrección de la que no se supo no deja empezar otra en otra cuenta, y se termina desde su folio", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const folios: string[] = [];
  for (const kg of ["30", "40"]) {
    await page.getByRole("button", { name: "+ Compra" }).click();
    await pesar(page, "Cartón", "Báscula 2", kg);
    await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
    folios.push((await page.locator(".ticket").first().getAttribute("data-folio"))!);
    await page.getByRole("button", { name: "Listo" }).click();
  }
  const [a, b] = folios as [string, string];

  // Se corrige la primera, y la respuesta se pierde: la corrección sí entró.
  await page.getByRole("link", { name: "Cierre" }).click();
  await page.getByLabel("Folio").fill(a);
  await page.getByRole("button", { name: "Buscar" }).click();
  const correcciones = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Correcciones" }) });
  await correcciones.getByRole("button", { name: /^Cartón · 30\.000 kg/ }).click();
  await teclear(page, "25");
  await correcciones.getByRole("button", { name: "En efectivo, hoy" }).click();
  await page.getByPlaceholder("Se pesó con el costal, se anotó otro material…").fill("Se pesó con el costal");
  await page.getByRole("button", { name: "Pedir la clave de quien autoriza" }).click();
  let perdida = false;
  await page.route(/\/api\/comprobantes\/[^/]+\/correcciones$/, async (ruta) => {
    if (perdida || ruta.request().method() !== "POST") return ruta.fallback();
    perdida = true;
    await ruta.fetch();
    await ruta.abort();
  });
  const hoja = page.getByRole("dialog", { name: `Corregir la cuenta ${a}` });
  await hoja.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await hoja.getByRole("button", { name: "Corregir a nombre de Servando" }).click();
  await expect(hoja).toContainText("No se supo si la corrección quedó registrada.");

  // Se recarga y se busca otra cuenta: no se puede empezar a corregirla mientras la primera no se sepa.
  await page.reload();
  await expect(page.getByText(`Quedó una corrección de la cuenta ${a} sin saber si se registró.`).first()).toBeVisible();
  await page.getByLabel("Folio").fill(b);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(correcciones).toContainText(`Quedó una corrección de la cuenta ${a} sin saber si se registró. Primero se resuelve esa`);
  await expect(correcciones.getByRole("button", { name: /^Cartón · 40\.000 kg/ })).toHaveCount(0);

  // Desde el aviso se va a la primera, se teclea la clave otra vez, y entra una sola vez.
  await page.getByRole("button", { name: `Ver la cuenta ${a}` }).click();
  const otraVez = page.getByRole("dialog", { name: `Corregir la cuenta ${a}` });
  await expect(otraVez).toContainText("No se supo si la corrección quedó registrada.");
  await teclear(page, g.servando.clave);
  await otraVez.getByRole("button", { name: "Corregir a nombre de Servando" }).click();
  await expect(correcciones.locator(".okmsg")).toHaveText("Corregido. Se pagó de más: el vendedor devuelve $10.50, en efectivo.");
  await expect(correcciones.locator(".ren")).toHaveCount(1);
  await expect(page.getByText("sin saber si se registró")).toHaveCount(0);
});
