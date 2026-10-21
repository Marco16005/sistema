// Un día entero en el mostrador, de dar de alta el equipo a cerrar, tocando la pantalla como la
// tocará quien atiende.
import { expect, test } from "@playwright/test";
import { baseNueva, cerrarConCorte, contarElCajon, contarImpresiones, darDeAltaEquipo, entrar, gente, impresiones, pesar, salir } from "./apoyo.ts";

test.beforeEach(baseNueva);

test("un día completo: arranque, precios, una compra, una venta, comprobantes y cierre", async ({ page }) => {
  const g = await gente();
  await contarImpresiones(page);
  await darDeAltaEquipo(page);

  // ── el responsable deja el día listo ──
  await entrar(page, g.servando);
  await expect(page).toHaveURL(/\/arranque$/);
  await page.getByLabel("Kilos de Cartón").fill("500");
  await page.getByRole("group", { name: "Origen del saldo de Cartón" }).getByRole("button", { name: "contado" }).click();
  await page.getByRole("button", { name: "Revisar 1 material" }).click();
  await expect(page.getByText("Esto se hace una sola vez.")).toBeVisible();
  await page.getByRole("button", { name: "Terminar el arranque" }).click();
  await expect(page.getByRole("heading", { name: "Arranque terminado" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Arranque" })).toHaveCount(0);

  await page.getByRole("link", { name: "Precios" }).click();
  await expect(page.getByText("La jornada de hoy no está abierta")).toBeVisible();
  await page.getByRole("button", { name: "Abrir la jornada de hoy" }).click();
  await page.getByLabel("Precio de compra de Cartón").fill("2.1");
  await page.getByLabel("Precio de venta de Cartón").fill("2.5");
  await page.getByLabel("Precio de compra de Aluminio bote").fill("28");
  await page.getByLabel("Precio de venta de Aluminio bote").fill("33");
  await page.getByRole("button", { name: "Publicar lista del día" }).click();
  await expect(page.getByText("Lista publicada. Ya se puede atender.")).toBeVisible();
  await expect(page.getByLabel("Precio de compra de Cartón")).toHaveCount(0); // publicada: ya no se edita
  await salir(page);

  // ── el mostrador atiende una compra de dos materiales ──
  await entrar(page, g.luis);
  await expect(page).toHaveURL(/\/mostrador$/);
  // Antes de atender se cuenta el cajón.
  await contarElCajon(page, "5000");
  await expect(page.getByText("No hay cuentas abiertas. Abre una compra o una venta.")).toBeVisible();
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await expect(page.getByText("¿Qué material es?")).toBeVisible();
  // Un material sin precio hoy no se puede elegir.
  await expect(page.locator(".grid").getByRole("button", { name: /^Cobre de primera/ })).toBeDisabled();

  await pesar(page, "Cartón", "Báscula 2", "30.2");
  await expect(page.getByRole("status").filter({ hasText: "Agregado" })).toHaveText("Agregado: Cartón · 30.200 kg · $63.42");
  await page.getByRole("button", { name: "＋ Agregar otro material" }).click();
  await expect(page.getByText("¿Qué material sigue?")).toBeVisible();
  await pesar(page, "Bote", "Báscula 3", "4.11", "Aluminio");

  await expect(page.getByText("En esta cuenta · 2 materiales")).toBeVisible();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$179");
  await expect(page.locator(".tot.adj")).toContainText("+$0.50");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();

  const ticket = page.locator(".ticket");
  await expect(ticket).toContainText("COMPRA");
  await expect(ticket).toContainText("Atendió: Luis");
  await expect(ticket).toContainText("30.200 kg × $2.10");
  await expect(ticket).toContainText("Báscula 3");
  await expect(ticket).toContainText("A PAGAR$179");
  await expect(ticket).toContainText("No es comprobante fiscal");
  await expect(ticket).not.toContainText("REIMPRESIÓN");
  expect(await impresiones(page)).toBe(1);
  const folio = await ticket.getAttribute("data-folio");
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByText("No hay cuentas abiertas.")).toBeVisible();

  // ── una venta: se ve lo disponible ──
  await page.getByRole("button", { name: "+ Venta" }).click();
  await expect(page.locator(".grid").getByRole("button", { name: /^Cartón/ })).toContainText("$2.50 / kg · hay 530.2 kg");
  await pesar(page, "Cartón", "Báscula 2", "100.3");
  await expect(page.locator(".tot.big")).toHaveText("Se cobra$251");
  await page.getByRole("button", { name: "Cobrar e imprimir ticket" }).click();
  await expect(ticket).toContainText("A COBRAR$251");
  expect(await impresiones(page)).toBe(2);

  // Reimprimir pide motivo y sale marcado.
  await page.getByRole("button", { name: "Imprimir otra vez" }).click();
  await page.getByRole("button", { name: "No salió el papel" }).click();
  await expect(ticket).toContainText("REIMPRESIÓN 2 · No salió el papel");
  expect(await impresiones(page)).toBe(3);
  await page.getByRole("button", { name: "Listo" }).click();

  // ── el cierre ──
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByText("Nada pendiente en el mostrador.")).toBeVisible();
  const carton = page.getByRole("row", { name: /Cartón/ });
  await expect(carton).toContainText("30.200");
  await expect(carton).toContainText("100.300");
  await expect(page.getByText("A pagar por compras")).toBeVisible();
  await expect(page.locator(".tot", { hasText: "A pagar por compras" })).toContainText("$179");
  await expect(page.locator(".tot", { hasText: "A cobrar por ventas" })).toContainText("$251");

  // Un comprobante se encuentra por su folio.
  await page.getByLabel("Folio").fill(folio!);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$179");
  await page.getByRole("button", { name: "Listo" }).click();

  await cerrarConCorte(page, g.servando);
  // Cerrado hoy, ya no se ofrece «abrir la de hoy» (que solo podía fallar): dice que se cerró, y se puede reabrir.
  await expect(page.getByRole("heading", { name: "El día de hoy ya se cerró" })).toBeVisible();
  await expect(page.getByText("Jornada cerrada · cierre 1")).toBeVisible();
});
