// El vehículo que se pesa cargado hoy y vuelve vacío mañana: no impide cerrar, conserva el precio
// del día en que llegó y lo termina un responsable con su clave.
import { expect, test } from "@playwright/test";
import { cerrarConCorte, cerrarElDia, contarElCajon, aviso, baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

test("vehículo de un día para otro", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  // Hoy: llega cargado.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  await expect(page.locator(".prog")).toContainText("1 · cargado 5,200 kg ✓");
  await expect(page.locator(".prog")).toContainText("2 · vacío: falta");
  await expect(page.getByRole("button", { name: "Pagar e imprimir ticket" })).toBeDisabled();
  await expect(page.getByText("Falta la segunda pesada para poder terminar esta cuenta.")).toBeVisible();
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  await expect(riel.locator(".cta")).toContainText("Falta pesar vacío");

  // No vuelve: el día se cierra de todos modos.
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByText("Nada pendiente en el mostrador.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vehículos por volver" })).toBeVisible();
  await cerrarConCorte(page, g.servando);
  // Cerrado hoy, ya no se ofrece «abrir la de hoy» (que solo podía fallar): dice que se cerró, y se puede reabrir.
  await expect(page.getByRole("heading", { name: "El día de hoy ya se cerró" })).toBeVisible();

  // Al día siguiente (para la base sigue siendo hoy: se recorre la fecha de la jornada cerrada) el
  // fierro subió de precio.
  await conConsola(async (db) => {
    await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
    await db.query("UPDATE jornada SET fecha = fecha - 1");
    await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
    await db.query("SELECT abrir_jornada_de_hoy($1)", [g.luis.id]);
    await db.query("SELECT fijar_precio((SELECT id FROM material WHERE nombre = 'Fierro pesado'), 9, 11, $1)", [g.servando.id]);
    await db.query("SELECT publicar_lista_de_hoy($1)", [g.servando.id]);
  });
  await page.goto("/mostrador");
  // Día nuevo: antes de atender, se cuenta el cajón.
  await contarElCajon(page, "5000");
  await expect(riel.locator(".cta")).toContainText("De otro día");
  await expect(page.getByText("Este vehículo quedó de otro día.")).toBeVisible();
  // A una cuenta de otro día no se le agregan materiales.
  await expect(page.getByRole("button", { name: /Agregar otro material/ })).toHaveCount(0);

  // Vuelve vacío.
  await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
  await expect(page.locator(".que")).toContainText("cargado: 5,200 kg");
  await teclear(page, "3400");
  await page.getByRole("button", { name: "Guardar peso vacío" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Listo" })).toHaveText("Listo: Fierro pesado · 1,800.000 kg · $12,240.00");
  await expect(page.locator(".tot.big")).toHaveText("Se paga$12,240");

  // El mostrador no la termina solo: pide a un responsable, y dice quién quedará registrado.
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.getByText("Lo termina un responsable")).toBeVisible();
  await page.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, "000000");
  await page.getByRole("button", { name: "Terminar a nombre de Servando" }).click();
  await expect(aviso(page)).toContainText("La clave no pasó");
  await teclear(page, g.servando.clave);
  await page.getByRole("button", { name: "Terminar a nombre de Servando" }).click();

  const ticket = page.locator(".ticket");
  await expect(ticket).toContainText("Atendió: Servando");
  await expect(ticket).toContainText("1,800.000 kg × $6.80");
  await expect(ticket).toContainText("Báscula 1 · 5,200 − 3,400 kg");
  await expect(ticket).toContainText("A PAGAR$12,240");
  // Quien sigue atendiendo es Luis: la clave del responsable no lo dejó adentro.
  await expect(page.locator(".barra")).toContainText("Luis");
});

test("al responsable también se le pide su clave para terminar el vehículo de otro día", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.getByRole("link", { name: "Mostrador" }).click();
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  await conConsola(async (db) => {
    await cerrarElDia(db, g.servando.id);
    await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
    await db.query("UPDATE jornada SET fecha = fecha - 1");
    await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
    await db.query("SELECT abrir_jornada_de_hoy($1)", [g.servando.id]);
    await db.query("SELECT publicar_lista_de_hoy($1)", [g.servando.id]);
  });
  await page.goto("/mostrador");
  await contarElCajon(page, "5000");
  await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
  await teclear(page, "3400");
  await page.getByRole("button", { name: "Guardar peso vacío" }).click();

  // Tiene la sesión abierta y es responsable, pero la excepción pide la clave en el momento.
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.getByText("Lo termina un responsable")).toBeVisible();
  await expect(page.locator(".ticket")).toHaveCount(0);
  await page.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await page.getByRole("button", { name: "Terminar a nombre de Servando" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$12,240");
});
