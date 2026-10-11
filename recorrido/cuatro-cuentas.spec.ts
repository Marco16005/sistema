// Varias cuentas a la vez: lo que el personal pidió al revisar el prototipo. Hasta diez (eran
// cuatro; el negocio pidió más), la activa inconfundible y siempre a la vista, las que esperan la
// segunda pesada en su propio grupo, y cambiar de una a otra sin perder en qué iba cada una.
import { expect, test } from "@playwright/test";
import { aviso, baseNueva, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

test("hasta diez cuentas abiertas; la undécima no se ofrece, y la activa queda siempre a la vista", async ({ page }) => {
  // Una pantalla ancha pero baja, como la de un monitor de mostrador: diez tarjetas no caben a la vez.
  await page.setViewportSize({ width: 1280, height: 620 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  for (let n = 1; n <= 10; n += 1) {
    const [boton, nombre] = n % 2 ? ["+ Compra", `Compra ${n}`] : ["+ Venta", `Venta ${n}`];
    await page.getByRole("button", { name: boton }).click();
    await expect(page.getByRole("heading", { name: nombre })).toBeVisible();
  }
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  await expect(riel.locator(".cta")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "+ Venta" })).toBeDisabled();
  await expect(page.getByText("Máximo diez. Termina o descarta una para abrir otra.")).toBeVisible();

  // La activa es una sola, es la que encabeza la pantalla, y se ve sin tener que buscarla.
  const activa = riel.locator('.cta[aria-pressed="true"]');
  await expect(activa).toHaveCount(1);
  await expect(activa).toContainText("Venta 10");
  await expect(activa).toBeInViewport({ ratio: 1 });
  // Los botones para abrir otra no se van al fondo de la lista: siguen a la vista.
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeInViewport({ ratio: 1 });

  // Al descartar una vacía se pasa sola a la siguiente abierta —la primera— y la lista se acomoda
  // para mostrarla: estaba hasta abajo y ahora está hasta arriba.
  await page.getByRole("button", { name: "Cuenta", exact: false }).filter({ hasText: "3" }).click();
  await page.getByRole("button", { name: "Descartar esta cuenta" }).click();
  await expect(riel.locator(".cta")).toHaveCount(9);
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await expect(activa).toContainText("Compra 1");
  await expect(activa).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeEnabled();
  // El número no se recicla mientras haya una cuenta con uno mayor.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(page.getByRole("heading", { name: "Compra 10" })).toBeVisible();
  await expect(activa).toBeInViewport({ ratio: 1 });
});

test("en pantalla angosta, con muchas cuentas, la activa y los botones para abrir otra siguen a la vista", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  for (let n = 1; n <= 7; n += 1) {
    await page.getByRole("button", { name: n % 2 ? "+ Compra" : "+ Venta" }).click();
    await expect(page.getByRole("heading", { name: `${n % 2 ? "Compra" : "Venta"} ${n}` })).toBeVisible();
  }
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  const activa = riel.locator('.cta[aria-pressed="true"]');
  await expect(activa).toContainText("Compra 7");
  await expect(activa).toBeInViewport({ ratio: 1 });
  // Abrir otra no pide recorrer toda la tira: los botones van al principio.
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "+ Venta" }).click();
  await expect(page.getByRole("heading", { name: "Venta 8" })).toBeVisible();
  await expect(activa).toContainText("Venta 8");
  await expect(activa).toBeInViewport({ ratio: 1 });
});

test("las cuentas que esperan la segunda pesada van en su propio grupo, y vuelven al mostrador cuando se pesan", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  const mostrador = riel.getByRole("group", { name: "En el mostrador" });
  const espera = riel.getByRole("group", { name: "En espera de la segunda pesada" });

  // Sin vehículos esperando no hay grupo de espera: la lista se ve como siempre.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(mostrador.locator(".cta")).toHaveCount(1);
  await expect(espera).toHaveCount(0);

  // Llega un camión: se pesa cargado y se va a descargar. Su cuenta pasa a esperar.
  await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  await expect(espera.locator(".cta")).toHaveCount(1);
  await expect(espera.locator(".cta")).toContainText("Falta pesar vacío");
  await expect(mostrador.locator(".cta")).toHaveCount(0);

  // Mientras tanto se atiende a otra persona: su cuenta queda en el mostrador, la del camión aparte.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(page.getByRole("heading", { name: "Compra 2" })).toBeVisible();
  await pesar(page, "Cartón", "Báscula 2", "12");
  await expect(mostrador.locator(".cta")).toHaveCount(1);
  await expect(mostrador.locator(".cta")).toContainText("Compra 2");
  await expect(espera.locator(".cta")).toHaveCount(1);
  await expect(espera.locator(".cta")).toContainText("Compra 1");

  // El camión vuelve vacío: se entra a su cuenta desde el grupo de espera y se pesa.
  await espera.locator(".cta").click();
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
  await teclear(page, "3400");
  await page.getByRole("button", { name: "Guardar peso vacío" }).click();
  // Ya no espera nada: vuelve con las del mostrador y el grupo de espera desaparece.
  await expect(espera).toHaveCount(0);
  await expect(mostrador.locator(".cta")).toHaveCount(2);
  await expect(riel.locator('.cta[aria-pressed="true"]')).toContainText("Compra 1");
});

