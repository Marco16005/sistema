// El precio especial, en la pantalla: a un material de una cuenta abierta se le da un precio
// distinto del de lista, para un cliente y con la clave de quien autoriza. Lo que aquí se recorre
// es lo que ve quien atiende —cómo queda antes de autorizar, el renglón, el total, el comprobante,
// el cierre— y lo que pasa cuando una respuesta se pierde: las reglas se prueban en la base
// (pruebas/26-precio-especial.test.ts) y por las rutas (pruebas/17-rutas.test.ts).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { altaDePersona, aviso, baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const DAR = /\/api\/cuentas\/[^/]+\/precio-especial$/;
const QUITAR = /\/api\/cuentas\/[^/]+\/precio-especial\/quitar$/;

async function listo(page: Page, saldos: Array<[string, string]> = []): Promise<Gente> {
  const g = await gente();
  await diaListo(g, saldos);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  return g;
}

/** Abre el precio especial de ese material y lo llena, hasta dejarlo listo para autorizar. */
async function pedirPrecio(page: Page, material: string, o: { cliente?: string; nuevo?: string; menos?: boolean; diferencia: string }): Promise<void> {
  await page.getByRole("button", { name: `Precio especial para ${material}` }).click();
  if (o.nuevo !== undefined) {
    await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
    await page.getByLabel("Nombre del cliente nuevo").fill(o.nuevo);
  }
  if (o.cliente !== undefined) await page.locator(".grid").getByRole("button", { name: o.cliente, exact: true }).click();
  if (o.menos) await page.getByRole("button", { name: "Menos que la lista" }).click();
  await teclear(page, o.diferencia);
}

/** Quien autoriza se elige —si hay que elegir— y teclea su clave. */
async function autorizar(page: Page, quien: { nombre: string }, clave: string): Promise<void> {
  const hoja = page.getByRole("dialog");
  if (await hoja.getByText("¿Quién autoriza?").isVisible()) await hoja.getByRole("button", { name: new RegExp("^" + quien.nombre) }).click();
  await teclear(page, clave);
  await hoja.getByRole("button", { name: `Autorizar a nombre de ${quien.nombre}` }).click();
}

const queda = (page: Page) => page.locator(".queda");
const total = (page: Page) => page.locator(".tot.big");
/** Los cambios de precio que la base tiene anotados: qué se hizo, y a cuánto quedó. */
const anotados = (): Promise<Array<{ que: string; precio: string }>> =>
  conConsola(async (db) => (await db.query("SELECT clase AS que, precio_nuevo::text AS precio FROM precio_especial ORDER BY id")).rows);

test("a un material se le da precio especial para un cliente nuevo, con la clave de un responsable: se ve cómo queda antes de autorizar, el renglón lo dice, la cuenta queda a su nombre y el total cambia; quitarlo lo regresa a la lista", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await expect(total(page)).toHaveText("Se paga$210");

  await pedirPrecio(page, "Cartón", { nuevo: "  Recicladora   del Norte ", diferencia: "0.5" });
  await expect(queda(page)).toHaveText("Lista $2.10 → queda $2.60 por kilo, para Recicladora del Norte.");
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  // Antes de teclear la clave, quien autoriza lee lo que autoriza.
  await expect(page.getByRole("dialog")).toContainText("Cartón: lista $2.10 → queda $2.60 por kilo, para Recicladora del Norte.");
  await autorizar(page, g.servando, g.servando.clave);

  await expect(page.locator(".okmsg")).toHaveText("Precio especial: Cartón queda en $2.60 por kilo, para Recicladora del Norte.");
  await expect(page.locator(".ren")).toContainText("100.000 kg × $2.60");
  await expect(page.locator(".especial")).toContainText("lista $2.10");
  await expect(page.locator(".especial")).toContainText("Autorizó Servando");
  await expect(page.getByText("A nombre de Recicladora del Norte")).toBeVisible();
  await expect(total(page)).toHaveText("Se paga$260");
  expect(await conConsola(async (db) => (await db.query("SELECT nombre FROM cliente")).rows)).toEqual([{ nombre: "Recicladora del Norte" }]);

  // Quitarlo no pide clave: es volver al precio de siempre. Y la cuenta deja de estar a nombre de nadie.
  await page.getByRole("button", { name: "Quitar el precio especial de Cartón" }).click();
  await expect(page.locator(".okmsg")).toHaveText("Cartón volvió a su precio de lista.");
  await expect(total(page)).toHaveText("Se paga$210");
  await expect(page.locator(".especial")).toHaveCount(0);
  await expect(page.getByText("A nombre de")).toHaveCount(0);
  expect((await anotados()).map((a) => a.precio)).toEqual(["2.6000", "2.1000"]);
});

