// El comprobante sale por duplicado: la primera impresión lleva dos copias en un solo envío a la
// impresora, la del cliente y la del negocio. En pantalla se sigue viendo uno. Una reimpresión
// saca una sola copia. Lo que sale en papel se mira con la página como la ve la impresora.
import { expect, test, type Page } from "@playwright/test";
import { baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, impresiones, pesar } from "./apoyo.ts";

test.beforeEach(baseNueva);

const delCliente = (page: Page) => page.locator(".ticket");
const delNegocio = (page: Page) => page.locator(".ticket-negocio");
const IMPRIMIR = /\/api\/comprobantes\/[^/]+\/imprimir$/;

/** Lo que saldría en el papel: se mira con la página como la ve la impresora, y se vuelve a la pantalla. */
async function enPapel<T>(page: Page, mirar: () => Promise<T>): Promise<T> {
  await page.emulateMedia({ media: "print" });
  try {
    return await mirar();
  } finally {
    await page.emulateMedia({ media: "screen" });
  }
}

/** Las dos copias, una debajo de la otra y en hojas distintas, con lo mismo salvo la leyenda. */
async function salenDos(page: Page, total: string): Promise<void> {
  await enPapel(page, async () => {
    await expect(delCliente(page)).toBeVisible();
    await expect(delNegocio(page)).toBeVisible();
    await expect(delNegocio(page)).toContainText("COPIA DEL NEGOCIO");
    await expect(delCliente(page)).not.toContainText("COPIA DEL NEGOCIO");
    await expect(delNegocio(page)).toContainText(total);
    // El mismo comprobante: quitada la leyenda, dicen lo mismo, renglón por renglón.
    const renglones = async (copia: ReturnType<typeof delCliente>): Promise<string[]> =>
      (await copia.innerText()).split("\n").map((r) => r.trim()).filter((r) => r !== "" && r !== "COPIA DEL NEGOCIO");
    expect(await renglones(delNegocio(page))).toEqual(await renglones(delCliente(page)));
    // Una debajo de la otra, del mismo ancho, y la del negocio empieza hoja: ahí corta la impresora.
    const [a, b] = [await delCliente(page).boundingBox(), await delNegocio(page).boundingBox()];
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
    expect(Math.abs(b!.width - a!.width)).toBeLessThan(0.5);
    expect(Math.abs(b!.x - a!.x)).toBeLessThan(0.5);
    expect(await delNegocio(page).evaluate((e) => getComputedStyle(e).breakBefore)).toBe("page");
  });
}

async function unaSola(page: Page): Promise<void> {
  await enPapel(page, async () => {
    await expect(delCliente(page)).toBeVisible();
    await expect(delNegocio(page)).toHaveCount(0);
  });
}

async function compraLista(page: Page): Promise<void> {
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
}

test("al cobrar una compra se manda a imprimir una vez, y el papel trae dos copias: la del cliente y la del negocio", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await compraLista(page);
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(delCliente(page)).toContainText("A PAGAR$63");
  expect(await impresiones(page)).toBe(1);

  // En pantalla se ve uno solo, y solo uno existe para quien no ve la pantalla.
  await expect(delCliente(page)).toHaveCount(1);
  await expect(delNegocio(page)).toBeHidden();
  await expect(page.getByText("COPIA DEL NEGOCIO")).toBeHidden();
  expect(await delNegocio(page).getAttribute("aria-hidden")).toBe("true");

  await salenDos(page, "A PAGAR$63");
  // La del cliente quedó donde y como salía: arriba a la izquierda, a 72 mm.
  await enPapel(page, async () => {
    const caja = await delCliente(page).boundingBox();
    expect(caja!.x).toBe(0);
    expect(caja!.y).toBe(0);
    expect(Math.abs(caja!.width - 72 * 96 / 25.4)).toBeLessThan(0.5);
  });
});

test("en una venta también salen dos, y un comprobante largo no encima una copia sobre la otra", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"], ["Aluminio bote", "200"], ["Fierro pesado", "900"], ["PET", "300"]]);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  for (const [material, kg, familia] of [["Bote", "50", "Aluminio"], ["Pesado", "300", "Fierro"], ["PET", "80", "Plástico"]] as const) {
    await page.getByRole("button", { name: "＋ Agregar otro material" }).click();
    await pesar(page, material, "Báscula 2", kg, familia);
  }
  await expect(page.getByText("En esta cuenta · 4 materiales")).toBeVisible();
  await page.getByRole("button", { name: "Cobrar e imprimir ticket" }).click();
  await expect(delCliente(page)).toContainText("VENTA");
  expect(await impresiones(page)).toBe(1);
  await salenDos(page, "A COBRAR");
});

test("una reimpresión saca una sola copia, y «Copia para el negocio» está entre los motivos", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await compraLista(page);
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(delCliente(page)).toContainText("A PAGAR$63");

  await page.getByRole("button", { name: "Imprimir otra vez" }).click();
  await page.getByRole("button", { name: "Copia para el negocio" }).click();
  await expect(delCliente(page)).toContainText("REIMPRESIÓN 2 · Copia para el negocio");
  expect(await impresiones(page)).toBe(2);
  await unaSola(page);
});

test("la primera impresión pedida a mano también saca dos; y si no se supo de ella, el reintento es esa misma", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await compraLista(page);

  // Al cobrar no se pudo registrar la impresión: el comprobante se muestra sin haber salido.
  let intento = 0;
  await page.route(IMPRIMIR, async (ruta) => {
    intento += 1;
    if (intento === 1) return ruta.abort();                    // no llegó
    if (intento === 2) {                                         // llegó y se registró, pero la respuesta se perdió
      await ruta.fetch();
      return ruta.abort();
    }
    return ruta.fallback();
  });
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(delCliente(page)).toContainText("A PAGAR$63");
  expect(await impresiones(page)).toBe(0);
  await unaSola(page);                                           // nada se ha mandado: no hay copia que mostrar

  const imprimir = page.getByRole("button", { name: "Imprimir", exact: true });
  await imprimir.click();
  await expect(page.locator('.flag[role="alert"]')).toBeVisible();
  expect(await impresiones(page)).toBe(0);

  // Mientras tanto, desde otro lado se reimprimió: el comprobante ya lleva dos impresiones.
  const folio = await delCliente(page).getAttribute("data-folio");
  const operacion = await conConsola(async (db) => (await db.query("SELECT id FROM operacion WHERE folio = $1", [folio])).rows[0].id as string);
  const otra = await page.evaluate(async ({ id, persona }) => {
    const r = await fetch(`/api/comprobantes/${id}/imprimir`, {
      method: "POST", headers: { "content-type": "application/json", "x-persona": persona },
      body: JSON.stringify({ id: crypto.randomUUID(), motivo: "Se atascó" }),
    });
    return (await r.json()).impresion.numero as number;
  }, { id: operacion, persona: String(g.luis.id) });
  expect(otra).toBe(2);

  // El reintento es la primera impresión de siempre: sale por duplicado, una vez, y no es reimpresión.
  await imprimir.click();
  await expect(page.locator('.flag[role="alert"]')).toHaveCount(0);
  await expect.poll(() => impresiones(page)).toBe(1);
  await expect(delCliente(page)).not.toContainText("REIMPRESIÓN");
  await salenDos(page, "A PAGAR$63");
  expect(await conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM impresion WHERE operacion_id = $1", [operacion])).rows[0].n)).toBe(2);
});
