// Reabrir el día, tocando la pantalla. Un cierre por error a media tarde ya no deja al negocio sin
// atender: la jornada de hoy se reabre con la clave de quien autoriza, y queda registro.
// Cerrar y reabrir dicen qué vieron, así que una pestaña atrasada no deshace lo que hizo otra.
import { expect, test, type Page } from "@playwright/test";
import {
  altaDePersona, aviso, baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, salir, teclear,
} from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const CERRAR = /\/api\/jornada\/cerrar$/;
const REABRIR = /\/api\/jornada\/reabrir$/;

/** Cómo está la jornada en la base, y cuántas reaperturas lleva registradas. */
const enLaBase = () =>
  conConsola(async (db) => (await db.query(
    "SELECT cerrada_en IS NULL AS abierta, cierres, (SELECT count(*)::int FROM reapertura) AS reaperturas FROM jornada ORDER BY id DESC LIMIT 1",
  )).rows[0] as { abierta: boolean; cierres: number; reaperturas: number });

async function enElCierre(page: Page, g: Gente): Promise<void> {
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByRole("button", { name: "Cerrar el día" })).toBeVisible();
}

async function cerrar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cerrar el día" }).click();
  await page.getByRole("button", { name: "Toca otra vez para cerrar el día" }).click();
}

const cerrado = (page: Page) => page.getByRole("heading", { name: "El día de hoy ya se cerró" });

/** Pide reabrir y deja elegida a quien autoriza: falta su clave. */
async function pedirReabrir(page: Page, quien = "Servando"): Promise<void> {
  await page.getByRole("button", { name: "Reabrir el día" }).click();
  await expect(page.getByText("¿Quién autoriza?")).toBeVisible();
  await page.getByRole("button", { name: new RegExp("^" + quien) }).click();
}

async function autorizar(page: Page, clave: string, quien = "Servando"): Promise<void> {
  await teclear(page, clave);
  await page.getByRole("button", { name: `Reabrir a nombre de ${quien}` }).click();
}

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

test("se cierra el día por error y se reabre con la clave de quien autoriza: se sigue atendiendo, y al volver a cerrar el reporte lo dice", async ({ page }) => {
  const g = await gente();
  await contarImpresiones(page);
  await enElCierre(page, g);
  await cerrar(page);
  await expect(cerrado(page)).toBeVisible();
  await expect(page.getByText("Jornada cerrada · cierre 1")).toBeVisible();

  // Cerrado, en el mostrador ya no se ofrece «abrir la jornada de hoy»: se dice que se cerró y a dónde ir.
  await page.getByRole("link", { name: "Mostrador" }).click();
  await expect(page.getByText("El día de hoy ya se cerró")).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir la jornada de hoy" })).toHaveCount(0);
  await page.getByRole("link", { name: "Ir al cierre" }).click();

  await pedirReabrir(page);
  await autorizar(page, g.servando.clave);
  await expect(page.locator(".okmsg")).toContainText("El día quedó abierto otra vez");
  await expect(page.getByRole("button", { name: "Cerrar el día" })).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: true, cierres: 1, reaperturas: 1 });

  // Es la misma jornada: se atiende con los precios que ya estaban publicados.
  await page.getByRole("link", { name: "Mostrador" }).click();
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
  await page.getByRole("button", { name: "Listo" }).click();

  // Se vuelve a cerrar: es el segundo cierre, y el reporte dice que antes se reabrió y quién lo autorizó.
  await page.getByRole("link", { name: "Cierre" }).click();
  await cerrar(page);
  await expect(page.getByText("Jornada cerrada · cierre 2")).toBeVisible();
  await expect(page.getByText(/Este día se reabrió después de cerrarse · cierre 1 .* con autorización de Servando/)).toBeVisible();
  await expect(page.locator(".tot", { hasText: "A pagar por compras" })).toContainText("$63");
  expect(await enLaBase()).toEqual({ abierta: false, cierres: 2, reaperturas: 1 });
});