test("un día con precio especial en una compra y en una venta: el cliente ya registrado se elige de la lista; el comprobante lleva su nombre y el precio que se aplicó, sin decir que es especial; y el cierre dice qué se dio, a quién y cuánto significó", async ({ page }) => {
  const g = await listo(page, [["Cartón", "500"]]);
  // La compra: 100 kg, a 50 centavos más que la lista.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await autorizar(page, g.servando, g.servando.clave);
  await expect(total(page)).toHaveText("Se paga$260");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  const ticket = page.locator(".ticket");
  await expect(ticket).toContainText("A PAGAR$260");
  await expect(ticket).toContainText("Cliente: Don Chuy");
  await expect(ticket).toContainText("100.000 kg × $2.60");
  // Lo que es del negocio no sale en el papel: ni que es especial, ni cuánto era la lista.
  const impreso = (await ticket.textContent()) ?? "";
  expect(impreso).not.toMatch(/especial|lista|2\.10/i);

  // La venta: 200 kg, a 25 centavos menos. Don Chuy ya está en la lista.
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "200");
  await pedirPrecio(page, "Cartón", { cliente: "Don Chuy", menos: true, diferencia: "0.25" });
  await expect(queda(page)).toHaveText("Lista $2.50 → queda $2.25 por kilo, para Don Chuy.");
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await autorizar(page, g.servando, g.servando.clave);
  await expect(total(page)).toHaveText("Se cobra$450");
  await page.getByRole("button", { name: "Cobrar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("Cliente: Don Chuy");

  // El cierre: lo que se dio en el día, compras y ventas aparte, con lo que significó en dinero.
  await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Cierre" }).click();
  const dados = page.locator(".card", { has: page.getByRole("heading", { name: "Precios especiales del día" }) });
  await expect(dados).toContainText("Don Chuy");
  await expect(dados.locator(".ren")).toHaveCount(2);
  await expect(dados.locator(".ren").nth(0)).toContainText("100.000 kg × $2.60");
  await expect(dados.locator(".ren").nth(0)).toContainText("lista $2.10");
  await expect(dados.locator(".ren").nth(0)).toContainText("Autorizó Servando");
  await expect(dados.locator(".ren").nth(0).locator(".ri")).toHaveText("+$50.00");
  await expect(dados.locator(".ren").nth(1)).toContainText("200.000 kg × $2.25");
  await expect(dados.locator(".ren").nth(1).locator(".ri")).toHaveText("−$50.00");
  await expect(dados).toContainText("En compras se pagó de más$50.00");
  await expect(dados).toContainText("En ventas se cobró de menos$50.00");
});

test("un día sin precios especiales no enseña esa lista en el cierre", async ({ page }) => {
  await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
  await expect(page.locator(".ticket")).not.toContainText("Cliente");
  await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByRole("heading", { name: "Dinero del día" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Precios especiales del día" })).toHaveCount(0);
});

test("lo que no puede ser no se deja autorizar: sin cliente, sin diferencia, o un precio que quedaría en cero o menos; y salir sin darlo no cambia nada", async ({ page }) => {
  await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await page.getByRole("button", { name: "Precio especial para Cartón" }).click();
  const boton = page.getByRole("button", { name: "Autorizar el precio especial", exact: true });
  await expect(boton).toBeDisabled();
  await expect(queda(page)).toHaveText("Teclea la diferencia para ver cómo queda.");
  // Con diferencia y sin cliente, tampoco.
  await teclear(page, "0.5");
  await expect(boton).toBeDisabled();
  await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
  await page.getByLabel("Nombre del cliente nuevo").fill("   ");
  await expect(boton).toBeDisabled();
  await page.getByLabel("Nombre del cliente nuevo").fill("Don Chuy");
  await expect(boton).toBeEnabled();
  // Hacia abajo, más de lo que vale la lista: quedaría en menos que nada.
  await page.getByRole("button", { name: "Menos que la lista" }).click();
  for (let k = 0; k < 3; k++) await page.locator(".teclado").getByRole("button", { name: "Borrar" }).click();
  await teclear(page, "2.1");
  await expect(queda(page)).toHaveText("El precio tiene que quedar mayor que cero.");
  await expect(boton).toBeDisabled();
  await page.getByRole("button", { name: "No dar precio especial" }).click();
  await expect(total(page)).toHaveText("Se paga$210");
  expect(await anotados()).toEqual([]);
});

test("con la clave equivocada no se da, y se dice; con la buena, sí, y una sola vez", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await autorizar(page, g.servando, "000000");
  await expect(aviso(page)).toContainText("La clave no pasó");
  expect(await anotados()).toEqual([]);
  // Con una clave rechazada ese envío quedó cancelado: se puede elegir otra vez quién autoriza.
  await autorizar(page, g.servando, g.servando.clave);
  await expect(total(page)).toHaveText("Se paga$260");
  expect(await anotados()).toEqual([{ que: "dar", precio: "2.6000" }]);
});

for (const llego of [true, false]) {
  test(`si se pierde la respuesta al dar el precio —y ${llego ? "sí había llegado" : "no había llegado"}—, no se sabe: no se cambia nada, se autoriza otra vez el mismo, también después de recargar, y queda dado una sola vez`, async ({ page }) => {
    const g = await listo(page);
    await page.getByRole("button", { name: "+ Compra" }).click();
    await pesar(page, "Cartón", "Báscula 2", "100");
    await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
    await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
    const enviados: Array<Record<string, unknown>> = [];
    await page.route(DAR, async (ruta) => {
      enviados.push(ruta.request().postDataJSON());
      if (llego) await ruta.fetch();              // el servidor lo recibe y lo da…
      await ruta.abort("connectionreset");        // …y la respuesta se pierde en el camino
    }, { times: 1 });
    await autorizar(page, g.servando, g.servando.clave);
    const hoja = page.getByRole("dialog");
    await expect(hoja).toContainText("No se supo si el precio especial quedó dado");
    // Se le pide la clave a la misma persona, sin elegir.
    await expect(hoja.getByText("Clave de Servando")).toBeVisible();
    expect(await anotados()).toEqual(llego ? [{ que: "dar", precio: "2.6000" }] : []);
    // El envío quedó guardado en el equipo, para poder mandar ese mismo otra vez. La clave, no: ni ahí ni en ningún lado.
    const guardado = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
    expect(guardado).toContain(String(enviados[0]!.id));
    expect(guardado).not.toContain(g.servando.clave);

    // Se recarga la página con el envío en el aire: sigue ahí, y no deja cambiar nada.
    await page.reload();
    await expect(page.getByRole("dialog")).toContainText("No se supo si el precio especial quedó dado");
    await page.getByRole("dialog").getByRole("button", { name: "Regresar" }).click();
    await expect(aviso(page)).toContainText("No se supo si este precio especial quedó dado");
    await expect(page.getByRole("button", { name: "Menos que la lista" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "No dar precio especial" })).toHaveCount(0);
    await expect(page.locator(".pasos").getByRole("button", { name: /Material/ })).toBeDisabled();
    await page.getByRole("button", { name: "Volver a autorizar" }).click();
    await page.route(DAR, async (ruta) => {
      enviados.push(ruta.request().postDataJSON());
      await ruta.fallback();
    });
    await autorizar(page, g.servando, g.servando.clave);
    await expect(page.locator(".okmsg")).toHaveText("Precio especial: Cartón queda en $2.60 por kilo, para Don Chuy.");
    await expect(total(page)).toHaveText("Se paga$260");
    // El mismo envío, con el mismo identificador y lo mismo adentro; y en la base, una sola vez.
    expect(enviados).toHaveLength(2);
    const sinClave = (e: Record<string, unknown>) => ({ ...e, clave: "" });
    expect(sinClave(enviados[1]!)).toEqual(sinClave(enviados[0]!));
    expect(await anotados()).toEqual([{ que: "dar", precio: "2.6000" }]);
    // Y ya resuelto, no queda guardado nada de él.
    const despues = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
    expect(despues).not.toContain(String(enviados[0]!.id));
    expect(despues).not.toContain(g.servando.clave);
  });
}

test("si el servidor falla después de dar el precio, tampoco se sabe: al autorizar otra vez contesta lo que ya había hecho", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await page.route(DAR, async (ruta) => {
    await ruta.fetch();
    await ruta.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" });
  }, { times: 1 });
  await autorizar(page, g.servando, g.servando.clave);
  await expect(page.getByRole("dialog")).toContainText("No se supo si el precio especial quedó dado");
  await autorizar(page, g.servando, g.servando.clave);
  await expect(total(page)).toHaveText("Se paga$260");
  expect(await anotados()).toEqual([{ que: "dar", precio: "2.6000" }]);
});

test("con un envío del que no se supo, «autoriza otra persona» primero resuelve ese envío: si no había entrado queda cancelado, y entonces sí se elige a otra", async ({ page }) => {
  const g = await listo(page);
  const marta = await altaDePersona("Marta", "responsable", "162342", true);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await page.route(DAR, (ruta) => ruta.abort("connectionreset"), { times: 1 });
  await autorizar(page, g.servando, g.servando.clave);
  const hoja = page.getByRole("dialog");
  await expect(hoja.getByText("Clave de Servando")).toBeVisible();
  await hoja.getByRole("button", { name: "Autoriza otra persona" }).click();
  await expect(hoja.getByText("¿Quién autoriza?")).toBeVisible();
  await autorizar(page, marta, "162342");
  await expect(page.locator(".especial")).toContainText("Autorizó Marta");
  expect(await anotados()).toEqual([{ que: "dar", precio: "2.6000" }]);
});

for (const llego of [true, false]) {
  test(`si se pierde la respuesta al quitar el precio especial —y ${llego ? "sí había llegado" : "no había llegado"}—, no se sabe: la cuenta no deja hacer otra cosa hasta saberlo, y se quita una sola vez`, async ({ page }) => {
    const g = await listo(page);
    await page.getByRole("button", { name: "+ Compra" }).click();
    await pesar(page, "Cartón", "Báscula 2", "100");
    await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
    await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
    await autorizar(page, g.servando, g.servando.clave);
    await expect(total(page)).toHaveText("Se paga$260");
    await page.route(QUITAR, async (ruta) => {
      if (llego) await ruta.fetch();
      await ruta.abort("connectionreset");
    }, { times: 1 });
    await page.getByRole("button", { name: "Quitar el precio especial de Cartón" }).click();
    await expect(aviso(page)).toContainText("No se supo si se quitó el precio especial de Cartón");
    // Mientras no se sepa, no se paga con un total que quizá ya cambió, ni se agrega ni se quita nada.
    await expect(page.getByRole("button", { name: "Pagar e imprimir ticket" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Quitar Cartón" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "＋ Agregar otro material" })).toBeDisabled();
    // Ni por los pasos de arriba (lo encontró Codex al revisar la pantalla): por «Material» se podía agregar otro.
    await expect(page.locator(".pasos").getByRole("button", { name: /Material/ })).toBeDisabled();
    await expect(page.locator(".pasos").getByRole("button", { name: /Báscula/ })).toBeDisabled();
    await page.reload();
    if (llego) {
      // Al recargar, la cuenta llega como quedó: ya no lleva precio especial, y no queda nada por saber.
      await expect(total(page)).toHaveText("Se paga$210");
      await expect(aviso(page)).toHaveCount(0);
    } else {
      // Sigue sin saberse, también después de recargar: se manda otra vez el mismo.
      await expect(aviso(page)).toContainText("No se supo si se quitó el precio especial de Cartón");
      await expect(page.getByRole("button", { name: "Pagar e imprimir ticket" })).toBeDisabled();
      await page.getByRole("button", { name: "Volver a intentar" }).click();
      await expect(page.locator(".okmsg")).toHaveText("Cartón volvió a su precio de lista.");
      await expect(total(page)).toHaveText("Se paga$210");
    }
    await expect(page.getByRole("button", { name: "Pagar e imprimir ticket" })).toBeEnabled();
    await expect(page.locator(".especial")).toHaveCount(0);
    expect((await anotados()).map((a) => a.que)).toEqual(["dar", "quitar"]);
  });
}

test("si el precio de ese material cambió mientras se tenía abierto —por otro lado—, no se pisa: se dice, y se vuelve a ver la cuenta", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  // Mientras tanto, por otro lado, a ese material ya se le dio otro precio.
  const linea = await conConsola(async (db) => (await db.query("SELECT id, operacion_id AS cuenta FROM operacion_linea")).rows[0] as { id: string; cuenta: string });
  const otra = await page.evaluate(async ({ cuenta, renglon, persona, autoriza, clave }) => {
    const r = await fetch(`/api/cuentas/${cuenta}/precio-especial`, {
      method: "POST", headers: { "content-type": "application/json", "x-persona": persona },
      body: JSON.stringify({ id: crypto.randomUUID(), linea: renglon, visto: null, cliente: null, clienteNuevo: "Otro Cliente", diferencia: "1", autoriza, clave }),
    });
    return r.status;
  }, { cuenta: linea.cuenta, renglon: linea.id, persona: String(g.luis.id), autoriza: String(g.servando.id), clave: g.servando.clave });
  expect(otra).toBe(200);
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await autorizar(page, g.servando, g.servando.clave);
  await expect(aviso(page)).toContainText("El precio de ese material cambió mientras lo tenías abierto");
  // De vuelta en la cuenta, como quedó: con el precio que dio el otro.
  await expect(page.locator(".especial")).toContainText("queda $3.10");
  expect((await anotados()).map((a) => a.precio)).toEqual(["3.1000"]);
});

test("una diferencia de media diezmilésima no se pierde: lo que se enseña antes de autorizar es lo que queda en la cuenta y lo que sale en el papel", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.0005" });
  await expect(queda(page)).toHaveText("Lista $2.10 → queda $2.1005 por kilo, para Don Chuy.");
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await autorizar(page, g.servando, g.servando.clave);
  await expect(page.locator(".ren")).toContainText("100.000 kg × $2.1005");
  await expect(page.locator(".tot.first")).toContainText("$210.05");
  expect(await anotados()).toEqual([{ que: "dar", precio: "2.1005" }]);
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("100.000 kg × $2.1005");
  await expect(page.locator(".ticket")).toContainText("$210.05");
});

test("lo capturado para un precio especial es de su cuenta: cambiar a otra no lo lleva, y al volver sigue ahí; y si esa cuenta se descartó por otro lado, al autorizar se dice y no queda nada dado", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "PET", "Báscula 2", "10", "Plástico");
  const cuentas = page.getByRole("complementary", { name: "Cuentas abiertas" });
  // En la primera, el precio especial a medio llenar.
  await cuentas.getByRole("button", { name: /^Compra 1/ }).click();
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  // En la segunda no hay nada de eso: es otra cuenta.
  await cuentas.getByRole("button", { name: /^Compra 2/ }).click();
  await expect(page.getByRole("button", { name: "Precio especial para PET" })).toBeVisible();
  await expect(queda(page)).toHaveCount(0);
  // De vuelta en la primera —también después de recargar—, sigue como se dejó.
  await page.reload();
  await cuentas.getByRole("button", { name: /^Compra 1/ }).click();
  await expect(queda(page)).toHaveText("Lista $2.10 → queda $2.60 por kilo, para Don Chuy.");
  // Esa cuenta se descarta desde otro equipo, con el panel abierto aquí.
  const cuenta = await conConsola(async (db) => (await db.query("SELECT l.operacion_id AS id FROM operacion_linea l JOIN material m ON m.id = l.material_id WHERE m.nombre = 'Cartón'")).rows[0].id as string);
  const descartada = await page.evaluate(async ({ id, persona }) => (await fetch(`/api/cuentas/${id}/descartar`, { method: "POST", headers: { "content-type": "application/json", "x-persona": persona }, body: "{}" })).status, { id: cuenta, persona: String(g.luis.id) });
  expect(descartada).toBe(200);
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await autorizar(page, g.servando, g.servando.clave);
  await expect(aviso(page)).toContainText("No se dio el precio especial");
  await expect(cuentas.getByRole("button", { name: /^Compra 1/ })).toHaveCount(0);
  await expect(cuentas.getByRole("button", { name: /^Compra 2/ })).toBeVisible();
  expect(await anotados()).toEqual([]);
});

