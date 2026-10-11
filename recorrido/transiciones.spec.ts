// Lo que pasa a medio camino: mientras una respuesta tarda, cuando una respuesta se pierde, y
// cuando se toca dos veces. Los recorridos que esperan a que todo se asiente no ven estos cruces;
// aquí las respuestas se demoran o se cortan a propósito, y se afirma a dónde y con qué salió cada envío.
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, Request } from "@playwright/test";
import { baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, impresiones, pesar, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

/** Abre una cuenta y devuelve su identificador, tomado de lo que el servidor contestó. */
async function nuevaCuenta(page: Page, boton: "+ Compra" | "+ Venta"): Promise<string> {
  const respuesta = page.waitForResponse((r) => r.url().endsWith("/api/cuentas") && r.request().method() === "POST");
  await page.getByRole("button", { name: boton }).click();
  return (await (await respuesta).json()).cuenta.id;
}

/** Una compuerta: detiene las peticiones que casen hasta que se abra. */
async function compuerta(page: Page, patron: RegExp, metodo: string) {
  let abrir!: () => void;
  const abierta = new Promise<void>((listo) => { abrir = listo; });
  await page.route(patron, async (ruta) => {
    if (ruta.request().method() !== metodo) return ruta.fallback();
    await abierta;
    await ruta.fallback();
  });
  return { abrir, quitar: () => page.unroute(patron) };
}

const materialesDe = (cuenta: string): Promise<Array<{ kg: string }>> =>
  conConsola(async (db) => (await db.query("SELECT peso_bruto::text AS kg FROM operacion_linea WHERE operacion_id = $1 ORDER BY creada_en", [cuenta])).rows);

test("mientras llega el detalle de la cuenta elegida, lo tecleado no se puede mandar a otra", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });

  // Compra 1: Cartón en la báscula 2, con 12.5 a medio teclear.
  const una = await nuevaCuenta(page, "+ Compra");
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "12.5");
  // Compra 2: Aluminio en la báscula 3, con 30 a medio teclear.
  const dos = await nuevaCuenta(page, "+ Compra");
  await page.locator(".grid").getByRole("button", { name: /^Aluminio bote/ }).click();
  await page.getByRole("button", { name: /^Báscula 3/ }).click();
  await teclear(page, "30");

  const envios: Request[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/materiales")) envios.push(r); });

  // Se vuelve a la Compra 1, pero su detalle tarda en llegar.
  const detalle = await compuerta(page, new RegExp(`/api/cuentas/${una}$`), "GET");
  await riel.locator(".cta", { hasText: "Compra 1" }).click();
  // Mientras tanto no hay nada que tocar: ni el botón ni el teclado de la cuenta anterior.
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(300);
  expect(envios).toHaveLength(0);
  expect(await materialesDe(dos)).toEqual([]);

  detalle.abrir();
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
  await expect(page.locator(".visor")).toContainText("12.5");
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado" })).toContainText("Cartón · 12.500 kg");

  expect(envios).toHaveLength(1);
  expect(envios[0]!.url()).toContain(`/api/cuentas/${una}/materiales`);
  expect(envios[0]!.postDataJSON().kg).toBe("12.5");
  expect(await materialesDe(una)).toEqual([{ kg: "12.500" }]);
  expect(await materialesDe(dos)).toEqual([]);
});

/** Deja una compra con 30 kg de Cartón enviados y guardados en el servidor, pero cuya respuesta nunca llegó. */
async function envioSinRespuesta(page: Page): Promise<string> {
  const cuenta = await nuevaCuenta(page, "+ Compra");
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "30");
  const patron = /\/api\/cuentas\/[^/]+\/materiales$/;
  await page.route(patron, async (ruta) => {
    await ruta.fetch();                       // el servidor lo recibe y lo guarda…
    await ruta.abort("connectionreset");      // …y la respuesta se pierde en el camino
  });
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
  await page.unroute(patron);
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
  return cuenta;
}

test("si se pierde la respuesta de un envío, no se puede teclear otro peso: se reintenta el mismo", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const cuenta = await envioSinRespuesta(page);

  // No se puede cambiar lo tecleado ni mandar otra cosa: solo reintentar lo mismo.
  await expect(page.locator(".teclado")).toHaveCount(0);
  await expect(page.locator(".visor")).toContainText("30");
  await expect(page.getByRole("button", { name: "Es otra báscula" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Material/ })).toBeDisabled();

  const reintento = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/materiales"));
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await reintento).postDataJSON().kg).toBe("30");
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$63");
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