test("cuando la cuenta activa cambia de grupo —se pesa el camión, o vuelve—, sigue a la vista aunque su grupo no quepa entero", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  const espera = riel.getByRole("group", { name: "En espera de la segunda pesada" });
  const activa = riel.locator('.cta[aria-pressed="true"]');

  // Cuatro camiones esperando: su grupo ya no cabe entero.
  for (let n = 1; n <= 4; n += 1) {
    await page.getByRole("button", { name: "+ Compra" }).click();
    await expect(page.getByRole("heading", { name: `Compra ${n}` })).toBeVisible();
    await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  }
  await expect(espera.locator(".cta")).toHaveCount(4);
  // Y cinco cuentas más en el mostrador, para que tampoco ese grupo quepa.
  for (let n = 5; n <= 9; n += 1) {
    await page.getByRole("button", { name: "+ Compra" }).click();
    await expect(page.getByRole("heading", { name: `Compra ${n}` })).toBeVisible();
  }

  // La última se pesa cargada: sin cambiar de cuenta ni de número de cuentas, pasa al final del grupo de espera.
  await pesar(page, "Pesado", "Báscula 1", "6100", "Fierro");
  await expect(espera.locator(".cta")).toHaveCount(5);
  await expect(activa).toContainText("Compra 9");
  await expect(activa).toContainText("Falta pesar vacío");
  // (Casi entera: el acomodo redondea al punto, y puede faltarle una fracción de punto de un borde.)
  await expect(activa).toBeInViewport({ ratio: 0.99 });

  // Vuelve vacía: regresa al grupo del mostrador, y sigue a la vista.
  await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
  await teclear(page, "3400");
  await page.getByRole("button", { name: "Guardar peso vacío" }).click();
  await expect(espera.locator(".cta")).toHaveCount(4);
  await expect(activa).toContainText("Compra 9");
  await expect(activa).toBeInViewport({ ratio: 0.99 });
});

test("cambiar de cuenta recuerda el paso, el material elegido y el peso a medio teclear, y no los pasa a otra", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });

  // En la Compra 1: Cartón, Báscula 2, y 12.5 a medio teclear.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "12.5");
  await expect(page.locator(".visor")).toContainText("12.5");

  // Se abre la Compra 2 y se le pesa otra cosa completa.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(page.getByRole("heading", { name: "Compra 2" })).toBeVisible();
  await expect(page.getByText("¿Qué material es?")).toBeVisible();
  await pesar(page, "Aluminio bote", "Báscula 3", "4");
  await expect(riel.locator(".cta", { hasText: "Compra 2" })).toContainText("$112");
  await expect(riel.locator(".cta", { hasText: "Compra 1" })).toContainText("Sin materiales");

  // De vuelta en la Compra 1: sigue en la báscula, con su material y lo tecleado.
  await riel.locator(".cta", { hasText: "Compra 1" }).click();
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await expect(page.locator(".que")).toContainText("Cartón");
  await expect(page.locator(".visor")).toContainText("Báscula 2");
  await expect(page.locator(".visor")).toContainText("12.5");

  // Y sobrevive a recargar la página.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await expect(page.locator(".visor")).toContainText("12.5");

  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado" })).toHaveText("Agregado: Cartón · 12.500 kg · $26.25");
  // La otra cuenta no recibió nada de esto.
  await expect(riel.locator(".cta", { hasText: "Compra 2" })).toContainText("1 material");
  await expect(riel.locator(".cta", { hasText: "Compra 2" })).toContainText("$112");
});

test("un peso que la báscula no puede marcar se rechaza con su razón y no deja material", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();

  // El teclado no deja escribir más de tres decimales ni dos puntos.
  await teclear(page, "1.2.3456");
  await expect(page.locator(".visor")).toContainText("1.234");
  // Sin peso, o en cero, no se puede agregar.
  for (let k = 0; k < 5; k++) await page.getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByRole("button", { name: "Agregar a la cuenta" })).toBeDisabled();
  await teclear(page, "0");
  await expect(page.getByRole("button", { name: "Agregar a la cuenta" })).toBeDisabled();
  await page.getByRole("button", { name: "Borrar" }).click();

  // Más de lo que aguanta la báscula: lo dice la base, con sus palabras.
  await teclear(page, "5000");
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(aviso(page)).toContainText("rebasa la capacidad de la Báscula 2");
  await page.getByRole("button", { name: "Cuenta", exact: false }).filter({ hasText: "3" }).click();
  await expect(page.getByText("Esta cuenta está vacía")).toBeVisible();
});
