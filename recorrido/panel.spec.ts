// El panel de quien dirige: el resumen con sus gráficas, los días que ha habido y la bitácora.
// Con tres días de movimiento: antier, ayer y hoy.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { altaDePersona, baseNueva, cerrarElDia, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide } from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** 2026-10-01 → 1 de octubre, como lo escribe la pantalla. */
const fechaCorta = (f: string): string => `${Number(f.slice(8))} de ${MESES[Number(f.slice(5, 7)) - 1]}`;

/**
 * Tres días con movimiento, y había 500 kg de Cartón al arrancar:
 *   antier — Luis compra 100 kg de Cartón ($210) y vende 40 ($100);
 *   ayer   — Luis compra 10 kg de PET ($75);
 *   hoy    — Servando compra 30 kg de Cartón ($63). Hoy sigue abierto.
 * Cada día se hace «hoy» y después se recorre la fecha de su jornada, que ya quedó cerrada.
 * Devuelve las tres fechas, AAAA-MM-DD.
 */
async function tresDias(g: Gente): Promise<{ antier: string; ayer: string; hoy: string }> {
  await diaListo(g, [["Cartón", "500"]]);
  return conConsola(async (db) => {
    const cuenta = async (tipo: "compra" | "venta", quien: string, material: string, kg: string): Promise<void> => {
      const id = randomUUID();
      await db.query("SELECT abrir_cuenta($1, $2, NULL, $3)", [id, tipo, quien]);
      await db.query("SELECT agregar_material($1, $2, (SELECT id FROM material WHERE nombre = $3), 2::smallint, $4, $5, $6)", [id, randomUUID(), material, randomUUID(), kg, quien]);
      await db.query("SELECT confirmar_cuenta($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [id, quien]);
    };
    const otroDia = async (): Promise<void> => {
      await cerrarElDia(db, g.luis.id);
      await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
      await db.query("UPDATE jornada SET fecha = fecha - 1");
      await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
      await db.query("SELECT abrir_jornada_de_hoy($1)", [g.luis.id]);
      await db.query("SELECT publicar_lista_de_hoy($1)", [g.servando.id]);
    };
    await cuenta("compra", g.luis.id, "Cartón", "100");
    await cuenta("venta", g.luis.id, "Cartón", "40");
    await otroDia();
    await cuenta("compra", g.luis.id, "PET", "10");
    await otroDia();
    await cuenta("compra", g.servando.id, "Cartón", "30");
    const f = (await db.query(
      "SELECT to_char(h - 2, 'YYYY-MM-DD') AS antier, to_char(h - 1, 'YYYY-MM-DD') AS ayer, to_char(h, 'YYYY-MM-DD') AS hoy, to_char(h - 6, 'YYYY-MM-DD') AS semana FROM (SELECT hoy_en(1::smallint) AS h) x",
    )).rows[0];
    return f;
  });
}

const indicador = (page: Page, nombre: string) => page.locator(".indicador").filter({ has: page.getByText(nombre, { exact: true }) });
const tarjeta = (page: Page, titulo: string) => page.locator(".card").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) });