test("con la clave mal no se reabre, y se puede intentar otra vez; quien no cobra no ve cómo reabrir", async ({ page }) => {
  const g = await gente();
  const ana = await altaDePersona("Ana", "consulta", "3141");
  await enElCierre(page, g);
  await cerrar(page);
  await expect(cerrado(page)).toBeVisible();

  await pedirReabrir(page);
  await autorizar(page, "000000");
  await expect(aviso(page)).toContainText("La clave no pasó");
  expect(await enLaBase()).toEqual({ abierta: false, cierres: 1, reaperturas: 0 });
  // Sigue ahí, con la misma persona: solo falta la clave buena.
  await autorizar(page, g.servando.clave);
  await expect(page.locator(".okmsg")).toContainText("El día quedó abierto otra vez");

  // Otra vez cerrado, entra quien solo consulta: ve que se cerró, y no puede reabrir.
  await cerrar(page);
  await expect(cerrado(page)).toBeVisible();
  await salir(page);
  await entrar(page, ana);
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(cerrado(page)).toBeVisible();
  await expect(page.getByText("lo reabre quien atiende el mostrador o un responsable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reabrir el día" })).toHaveCount(0);
});

test("si no se supo del cierre, se manda ese mismo otra vez —también después de recargar— y el día se cierra una sola vez", async ({ page }) => {
  const g = await gente();
  await enElCierre(page, g);
  await perderLaRespuesta(page, CERRAR);
  await cerrar(page);
  await expect(page.getByText("No se supo si el cierre se guardó.")).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: false, cierres: 1, reaperturas: 0 });

  // Se recarga con el envío en el aire: sigue sin saberse, y no se ofrece cerrar de nuevo.
  await page.reload();
  await expect(page.getByText("No se supo si el cierre se guardó.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar el día" })).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(cerrado(page)).toBeVisible();
  await expect(page.getByText("Jornada cerrada · cierre 1")).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: false, cierres: 1, reaperturas: 0 });
});

test("si no se supo de la reapertura, se le pide la clave otra vez a la misma persona —también después de recargar— y se reabre una sola vez", async ({ page }) => {
  const g = await gente();
  await enElCierre(page, g);
  await cerrar(page);
  await expect(cerrado(page)).toBeVisible();

  await perderLaRespuesta(page, REABRIR);
  await pedirReabrir(page);
  await autorizar(page, g.servando.clave);
  await expect(page.getByText("No se supo si el día se reabrió.")).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: true, cierres: 1, reaperturas: 1 });

  // Se recarga: lo primero que se ve es eso mismo, con quien ya había autorizado. La clave no se guardó.
  await page.reload();
  await expect(page.getByText("No se supo si el día se reabrió.")).toBeVisible();
  await expect(page.getByText("Clave de Servando")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reabrir el día" })).toHaveCount(0);
  await autorizar(page, g.servando.clave);
  await expect(page.locator(".okmsg")).toContainText("El día quedó abierto otra vez");
  await expect(page.getByRole("button", { name: "Cerrar el día" })).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: true, cierres: 1, reaperturas: 1 });
});

test("una pestaña atrasada no reabre un cierre que ya no es el vigente, ni cierra un día que otra reabrió", async ({ page, context }) => {
  const g = await gente();
  await enElCierre(page, g);

  // La otra pestaña ve el día abierto, con cero cierres, y ahí se queda.
  const otra = await context.newPage();
  await otra.goto("/cierre");
  await expect(otra.getByRole("button", { name: "Cerrar el día" })).toBeVisible();

  // En esta se cierra y se reabre: el día lleva un cierre.
  await cerrar(page);
  await pedirReabrir(page);
  await autorizar(page, g.servando.clave);
  await expect(page.locator(".okmsg")).toContainText("El día quedó abierto otra vez");

  // La atrasada quiere cerrar lo que vio: no cierra, lo dice, y muestra el día como está.
  await cerrar(otra);
  await expect(aviso(otra)).toContainText("ya se cerró o se reabrió desde que se vio");
  expect(await enLaBase()).toEqual({ abierta: true, cierres: 1, reaperturas: 1 });
  // Ya viéndolo como está, sí lo cierra: es el segundo cierre.
  await cerrar(otra);
  await expect(otra.getByText("Jornada cerrada · cierre 2")).toBeVisible();

  // Ahora la primera es la atrasada. Recarga, ve el cierre 2 y deja elegida a quien autoriza.
  await page.reload();
  await expect(cerrado(page)).toBeVisible();
  await pedirReabrir(page);
  // Mientras tanto, en la otra se reabre y se vuelve a cerrar: el vigente es el cierre 3.
  await pedirReabrir(otra);
  await autorizar(otra, g.servando.clave);
  await expect(otra.locator(".okmsg")).toContainText("El día quedó abierto otra vez");
  await cerrar(otra);
  await expect(otra.getByText("Jornada cerrada · cierre 3")).toBeVisible();

  // La clave llega tarde: no reabre el cierre 3, que nadie pidió reabrir.
  await autorizar(page, g.servando.clave);
  await expect(aviso(page)).toContainText("Ese cierre ya no es el vigente");
  await expect(page.getByText("Jornada cerrada · cierre 3")).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: false, cierres: 3, reaperturas: 2 });
});

