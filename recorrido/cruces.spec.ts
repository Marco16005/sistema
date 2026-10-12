// Lo que pasa en los cruces: dos pestañas sobre la misma cuenta, la sesión que vence a media
// tarea, el día que todavía no está listo, y lo que ve cada rol.
import { expect, test } from "@playwright/test";
import {
  altaDePersona, aviso, baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, salir,
} from "./apoyo.ts";

test.beforeEach(baseNueva);

test("dos pestañas sobre la misma cuenta: la que se quedó atrás no confirma lo que ya cambió", async ({ context, page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await expect(page.locator(".tot.big")).toHaveText("Se paga$63");

  // En otra pestaña del mismo equipo alguien le agrega otro material a esa cuenta.
  const otra = await context.newPage();
  await otra.goto("/mostrador");
  await expect(otra.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await otra.getByRole("button", { name: /Agregar otro material/ }).click();
  await pesar(otra, "Aluminio bote", "Báscula 3", "4");
  await expect(otra.locator(".tot.big")).toHaveText("Se paga$175");

  // La primera pestaña todavía muestra $63. Al pagar no confirma: avisa y muestra la cuenta como está.
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(aviso(page)).toContainText("La cuenta cambió mientras la tenías abierta");
  await expect(page.locator(".ticket")).toHaveCount(0);
  await expect(page.getByText("En esta cuenta · 2 materiales")).toBeVisible();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$175");

  // Vista de nuevo, ahora sí.
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$175");
});

test("la sesión vence a media cuenta: se pide la clave y la cuenta sigue ahí", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");

  await conConsola((db) => db.query("UPDATE sesion SET vista_en = now() - interval '31 minutes'"));
  await page.getByRole("button", { name: /Agregar otro material/ }).click();
  await expect(page.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();

  await entrar(page, g.luis);
  // Vuelve a donde estaba, con su cuenta y su material.
  await expect(page).toHaveURL(/\/mostrador$/);
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await page.getByRole("button", { name: /Regresar a la cuenta/ }).click();
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$63");
});

test("con el día sin abrir, el mostrador lo dice y lleva a resolverlo", async ({ page }) => {
  const g = await gente();
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await expect(page).toHaveURL(/\/mostrador$/);
  await expect(page.getByText("La jornada de hoy no está abierta")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Compra" })).toHaveCount(0);

  await page.getByRole("button", { name: "Abrir la jornada de hoy" }).click();
  await expect(page.getByText("Los precios de hoy no se han publicado")).toBeVisible();
  await expect(page.getByText("Los publica un responsable.")).toBeVisible();
  // El mostrador ve los precios pero no los cambia.
  await page.getByRole("link", { name: "Precios" }).click();
  await expect(page.getByRole("heading", { name: "Precios de hoy" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publicar lista del día" })).toHaveCount(0);

  // El responsable publica, y el mostrador ya puede atender.
  await salir(page);
  await entrar(page, g.servando);
  await page.getByRole("link", { name: "Precios" }).click();
  await page.getByLabel("Precio de compra de Cartón").fill("2,1"); // con coma, como se escribe
  await page.getByLabel("Precio de venta de Cartón").fill("2.5");
  await page.getByRole("button", { name: "Publicar lista del día" }).click();
  await expect(page.getByText("Lista publicada. Ya se puede atender.")).toBeVisible();
  await salir(page);
  await entrar(page, g.luis);
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeEnabled();
});

test("un precio a medias no se guarda: dice cuál material revisar", async ({ page }) => {
  const g = await gente();
  await conConsola((db) => db.query("SELECT abrir_jornada_de_hoy($1)", [g.luis.id]));
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.getByRole("link", { name: "Precios" }).click();
  await page.getByLabel("Precio de compra de Cartón").fill("2.1");
  await page.getByRole("button", { name: "Guardar sin publicar" }).click();
  await expect(aviso(page)).toContainText("Revisa Cartón");
  await page.getByLabel("Precio de venta de Cartón").fill("2.5");
  await page.getByRole("button", { name: "Guardar sin publicar" }).click();
  await expect(page.getByText("Precios guardados. Falta publicarlos.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Precio de compra de Cartón")).toHaveValue("2.10");
});

test("quien solo consulta ve inventario, precios, cierre y el panel, y no escribe nada", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  const ana = await altaDePersona("Ana", "consulta", "3141");
  await darDeAltaEquipo(page);
  await entrar(page, ana);
  await expect(page).toHaveURL(/\/precios$/);
  await expect(page.getByRole("link", { name: "Mostrador" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Arranque" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Pantallas" }).getByRole("link")).toHaveText(["Inventario", "Precios", "Cierre", "Panel"]);
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByRole("heading", { name: "Kilos del día" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar el día" })).toHaveCount(0);
  // Aunque escriba la dirección, el mostrador no es para ella.
  await page.goto("/mostrador");
  await expect(page.getByText("El mostrador es para quien atiende.")).toBeVisible();
});

test("patio arma la cuenta y pesa, pero no la termina", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  const beto = await altaDePersona("Beto", "patio", "2718");
  await darDeAltaEquipo(page);
  await entrar(page, beto);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await expect(page.getByRole("button", { name: "Pagar e imprimir ticket" })).toHaveCount(0);
  await expect(page.getByText("La cuenta la termina quien atiende el mostrador.")).toBeVisible();
});

test("una venta que ya no alcanza avisa en la cuenta, y el libro la rechaza al cobrar", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "100"]]);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Venta" }).click();
  await expect(page.locator(".grid").getByRole("button", { name: /^Cartón/ })).toContainText("hay 100 kg");
  await pesar(page, "Cartón", "Báscula 2", "120");
  await expect(page.getByText("Entre las ventas abiertas faltan 20.000 kg de Cartón.")).toBeVisible();
  await page.getByRole("button", { name: "Cobrar e imprimir ticket" }).click();
  await expect(aviso(page)).toContainText("No alcanza: hay 100.000 kg de Cartón");
  await expect(page.locator(".ticket")).toHaveCount(0);
});
