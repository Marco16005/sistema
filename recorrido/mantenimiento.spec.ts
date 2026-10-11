// En mantenimiento. La operación se cierra y se abre en la base —al publicar una versión—, y
// mientras está cerrada el servidor no atiende nada del negocio. La pantalla lo dice con ese
// nombre: no es que se haya ido la conexión, y nada de lo capturado se pierde.
import { expect, test, type Page } from "@playwright/test";
import { baseNueva, conConsola, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

const cerrar = () => conConsola((db) => db.query("SELECT cerrar_operacion('Publicar una versión', 'pub-de-prueba')"));
const abrir = () =>
  conConsola(async (db) => {
    await db.query("SELECT decidir_abrir('pub-de-prueba')");
    await db.query("SELECT abrir_operacion('pub-de-prueba', (SELECT id FROM vida))");
  });
const materiales = () => conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM operacion_linea")).rows[0].n as number);
const interruptor = (page: Page) => page.getByRole("switch", { name: "Más contraste" });

test("con el sistema en mantenimiento la pantalla lo dice —no «sin conexión»—; al abrir, se sigue con la misma sesión", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await cerrar();
  await page.reload();
  await expect(page.getByRole("heading", { name: "En mantenimiento" })).toBeVisible();
  await expect(page.getByText("Sin conexión")).toHaveCount(0);
  await expect(page.getByText(/no se perdió nada/i)).toBeVisible();
  // El interruptor de contraste sigue ahí, y funciona: no depende de la base.
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  // Todo lo que se toca mide lo que debe, también en un teléfono.
  await page.setViewportSize({ width: 420, height: 800 });
  expect(await loQueNoMide(page)).toEqual([]);

  // Volver a intentar, con el sistema todavía cerrado: sigue diciendo lo mismo.
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByRole("heading", { name: "En mantenimiento" })).toBeVisible();
  // Se abre. No hubo que volver a entrar: la sesión es la misma.
  await abrir();
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.locator(".barra")).toContainText("Luis");
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeVisible();
});

test("a media captura: con el sistema en mantenimiento el material no se agrega y lo tecleado sigue ahí; al abrir, entra una sola vez", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "30.2");
  await page.evaluate(() => { (window as any).sigoAqui = true; });
  await cerrar();
  await page.getByRole("button", { name: /^Agregar a la cuenta/ }).click();
  // Arriba, para toda la pantalla: por qué no entró. Y en su lugar, lo de siempre: el peso queda pendiente.
  const aviso = page.getByRole("status").filter({ hasText: /en mantenimiento/i });
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(/sigue aquí/i);
  await expect(page.getByRole("alert").filter({ hasText: "No se supo si este peso se guardó" })).toBeVisible();
  expect(await materiales()).toBe(0);
  // La pantalla no se fue a otra parte ni perdió la captura: es la misma página.
  await expect(page.locator(".visor")).toContainText("30.2");
  await expect(page.getByRole("heading", { name: "En mantenimiento" })).toHaveCount(0);
  // Reintentar con el sistema todavía cerrado: sigue pendiente, sigue el aviso, y no entró.
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(aviso).toBeVisible();
  expect(await materiales()).toBe(0);

  await abrir();
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByText(/^En esta cuenta/)).toBeVisible();
  await expect(aviso).toHaveCount(0);
  expect(await materiales()).toBe(1);
  expect(await page.evaluate(() => (window as any).sigoAqui === true), "la página se recargó o se volvió a montar").toBe(true);
});