test("si se pierde la respuesta y se recarga la página, la cuenta aparece con lo que sí se guardó", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const cuenta = await envioSinRespuesta(page);

  await page.reload();
  // Al volver a pedir la cuenta se ve que el material ya estaba: no hay nada que reintentar ni que teclear de nuevo.
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$63");
  await expect(page.locator('.flag[role="alert"]')).toHaveCount(0);
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

test("si el envío sin respuesta en realidad no llegó, reintentarlo lo agrega una sola vez", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const cuenta = await nuevaCuenta(page, "+ Compra");
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "30");
  const patron = /\/api\/cuentas\/[^/]+\/materiales$/;
  await page.route(patron, (ruta) => ruta.abort("connectionreset"));      // ni siquiera sale
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
  expect(await materialesDe(cuenta)).toEqual([]);
  await page.unroute(patron);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado" })).toContainText("Cartón · 30.000 kg");
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

/**
 * El primer envío recibe una falla, como cuando se cae lo que hay en medio: después de que el
 * servidor lo guardó, o sin que le haya llegado. Los siguientes pasan. Devuelve con qué salió cada uno.
 */
async function fallaElPrimero(page: Page, patron: RegExp, llega: boolean): Promise<any[]> {
  const envios: any[] = [];
  await page.route(patron, async (ruta) => {
    envios.push(ruta.request().postDataJSON());
    if (envios.length > 1) return ruta.fallback();
    if (llega) await ruta.fetch();
    await ruta.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" });
  });
  return envios;
}

async function pesoListoParaAgregar(page: Page): Promise<string> {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const cuenta = await nuevaCuenta(page, "+ Compra");
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "30");
  return cuenta;
}