test("quien dirige ve el resumen de la semana: lo comprado, lo vendido, día por día, lo que más se movió y lo que hay", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Panel" }).click();
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "true");

  // Los cuatro indicadores, de los siete días que terminan hoy.
  await expect(indicador(page, "Compras")).toContainText("$348");
  await expect(indicador(page, "Compras")).toContainText("3 cuentas · 140 kg");
  await expect(indicador(page, "Compras")).toContainText("Sin nada antes con qué comparar");
  await expect(indicador(page, "Ventas")).toContainText("$100");
  await expect(indicador(page, "Ventas")).toContainText("1 cuenta · 40 kg");
  await expect(indicador(page, "Ventas menos compras")).toContainText("−$248");
  await expect(indicador(page, "Ventas menos compras")).toContainText("No es la ganancia");
  await expect(indicador(page, "Cuentas terminadas").locator(".cifra")).toHaveText("4");

  // La gráfica, y sus números para quien los quiere exactos: cada día dice lo que su cierre.
  const serie = tarjeta(page, "Compras y ventas");
  await expect(serie.locator(".col")).toHaveCount(7);
  await expect(serie.locator(".tope")).toHaveText("$210");
  await serie.getByRole("button", { name: "En kilos" }).click();
  await expect(serie.locator(".tope")).toHaveText("100 kg");
  await serie.getByText("Ver los números").click();
  const filas = serie.locator("tbody tr");
  await expect(filas).toHaveCount(7);
  await expect(filas.nth(4)).toHaveText(`${fechaCorta(dias.antier)}$210$100100 kg40 kg2`);
  await expect(filas.nth(5)).toHaveText(`${fechaCorta(dias.ayer)}$75$010 kg0 kg1`);
  await expect(filas.nth(6)).toHaveText(`${fechaCorta(dias.hoy)}$63$030 kg0 kg1`);

  // Lo que más se movió, y lo que hay ahora con lo que valdría comprarlo hoy.
  const movidos = tarjeta(page, "Lo que más se movió").locator(".mov");
  await expect(movidos).toHaveCount(2);
  await expect(movidos.nth(0)).toContainText("Cartón");
  await expect(movidos.nth(0)).toContainText("Entró 130 kg · $273.00");
  await expect(movidos.nth(0)).toContainText("Salió 40 kg · $100.00");
  await expect(movidos.nth(1)).toContainText("PET");
  const hay = tarjeta(page, "Lo que hay en el patio");
  await expect(hay.locator(".tot.big")).toHaveText("Vale, a precio de compra$1,314.00");
  await expect(hay.locator(".mov").nth(0)).toContainText("Cartón$1,239.00");
  await expect(hay.locator(".mov").nth(0)).toContainText("590 kg × $2.10");
  await expect(hay).toContainText(`con la lista del ${fechaCorta(dias.hoy)}, no lo que costó`);

  // Quién atendió, y lo que conviene vigilar.
  await expect(tarjeta(page, "Quién atendió")).toContainText("Luis3 cuentas");
  await expect(tarjeta(page, "Quién atendió")).toContainText("Servando1 cuenta");
  await expect(tarjeta(page, "Para vigilar")).toContainText("Material dado de bajaNada");

  // Otro periodo: el rótulo dice de cuándo a cuándo.
  await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
  await expect(page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" })).toHaveAttribute("aria-pressed", "true");
  await expect(serie.locator(".col")).toHaveCount(13);
  await expect(serie.locator("header")).toContainText("Por semana");
  await expect(indicador(page, "Compras")).toContainText("$348");
});

test("si la respuesta de un periodo llega cuando ya se eligió otro, no se queda a la vista la que ya no se pidió", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.goto("/panel");
  await expect(indicador(page, "Compras")).toContainText("$348");
  // La de 30 días tarda; la de 7, no: llega primero la que se pidió después.
  await page.route(/\/api\/panel\?dias=30$/, async (ruta) => { await new Promise((listo) => setTimeout(listo, 1200)); await ruta.fallback(); });
  const periodo = page.getByRole("group", { name: "Periodo" });
  const lenta = page.waitForResponse((r) => r.url().endsWith("dias=30"));
  await periodo.getByRole("button", { name: "30 días" }).click();
  await periodo.getByRole("button", { name: "7 días" }).click();
  await lenta;
  await page.waitForTimeout(300);
  await expect(periodo.getByRole("button", { name: "7 días" })).toHaveAttribute("aria-pressed", "true");
  await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(7);
  await expect(page.locator(".periodo")).not.toContainText("cargando");
});

