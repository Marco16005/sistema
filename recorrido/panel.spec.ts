// El panel de quien dirige: el resumen con sus gráficas, los días que ha habido, los materiales, la
// historia de precios, los clientes, la bitácora y sacar reportes.
// Con tres días de movimiento: antier, ayer y hoy.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { altaDePersona, aviso, baseNueva, cerrarElDia, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, impresiones, loQueNoMide } from "./apoyo.ts";
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
 * Devuelve las tres fechas y la de hace seis días (el primero de los últimos siete), AAAA-MM-DD.
 */
async function tresDias(g: Gente): Promise<{ antier: string; ayer: string; hoy: string; semana: string }> {
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

/**
 * Entra, y espera a que la aplicación termine de llevar a esa persona a su pantalla: pedir otra
 * dirección antes de eso interrumpe ese viaje, y a veces gana él.
 */
async function adentro(page: Page, persona: Gente["servando"]): Promise<void> {
  await entrar(page, persona);
  await page.waitForURL((u) => u.pathname !== "/");
}

const indicador = (page: Page, nombre: string) => page.locator(".indicador").filter({ has: page.getByText(nombre, { exact: true }) });
const tarjeta = (page: Page, titulo: string) => page.locator(".card").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) });

test("quien dirige ve el resumen de la semana: lo comprado, lo vendido, día por día, lo que más se movió y lo que hay", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
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

  // La cuenta promedio: tres compras por $348 y 140 kg; una venta.
  await expect(indicador(page, "Compras")).toContainText("En promedio, $116 y 46.7 kg por cuenta");
  await expect(indicador(page, "Ventas")).toContainText("En promedio, $100 y 40 kg por cuenta");

  // Qué día de la semana: antier hubo dos cuentas, y ayer y hoy, una. En siete días cada día cae una vez.
  const semana = tarjeta(page, "Qué día de la semana");
  await expect(semana.locator(".col")).toHaveCount(7);
  await expect(semana.locator(".tope")).toHaveText("2 por día");
  const elFuerte = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(`${dias.antier}T00:00:00Z`).getUTCDay()]!;
  await expect(semana).toContainText(`El más fuerte es el ${elFuerte}: 2 cuentas por día.`);
  await expect(semana.locator("ul.oculto li")).toHaveCount(7);
  await expect(semana.locator("ul.oculto")).toContainText(`Los ${elFuerte}, 2 por día: 2 cuentas en 1 día`);

  // Quién atendió —con lo que cobró cada quien—, y lo que conviene vigilar.
  const atendio = tarjeta(page, "Quién atendió").locator(".mov");
  await expect(atendio).toHaveText(["Luis3 cuentas2 compras por $285 · 1 venta por $100 · 150 kg pesados", "Servando1 cuenta1 compra por $63 · 30 kg pesados"]);
  await expect(tarjeta(page, "Para vigilar")).toContainText("Material dado de bajaNada");
  await expect(tarjeta(page, "Para vigilar")).toContainText("Kilos descontados en el mostradorNinguno");

  // Otro periodo: el rótulo dice de cuándo a cuándo.
  await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
  await expect(page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" })).toHaveAttribute("aria-pressed", "true");
  await expect(serie.locator(".col")).toHaveCount(13);
  await expect(serie.locator("header")).toContainText("Por semana");
  await expect(indicador(page, "Compras")).toContainText("$348");
});

test("el resumen de otro periodo, de tal día a tal día: lo suyo, y se compara con los mismos días de antes", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await expect(indicador(page, "Compras")).toContainText("$348");
  const periodo = page.getByRole("group", { name: "Periodo" });
  await periodo.getByRole("button", { name: "Otro periodo" }).click();
  await expect(periodo.getByRole("button", { name: "Otro periodo" })).toHaveAttribute("aria-pressed", "true");
  await expect(periodo.getByRole("button", { name: "7 días" })).toHaveAttribute("aria-pressed", "false");

  // Solo antier: la compra de $210 y la venta de $100. Antes de ese día no hubo nada.
  await page.getByLabel("Desde").fill(dias.antier);
  await page.getByLabel("Hasta").fill(dias.antier);
  await expect(page.locator(".periodo")).toHaveText(`Del ${fechaCorta(dias.antier)} al ${fechaCorta(dias.antier)}`);
  await expect(indicador(page, "Compras")).toContainText("$2101 cuenta · 100 kg");
  await expect(indicador(page, "Compras")).toContainText("Sin nada antes con qué comparar");
  await expect(indicador(page, "Ventas")).toContainText("$1001 cuenta · 40 kg");
  await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(1);

  // Solo ayer: una compra de $75, y se compara con el día anterior, que tuvo $210.
  await page.getByLabel("Desde").fill(dias.ayer);
  await page.getByLabel("Hasta").fill(dias.ayer);
  await expect(indicador(page, "Compras")).toContainText("$751 cuenta · 10 kg");
  await expect(indicador(page, "Compras")).toContainText("▼ 64.3 % menos que el día anterior");

  // De antier a hoy: tres días, y se compara con los tres de antes.
  await page.getByLabel("Desde").fill(dias.antier);
  await page.getByLabel("Hasta").fill(dias.hoy);
  await expect(indicador(page, "Compras")).toContainText("$3483 cuentas · 140 kg");
  await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(3);
  await expect(page.locator(".periodo")).toHaveText(`Del ${fechaCorta(dias.antier)} al ${fechaCorta(dias.hoy)}`);

  // Al revés no se pide: se dice qué falta, y lo que estaba a la vista —solo hoy— se queda.
  await page.getByLabel("Desde").fill(dias.hoy);
  await expect(indicador(page, "Compras")).toContainText("$631 cuenta · 30 kg");
  await page.getByLabel("Hasta").fill(dias.antier);
  await expect(page.getByText("El primer día no puede ser posterior al último.")).toBeVisible();
  await expect(indicador(page, "Compras")).toContainText("$631 cuenta · 30 kg");
  await expect(page.locator(".periodo")).toHaveText(`Del ${fechaCorta(dias.hoy)} al ${fechaCorta(dias.hoy)}`);

  // De vuelta a un periodo de un toque: ya no se pregunta de qué día a qué día.
  await periodo.getByRole("button", { name: "7 días" }).click();
  await expect(page.getByLabel("Desde")).toHaveCount(0);
  await expect(page.locator(".periodo")).toHaveText(`Del ${fechaCorta(dias.semana)} al ${fechaCorta(dias.hoy)}`);
  await expect(indicador(page, "Compras")).toContainText("Sin nada antes con qué comparar");
});