test("si el servidor falla después de guardar el peso, la cuenta aparece con él y no hay nada que teclear de nuevo", async ({ page }) => {
  const cuenta = await pesoListoParaAgregar(page);
  const envios = await fallaElPrimero(page, /\/api\/cuentas\/[^/]+\/materiales$/, true);
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();

  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$63");
  await expect(page.locator('.flag[role="alert"]')).toHaveCount(0);
  expect(envios.length).toBe(1);
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

test("si el servidor falla y el peso no llegó, no se teclea otro: se reintenta el mismo", async ({ page }) => {
  const cuenta = await pesoListoParaAgregar(page);
  const envios = await fallaElPrimero(page, /\/api\/cuentas\/[^/]+\/materiales$/, false);
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();

  await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
  await expect(page.locator(".teclado")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Es otra báscula" })).toHaveCount(0);
  expect(await materialesDe(cuenta)).toEqual([]);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  expect(envios.length).toBe(2);
  expect(envios[1]).toEqual(envios[0]);
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

test("si al reintentar un peso llega un rechazo y el primer envío seguía en camino, ese primero ya no entra", async ({ page }) => {
  const cuenta = await pesoListoParaAgregar(page);
  let entregar!: () => void;
  const orden = new Promise<void>((listo) => { entregar = listo; });
  let contesto!: (estado: number) => void;
  const tardio = new Promise<number>((listo) => { contesto = listo; });
  const envios: any[] = [];
  await page.route(/\/api\/cuentas\/[^/]+\/materiales$/, async (ruta) => {
    envios.push(ruta.request().postDataJSON());
    if (envios.length === 1) {                 // el primero se queda en el camino…
      await orden;
      contesto((await ruta.fetch()).status());       // …y llega cuando ya nadie lo espera
      return;
    }
    if (envios.length === 2) return ruta.fulfill({ status: 409, json: { error: { codigo: "RC006", mensaje: "La jornada ya se cerró" } } });
    return ruta.fallback();
  });
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect.poll(() => envios.length).toBe(1);
  await page.reload();
  await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.locator('.flag[role="alert"]')).toContainText("La jornada ya se cerró");
  // La pantalla soltó el peso, pero antes dejó cancelado ese envío en el servidor: aunque llegue, no entra.
  entregar();
  expect(await tardio).toBe(409);
  expect(await materialesDe(cuenta)).toEqual([]);
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  expect(envios.length).toBe(3);
  expect(envios[2].linea).not.toBe(envios[0].linea);
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

/** En qué quedó un envío en el registro del servidor: su clase, o nada si nunca llegó. */
const claseDelEnvio = (id: string): Promise<string | null> =>
  conConsola(async (db) => (await db.query("SELECT clase FROM envio WHERE id = $1", [id])).rows[0]?.clase ?? null);

test("si al reintentar un peso llega un rechazo y el primero sí había entrado, la cuenta aparece con él", async ({ page }) => {
  const cuenta = await pesoListoParaAgregar(page);
  const envios: any[] = [];
  await page.route(/\/api\/cuentas\/[^/]+\/materiales$/, async (ruta) => {
    envios.push(ruta.request().postDataJSON());
    if (envios.length === 1) {                 // el servidor lo guarda y la respuesta se pierde
      await ruta.fetch();
      return ruta.abort("connectionreset");
    }
    return ruta.fulfill({ status: 409, json: { error: { codigo: "RC006", mensaje: "La jornada ya se cerró" } } });
  });
  // Lo que la pantalla le pide al servidor para resolver ese envío, y lo que le contesta.
  const resuelto = page.waitForResponse((r) => r.url().endsWith("/cancelar") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  // El rechazo era del reintento: la pantalla averigua que el primero sí entró, y no deja teclearlo otra vez.
  const respuesta = await resuelto;
  expect(respuesta.url()).toContain(`/api/envios/${envios[0].linea}/cancelar`);
  expect(await respuesta.json()).toEqual({ entro: true });
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  await expect(page.locator(".teclado")).toHaveCount(0);
  expect(envios.length).toBe(2);
  expect(await claseDelEnvio(envios[0].linea)).toBe("material");
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

test("un peso rechazado por una regla deja cancelado ese envío antes de soltarlo, aunque fuera el primer intento", async ({ page }) => {
  const cuenta = await pesoListoParaAgregar(page);
  const envios: any[] = [];
  await page.route(/\/api\/cuentas\/[^/]+\/materiales$/, async (ruta) => {
    envios.push(ruta.request().postDataJSON());
    if (envios.length === 1) return ruta.fulfill({ status: 409, json: { error: { codigo: "RC004", mensaje: "Ese peso no cabe en esa báscula" } } });
    return ruta.fallback();
  });
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.locator('.flag[role="alert"]')).toContainText("Ese peso no cabe en esa báscula");
  // Si ese mismo envío viniera también de otra pestaña, ya no entra.
  expect(await claseDelEnvio(envios[0].linea)).toBe("cancelado");
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  expect(envios[1].linea).not.toBe(envios[0].linea);
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

/** Abre desde una pestaña otra que hereda lo que la primera tenía guardado, como al duplicarla. */
async function abrirCopia(page: Page, contexto: BrowserContext, camino: string): Promise<Page> {
  const abierta = contexto.waitForEvent("page");
  await page.evaluate((a) => { window.open(a, "_blank"); }, camino);
  return abierta;
}

// Lo que encontró Codex en el mostrador: el peso tecleado y todavía no agregado se copiaba a la
// pestaña duplicada, y agregarlo en las dos dejaba dos renglones en la cuenta.
for (const conEnvio of [false, true]) {
  test(`una pestaña duplicada del mostrador no hereda el peso a medias${conEnvio ? ", tampoco con un envío del que no se supo" : ""}`, async ({ page, context }) => {
    const cuenta = await pesoListoParaAgregar(page);
    if (conEnvio) {
      const patron = /\/api\/cuentas\/[^/]+\/materiales$/;
      let primero = true;
      await page.route(patron, async (ruta) => {
        if (!primero) return ruta.fallback();
        primero = false;
        return ruta.abort("connectionreset");        // el peso no llega, y queda pendiente en la original
      });
      await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
      await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
    }
    const copia = await abrirCopia(page, context, "/mostrador");
    // La copia ve la cuenta, sin el peso tecleado ni el envío pendiente, y con su aviso.
    await expect(copia.getByRole("heading", { name: "Compra 1" })).toBeVisible();
    await expect(copia.locator('.flag[role="alert"]')).toContainText("sigue en la otra pestaña");
    await expect(copia.locator(".visor")).toHaveCount(0);
    await expect(copia.getByRole("button", { name: "Agregar a la cuenta" })).toHaveCount(0);
    await expect(copia.getByRole("button", { name: "Volver a intentar" })).toHaveCount(0);
    // La original lo agrega, una sola vez.
    await page.getByRole("button", { name: conEnvio ? "Volver a intentar" : "Agregar a la cuenta" }).click();
    await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
    expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
  });
}

test("recargar el mostrador varias veces no le quita el peso a medias a su propia pestaña", async ({ page }) => {
  const cuenta = await pesoListoParaAgregar(page);
  for (let k = 0; k < 10; k += 1) {
    await page.reload();
    await expect(page.locator(".visor")).toContainText("30");
  }
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();
  expect(await materialesDe(cuenta)).toEqual([{ kg: "30.000" }]);
});

for (const llega of [true, false]) {
  test(`si el servidor falla en la segunda pesada y ${llega ? "sí quedó guardada, aparece ya pesada" : "no llegó, se reintenta la misma"}`, async ({ page }) => {
    const g = await gente();
    await diaListo(g);
    await darDeAltaEquipo(page);
    await entrar(page, g.luis);
    await page.getByRole("button", { name: "+ Compra" }).click();
    await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
    await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
    await teclear(page, "3400");
    const envios = await fallaElPrimero(page, /\/api\/cuentas\/[^/]+\/segunda-pesada$/, llega);
    await page.getByRole("button", { name: "Guardar peso vacío" }).click();

    if (!llega) {
      await expect(page.locator('.flag[role="alert"]')).toContainText("No se supo si este peso se guardó");
      await expect(page.locator(".teclado")).toHaveCount(0);
      await page.getByRole("button", { name: "Volver a intentar" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Listo" })).toContainText("1,800.000 kg");
      expect(envios[1]).toEqual(envios[0]);
    }
    // Queda pesada una sola vez: 5 200 de lleno menos 3 400 de vacío.
    await expect(page.locator(".tot.big")).toHaveText("Se paga$12,240");
    await expect(page.locator(".teclado")).toHaveCount(0);
    await expect(page.locator('.flag[role="alert"]')).toHaveCount(0);
    expect(envios.length).toBe(llega ? 1 : 2);
    expect(await conConsola(async (db) => (await db.query("SELECT peso_recibido::text AS kg FROM operacion_linea")).rows)).toEqual([{ kg: "1800.000" }]);
  });
}

test("cambiar de cuenta a media segunda pesada no rompe la pantalla y recuerda lo tecleado", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));

  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "10");

  await riel.locator(".cta", { hasText: "Compra 1" }).click();
  await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
  await teclear(page, "3400");
  await riel.locator(".cta", { hasText: "Compra 2" }).click();
  await expect(page.getByRole("heading", { name: "Compra 2" })).toBeVisible();
  await expect(page.getByText("En esta cuenta · 1 material")).toBeVisible();

  await riel.locator(".cta", { hasText: "Compra 1" }).click();
  await expect(page.locator(".visor")).toContainText("3400");
  await page.getByRole("button", { name: "Guardar peso vacío" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Listo" })).toContainText("1,800.000 kg");
  expect(errores).toEqual([]);
});

test("un doble toque en el motivo registra e imprime una sola reimpresión", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  const cuenta = await nuevaCuenta(page, "+ Compra");
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
  expect(await impresiones(page)).toBe(1);

  await page.getByRole("button", { name: "Imprimir otra vez" }).click();
  const registro = await compuerta(page, /\/api\/comprobantes\/[^/]+\/imprimir$/, "POST");
  const motivo = page.getByRole("button", { name: "No salió el papel" });
  await motivo.click();
  await motivo.click({ timeout: 1000 }).catch(() => {});       // el segundo toque, mientras el primero sigue en camino
  registro.abrir();
  await expect(page.locator(".ticket")).toContainText("REIMPRESIÓN 2");
  await page.waitForTimeout(300);
  expect(await impresiones(page)).toBe(2);
  expect(await conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM impresion WHERE operacion_id = $1", [cuenta])).rows[0].n)).toBe(2);
});

test("en el arranque, los kilos con coma son decimales, no miles", async ({ page }) => {
  const g = await gente();
  await darDeAltaEquipo(page);
  await entrar(page, g.servando);
  await page.getByLabel("Kilos de Cartón").fill("12,5");
  await page.getByRole("button", { name: "Revisar 1 material" }).click();
  await expect(page.locator(".ren", { hasText: "Cartón" })).toContainText("12.500 kg");
  await page.getByRole("button", { name: "Regresar a corregir" }).click();
  // Lo que no se entiende se rechaza en vez de limpiarse.
  await page.getByLabel("Kilos de Cartón").fill("1,250.5");
  await expect(page.locator('.flag[role="alert"]')).toContainText("Revisa Cartón");
  await expect(page.getByRole("button", { name: /^Revisar/ })).toBeDisabled();
});

test("en pantalla angosta las cuentas siguen a la vista al bajar hasta el botón", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await page.setViewportSize({ width: 375, height: 667 });
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.getByRole("button", { name: "+ Compra" }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "12");
  await page.getByRole("button", { name: "Agregar a la cuenta" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 2000);
  const riel = page.getByRole("complementary", { name: "Cuentas abiertas" });
  await expect(riel.locator(".cta", { hasText: "Compra 1" })).toBeInViewport();
  await expect(riel.locator(".cta", { hasText: "Compra 2" })).toBeInViewport();
  // Y sirve: se cambia de cuenta desde ahí.
  await riel.locator(".cta", { hasText: "Compra 1" }).click();
  await expect(page.getByRole("heading", { name: "Compra 1" })).toBeVisible();
});