test("quien pesa en el patio arma la cuenta, pero no da ni quita precios especiales: no se le ofrece", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  const pato = await altaDePersona("Pato", "patio", "2718");
  await darDeAltaEquipo(page);
  await entrar(page, pato);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await expect(page.getByRole("button", { name: "Quitar Cartón" })).toBeVisible();
  await expect(page.getByRole("button", { name: /precio especial/i })).toHaveCount(0);
});

test("capturas del precio especial, para verlas", async ({ page }) => {
  test.skip(process.env.CAPTURAS !== "1", "solo cuando se piden capturas");
  // Alta, para que quepa la pantalla entera sin desplazarla: así la barra de arriba sale en su lugar.
  await page.setViewportSize({ width: 1280, height: 1500 });
  const g = await listo(page, [["Cartón", "500"]]);
  const foto = async (nombre: string): Promise<void> => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);       // lo que estaba cambiando de color termina de cambiar
    await page.screenshot({ path: `recorrido/capturas/precio-especial/${nombre}.png` });
  };
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await foto("1-la-cuenta-con-su-boton");
  await pedirPrecio(page, "Cartón", { nuevo: "Don Chuy", diferencia: "0.5" });
  await foto("2-el-panel-lleno");
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Servando/ }).click();
  await foto("3-autorizar-con-clave");
  await autorizar(page, g.servando, g.servando.clave);
  await expect(total(page)).toHaveText("Se paga$260");
  await foto("4-el-renglon-con-precio-especial");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("Cliente: Don Chuy");
  await foto("5-el-comprobante");
  await page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Cierre" }).click();
  await expect(page.getByRole("heading", { name: "Precios especiales del día" })).toBeVisible();
  await foto("6-el-cierre");
});