test("si la respuesta de un periodo llega cuando ya se eligió otro, no se queda a la vista la que ya no se pidió", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
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
  await adentro(page, g.servando);
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
  // El título del día (más abajo hay otro encabezado que también termina con la fecha).
  await expect(page.locator(".top h2")).toHaveText(new RegExp(fechaCorta(dias.antier) + "$"));
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
  await adentro(page, g.servando);
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

/**
 * Tres días con lista publicada, sin ninguna cuenta:
 *   antier — la del arranque: Cartón a 2.10 y 2.50, PET a 7.50 y 8.90, y tres materiales más;
 *   ayer   — el Cartón sube a 2.30 y 2.80, y el PET se queda sin precio;
 *   hoy    — el Cartón baja a 2.20 de compra; la venta sigue en 2.80. Hoy sigue abierto.
 * Devuelve las tres fechas y el primer día de los últimos treinta.
 */
async function preciosQueSeMueven(g: Gente): Promise<{ antier: string; ayer: string; hoy: string; hace29: string }> {
  await diaListo(g);
  return conConsola(async (db) => {
    const otroDia = async (cambios: Array<[string, string, string] | [string]>): Promise<void> => {
      await cerrarElDia(db, g.luis.id);
      await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
      await db.query("UPDATE jornada SET fecha = fecha - 1");
      await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
      await db.query("SELECT abrir_jornada_de_hoy($1)", [g.luis.id]);
      for (const [material, compra, venta] of cambios) {
        if (compra === undefined) await db.query("SELECT quitar_precio((SELECT id FROM material WHERE nombre = $1), $2)", [material, g.servando.id]);
        else await db.query("SELECT fijar_precio((SELECT id FROM material WHERE nombre = $1), $2, $3, $4)", [material, compra, venta, g.servando.id]);
      }
      await db.query("SELECT publicar_lista_de_hoy($1)", [g.servando.id]);
    };
    await otroDia([["Cartón", "2.3", "2.8"], ["PET"]]);
    await otroDia([["Cartón", "2.2", "2.8"]]);
    return (await db.query(
      "SELECT to_char(h - 2, 'YYYY-MM-DD') AS antier, to_char(h - 1, 'YYYY-MM-DD') AS ayer, to_char(h, 'YYYY-MM-DD') AS hoy, to_char(h - 29, 'YYYY-MM-DD') AS hace29 FROM (SELECT hoy_en(1::smallint) AS h) x",
    )).rows[0];
  });
}

const material = (page: Page, nombre: string) => page.locator(".exrow.material").filter({ has: page.getByText(nombre, { exact: true }) });

test("la historia de precios: qué materiales cambiaron y cuánto, y de cada uno sus cambios día por día", async ({ page }) => {
  const g = await gente();
  const dias = await preciosQueSeMueven(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Precios" }).click();
  await expect(page.getByRole("heading", { name: "Historia de precios" })).toBeVisible();
  // En la barra de arriba sigue siendo el panel, no la lista de precios de hoy.
  const barra = page.getByRole("navigation", { name: "Pantallas" });
  await expect(barra.getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "true");
  await expect(barra.getByRole("link", { name: "Precios" })).toHaveAttribute("aria-current", "false");
  await expect(page.locator(".periodo")).toHaveText(`Del ${fechaCorta(dias.hace29)} al ${fechaCorta(dias.hoy)} · 3 listas publicadas`);

  await expect(indicador(page, "Listas publicadas").locator(".cifra")).toHaveText("3");
  await expect(indicador(page, "Cambiaron de precio").locator(".cifra")).toHaveText("2 de 5");
  await expect(indicador(page, "La compra que más subió").locator(".cifra")).toHaveText("▲ 4.8 %");
  await expect(indicador(page, "La compra que más subió")).toContainText("Cartón: de $2.10 a $2.20");
  await expect(indicador(page, "La compra que más bajó").locator(".cifra")).toHaveText("Ninguna");

  // Cada material: cuántas veces cambió, su rayita y lo que vale hoy.
  await expect(page.locator(".exrow.material")).toHaveCount(5);
  await expect(material(page, "Cartón")).toContainText("Cambió 2 veces");
  await expect(material(page, "Cartón").locator(".dinero small").nth(0)).toHaveText("Compra $2.20▲subió 4.8 %");
  await expect(material(page, "Cartón").locator(".dinero small").nth(1)).toHaveText("Venta $2.80▲subió 12 %");
  await expect(material(page, "Cartón").locator("svg path")).toHaveCount(1);
  await expect(material(page, "PET")).toContainText("Cambió una vez");
  await expect(material(page, "PET")).toContainText("Hoy no tiene precio");
  await expect(material(page, "Aluminio bote")).toContainText("No cambió");
  await expect(material(page, "Aluminio bote").locator(".dinero")).toHaveText("Compra $28.00Venta $33.00");

  // El Cartón, cambio por cambio: del más reciente al más viejo, con su flecha donde se movió.
  await material(page, "Cartón").click();
  await expect(page.getByRole("heading", { name: "Cartón", exact: true })).toBeVisible();
  await expect(indicador(page, "Compra, por kilo").locator(".cifra")).toHaveText("$2.20");
  await expect(indicador(page, "Compra, por kilo")).toContainText("4.8 % en el periodo: empezó en $2.10");
  await expect(indicador(page, "Venta, por kilo")).toContainText("12 % en el periodo: empezó en $2.50");
  const grafica = tarjeta(page, "Precio por kilo");
  await expect(grafica.locator("svg path")).toHaveCount(2);
  await expect(grafica.locator(".tope").first()).toHaveText("$2.80");
  await expect(grafica.locator(".tope").last()).toHaveText("$2.10");
  const cambios = tarjeta(page, "Cada cambio").locator("tbody tr");
  await expect(cambios).toHaveCount(3);
  await expect(cambios.nth(0).locator("td")).toHaveText([new RegExp(fechaCorta(dias.hoy) + "$"), "$2.20 ▼ bajó", "$2.80"]);
  await expect(cambios.nth(1).locator("td")).toHaveText([new RegExp(fechaCorta(dias.ayer) + "$"), "$2.30 ▲ subió", "$2.80 ▲ subió"]);
  await expect(cambios.nth(2).locator("td")).toHaveText([new RegExp(fechaCorta(dias.antier) + "$"), "$2.10", "$2.50"]);

  // De vuelta, y el PET: se quedó sin precio ayer.
  await page.getByRole("button", { name: "‹ Precios" }).click();
  await material(page, "PET").click();
  await expect(indicador(page, "Compra, por kilo").locator(".cifra")).toHaveText("Sin precio");
  await expect(tarjeta(page, "Cada cambio").locator("tbody tr").nth(0)).toContainText("Se quedó sin precio");
  await expect(tarjeta(page, "Cada cambio").locator("tbody tr").nth(1)).toContainText("$7.50");
});

test("si la historia de un periodo llega cuando ya se eligió otro, no se queda a la vista la que ya no se pidió", async ({ page }) => {
  const g = await gente();
  const dias = await preciosQueSeMueven(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/precios");
  await expect(page.locator(".exrow.material")).toHaveCount(5);
  // La de 3 meses tarda; la de 30 días, no: llega primero la que se pidió después.
  await page.route(/\/api\/precios\/historia\?dias=91$/, async (ruta) => { await new Promise((listo) => setTimeout(listo, 1200)); await ruta.fallback(); });
  const periodo = page.getByRole("group", { name: "Periodo" });
  const lenta = page.waitForResponse((r) => r.url().endsWith("dias=91"));
  await periodo.getByRole("button", { name: "3 meses" }).click();
  await periodo.getByRole("button", { name: "30 días" }).click();
  await lenta;
  await page.waitForTimeout(300);
  await expect(periodo.getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".periodo")).toHaveText(`Del ${fechaCorta(dias.hace29)} al ${fechaCorta(dias.hoy)} · 3 listas publicadas`);
});

/**
 * Hoy, con el día ya abierto y con precios: tres cuentas con precio especial y una sin él.
 *   Don Chuy  — una compra de 100 kg de Cartón a 50 centavos más ($260: $50.00 de más que la lista)
 *               y una venta de 40 kg a 10 centavos menos ($96: $4.00 de menos);
 *   Doña Lupe — una compra de 10 kg de PET a un peso más ($85: $10.00 de más);
 *   y una compra de 30 kg de Cartón a precio de lista, que no queda a nombre de nadie.
 * Atiende Luis y autoriza Servando, desde un equipo dado de alta para eso.
 */
async function clientesDeHoy(g: Gente): Promise<void> {
  await conConsola(async (db) => {
    const huella = createHash("sha256").update(randomUUID()).digest("hex");
    const codigo = (await db.query("SELECT crear_codigo_alta('Oficina') AS c")).rows[0].c;
    await db.query("SELECT canjear_codigo($1, $2)", [codigo, huella]);
    const cuenta = async (tipo: "compra" | "venta", material: string, kg: string, especial?: [cliente: string, diferencia: string]): Promise<void> => {
      const [id, linea] = [randomUUID(), randomUUID()];
      await db.query("SELECT abrir_cuenta($1, $2, NULL, $3)", [id, tipo, g.luis.id]);
      await db.query("SELECT agregar_material($1, $2, (SELECT id FROM material WHERE nombre = $3), 2::smallint, $4, $5, $6)", [id, linea, material, randomUUID(), kg, g.luis.id]);
      if (especial) {
        const ya = (await db.query("SELECT id FROM cliente WHERE nombre = $1", [especial[0]])).rows[0]?.id ?? null;
        await db.query("SELECT dar_precio_especial($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10)", [
          randomUUID(), id, linea, ya, ya === null ? especial[0] : null, especial[1], g.servando.id, g.servando.clave, huella, g.luis.id,
        ]);
      }
      await db.query("SELECT confirmar_cuenta($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [id, g.luis.id]);
    };
    await cuenta("compra", "Cartón", "100", ["Don Chuy", "0.5"]);
    await cuenta("venta", "Cartón", "40", ["Don Chuy", "-0.1"]);
    await cuenta("compra", "PET", "10", ["Doña Lupe", "1"]);
    await cuenta("compra", "Cartón", "30");
  });
}

const cliente = (page: Page, nombre: string) => page.locator(".exrow.cliente").filter({ has: page.getByText(nombre, { exact: true }) });

test("los materiales: cuánto hay de cada uno y cuánto lleva sin salir; y de cada material su ficha, con lo que entró, lo que salió y a cuánto el kilo", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Materiales" }).click();
  await expect(page.getByRole("heading", { name: "Materiales", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Materiales" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".periodo")).toHaveText(`Al ${fechaCorta(dias.hoy)} · valuado con la lista del ${fechaCorta(dias.hoy)}`);

  // Lo que hay: 590 kg de Cartón a $2.10 y 10 de PET a $7.50. Nada lleva treinta días sin salir.
  await expect(indicador(page, "Lo que hay vale").locator(".cifra")).toHaveText("$1,314.00");
  await expect(indicador(page, "Con existencia")).toContainText("2materiales");
  await expect(indicador(page, "Se están quedando")).toContainText("0Nada lleva 30 días sin salir");
  await expect(indicador(page, "El que más lleva sin salir")).toContainText("2 díasCartón");
  await expect(tarjeta(page, "Se están quedando")).toHaveCount(0);
  const seMueven = tarjeta(page, "Se mueven").locator(".exrow");
  await expect(seMueven).toHaveCount(2);
  // El Cartón salió antier: 590 kg entre los 40 que salieron en cuatro semanas. El PET llegó ayer y no se ha vendido.
  await expect(seMueven.nth(0)).toHaveText("CartónLleva 2 días sin salirAlcanza para 413 días590 kg");
  await expect(seMueven.nth(1)).toHaveText("PETLlegó ayer y no ha salidoSin salidas en cuatro semanas10 kg");

  // La ficha del Cartón, en los treinta días que terminan hoy.
  await seMueven.nth(0).click();
  await expect(page.getByRole("heading", { name: "Cartón", exact: true })).toBeVisible();
  await expect(page.locator(".periodo")).toContainText(`al ${fechaCorta(dias.hoy)}`);
  await expect(indicador(page, "Se pagó, por kilo")).toContainText("$2.10130 kg en 2 cuentas · $273.00");
  await expect(indicador(page, "Se cobró, por kilo")).toContainText("$2.5040 kg en 1 cuenta · $100.00");
  await expect(indicador(page, "Diferencia por kilo")).toContainText("$0.40No es la ganancia");
  await expect(indicador(page, "En el patio")).toContainText("590 kgLleva 2 días sin salir · alcanza para 413 díasVale $1,239.00 a precio de compra");

  const serie = tarjeta(page, "Lo que entró y lo que salió");
  await expect(serie.locator(".col")).toHaveCount(30);
  await expect(serie.locator(".tope")).toHaveText("100 kg");
  await serie.getByText("Ver los números").click();
  const filas = serie.locator("tbody tr");
  await expect(filas).toHaveCount(30);
  await expect(filas.nth(27)).toContainText(`${fechaCorta(dias.antier)}100 kg$210.0040 kg$100.00`);
  await expect(filas.nth(28)).toContainText(`${fechaCorta(dias.ayer)}0 kg$0.000 kg$0.00`);
  await expect(filas.nth(29)).toHaveText(`${fechaCorta(dias.hoy)}30 kg$63.000 kg$0.00590 kg`);

  // Su precio junto a sus kilos: la compra, y al tocar «Venta», la venta.
  const precioYKilos = tarjeta(page, "El precio y los kilos");
  await expect(precioYKilos.locator("svg.escalones path.compra")).toHaveCount(1);
  await expect(precioYKilos.locator(".col")).toHaveCount(30);
  await expect(precioYKilos.locator(".tope").first()).toHaveText("$2.10 por kilo");
  await expect(precioYKilos).toContainText("los kilos que entraron cada día");
  await precioYKilos.getByRole("button", { name: "Venta" }).click();
  await expect(precioYKilos.locator("svg.escalones path.venta")).toHaveCount(1);
  await expect(precioYKilos.locator(".tope").first()).toHaveText("$2.50 por kilo");
  await expect(precioYKilos).toContainText("los kilos que salieron cada día");

  await expect(tarjeta(page, "Lo que ha habido en el patio")).toContainText("hoy hay 590 kg");
  await expect(tarjeta(page, "Para vigilar")).toContainText("Material dado de bajaNada");
  await expect(tarjeta(page, "Para vigilar")).toContainText("Se pesó y no se pagó, en comprasNada");

  // A tres meses va por semanas.
  await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
  await expect(serie.locator(".col")).toHaveCount(13);
  await expect(serie.locator("header")).toContainText("Kilos por semana");
  await expect(page.locator(".periodo")).not.toContainText("cargando");
  await expect(indicador(page, "Se pagó, por kilo")).toContainText("$2.10");

  // De vuelta a la lista, y otro material: uno que no se ha vendido.
  await page.getByRole("button", { name: "‹ Materiales" }).click();
  await tarjeta(page, "Se mueven").locator(".exrow").nth(1).click();
  await expect(page.getByRole("heading", { name: "PET", exact: true })).toBeVisible();
  await expect(indicador(page, "Se cobró, por kilo")).toContainText("NadaNo se vendió en este periodo");
  await expect(indicador(page, "Diferencia por kilo")).toContainText("—Hace falta haberlo comprado y vendido en el periodo.");
  await expect(indicador(page, "En el patio")).toContainText("10 kgLlegó ayer y no ha salido · sin salidas en cuatro semanas");
});

test("lo que lleva treinta días o más sin salir se dice aparte: se está quedando", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  // Lo de antier pasa a ser de hace cuarenta días: el Cartón lleva cuarenta sin salir.
  await conConsola(async (db) => {
    await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
    await db.query("UPDATE jornada SET fecha = fecha - 38 WHERE fecha = hoy_en(1::smallint) - 2");
    await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
  });
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/materiales");
  await expect(indicador(page, "Se están quedando")).toContainText("1Con 30 días o más sin salir · valen $1,239.00");
  await expect(indicador(page, "El que más lleva sin salir")).toContainText("40 díasCartón");
  await expect(tarjeta(page, "Se están quedando").locator(".exrow")).toHaveText(["CartónLleva 40 días sin salirSin salidas en cuatro semanas590 kg"]);
  await expect(tarjeta(page, "Se mueven").locator(".exrow")).toHaveText(["PETLlegó ayer y no ha salidoSin salidas en cuatro semanas10 kg"]);
});

test("en los materiales, la ficha de un periodo que llega tarde no tapa la del periodo que ya se eligió", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/materiales");
  await tarjeta(page, "Se mueven").locator(".exrow").first().click();
  const serie = tarjeta(page, "Lo que entró y lo que salió");
  await expect(serie.locator(".col")).toHaveCount(30);
  // La de tres meses tarda; la de 30 días, no: llega primero la que se pidió después.
  await page.route(/\/api\/panel\/materiales\/\d+\?dias=91$/, async (ruta) => { await new Promise((listo) => setTimeout(listo, 1200)); await ruta.fallback(); });
  const periodo = page.getByRole("group", { name: "Periodo" });
  const lenta = page.waitForResponse((r) => r.url().endsWith("dias=91"));
  await periodo.getByRole("button", { name: "3 meses" }).click();
  await periodo.getByRole("button", { name: "30 días" }).click();
  await lenta;
  await page.waitForTimeout(300);
  await expect(periodo.getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");
  await expect(serie.locator(".col")).toHaveCount(30);
  await expect(page.locator(".periodo")).not.toContainText("cargando");
});

test("los clientes: a quién se le da precio especial, cuánto se le ha comprado y vendido, y cuánto movieron sus precios respecto de la lista", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await clientesDeHoy(g);
  const hoy = await conConsola(async (db) => (await db.query("SELECT to_char(hoy_en(1::smallint), 'YYYY-MM-DD') AS f")).rows[0].f as string);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Clientes" }).click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "true");

  // Lo de todos: la cuenta a precio de lista no es de nadie, y no suma aquí.
  await expect(indicador(page, "Clientes").locator(".cifra")).toHaveText("2");
  await expect(indicador(page, "Cuentas a su nombre").locator(".cifra")).toHaveText("3");
  await expect(indicador(page, "Sus precios en compras")).toContainText("$60.00");
  await expect(indicador(page, "Sus precios en compras")).toContainText("Se pagó de más que con la lista");
  await expect(indicador(page, "Sus precios en ventas")).toContainText("$4.00");
  await expect(indicador(page, "Sus precios en ventas")).toContainText("Se cobró de menos que con la lista");

  await expect(page.locator(".exrow.cliente")).toHaveCount(2);
  await expect(cliente(page, "Don Chuy")).toContainText(`2 cuentas · la última, el ${fechaCorta(hoy)}`);
  await expect(cliente(page, "Don Chuy").locator(".dinero")).toHaveText("Compras $260Ventas $96");
  await expect(cliente(page, "Doña Lupe")).toContainText("1 cuenta ·");
  await expect(cliente(page, "Doña Lupe").locator(".dinero")).toHaveText("Compras $85Ventas $0");

  // Don Chuy: lo que se le compró y vendió, sus precios uno por uno, y sus cuentas.
  await cliente(page, "Don Chuy").click();
  await expect(page.getByRole("heading", { name: "Don Chuy", exact: true })).toBeVisible();
  await expect(indicador(page, "Se le compró")).toContainText("$260");
  await expect(indicador(page, "Se le compró")).toContainText("1 cuenta · 100 kg");
  await expect(indicador(page, "Se le vendió")).toContainText("$96");
  await expect(indicador(page, "Se le vendió")).toContainText("1 cuenta · 40 kg");
  await expect(indicador(page, "Sus precios en compras")).toContainText("$50.00");
  await expect(indicador(page, "Sus precios en compras")).toContainText("Se le pagó de más que con la lista");
  await expect(indicador(page, "Sus precios en ventas")).toContainText("Se le cobró de menos que con la lista");
  const precios = tarjeta(page, "Sus precios especiales").locator(".mov");
  await expect(precios).toHaveCount(2);
  // Lo más reciente primero: la venta, a menos que la lista.
  await expect(precios.nth(0)).toContainText("Cartón$4.00 de menos");
  await expect(precios.nth(0)).toContainText(`Venta 2 · ${fechaCorta(hoy)} · 40 kg`);
  await expect(precios.nth(0)).toContainText("A $2.40 por kilo; en la lista estaba a $2.50");
  await expect(precios.nth(0)).toContainText("Lo autorizó Servando");
  await expect(precios.nth(1)).toContainText("Cartón$50.00 de más");
  await expect(precios.nth(1)).toContainText("A $2.60 por kilo; en la lista estaba a $2.10");
  const movido = tarjeta(page, "Lo que se le compró y vendió").locator(".mov");
  await expect(movido).toHaveCount(1);
  await expect(movido).toContainText("Se le compró 100 kg · $260.00");
  await expect(movido).toContainText("Se le vendió 40 kg · $96.00");

  // De cada cuenta, su comprobante, sin poder reimprimirlo desde aquí.
  const cuentas = tarjeta(page, "Sus cuentas").locator(".exrow");
  await expect(cuentas).toHaveCount(2);
  await expect(cuentas.nth(1)).toContainText("Compra ·");
  await expect(cuentas.nth(1)).toContainText("Folio 1 · 1 material · atendió Luis");
  await cuentas.nth(1).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$260");
  await expect(page.getByRole("button", { name: /imprimir/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(tarjeta(page, "Sus cuentas")).toBeVisible();
  await page.getByRole("button", { name: "‹ Clientes" }).click();
  await expect(page.locator(".exrow.cliente")).toHaveCount(2);

  // A Doña Lupe solo se le ha comprado: de lo que no hay, no se pone renglón.
  await cliente(page, "Doña Lupe").click();
  await expect(tarjeta(page, "Lo que se le compró y vendió").locator(".mov")).toHaveText("PETSe le compró 10 kg · $85.00");
});

test("sin clientes, la pantalla lo dice y explica de dónde salen", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/clientes");
  await expect(page.getByText("Todavía no hay clientes: se dan de alta en Ajustes, o en el mostrador al darles su primer precio especial.")).toBeVisible();
  await expect(page.locator(".indicador, .exrow")).toHaveCount(0);
});

test("los reportes: se elige de qué días y se baja cada hoja como archivo para Excel, con lo que quedó asentado", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Reportes" }).click();
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  // Al llegar, lo que va del mes; con un toque, otro periodo.
  await expect(page.getByLabel("Desde")).toHaveValue(`${dias.hoy.slice(0, 8)}01`);
  await expect(page.getByLabel("Hasta")).toHaveValue(dias.hoy);
  await page.getByRole("button", { name: "Últimos 7 días" }).click();
  await expect(page.getByLabel("Desde")).toHaveValue(dias.semana);
  await expect(page.getByRole("button", { name: "Últimos 7 días" })).toHaveAttribute("aria-pressed", "true");

  const bajar = async (nombre: string): Promise<{ archivo: string; renglones: string[] }> => {
    const espera = page.waitForEvent("download");
    await page.getByRole("button", { name: `Bajar ${nombre}` }).click();
    const bajado = await espera;
    return { archivo: bajado.suggestedFilename(), renglones: (await readFile(await bajado.path())).toString("utf8").split("\r\n") };
  };

  // Las cuentas: una por renglón, con la marca que Excel pide para leer los acentos.
  const cuentas = await bajar("las cuentas");
  expect(cuentas.archivo).toBe(`cuentas-${dias.semana}-a-${dias.hoy}.csv`);
  expect(cuentas.renglones[0]).toBe("\uFEFFFecha,Hora,Folio,Tipo,Cliente,Nombre,Materiales,Kilos,Total,Atendió");
  expect(cuentas.renglones).toHaveLength(6);
  expect(cuentas.renglones[1]).toMatch(new RegExp(`^${dias.antier},\\d\\d:\\d\\d,1,compra,,,1,100\\.000,210,Luis$`));
  expect(cuentas.renglones[4]).toMatch(new RegExp(`^${dias.hoy},\\d\\d:\\d\\d,4,compra,,,1,30\\.000,63,Servando$`));
  await expect(page.locator(".okmsg")).toContainText(`Se bajó «Las cuentas», del ${fechaCorta(dias.semana)} al ${fechaCorta(dias.hoy)}`);

  // Los días: cada uno dice lo que su cierre.
  const losDias = await bajar("los días");
  expect(losDias.archivo).toBe(`dias-${dias.semana}-a-${dias.hoy}.csv`);
  expect(losDias.renglones).toEqual([
    "\uFEFFFecha,Estado,Cuentas,Compras,Ventas,Pagado,Cobrado,Kilos comprados,Kilos vendidos",
    `${dias.antier},cerrado,2,1,1,210,100,100.000,40.000`,
    `${dias.ayer},cerrado,1,1,0,75,0,10.000,0.000`,
    `${dias.hoy},abierto,1,1,0,63,0,30.000,0.000`,
    "",
  ]);
  expect((await bajar("los materiales de cada cuenta")).renglones).toHaveLength(6);
  expect((await bajar("los precios")).renglones[0]).toBe("\uFEFFFecha,Familia,Material,Compra,Venta");

  // Un periodo al revés no se pide: se dice por qué, y no hay qué bajar.
  await page.getByLabel("Desde").fill(dias.hoy);
  await page.getByLabel("Hasta").fill(dias.ayer);
  await expect(page.getByText("El primer día no puede ser posterior al último.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bajar las cuentas" })).toBeDisabled();
});

test("imprimir una pantalla del panel: sale ella sola, sin la barra ni lo que se toca; el comprobante sigue saliendo solo, en su papel", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await expect(indicador(page, "Compras")).toContainText("$348");
  await page.getByRole("button", { name: "Imprimir" }).click();
  expect(await impresiones(page)).toBe(1);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".indicador").first()).toBeVisible();
  // La barra de antier (la quinta de siete): la primera es de un día sin cuentas y no mide nada.
  await expect(tarjeta(page, "Compras y ventas").locator(".col").nth(4).locator(".barrita.compra")).toBeVisible();
  for (const loQueNoSale of ['nav[aria-label="Pantallas"]', ".secciones", ".chips", ".imprimir", ".barra .dia"]) {
    await expect(page.locator(loQueNoSale).first(), loQueNoSale).toBeHidden();
  }

  // Un día también se imprime; y su comprobante, cuando se abre, es lo único que va al papel.
  await page.emulateMedia({ media: "screen" });
  await page.goto("/panel/dias");
  await page.locator(".exrow.dia").nth(2).click();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".card").filter({ hasText: "Cuentas del día" })).toBeVisible();
  await expect(page.locator(".secciones")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await tarjeta(page, "Cuentas del día").locator(".exrow").nth(0).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$210");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".papel .ticket").first()).toBeVisible();
  await expect(page.locator(".imprimible")).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Pantallas"]')).toBeHidden();
});

