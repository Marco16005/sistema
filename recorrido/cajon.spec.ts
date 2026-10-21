// El cajón, como lo pidió el negocio el 14 y el 15 de octubre de 2026: se cuenta al abrir, cada
// cuenta dice si fue en efectivo o por transferencia, sacar y meter dinero pide la clave de un
// responsable, y el día se cierra con un corte que firma quien tiene permiso; si no cuadra, al
// responsable le llega un aviso.
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  aviso, baseNueva, cerrarConCorte, conConsola, contarElCajon, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, pesar, salir, teclear,
} from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const capturas = process.env.CAPTURAS === "1";
const foto = async (page: Page, nombre: string): Promise<void> => {
  if (!capturas) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `recorrido/capturas/demo-${nombre}.png`, fullPage: true });
};

/** El día listo pero con el cajón SIN contar: lo que pasa la primera vez de cada mañana. */
async function sinContar(g: Gente): Promise<void> {
  await diaListo(g);
  // El registro del cajón no se borra: se aparta el guardián solo para dejar el día como recién abierto.
  await conConsola(async (db) => {
    await db.query("ALTER TABLE caja_apertura DISABLE TRIGGER USER");
    await db.query("DELETE FROM caja_apertura");
    await db.query("ALTER TABLE caja_apertura ENABLE TRIGGER USER");
  });
}

const enLaBase = () =>
  conConsola(async (db) => (await db.query(`SELECT
      (SELECT count(*)::int FROM caja_movimiento) AS movimientos,
      (SELECT count(*)::int FROM aviso WHERE visto_en IS NULL) AS avisos,
      (SELECT jsonb_agg(forma_de_pago ORDER BY folio) FROM operacion WHERE estado = 'confirmada') AS formas`)).rows[0]);

/** La siguiente petición a esa ruta llega al servidor y se asienta, pero su respuesta se pierde. */
async function perderLaRespuesta(page: Page, patron: RegExp): Promise<void> {
  let ya = false;
  await page.route(patron, async (ruta) => {
    if (ya) return ruta.fallback();
    ya = true;
    await ruta.fetch();
    await ruta.abort();
  });
}

test("antes de atender se cuenta el cajón; si no es lo que se dejó, al responsable le llega un aviso y lo marca como visto", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  // Ayer: el corte cuadró y se dejaron $2,000 en el cajón. Hoy se abre el día sin contarlo todavía.
  await conConsola(async (db) => {
    const huella = createHash("sha256").update(randomUUID()).digest("hex");
    const { c } = (await db.query("SELECT crear_codigo_alta('Consola') AS c")).rows[0];
    await db.query("SELECT canjear_codigo($1, $2)", [c, huella]);
    const j = (await db.query("SELECT id, cierres FROM jornada WHERE cerrada_en IS NULL")).rows[0];
    await db.query("SELECT * FROM cerrar_el_dia(gen_random_uuid(), $1, $2, 20000, 2000, $3, $4, $5, $3)", [j.id, j.cierres, g.servando.id, g.servando.clave, huella]);
    await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
    await db.query("UPDATE jornada SET fecha = fecha - 1");
    await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
    await db.query("SELECT abrir_jornada_de_hoy($1)", [g.luis.id]);
    await db.query("SELECT publicar_lista_de_hoy($1)", [g.servando.id]);
  });
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await expect(page.getByText("Antes de atender, cuenta el cajón")).toBeVisible();
  await expect(page.getByText("En el último corte se dejaron $2,000.00.")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Compra" })).toHaveCount(0);
  await foto(page, "18-contar-el-cajon");
  // Faltan $50.
  await contarElCajon(page, "1950");
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeEnabled();
  expect((await enLaBase()).avisos).toBe(1);

  // El responsable lo ve en la barra en cuanto entra, y en el panel dice que ya lo vio.
  await salir(page);
  await entrar(page, g.servando);
  await expect(page.locator(".avisos-de-caja")).toContainText("Un aviso del cajón.");
  await expect(page.locator(".avisos-de-caja")).toContainText("abrió con $50.00 de menos de lo que se dejó en el último corte. Lo contó Luis");
  await page.locator(".avisos-de-caja").getByRole("link", { name: "Ver en el panel" }).click();
  await expect(page.getByRole("heading", { name: "Avisos del cajón" })).toBeVisible();
  await page.getByRole("button", { name: "Ya lo vi" }).click();
  await expect(page.getByRole("heading", { name: "Avisos del cajón" })).toHaveCount(0);
  expect((await enLaBase()).avisos).toBe(0);
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.locator(".avisos-de-caja")).toHaveCount(0);
});

