// Lo que el dueño pidió el 14 de octubre de 2026 tras revisar el sistema con su gente:
//  - en la báscula chica, quitar lo que pesa el costal o la carretilla en el momento de pesar, y no
//    corregirlo después en el inventario; tecleado cada vez, sin lista de recipientes;
//  - ponerle nombre a cada cuenta para no perderse entre «Compra 1», «Compra 2»…
// Las dos cosas sin agregar pasos a quien no las usa.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

const capturas = process.env.CAPTURAS === "1";
const foto = async (page: Page, nombre: string): Promise<void> => {
  if (!capturas) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `recorrido/capturas/demo-${nombre}.png`, fullPage: true });
};

test("en la báscula chica, el costal se teclea al pesar y se quita de lo que se paga, del ticket y del patio", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cobre de primera/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  // Antes de teclear lo que marca, no hay recipiente que poner.
  const viene = page.getByRole("button", { name: "¿Viene en algo? Costal, carretilla…" });
  await expect(viene).toBeDisabled();
  await teclear(page, "15.4");
  await viene.click();
  await expect(page.getByText("¿Cuánto pesa vacío el recipiente?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar a la cuenta" })).toBeDisabled();
  await expect(page.getByText("Teclea lo que pesa vacío el recipiente.")).toBeVisible();

  // Un recipiente que pesa lo mismo que lo que marcó no se acepta.
  await teclear(page, "15.4");
  await expect(page.getByText("El recipiente tiene que pesar menos que lo que marcó la báscula.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar a la cuenta" })).toBeDisabled();
  for (let k = 0; k < 4; k += 1) await page.locator(".teclado").getByRole("button", { name: "Borrar" }).click();
  await teclear(page, ".4");
  await expect(page.getByRole("status").filter({ hasText: "Quedan" })).toHaveText("Quedan 15.000 kg de material");

  // Lo que marcó se puede corregir sin perder el recipiente.
  await page.getByRole("button", { name: "Marcó 15.4 kg" }).click();
  await expect(page.getByText("¿Cuánto marca?")).toBeVisible();
  await page.locator(".teclado").getByRole("button", { name: "Borrar" }).click();
  await teclear(page, "6");
  await expect(page.getByRole("button", { name: "Recipiente 0.4 kg" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Quedan" })).toHaveText("Quedan 15.200 kg de material");
  await foto(page, "14-recipiente-al-pesar");

  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado" }))
    .toHaveText("Agregado: Cobre de primera · 15.200 kg · $2,280.00 · sin los 0.4 kg del recipiente");
  await expect(page.locator(".ren").first()).toContainText("marcó 15.6, menos 0.4 kg de recipiente");
  await expect(page.locator(".tot.big")).toContainText("$2,280");

  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  const ticket = page.locator(".ticket").first();
  await expect(ticket).toContainText("Báscula 2 · marcó 15.6 kg");
  await expect(ticket).toContainText("Recipiente: 0.4 kg");
  await expect(ticket).toContainText("15.200 kg × $150.00");
  await foto(page, "16-recipiente-en-el-ticket");

  // Al patio entró el cobre solo.
  const hay = await conConsola(async (db) => (await db.query("SELECT kg::text FROM existencia WHERE nombre = 'Cobre de primera'")).rows[0]?.kg);
  expect(hay).toBe("15.200");
});

test("si el recipiente se olvidó o se tecleó mal, se corrige desde la cuenta; con cero se quita", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "32");
  await expect(page.locator(".tot.big")).toContainText("$67");

  await page.getByRole("button", { name: "Recipiente de Cartón" }).click();
  await expect(page.getByRole("button", { name: "Guardar el recipiente" })).toBeDisabled();
  await teclear(page, "2");
  await expect(page.getByRole("status").filter({ hasText: "Quedan" })).toHaveText("Quedan 30.000 kg de material");
  await foto(page, "15-recipiente-desde-la-cuenta");
  await page.getByRole("button", { name: "Guardar el recipiente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cartón" })).toHaveText("Cartón: sin los 2 kg del recipiente quedan 30.000 kg · $63.00");
  await expect(page.locator(".ren").first()).toContainText("marcó 32, menos 2 kg de recipiente");
  await expect(page.locator(".tot.big")).toContainText("$63");

  // Quitarlo es teclear cero.
  await page.getByRole("button", { name: "Recipiente de Cartón" }).click();
  await expect(page.getByText("ahora lleva 2 kg de recipiente")).toBeVisible();
  await teclear(page, "0");
  await page.getByRole("button", { name: "Quitar el recipiente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cartón" })).toHaveText("Cartón, sin recipiente: 32.000 kg · $67.20");
  await expect(page.locator(".ren").first()).not.toContainText("recipiente");

  // «Regresar a la cuenta» no cambia nada.
  await page.getByRole("button", { name: "Recipiente de Cartón" }).click();
  await teclear(page, "5");
  await page.getByRole("button", { name: "Regresar a la cuenta" }).click();
  await expect(page.locator(".tot.big")).toContainText("$67");
});