// ── lo que encontró la revisión de Codex del 12 de octubre ─────────────────

/** Detiene las peticiones a esa dirección hasta que se suelten; `con` dice qué contestar (por omisión, lo de verdad). */
async function detener(page: Page, direccion: RegExp, con?: { estado: number; mensaje: string }): Promise<() => void> {
  let soltar: () => void = () => {};
  const detenida = new Promise<void>((listo) => { soltar = listo; });
  await page.route(direccion, async (ruta) => {
    await detenida;
    if (con) await ruta.fulfill({ status: con.estado, contentType: "application/json", body: JSON.stringify({ error: { codigo: "INTERNO", mensaje: con.mensaje } }) });
    else await ruta.fallback();
  });
  return soltar;
}

test("en la bitácora, al cambiar lo que se busca deja de verse lo anterior: mientras llega lo nuevo no hay nada que confundir, y si falla, tampoco", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/bitacora");
  await expect(page.locator(".asiento").filter({ hasText: "Servando publicó los precios" })).toHaveCount(3);

  // Lo de Luis tarda, y al final falla: lo de todos no se queda a la vista bajo «Luis».
  const soltar = await detener(page, /\/api\/bitacora\?persona=/, { estado: 500, mensaje: "Algo falló de nuestro lado. Intenta de nuevo." });
  await page.getByLabel("Quién").selectOption({ label: "Luis" });
  await expect(page.locator(".asiento")).toHaveCount(0);
  await expect(page.getByText("Un momento…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver lo anterior" })).toHaveCount(0);
  soltar();
  await expect(aviso(page)).toContainText("Algo falló de nuestro lado");
  await expect(page.locator(".asiento")).toHaveCount(0);

  // Y al quitar la búsqueda vuelve lo de todos.
  await page.getByRole("button", { name: "Ver todo" }).click();
  await expect(page.locator(".asiento").filter({ hasText: "Servando publicó los precios" })).toHaveCount(3);
  await expect(aviso(page)).toHaveCount(0);
});