test("si el día que se cerró ya no es hoy, no se ofrece reabrirlo: se abre la jornada de hoy", async ({ page }) => {
  const g = await gente();
  await enElCierre(page, g);
  await cerrar(page);
  await expect(cerrado(page)).toBeVisible();
  // Al día siguiente (para la base sigue siendo hoy: se recorre la fecha de la jornada cerrada).
  await conConsola(async (db) => {
    await db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
    await db.query("UPDATE jornada SET fecha = fecha - 1");
    await db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
  });
  await page.reload();
  await expect(page.getByText("La jornada de hoy no está abierta")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reabrir el día" })).toHaveCount(0);
  await expect(cerrado(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir la jornada de hoy" }).click();
  await page.getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByRole("button", { name: "Cerrar el día" })).toBeVisible();
});

test("una pestaña duplicada no hereda un cierre a medias: se resuelve donde se empezó", async ({ page, context }) => {
  const g = await gente();
  await enElCierre(page, g);
  await perderLaRespuesta(page, CERRAR);
  await cerrar(page);
  await expect(page.getByText("No se supo si el cierre se guardó.")).toBeVisible();

  // La copia nace con lo que la primera tenía guardado, y lo suelta: no le toca reintentar nada.
  const abierta = context.waitForEvent("page");
  await page.evaluate(() => { window.open("/cierre", "_blank"); });
  const copia = await abierta;
  await expect(copia.locator(".okmsg")).toContainText("sigue en la otra pestaña");
  await expect(copia.getByRole("button", { name: "Volver a intentar" })).toHaveCount(0);
  await expect(copia.getByText("No se supo si el cierre se guardó.")).toHaveCount(0);
  expect(await copia.evaluate(() => sessionStorage.getItem("feruga.cierre") ?? "")).not.toContain("jornada");
  // Ve el día como está en el servidor, que ya lo cerró.
  await expect(cerrado(copia)).toBeVisible();

  // La primera sigue con lo suyo, y el día queda cerrado una sola vez.
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(cerrado(page)).toBeVisible();
  expect(await enLaBase()).toEqual({ abierta: false, cierres: 1, reaperturas: 0 });
});

// Lo que encontró Codex (A7-A-M1): al resolver una reapertura que sí había entrado, el servidor
// contesta lo que hizo ENTONCES. Si entre tanto el día se volvió a cerrar, la pantalla no puede
// decir que quedó abierto.
for (const salida of ["reintentar", "autoriza otra persona"] as const) {
  test(`una reapertura de la que no se supo, cuando el día ya se volvió a cerrar: al resolverla (${salida}) no se dice que quedó abierto`, async ({ page, context }) => {
    const g = await gente();
    await enElCierre(page, g);
    await cerrar(page);
    await expect(cerrado(page)).toBeVisible();
    await perderLaRespuesta(page, REABRIR);
    await pedirReabrir(page);
    await autorizar(page, g.servando.clave);
    await expect(page.getByText("No se supo si el día se reabrió.")).toBeVisible();

    // En otra pestaña el día se ve abierto, se atiende lo que sea y se vuelve a cerrar.
    const otra = await context.newPage();
    await otra.goto("/cierre");
    await cerrar(otra);
    await expect(otra.getByText("Jornada cerrada · cierre 2")).toBeVisible();

    if (salida === "reintentar") await autorizar(page, g.servando.clave);
    else await page.getByRole("button", { name: "Autoriza otra persona" }).click();
    await expect(page.locator(".okmsg")).toContainText("ya había quedado registrada");
    await expect(page.locator(".okmsg")).toContainText("se volvió a cerrar");
    await expect(page.locator(".okmsg")).not.toContainText("abierto otra vez");
    // Y muestra el día como está: cerrado, en su segundo cierre, y se puede pedir reabrir ese.
    await expect(page.getByText("Jornada cerrada · cierre 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reabrir el día" })).toBeVisible();
    expect(await enLaBase()).toEqual({ abierta: false, cierres: 2, reaperturas: 1 });
  });
}