test("en la báscula grande no hay recipiente: el vehículo se pesa lleno y vacío", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.getByRole("button", { name: "Fierro", exact: true }).click();
  await page.locator(".grid").getByRole("button", { name: /^Pesado/ }).click();
  await page.getByRole("button", { name: /^Báscula 1/ }).click();
  await teclear(page, "5200");
  await expect(page.getByRole("button", { name: /^¿Viene en algo\?/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Guardar peso/ }).click();
  await page.getByRole("button", { name: /^Pesar / }).click();
  await teclear(page, "3400");
  await page.getByRole("button", { name: /^Guardar peso/ }).click();
  await expect(page.locator(".ren").first()).toContainText("5,200 − 3,400 kg");
  await expect(page.getByRole("button", { name: /^Recipiente de/ })).toHaveCount(0);
});

test("a cada cuenta se le pone el nombre de quien la trae; no sale en el ticket", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });

  // Abrir sigue siendo un toque: el nombre se pone si se quiere, después.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(page.getByRole("heading", { name: "Compra 2" })).toBeVisible();

  await page.getByRole("button", { name: "Cambiarle el nombre a Compra 2" }).click();
  const campo = page.getByLabel("Cómo se llama esta cuenta");
  await expect(campo).toHaveValue("Compra 2");
  await expect(campo).toBeFocused();
  // Sin cambiarlo, no hay nada que guardar; vacío, tampoco.
  await expect(page.getByRole("button", { name: "Guardar el nombre" })).toBeDisabled();
  await campo.fill("   ");
  await expect(page.getByRole("button", { name: "Guardar el nombre" })).toBeDisabled();
  await campo.fill("Don Chuy, camioneta roja");
  await foto(page, "17-nombre-de-la-cuenta");
  // Enter guarda, igual que el botón; y las teclas no se van al teclado de pesos.
  await campo.press("Enter");
  await expect(page.getByRole("heading", { name: "Don Chuy, camioneta roja" })).toBeVisible();
  await expect(riel.locator(".cta", { hasText: "Don Chuy, camioneta roja" })).toHaveAttribute("aria-pressed", "true");
  await expect(riel.locator(".cta", { hasText: "Compra 1" })).toBeVisible();

  // «No cambiarlo» deja el que tenía.
  await page.getByRole("button", { name: "Cambiarle el nombre a Don Chuy, camioneta roja" }).click();
  await page.getByLabel("Cómo se llama esta cuenta").fill("Otro");
  await page.getByRole("button", { name: "No cambiarlo" }).click();
  await expect(page.getByRole("heading", { name: "Don Chuy, camioneta roja" })).toBeVisible();

  // Con su nombre se cobra igual, y el ticket no lo lleva.
  await pesar(page, "Cartón", "Báscula 2", "10");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  const ticket = page.locator(".ticket").first();
  await expect(ticket).toContainText("Cartón");
  await expect(ticket).not.toContainText("Don Chuy");
  await expect(ticket).not.toContainText("camioneta");
});

test("un nombre largo no se sale de la pantalla en un teléfono", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Venta" }).click();
  await page.getByRole("button", { name: "Cambiarle el nombre a Venta 1" }).click();
  // Cuarenta letras y ningún espacio: lo peor que se puede escribir.
  await page.getByLabel("Cómo se llama esta cuenta").fill("W".repeat(45));
  await expect(page.getByLabel("Cómo se llama esta cuenta")).toHaveValue("W".repeat(40));
  await page.getByRole("button", { name: "Guardar el nombre" }).click();
  await expect(page.getByRole("heading", { name: "W".repeat(40) })).toBeVisible();
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(ancho).toBeLessThanOrEqual(360);
});