test("los días: cada uno con lo que dejó asentado y sus cuentas, y de cada cuenta su comprobante", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Días" }).click();
  await expect(page.getByRole("heading", { name: "Días" })).toBeVisible();
  // En la barra de arriba sigue siendo el panel.
  await expect(page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "true");

  const renglones = page.locator(".exrow.dia");
  await expect(renglones).toHaveCount(3);
  await expect(renglones.nth(0)).toContainText(fechaCorta(dias.hoy));
  await expect(renglones.nth(0)).toContainText("1 cuenta · abierto");
  await expect(renglones.nth(2)).toContainText(fechaCorta(dias.antier));
  await expect(renglones.nth(2)).toContainText("2 cuentas · cerrado");
  await expect(renglones.nth(2)).toContainText("Compras $210");
  await expect(renglones.nth(2)).toContainText("Ventas $100");

  // Antier: el mismo reporte de su cierre, y sus dos cuentas.
  await renglones.nth(2).click();
  await expect(page.getByRole("heading", { name: new RegExp(fechaCorta(dias.antier) + "$") })).toBeVisible();
  await expect(tarjeta(page, "Dinero del día")).toContainText("A pagar por compras$210");
  await expect(tarjeta(page, "Dinero del día")).toContainText("A cobrar por ventas$100");
  await expect(page.getByRole("heading", { name: `Kilos del ${fechaCorta(dias.antier)}` })).toBeVisible();
  const cuentas = tarjeta(page, "Cuentas del día").locator(".exrow");
  await expect(cuentas).toHaveCount(2);
  await expect(cuentas.nth(0)).toContainText("Compra");
  await expect(cuentas.nth(0)).toContainText("Folio 1 ·");
  await expect(cuentas.nth(0)).toContainText("1 material · atendió Luis");
  await expect(cuentas.nth(0)).toContainText("$210");
  // Desde aquí no se cierra ni se reabre nada: es para ver.
  await expect(page.getByRole("button", { name: /Cerrar el día|Reabrir el día/ })).toHaveCount(0);

  // El comprobante de la primera, sin poder reimprimirlo desde aquí; y de vuelta al día.
  await cuentas.nth(0).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$210");
  await expect(page.getByRole("button", { name: /imprimir/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(tarjeta(page, "Cuentas del día")).toBeVisible();
  await page.getByRole("button", { name: "‹ Días" }).click();
  await expect(renglones).toHaveCount(3);
});

test("la bitácora dice en palabras llanas quién hizo qué, y se puede buscar por persona", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.goto("/panel/bitacora");
  await expect(page.getByRole("heading", { name: "Bitácora" })).toBeVisible();
  const asientos = page.locator(".asiento");
  // Lo más reciente primero: dar de alta este equipo fue lo último; antes, la compra de hoy, de Servando.
  await expect(asientos.nth(0)).toContainText("dio de alta el equipo Mostrador");
  await expect(asientos.nth(1)).toContainText("Servando confirmó la compra 4 por $63.00");
  await expect(page.locator(".asiento").filter({ hasText: "Luis cerró el día" })).toHaveCount(2);
  await expect(page.locator(".asiento").filter({ hasText: "Servando publicó los precios" })).toHaveCount(3);
  await expect(asientos.first().locator(".hora")).toHaveText(/^\d{2}:\d{2}$/);

  await page.getByLabel("Quién").selectOption({ label: "Luis" });
  await expect(page.locator(".asiento").filter({ hasText: "Servando" })).toHaveCount(0);
  await expect(page.locator(".asiento").filter({ hasText: "Luis confirmó la venta 2 por $100.00" })).toHaveCount(1);
  await page.getByRole("button", { name: "Ver todo" }).click();
  await expect(asientos.nth(1)).toContainText("Servando confirmó la compra 4 por $63.00");

  // Lo de una búsqueda que llega cuando ya se pidió otra no se queda a la vista: aquí, lo de Luis tarda.
  await page.route(/\/api\/bitacora\?persona=/, async (ruta) => { await new Promise((listo) => setTimeout(listo, 1200)); await ruta.fallback(); });
  const lenta = page.waitForResponse((r) => r.url().includes("/api/bitacora?persona="));
  await page.getByLabel("Quién").selectOption({ label: "Luis" });
  await page.getByRole("button", { name: "Ver todo" }).click();
  await lenta;
  await page.waitForTimeout(300);
  await expect(page.getByLabel("Quién")).toHaveValue("");
  await expect(page.locator(".asiento").filter({ hasText: "Servando publicó los precios" })).toHaveCount(3);
});

test("el panel es de quien dirige y de quien consulta: al mostrador no se le ofrece, y si escribe la dirección, tampoco", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  const ana = await altaDePersona("Ana", "consulta", "3141");
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await expect(page.getByRole("link", { name: "Panel" })).toHaveCount(0);
  for (const camino of ["/panel", "/panel/dias", "/panel/bitacora"]) {
    await page.goto(camino);
    await expect(page.getByText("El panel es para quien dirige el negocio.")).toBeVisible();
    await expect(page.locator(".indicador, .exrow, .asiento")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await entrar(page, ana);
  await page.getByRole("link", { name: "Panel" }).click();
  await expect(indicador(page, "Compras")).toContainText("$348");
});

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, en el resumen, los días y la bitácora todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await tresDias(g);
    await contarImpresiones(page);
    await darDeAltaEquipo(page);
    await entrar(page, g.servando);
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };

    await page.goto("/panel");
    await expect(indicador(page, "Compras")).toContainText("$348");
    await medir("el resumen");
    await tarjeta(page, "Compras y ventas").getByText("Ver los números").click();
    await medir("el resumen, con los números abiertos");

    await page.getByRole("link", { name: "Días" }).click();
    await expect(page.locator(".exrow.dia")).toHaveCount(3);
    await medir("los días");
    await page.locator(".exrow.dia").nth(2).click();
    await expect(tarjeta(page, "Cuentas del día").locator(".exrow")).toHaveCount(2);
    await medir("un día");

    await page.getByRole("link", { name: "Bitácora" }).click();
    await expect(page.locator(".asiento").first()).toBeVisible();
    await medir("la bitácora");
  });
}

