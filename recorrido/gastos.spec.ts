// Los gastos (respuesta 7 del negocio): se capturan a mano, de otro lado o del cajón; el del cajón
// baja lo que debería haber en el corte; cada tipo dice si se resta en la ganancia; anular deja el
// registro, y lo que se sacó del cajón se clasifica como gasto. Quien consulta los ve, sin escribir.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { altaDePersona, baseNueva, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, salir } from "./apoyo.ts";

test.beforeEach(baseNueva);

const capturas = process.env.CAPTURAS === "1";
const foto = async (page: Page, nombre: string): Promise<void> => {
  if (!capturas) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `recorrido/capturas/demo-${nombre}.png`, fullPage: true });
};
const indicador = (page: Page, nombre: string) => page.locator(".indicador").filter({ has: page.locator(".lbl", { hasText: new RegExp(`^${nombre}$`) }) }).locator(".cifra");
const tarjeta = (page: Page, titulo: string) => page.locator(".card").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) });
const hecho = (page: Page) => page.locator(".note.hecho");

/** Abre el registro y llena un gasto; no lo manda. */
async function llenar(page: Page, o: { tipo: string; deDonde: "Del cajón, hoy" | "De otro lado"; concepto: string; importe: string }): Promise<void> {
  await page.getByRole("button", { name: "Registrar un gasto", exact: true }).click();
  const forma = tarjeta(page, "Registrar un gasto");
  await forma.getByRole("group", { name: "Tipo de gasto" }).getByRole("button", { name: o.tipo, exact: true }).click();
  await forma.getByRole("button", { name: o.deDonde, exact: true }).click();
  await forma.getByLabel("Concepto").fill(o.concepto);
  await forma.getByLabel("Cuánto, en pesos").fill(o.importe);
}

test("un responsable registra gastos de otro lado y del cajón; el del cajón baja lo que debería haber; la ganancia resta los que se escogen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.goto("/panel/gastos");
  await expect(page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Gastos" })).toHaveAttribute("aria-current", "page");
  await expect(tarjeta(page, "Los gastos")).toContainText("No hay gastos en este periodo.");

  await llenar(page, { tipo: "Renta", deDonde: "De otro lado", concepto: "Renta del mes", importe: "8000" });
  await foto(page, "28-registrar-un-gasto");
  await page.getByRole("button", { name: "Registrar el gasto de $8,000.00" }).click();
  await expect(hecho(page)).toHaveText("Se registró el gasto de $8,000.00 (Renta: Renta del mes).");

  await llenar(page, { tipo: "Gasolina", deDonde: "Del cajón, hoy", concepto: "Diésel del camión", importe: "500" });
  await expect(tarjeta(page, "Registrar un gasto")).toContainText("Sale del cajón de hoy: cuenta en el corte como dinero que se sacó.");
  await page.getByRole("button", { name: "Registrar el gasto de $500.00" }).click();
  await expect(hecho(page)).toHaveText("Se registró el gasto de $500.00 (Gasolina: Diésel del camión), que sale del cajón de hoy.");
  await expect(indicador(page, "Se resta en la ganancia")).toHaveText("$8,500");
  await expect(tarjeta(page, "Por tipo").locator(".exrow")).toHaveCount(2);
  await expect(tarjeta(page, "Los gastos").locator(".exrow")).toHaveCount(2);

  // En el cajón: lo que se sacó baja lo que debería haber.
  await page.goto("/cierre");
  const cajon = tarjeta(page, "El cajón");
  await expect(cajon).toContainText("Sacado del cajón−$500.00");
  await expect(cajon).toContainText("Debería haber$19,500.00");

  // En la ganancia: sin ventas, lo que queda son los gastos en contra.
  await page.goto("/panel/ganancia");
  await expect(indicador(page, "Lo que queda")).toHaveText("−$8,500");
  await expect(page.locator(".indicador").filter({ hasText: "Lo que queda" })).toContainText("Después de $8,500 de gastos");

  // La renta no se resta: cambia lo que se resta, en los gastos y en la ganancia.
  await page.goto("/panel/gastos");
  await tarjeta(page, "Tipos de gasto").getByRole("button", { name: "Que Renta no se reste en la ganancia" }).click();
  await expect(indicador(page, "Se resta en la ganancia")).toHaveText("$500");
  await expect(indicador(page, "No se resta")).toHaveText("$8,000");
  await expect(tarjeta(page, "Por tipo")).toContainText("no se resta en la ganancia");
  await page.goto("/panel/ganancia");
  await expect(indicador(page, "Lo que queda")).toHaveText("−$500");
});