test("una cuenta se paga en efectivo o por transferencia: el ticket lo dice, y la transferencia no pasa por el cajón", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);

  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await expect(page.getByRole("button", { name: "En efectivo" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket").first()).not.toContainText("transferencia");
  await page.getByRole("button", { name: "Listo" }).click();

  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "300");
  await page.getByRole("button", { name: "Por transferencia" }).click();
  await foto(page, "19-cobrar-por-transferencia");
  await page.getByRole("button", { name: "Cobrar por transferencia e imprimir ticket" }).click();
  await expect(page.locator(".ticket").first()).toContainText("Cobrado por transferencia");
  await page.getByRole("button", { name: "Listo" }).click();
  expect((await enLaBase()).formas).toEqual(["efectivo", "transferencia"]);

  // En el cajón: se pagaron $210 en efectivo; los $750 de la venta no pasaron por ahí.
  await page.getByRole("link", { name: "Cierre" }).click();
  const cajon = page.locator(".card").filter({ has: page.getByRole("heading", { name: "El cajón" }) });
  await expect(cajon).toContainText("Pagado en efectivo−$210.00");
  await expect(cajon).toContainText("Cobrado en efectivo+$0.00");
  await expect(cajon).toContainText("Por transferencia, que no pasa por el cajón: cobrado $750.00");
  await expect(cajon).toContainText("Debería haber$19,790.00");
});

test("sacar dinero pide la clave de un responsable; con la equivocada no se registra, y lo que salió y no se supo se manda una sola vez", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Cierre" }).click();

  await page.getByRole("button", { name: "Sacar dinero" }).click();
  await expect(page.getByRole("button", { name: "Pedir la clave de un responsable" })).toBeDisabled();
  await teclear(page, "350");
  await page.getByPlaceholder("La tienda, gasolina, un mandado…").fill("Comida de la cuadrilla");
  await foto(page, "20-sacar-dinero");
  await page.getByRole("button", { name: "Pedir la clave de un responsable" }).click();
  const hoja = page.getByRole("dialog", { name: "Sacar dinero del cajón" });
  await expect(hoja).toContainText("$350.00 · Comida de la cuadrilla");
  await hoja.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, "000000");
  await hoja.getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
  await expect(hoja.getByRole("alert")).toContainText("La clave no pasó");
  expect((await enLaBase()).movimientos).toBe(0);

  // La respuesta se pierde: no se sabe; se pide la clave otra vez a la misma persona, y entra una sola vez.
  await perderLaRespuesta(page, /\/api\/caja\/movimientos$/);
  await teclear(page, g.servando.clave);
  await hoja.getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
  await expect(hoja).toContainText("No se supo si quedó registrado.");
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Sacar dinero del cajón" })).toContainText("No se supo si quedó registrado.");
  await teclear(page, g.servando.clave);
  await page.getByRole("dialog", { name: "Sacar dinero del cajón" }).getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
  await expect(page.locator(".okmsg")).toContainText("Se sacaron $350.00: Comida de la cuadrilla.");
  expect((await enLaBase()).movimientos).toBe(1);
  const cajon = page.locator(".card").filter({ has: page.getByRole("heading", { name: "El cajón" }) });
  await expect(cajon).toContainText("Comida de la cuadrilla");
  await expect(cajon).toContainText("lo registró Luis · autorizó Servando");
  await expect(cajon).toContainText("Debería haber$19,650.00");
});