// Capturas, para verlas sin levantar nada. Corre solo si se piden:
//   docker compose --profile recorrido run --rm -e CAPTURAS=1 recorrido npx playwright test panel -g capturas
test("capturas del panel", async ({ page }) => {
  test.skip(!process.env.CAPTURAS, "solo cuando se piden capturas");
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  for (const [nombre, ancho, alto, esquema] of [["", 1180, 820, "light"], ["-telefono", 390, 800, "light"], ["-oscuro", 1180, 820, "dark"]] as const) {
    await page.setViewportSize({ width: ancho, height: alto });
    await page.emulateMedia({ colorScheme: esquema });
    const foto = (que: string) => page.screenshot({ path: `recorrido/capturas/panel/${que}${nombre}.png`, fullPage: true });
    await page.goto("/panel");
    await expect(indicador(page, "Compras")).toContainText("$348");
    await foto("1-resumen");
    await page.goto("/panel/dias");
    await expect(page.locator(".exrow.dia")).toHaveCount(3);
    await foto("2-dias");
    await page.locator(".exrow.dia").nth(2).click();
    await expect(tarjeta(page, "Cuentas del día").locator(".exrow")).toHaveCount(2);
    await foto("3-un-dia");
    await page.goto("/panel/bitacora");
    await expect(page.locator(".asiento").first()).toBeVisible();
    await foto("4-bitacora");
  }
});

// Las mismas pantallas, con las ocho semanas que deja el sembrador de la demostración: así se ven
// con historia. También corre solo si se piden, y además pide MODO=desarrollo, como el sembrador:
//   docker compose --profile recorrido run --rm -e CAPTURAS=1 -e MODO=desarrollo recorrido npx playwright test panel -g "ocho semanas"
test("capturas del panel con ocho semanas de demostración", async ({ page }) => {
  test.skip(!process.env.CAPTURAS || process.env.MODO !== "desarrollo", "solo cuando se piden capturas, en desarrollo");
  test.setTimeout(240_000);
  const g = await gente();
  const { sembrarDemo } = await import("../consola/demo.ts");
  const base = new URL(process.env.PG_ADMIN_URL ?? "postgres://feruga:recorrido@db_recorrido:5432/postgres");
  base.pathname = "/feruga";
  await sembrarDemo({ url: base.toString() });
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  for (const [nombre, ancho, alto, esquema] of [["", 1180, 820, "light"], ["-telefono", 390, 800, "light"], ["-oscuro", 1180, 820, "dark"]] as const) {
    await page.setViewportSize({ width: ancho, height: alto });
    await page.emulateMedia({ colorScheme: esquema });
    const foto = (que: string) => page.screenshot({ path: `recorrido/capturas/panel/demo-${que}${nombre}.png`, fullPage: true });
    await page.goto("/panel");
    await expect(page.locator(".indicador").first()).toBeVisible();
    await foto("1-resumen-7-dias");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "30 días" }).click();
    await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(30);
    await foto("2-resumen-30-dias");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
    await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(13);
    await foto("3-resumen-3-meses");
    await page.goto("/panel/dias");
    await expect(page.locator(".exrow.dia").first()).toBeVisible();
    await foto("4-dias");
    await page.locator(".exrow.dia").nth(1).click();
    await expect(tarjeta(page, "Cuentas del día").locator(".exrow").first()).toBeVisible();
    await foto("5-un-dia");
    await page.goto("/panel/bitacora");
    await expect(page.locator(".asiento").first()).toBeVisible();
    await foto("6-bitacora");
  }
});