test("en los días, un comprobante que llega tarde no tapa el día que ya se está viendo", async ({ page }) => {
  const g = await gente();
  const dias = await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/dias");
  await page.locator(".exrow.dia").nth(2).click();
  await expect(tarjeta(page, "Cuentas del día").locator(".exrow")).toHaveCount(2);

  // Se pide el comprobante de antier, que tarda; mientras, se vuelve y se abre ayer.
  const soltar = await detener(page, /\/api\/comprobantes\?folio=/);
  const lento = page.waitForResponse((r) => r.url().includes("/api/comprobantes?folio="));
  await tarjeta(page, "Cuentas del día").locator(".exrow").nth(0).click();
  await page.getByRole("button", { name: "‹ Días" }).click();
  await page.locator(".exrow.dia").nth(1).click();
  await expect(page.locator(".top h2")).toHaveText(new RegExp(fechaCorta(dias.ayer) + "$"));
  soltar();
  await lento;
  await page.waitForTimeout(300);
  await expect(page.locator(".ticket")).toHaveCount(0);
  await expect(page.locator(".top h2")).toHaveText(new RegExp(fechaCorta(dias.ayer) + "$"));
  await expect(tarjeta(page, "Cuentas del día").locator(".exrow")).toHaveCount(1);
});

test("en los clientes, un comprobante que llega tarde no tapa la ficha del cliente que ya se está viendo", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await clientesDeHoy(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel/clientes");
  await cliente(page, "Don Chuy").click();
  await expect(tarjeta(page, "Sus cuentas").locator(".exrow")).toHaveCount(2);

  const soltar = await detener(page, /\/api\/comprobantes\?folio=/);
  const lento = page.waitForResponse((r) => r.url().includes("/api/comprobantes?folio="));
  await tarjeta(page, "Sus cuentas").locator(".exrow").nth(0).click();
  await page.getByRole("button", { name: "‹ Clientes" }).click();
  await cliente(page, "Doña Lupe").click();
  await expect(page.getByRole("heading", { name: "Doña Lupe", exact: true })).toBeVisible();
  soltar();
  await lento;
  await page.waitForTimeout(300);
  await expect(page.locator(".ticket")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Doña Lupe", exact: true })).toBeVisible();
  await expect(tarjeta(page, "Sus cuentas").locator(".exrow")).toHaveCount(1);
});

test("el panel es de quien dirige y de quien consulta: al mostrador no se le ofrece, y si escribe la dirección, tampoco", async ({ page }) => {
  const g = await gente();
  await tresDias(g);
  const ana = await altaDePersona("Ana", "consulta", "3141");
  await darDeAltaEquipo(page);
  await adentro(page, g.luis);
  await expect(page.getByRole("link", { name: "Panel" })).toHaveCount(0);
  for (const camino of ["/panel", "/panel/dias", "/panel/materiales", "/panel/precios", "/panel/clientes", "/panel/bitacora", "/panel/reportes"]) {
    await page.goto(camino);
    await expect(page.getByText("El panel es para quien dirige el negocio.")).toBeVisible();
    await expect(page.locator(".indicador, .exrow, .asiento")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await adentro(page, ana);
  await page.getByRole("link", { name: "Panel" }).click();
  await expect(indicador(page, "Compras")).toContainText("$348");
});

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, en todas las partes del panel todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await tresDias(g);
    await contarImpresiones(page);
    await darDeAltaEquipo(page);
    await adentro(page, g.servando);
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };

    await page.goto("/panel");
    await expect(indicador(page, "Compras")).toContainText("$348");
    await medir("el resumen");
    await tarjeta(page, "Compras y ventas").getByText("Ver los números").click();
    await medir("el resumen, con los números abiertos");
    // A treinta días las columnas son angostas y su rótulo, más ancho que ellas: tampoco ensancha la página.
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "30 días" }).click();
    await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(30);
    await medir("el resumen, a treinta días");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "Otro periodo" }).click();
    await expect(page.getByLabel("Desde")).toBeVisible();
    await expect(page.locator(".periodo")).not.toContainText("cargando");
    await medir("el resumen, eligiendo de qué día a qué día");

    await page.getByRole("link", { name: "Días" }).click();
    await expect(page.locator(".exrow.dia")).toHaveCount(3);
    await medir("los días");
    await page.locator(".exrow.dia").nth(2).click();
    await expect(tarjeta(page, "Cuentas del día").locator(".exrow")).toHaveCount(2);
    await medir("un día");

    await page.getByRole("link", { name: "Bitácora" }).click();
    await expect(page.locator(".asiento").first()).toBeVisible();
    await medir("la bitácora");

    // Con un material cuyo nombre ocupa los cuarenta caracteres que puede llevar, sin un solo espacio.
    const largo = "W".repeat(40);
    await conConsola(async (db) => {
      await db.query("SELECT alta_material(1::smallint, $1, $2, false, $3)", [largo, "W".repeat(24), g.servando.id]);
      // El corte de arranque ya se cerró y un saldo inicial ya no entra por su puerta: para medir basta
      // con que el libro tenga algo de él, y se asienta por un lado, sin los candados.
      await db.query("BEGIN");
      await db.query("SET LOCAL session_replication_role = replica");
      await db.query(
        "INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, origen_saldo, creado_por, efectivo_en) VALUES (1, (SELECT id FROM material WHERE nombre = $1), 'apertura', 25, 'estimado', $2, now())",
        [largo, g.servando.id],
      );
      await db.query("COMMIT");
    });
    await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Materiales" }).click();
    await expect(tarjeta(page, "Se mueven").locator(".exrow")).toHaveCount(3);
    await medir("los materiales");
    await tarjeta(page, "Se mueven").locator(".exrow").filter({ hasText: largo }).click();
    await expect(page.getByRole("heading", { name: largo })).toBeVisible();
    await expect(indicador(page, "En el patio")).toContainText("25 kg");
    await medir("un material de nombre larguísimo");
    await page.getByRole("button", { name: "‹ Materiales" }).click();
    await tarjeta(page, "Se mueven").locator(".exrow").first().click();
    await expect(tarjeta(page, "Lo que entró y lo que salió").locator(".col")).toHaveCount(30);
    await medir("un material");
    await tarjeta(page, "Lo que entró y lo que salió").getByText("Ver los números").click();
    await medir("un material, con los números abiertos");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
    await expect(tarjeta(page, "Lo que entró y lo que salió").locator(".col")).toHaveCount(13);
    await medir("un material, a tres meses");

    await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Precios" }).click();
    await expect(page.locator(".exrow.material")).toHaveCount(5);
    await medir("la historia de precios");
    await page.locator(".exrow.material").first().click();
    await expect(tarjeta(page, "Cada cambio")).toBeVisible();
    await medir("la historia de un material");

    await clientesDeHoy(g);
    await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Clientes" }).click();
    await expect(page.locator(".exrow.cliente")).toHaveCount(2);
    await medir("los clientes");
    await page.locator(".exrow.cliente").first().click();
    await expect(tarjeta(page, "Sus cuentas").locator(".exrow")).toHaveCount(2);
    await medir("un cliente");

    await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Reportes" }).click();
    await expect(page.getByRole("button", { name: "Bajar las cuentas" })).toBeVisible();
    await medir("los reportes");
  });
}