test("el corte lo firma alguien de mostrador si un responsable le dio el permiso; si no cuadra, se cierra igual y le llega el aviso al responsable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);

  // Sin permiso, Luis no aparece entre quienes firman el corte.
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Cierre" }).click();
  await page.getByRole("button", { name: "Hacer el corte y cerrar el día" }).click();
  await teclear(page, "20000");
  await page.getByRole("button", { name: "Seguir" }).click();
  await page.getByRole("button", { name: "Firmar el corte" }).click();
  const firmar = page.getByRole("dialog", { name: "Firmar el corte y cerrar el día" });
  await expect(firmar.getByRole("button", { name: /^Servando/ })).toBeVisible();
  await expect(firmar.getByRole("button", { name: /^Luis/ })).toHaveCount(0);
  await firmar.getByRole("button", { name: "Regresar al corte" }).click();
  await page.getByRole("button", { name: "Volver a contar" }).click();
  await page.getByRole("button", { name: "No cerrar todavía" }).click();
  await salir(page);

  // Servando se lo da, en los ajustes, con su clave.
  await entrar(page, g.servando);
  await page.goto("/panel/ajustes");
  const luis = page.locator(".administrado").filter({ has: page.getByText("Luis", { exact: true }) });
  await luis.getByRole("button", { name: "Dar a Luis el permiso de corte" }).click();
  await teclear(page, g.servando.clave);
  await page.getByRole("dialog").getByRole("button", { name: "Dar el permiso", exact: true }).click();
  await expect(luis).toContainText("hace el corte");
  await salir(page);

  // Luis cuenta $19,880: faltan $120. Se cierra igual, y lo firma él con sus cuatro dígitos.
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Cierre" }).click();
  await page.getByRole("button", { name: "Hacer el corte y cerrar el día" }).click();
  await teclear(page, "19880");
  await expect(page.getByRole("status").filter({ hasText: "Faltaron" })).toContainText("Faltaron $120.00.");
  await foto(page, "21-corte-que-no-cuadra");
  await page.getByRole("button", { name: "Seguir" }).click();
  // Se propone dejar el fondo con que se abrió; lo demás se lo lleva quien hace el corte.
  await expect(page.getByRole("status").filter({ hasText: "Se lleva" })).toContainText("Se lleva quien hace el corte: $0.00");
  for (let k = 0; k < 8; k += 1) await page.locator(".teclado").getByRole("button", { name: "Borrar" }).click();
  await teclear(page, "3000");
  await expect(page.getByRole("status").filter({ hasText: "Se lleva" })).toContainText("Se lleva quien hace el corte: $16,880.00");
  await page.getByRole("button", { name: "Firmar el corte" }).click();
  await firmar.getByRole("button", { name: /^Luis/ }).click();
  await teclear(page, g.luis.clave);
  await firmar.getByRole("button", { name: "Cerrar el día a nombre de Luis" }).click();
  await expect(page.getByRole("heading", { name: "El día de hoy ya se cerró" })).toBeVisible();
  const cajon = page.locator(".card").filter({ has: page.getByRole("heading", { name: "El cajón" }) });
  await expect(cajon).toContainText("Faltaron $120.00.");
  await expect(cajon).toContainText("Se dejaron $3,000.00 para el día siguiente y se retiraron $16,880.00. Lo firmó Luis.");
  await foto(page, "22-el-corte-en-el-cierre");
  await salir(page);

  await entrar(page, g.servando);
  await expect(page.locator(".avisos-de-caja")).toContainText("no cuadró: faltaron $120.00. Lo contó Luis");
});

test("sin contar el cajón no se cierra: la pantalla del cierre pide contarlo primero", async ({ page }) => {
  const g = await gente();
  await sinContar(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByText("Antes de atender, cuenta el cajón")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hacer el corte y cerrar el día" })).toHaveCount(0);
  await expect(aviso(page)).toHaveCount(0);
  await contarElCajon(page, "1000");
  await cerrarConCorte(page, g.servando);
  await expect(page.getByRole("heading", { name: "El día de hoy ya se cerró" })).toBeVisible();
});

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, contar el cajón, sacar dinero y el corte miden lo que deben y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await sinContar(g);
    await darDeAltaEquipo(page);
    await entrar(page, g.luis);
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };
    await expect(page.getByText("Antes de atender, cuenta el cajón")).toBeVisible();
    await medir("contar el cajón, sin teclear");
    await contarElCajon(page, "123456.5");

    await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Cierre" }).click();
    await expect(page.getByRole("heading", { name: "El cajón" })).toBeVisible();
    await medir("el cajón, en el cierre");
    await page.getByRole("button", { name: "Sacar dinero" }).click();
    await teclear(page, "99999.99");
    await page.getByPlaceholder("La tienda, gasolina, un mandado…").fill("Un motivo largo para ver que nada se sale de la pantalla");
    await medir("sacar dinero");
    await page.getByRole("button", { name: "Pedir la clave de un responsable" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await medir("sacar dinero: quién autoriza", "dialog");
    await page.getByRole("dialog").getByRole("button", { name: "No hacerlo" }).click();
    await page.getByRole("button", { name: "No hacerlo" }).click();

    await page.getByRole("button", { name: "Hacer el corte y cerrar el día" }).click();
    await medir("el corte: contar");
    await teclear(page, "1000");
    await medir("el corte: no cuadra");
    await page.getByRole("button", { name: "Seguir" }).click();
    await medir("el corte: lo que se queda");
    await page.getByRole("button", { name: "Firmar el corte" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await medir("el corte: quién firma", "dialog");
  });
}