test("anular deja el registro tachado con quién y por qué; lo sacado del cajón vuelve a quedar por clasificar, y se clasifica", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.goto("/panel/gastos");
  await llenar(page, { tipo: "Renta", deDonde: "Del cajón, hoy", concepto: "Diésel del camión", importe: "500" });
  await page.getByRole("button", { name: "Registrar el gasto de $500.00" }).click();
  await expect(hecho(page)).toContainText("que sale del cajón de hoy");
  await expect(tarjeta(page, "Lo que se sacó del cajón")).toHaveCount(0);

  // El tipo estaba mal: se anula, con su porqué.
  await page.getByRole("button", { name: "Anular el gasto de $500.00: Diésel del camión" }).click();
  await expect(page.getByRole("button", { name: "Anular el gasto", exact: true })).toBeDisabled();
  await page.getByLabel("¿Por qué se anula?").fill("El tipo estaba mal");
  await page.getByRole("button", { name: "Anular el gasto", exact: true }).click();
  await expect(hecho(page)).toHaveText("Se anuló el gasto de $500.00 (Diésel del camión).");
  const fila = tarjeta(page, "Los gastos").locator(".exrow[data-anulado]");
  await expect(fila).toContainText("por Servando: El tipo estaba mal");
  await expect(fila.locator("s")).toHaveText("$500.00");
  await expect(indicador(page, "Se resta en la ganancia")).toHaveText("$0");

  // Lo que se sacó sigue sacado: queda por clasificar, y se clasifica bien.
  const porClasificar = tarjeta(page, "Lo que se sacó del cajón");
  await expect(porClasificar.locator(".exrow")).toHaveCount(1);
  await porClasificar.getByRole("button", { name: "Clasificar como gasto los $500.00 que se sacaron: Diésel del camión" }).click();
  const forma = tarjeta(page, "Clasificar lo que se sacó");
  await expect(forma).toContainText("Se sacaron $500.00 del cajón el");
  await expect(forma.getByLabel("Cuánto, en pesos")).toHaveValue("500.00");
  await expect(forma.getByRole("group", { name: "De dónde salió el dinero" })).toHaveCount(0);
  await forma.getByRole("group", { name: "Tipo de gasto" }).getByRole("button", { name: "Gasolina", exact: true }).click();
  await foto(page, "29-clasificar-lo-sacado");
  await forma.getByRole("button", { name: "Registrar el gasto de $500.00" }).click();
  await expect(hecho(page)).toHaveText("Se registró el gasto de $500.00 (Gasolina: Diésel del camión).");
  await expect(tarjeta(page, "Lo que se sacó del cajón")).toHaveCount(0);
  await expect(indicador(page, "Se resta en la ganancia")).toHaveText("$500");

  // Y el cajón: se sacaron $500 una sola vez.
  await page.goto("/cierre");
  await expect(tarjeta(page, "El cajón")).toContainText("Debería haber$19,500.00");
});

test("quien consulta ve los gastos, pero no registra, no anula ni cambia los tipos", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  const ana = await altaDePersona("Ana", "consulta", "3141");
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.goto("/panel/gastos");
  await llenar(page, { tipo: "Luz y agua", deDonde: "De otro lado", concepto: "Recibo de luz", importe: "1200" });
  await page.getByRole("button", { name: "Registrar el gasto de $1,200.00" }).click();
  await expect(hecho(page)).toBeVisible();
  await salir(page);
  await entrar(page, ana);
  await page.goto("/panel/gastos");
  await expect(tarjeta(page, "Los gastos")).toContainText("Recibo de luz");
  await expect(indicador(page, "Se resta en la ganancia")).toHaveText("$1,200");
  await expect(page.getByRole("button", { name: "Registrar un gasto" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Anular/ })).toHaveCount(0);
  await expect(tarjeta(page, "Tipos de gasto")).toHaveCount(0);
});

for (const [ancho, alto] of [[1280, 620], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, los gastos miden lo que deben y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await diaListo(g);
    await darDeAltaEquipo(page);
    await entrar(page, g.servando);
    const medir = async (donde: string): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page), donde).toEqual([]);
    };
    await page.goto("/panel/gastos");
    await expect(tarjeta(page, "Tipos de gasto")).toBeVisible();
    await medir("los gastos, sin ninguno");
    await llenar(page, { tipo: "Mantenimiento", deDonde: "Del cajón, hoy", concepto: "Refacciones de la báscula grande, con su mano de obra", importe: "99999.99" });
    await medir("registrar un gasto");
    await page.getByRole("button", { name: "Registrar el gasto de $99,999.99" }).click();
    await expect(hecho(page)).toBeVisible();
    await page.getByRole("button", { name: /^Anular el gasto de/ }).click();
    await medir("anular un gasto");
    await page.getByLabel("¿Por qué se anula?").fill("Se capturó dos veces");
    await page.getByRole("button", { name: "Anular el gasto", exact: true }).click();
    await expect(tarjeta(page, "Lo que se sacó del cajón")).toBeVisible();
    await medir("un gasto anulado, y lo sacado por clasificar");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "Otro periodo" }).click();
    await medir("eligiendo de qué día a qué día");
  });
}