// Capturas, para verlas sin levantar nada. Corre solo si se piden:
//   docker compose --profile recorrido run --rm -e CAPTURAS=1 recorrido npx playwright test panel -g capturas
test("capturas del panel", async ({ page }) => {
  test.skip(!process.env.CAPTURAS, "solo cuando se piden capturas");
  const g = await gente();
  await tresDias(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
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
    await page.goto("/panel/precios");
    await expect(page.locator(".exrow.material").first()).toBeVisible();
    await foto("5-precios");
    await page.goto("/panel/reportes");
    await expect(page.getByRole("button", { name: "Bajar las cuentas" })).toBeVisible();
    await foto("8-reportes");
    await page.goto("/panel/materiales");
    await expect(tarjeta(page, "Se mueven").locator(".exrow")).toHaveCount(2);
    await foto("9-materiales");
    await tarjeta(page, "Se mueven").locator(".exrow").first().click();
    await expect(tarjeta(page, "Lo que entró y lo que salió").locator(".col")).toHaveCount(30);
    await foto("10-un-material");
  }
});

test("capturas de los clientes", async ({ page }) => {
  test.skip(!process.env.CAPTURAS, "solo cuando se piden capturas");
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await clientesDeHoy(g);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  for (const [nombre, ancho, alto, esquema] of [["", 1180, 820, "light"], ["-telefono", 390, 800, "light"], ["-oscuro", 1180, 820, "dark"]] as const) {
    await page.setViewportSize({ width: ancho, height: alto });
    await page.emulateMedia({ colorScheme: esquema });
    const foto = (que: string) => page.screenshot({ path: `recorrido/capturas/panel/${que}${nombre}.png`, fullPage: true });
    await page.goto("/panel/clientes");
    await expect(page.locator(".exrow.cliente")).toHaveCount(2);
    await foto("6-clientes");
    await page.locator(".exrow.cliente").first().click();
    await expect(tarjeta(page, "Sus cuentas").locator(".exrow")).toHaveCount(2);
    await foto("7-un-cliente");
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
  await adentro(page, g.servando);
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
    await page.goto("/panel/precios");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
    await expect(page.locator(".periodo")).not.toContainText("cargando");
    await expect(page.locator(".exrow.material").first()).toBeVisible();
    await foto("7-precios");
    await page.locator(".exrow.material").first().click();
    await expect(tarjeta(page, "Cada cambio")).toBeVisible();
    await foto("8-un-precio");
    await page.goto("/panel/clientes");
    await expect(page.locator(".exrow.cliente").first()).toBeVisible();
    await foto("9-clientes");
    await page.locator(".exrow.cliente").first().click();
    await expect(tarjeta(page, "Sus cuentas").locator(".exrow").first()).toBeVisible();
    await foto("10-un-cliente");
    await page.goto("/panel/materiales");
    await expect(page.locator(".exrow").first()).toBeVisible();
    await foto("11-materiales");
    await page.locator(".exrow").first().click();
    await expect(tarjeta(page, "Lo que entró y lo que salió").locator(".col")).toHaveCount(30);
    await foto("12-un-material");
    await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "3 meses" }).click();
    await expect(tarjeta(page, "Lo que entró y lo que salió").locator(".col")).toHaveCount(13);
    await expect(page.locator(".periodo")).not.toContainText("cargando");
    await foto("13-un-material-3-meses");
  }

  // Lo que va al papel, en una hoja carta y aunque la pantalla esté en oscuro: el resumen de un mes y un día.
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.emulateMedia({ media: "screen", colorScheme: "dark" });
  await page.goto("/panel");
  await page.getByRole("group", { name: "Periodo" }).getByRole("button", { name: "30 días" }).click();
  await expect(tarjeta(page, "Compras y ventas").locator(".col")).toHaveCount(30);
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await page.screenshot({ path: "recorrido/capturas/panel/demo-papel-1-resumen.png", fullPage: true });
  await page.emulateMedia({ media: "screen", colorScheme: "dark" });
  await page.goto("/panel/dias");
  await page.locator(".exrow.dia").nth(1).click();
  await expect(tarjeta(page, "Cuentas del día").locator(".exrow").first()).toBeVisible();
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await page.screenshot({ path: "recorrido/capturas/panel/demo-papel-2-un-dia.png", fullPage: true });
});
