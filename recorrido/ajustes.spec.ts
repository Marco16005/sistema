// Los ajustes: personas, equipos, materiales y clientes desde la pantalla. Personas y equipos los
// pide un responsable facultado para autorizar, con su clave cada vez; lo que se genera —la clave
// de una persona, el código de un equipo— se ve una sola vez. Los materiales y los clientes,
// cualquier responsable. Las reglas se prueban en la base y por las rutas (pruebas/44-materiales,
// 45-administracion y 46-clientes-en-pantalla); aquí, lo que ve y hace quien administra.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { altaDePersona, aviso, baseNueva, conConsola, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, pesar, salir, teclear } from "./apoyo.ts";
import type { Gente, Persona } from "./apoyo.ts";

test.beforeEach(baseNueva);

/** Entra, y espera a que la aplicación termine de llevar a esa persona a su pantalla antes de pedir otra. */
async function adentro(page: Page, persona: Persona): Promise<void> {
  await entrar(page, persona);
  await page.waitForURL((u) => u.pathname !== "/");
}

/** El día en marcha (con lo que haya en el patio), este equipo dado de alta, Servando adentro y en los ajustes. */
async function enAjustes(page: Page, g: Gente, saldos: Array<[string, string]> = []): Promise<void> {
  await diaListo(g, saldos);
  await darDeAltaEquipo(page);
  await adentro(page, g.servando);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Ajustes" }).click();
  await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
}

const renglon = (page: Page, nombre: string) => page.locator(".administrado").filter({ has: page.getByText(nombre, { exact: true }) });
const tarjeta = (page: Page, titulo: string) => page.locator(".card").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) });
const hoja = (page: Page) => page.getByRole("dialog");
/** Teclea la clave en la hoja y toca el botón que lo hace. */
async function conMiClave(page: Page, clave: string, boton: string): Promise<void> {
  await teclear(page, clave);
  await hoja(page).getByRole("button", { name: boton, exact: true }).click();
}

test("el responsable que autoriza da de alta a una persona con su clave: se le enseña la clave nueva una sola vez, y con ella la persona entra", async ({ page }) => {
  const g = await gente();
  await enAjustes(page, g);
  // En la barra de arriba sigue siendo el panel.
  await expect(page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: "Panel" })).toHaveAttribute("aria-current", "true");
  await expect(renglon(page, "Servando")).toContainText("responsable · autoriza · está adentro, en Mostrador · se cambia por la consola");
  await expect(renglon(page, "Servando").getByRole("button")).toHaveCount(0);
  await expect(renglon(page, "Luis")).toContainText("mostrador");
  await expect(renglon(page, "Luis").getByRole("button")).toHaveCount(2);

  await page.getByRole("button", { name: "Dar de alta a una persona" }).click();
  await expect(page.getByRole("button", { name: /^Dar de alta a …$/ })).toBeDisabled();
  await page.getByLabel("Cómo se llama").fill("Rosa");
  await page.getByRole("group", { name: "Qué va a hacer" }).getByRole("button", { name: "Patio" }).click();
  await expect(page.getByText("Arma cuentas y pesa. No cobra.")).toBeVisible();
  await page.getByRole("button", { name: "Dar de alta a Rosa" }).click();
  await expect(hoja(page)).toContainText("Dar de alta a Rosa");
  await expect(hoja(page)).toContainText("Tu clave, Servando");

  // Con una clave que no es, no se da de alta a nadie, y se dice ahí mismo.
  await conMiClave(page, "000000", "Dar de alta");
  await expect(hoja(page).getByRole("alert")).toContainText("La clave no pasó");
  await expect(renglon(page, "Rosa")).toHaveCount(0);

  await conMiClave(page, g.servando.clave, "Dar de alta");
  const unaVez = page.locator(".unavez");
  await expect(unaVez).toContainText("Clave de Rosa");
  await expect(unaVez).toContainText("no se vuelve a mostrar");
  const clave = (await unaVez.locator(".secreto").textContent())!;
  expect(clave).toMatch(/^\d{4}$/);
  await expect(renglon(page, "Rosa")).toContainText("patio");
  // Es una hoja, y no se va con Escape: se cierra solo al decir que ya se anotó.
  await expect(hoja(page)).toContainText("Clave de Rosa");
  await page.keyboard.press("Escape");
  await expect(unaVez).toBeVisible();
  await unaVez.getByRole("button", { name: "Ya la anoté" }).click();
  await expect(page.locator(".unavez, .secreto")).toHaveCount(0);

  // Y Rosa entra con esa clave.
  await salir(page);
  await entrar(page, { id: "", nombre: "Rosa", clave });
});

test("cambiarle la clave a una persona le da una nueva y deja sin efecto la de antes; darla de baja la deja afuera, y queda entre las dadas de baja", async ({ page }) => {
  const g = await gente();
  await enAjustes(page, g);
  await page.getByRole("button", { name: "Cambiar la clave de Luis" }).click();
  await expect(hoja(page)).toContainText("Su clave de ahora deja de servir");
  await conMiClave(page, g.servando.clave, "Cambiar la clave");
  const unaVez = page.locator(".unavez");
  await expect(unaVez).toContainText("Clave nueva de Luis");
  const nueva = (await unaVez.locator(".secreto").textContent())!;
  expect(nueva).toMatch(/^\d{4}$/);
  expect(nueva).not.toBe(g.luis.clave);
  await unaVez.getByRole("button", { name: "Ya la anoté" }).click();

  // Regresar de la hoja sin teclear no hace nada.
  await page.getByRole("button", { name: "Dar de baja a Luis" }).click();
  await expect(hoja(page)).toContainText("Luis ya no podrá entrar");
  await hoja(page).getByRole("button", { name: "No, regresar" }).click();
  await expect(hoja(page)).toHaveCount(0);
  await expect(tarjeta(page, "Dadas de baja")).toHaveCount(0);

  await page.getByRole("button", { name: "Dar de baja a Luis" }).click();
  await conMiClave(page, g.servando.clave, "Dar de baja");
  await expect(hoja(page)).toHaveCount(0);
  await expect(tarjeta(page, "Dadas de baja")).toContainText("Luis");
  await expect(tarjeta(page, "Dadas de baja")).toContainText("ya no entra");
  await expect(tarjeta(page, "Personas").locator(".administrado")).toHaveCount(1);

  // En la puerta ya no está Luis.
  await salir(page);
  await expect(page.getByRole("button", { name: /^Servando/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Luis/ })).toHaveCount(0);
});

test("un equipo nuevo se da de alta con un código que se pide aquí y se teclea allá; después se da de baja desde aquí, y allá deja de entrar; este equipo no se da de baja a sí mismo", async ({ page, browser, baseURL }) => {
  const g = await gente();
  await enAjustes(page, g);
  await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Equipos" }).click();
  await expect(renglon(page, "Mostrador")).toContainText("Es este equipo · desde el");
  await expect(renglon(page, "Mostrador")).toContainText("atiende Servando");
  await expect(renglon(page, "Mostrador").getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: "Dar de alta un equipo" }).click();
  await page.getByLabel("Cómo se va a llamar").fill("Oficina");
  await page.getByRole("button", { name: "Pedir el código para Oficina" }).click();
  await expect(hoja(page)).toContainText("Dar de alta el equipo Oficina");
  await conMiClave(page, g.servando.clave, "Pedir el código");
  const unaVez = page.locator(".unavez");
  await expect(unaVez).toContainText("Código para Oficina");
  await expect(unaVez).toContainText("vence en 15 minutos");
  const codigo = (await unaVez.locator(".secreto").textContent())!;
  expect(codigo).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

  // Allá, en el equipo nuevo: con el código queda dado de alta.
  const otro = await browser.newContext({ baseURL });
  const alla = await otro.newPage();
  await alla.goto("/");
  await alla.getByLabel("Código de alta").fill(codigo);
  await alla.getByRole("button", { name: "Dar de alta" }).click();
  await expect(alla.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();

  // Aquí: al volver a mirar ya está, y se puede dar de baja.
  await unaVez.getByRole("button", { name: "Listo" }).click();
  await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Personas" }).click();
  await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Equipos" }).click();
  await expect(renglon(page, "Oficina")).toContainText("nadie adentro");
  await page.getByRole("button", { name: "Dar de baja el equipo Oficina" }).click();
  await expect(hoja(page)).toContainText("Desde Oficina ya no se podrá entrar");
  await conMiClave(page, g.servando.clave, "Dar de baja");
  await expect(hoja(page)).toHaveCount(0);
  await expect(tarjeta(page, "Dados de baja")).toContainText("Oficina");
  await expect(tarjeta(page, "Equipos").locator(".administrado")).toHaveCount(1);

  // Allá ya no pasa de la puerta: vuelve a pedir un código.
  await alla.reload();
  await expect(alla.getByLabel("Código de alta")).toBeVisible();
  await otro.close();
});

test("tocar dos veces el botón de la hoja lo manda una sola vez, y la clave tecleada no se queda a la vista mientras se espera: la clave que se enseña es la que vale", async ({ page }) => {
  // Lo pidió comprobar la revisión de Codex del 12 de octubre.
  const g = await gente();
  await enAjustes(page, g);
  let pedidos = 0;
  await page.route(/\/api\/administracion\/personas\/\d+\/clave$/, async (ruta) => {
    pedidos += 1;
    await new Promise((listo) => setTimeout(listo, 700));
    await ruta.fallback();
  });
  await page.getByRole("button", { name: "Cambiar la clave de Luis" }).click();
  await teclear(page, g.servando.clave);
  await expect(hoja(page).locator(".puntos i.lleno")).toHaveCount(6);
  await hoja(page).getByRole("button", { name: "Cambiar la clave", exact: true }).dblclick();
  // Mientras llega la respuesta —tarda, y todavía no llegó—, la clave ya no está en la hoja. Se mira
  // en el momento, sin esperar: esperando, la hoja se va sola y la pregunta se contesta sin querer.
  expect(await page.locator(".unavez").count()).toBe(0);
  expect(await hoja(page).locator(".puntos i.lleno").count()).toBe(0);
  const unaVez = page.locator(".unavez");
  await expect(unaVez).toContainText("Clave nueva de Luis");
  await page.waitForTimeout(900);
  expect(pedidos).toBe(1);
  const nueva = (await unaVez.locator(".secreto").textContent())!;
  await unaVez.getByRole("button", { name: "Ya la anoté" }).click();
  await salir(page);
  await entrar(page, { id: "", nombre: "Luis", clave: nueva });
});

// ── los materiales ─────────────────────────────────────────────────────────

const enMateriales = (page: Page) => page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Materiales" }).click();

test("el responsable da de alta un material: elige su familia, escribe su nombre y cómo se lee, y queda en el catálogo sin precio; uno que ya existe no se repite", async ({ page }) => {
  const g = await gente();
  await enAjustes(page, g);
  await enMateriales(page);
  await expect(tarjeta(page, "Papel").locator(".administrado")).toHaveCount(2);

  await page.getByRole("button", { name: "Dar de alta un material" }).click();
  await expect(page.getByRole("button", { name: /^Dar de alta …$/ })).toBeDisabled();
  await page.getByRole("group", { name: "Familia" }).getByRole("button", { name: "Papel" }).click();
  await page.getByLabel("Cómo se llama").fill("Papel periódico");
  // Lo que se propone para leerse dentro de su familia, y se puede cambiar.
  await expect(page.getByLabel("Cómo se lee dentro de su familia")).toHaveValue("Periódico");
  await expect(page.getByText("El nombre ya no se podrá cambiar")).toBeVisible();
  await page.getByRole("button", { name: "Dar de alta Papel periódico" }).click();
  await expect(page.locator(".okmsg")).toContainText("Papel periódico quedó dado de alta. Tendrá precio cuando lo pongas en la lista de precios");
  await expect(tarjeta(page, "Papel").locator(".administrado")).toHaveCount(3);
  await expect(renglon(page, "Papel periódico")).toContainText("nada en el patio · sin precio en la lista de hoy");
  expect(await conConsola(async (db) => (await db.query("SELECT nombre_corto, activo, frecuente FROM material WHERE nombre = 'Papel periódico'")).rows))
    .toEqual([{ nombre_corto: "Periódico", activo: true, frecuente: false }]);

  // Otro que se llame igual, aunque sea con otras mayúsculas, no entra, y se dice por qué.
  await page.getByRole("button", { name: "Dar de alta un material" }).click();
  await page.getByRole("group", { name: "Familia" }).getByRole("button", { name: "Papel" }).click();
  await page.getByLabel("Cómo se llama").fill("cartón");
  await page.getByRole("button", { name: "Dar de alta cartón" }).click();
  await expect(aviso(page)).toContainText("Ya hay un material que se llama «Cartón»");
  await expect(tarjeta(page, "Papel").locator(".administrado")).toHaveCount(3);
});

test("un material se marca como frecuente y se desmarca; se da de baja —si no hay nada de él en el patio— y se reactiva; y la bitácora lo dice", async ({ page }) => {
  const g = await gente();
  await enAjustes(page, g, [["Cartón", "500"]]);
  await enMateriales(page);

  // Del Cartón hay 500 kg: no se ofrece darlo de baja, y se dice por qué.
  await expect(renglon(page, "Cartón")).toContainText("frecuente · 500 kg en el patio");
  await expect(renglon(page, "Cartón")).toContainText("No se puede dar de baja mientras haya en el patio");
  await expect(page.getByRole("button", { name: "Dar de baja Cartón" })).toHaveCount(0);

  // Cómo está cada material lo dice su renglón chico (el botón también dice «frecuente»).
  const comoEsta = (nombre: string) => renglon(page, nombre).locator("small").first();
  await expect(comoEsta("PET")).toHaveText("nada en el patio");
  await page.getByRole("button", { name: "Marcar PET como frecuente" }).click();
  await expect(page.locator(".okmsg")).toHaveText("PET quedó entre los frecuentes.");
  await expect(comoEsta("PET")).toHaveText("frecuente · nada en el patio");
  await page.getByRole("button", { name: "Quitar PET de los frecuentes" }).click();
  await expect(page.locator(".okmsg")).toHaveText("PET ya no está entre los frecuentes.");

  // Darlo de baja se pregunta antes; decir que no, no hace nada.
  await page.getByRole("button", { name: "Dar de baja PET" }).click();
  await expect(renglon(page, "PET")).toContainText("¿Dar de baja PET? Deja de ofrecerse en el mostrador");
  await renglon(page, "PET").getByRole("button", { name: "No", exact: true }).click();
  await expect(tarjeta(page, "Dados de baja")).toHaveCount(0);
  await page.getByRole("button", { name: "Dar de baja PET" }).click();
  await renglon(page, "PET").getByRole("button", { name: "Sí, dar de baja" }).click();
  await expect(page.locator(".okmsg")).toHaveText("PET quedó dado de baja.");
  await expect(tarjeta(page, "Dados de baja").locator(".administrado")).toContainText("PET");
  await expect(tarjeta(page, "Plástico").locator(".administrado")).toHaveCount(3);

  await page.getByRole("button", { name: "Reactivar PET" }).click();
  await expect(page.locator(".okmsg")).toHaveText("PET quedó reactivado.");
  await expect(tarjeta(page, "Dados de baja")).toHaveCount(0);
  await expect(tarjeta(page, "Plástico").locator(".administrado")).toHaveCount(4);

  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Bitácora" }).click();
  const dicho = page.locator(".asiento");
  await expect(dicho.nth(0)).toContainText("Servando reactivó el material PET");
  await expect(dicho.nth(1)).toContainText("Servando dio de baja el material PET");
  await expect(dicho.nth(2)).toContainText("Servando quitó de frecuentes el material PET");
  await expect(dicho.nth(3)).toContainText("Servando marcó como frecuente el material PET");
});

const enClientes = (page: Page) => page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Clientes" }).click();
/** De la pantalla en que esté, a esa otra, por la barra de arriba. */
const irA = (page: Page, pantalla: string) => page.getByRole("navigation", { name: "Pantallas" }).getByRole("link", { name: pantalla, exact: true }).click();
/** De regreso a los clientes de los ajustes, desde el mostrador. */
async function deVueltaEnClientes(page: Page): Promise<void> {
  await irA(page, "Panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Ajustes" }).click();
  await enClientes(page);
}
/** En el mostrador, con el precio especial ya lleno: Servando lo autoriza con su clave. */
async function autorizaServando(page: Page, g: Gente): Promise<void> {
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await hoja(page).getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await hoja(page).getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
}

test("el responsable da de alta a un cliente sin esperar a su primer precio especial, y el mostrador ya lo ofrece; dado de baja deja de ofrecerse; reactivado, otra vez; y la bitácora lo dice", async ({ page }) => {
  const g = await gente();
  await enAjustes(page, g, [["Cartón", "500"]]);
  await enClientes(page);
  await expect(page.getByText("Todavía no hay clientes. También se dan de alta en el mostrador, al darles su primer precio especial.")).toBeVisible();

  await page.getByRole("button", { name: "Dar de alta un cliente" }).click();
  await expect(page.getByRole("button", { name: /^Dar de alta a …$/ })).toBeDisabled();
  await page.getByLabel("Cómo se llama").fill("  Fundidora   del Norte ");
  await page.getByRole("button", { name: "Dar de alta a Fundidora del Norte" }).click();
  await expect(page.locator(".okmsg")).toHaveText("Fundidora del Norte quedó dado de alta. Ya se le puede dar precio especial en el mostrador, con la clave de quien autoriza.");
  await expect(renglon(page, "Fundidora del Norte").locator("small").first()).toHaveText("todavía sin cuentas con precio especial");
  await expect(tarjeta(page, "Clientes").locator("header small")).toHaveText("1 cliente");
  // El formulario se cerró. Otro con el mismo nombre no se repite, y lo escrito se queda para corregirlo.
  await page.getByRole("button", { name: "Dar de alta un cliente" }).click();
  await page.getByLabel("Cómo se llama").fill("fundidora del norte");
  await page.getByRole("button", { name: "Dar de alta a fundidora del norte" }).click();
  await expect(aviso(page)).toHaveText("Ya hay un cliente que se llama «Fundidora del Norte»");
  await expect(page.getByLabel("Cómo se llama")).toHaveValue("fundidora del norte");
  await page.getByRole("button", { name: "No dar de alta a nadie" }).click();
  await expect(page.locator(".administrado")).toHaveCount(1);

  // En el mostrador ya está en la lista, sin haber tenido nunca un precio.
  await irA(page, "Mostrador");
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "40");
  await page.getByRole("button", { name: "Precio especial para Cartón" }).click();
  await expect(page.locator(".grid").getByRole("button", { name: "Fundidora del Norte", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "No dar precio especial" }).click();

  // Darlo de baja se pregunta antes; decir que no, no hace nada.
  await deVueltaEnClientes(page);
  await page.getByRole("button", { name: "Dar de baja a Fundidora del Norte" }).click();
  await expect(renglon(page, "Fundidora del Norte")).toContainText("¿Dar de baja a Fundidora del Norte? Ya no se le podrá dar precio especial.");
  await renglon(page, "Fundidora del Norte").getByRole("button", { name: "No", exact: true }).click();
  await expect(tarjeta(page, "Dados de baja")).toHaveCount(0);
  await page.getByRole("button", { name: "Dar de baja a Fundidora del Norte" }).click();
  await renglon(page, "Fundidora del Norte").getByRole("button", { name: "Sí, dar de baja" }).click();
  await expect(page.locator(".okmsg")).toHaveText("Fundidora del Norte quedó dado de baja.");
  await expect(tarjeta(page, "Dados de baja").locator(".administrado")).toContainText("no se ofrece en el mostrador");
  await expect(tarjeta(page, "Clientes").locator(".administrado")).toHaveCount(0);

  // En el mostrador ya no se ofrece; y escribirlo como si fuera nuevo dice dónde se reactiva.
  await irA(page, "Mostrador");
  await page.getByRole("button", { name: "Precio especial para Cartón" }).click();
  await expect(page.getByText("Todavía no hay clientes registrados.")).toBeVisible();
  await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
  await page.getByLabel("Nombre del cliente nuevo").fill("Fundidora del Norte");
  await page.getByRole("button", { name: "Menos que la lista" }).click();
  await teclear(page, "0.3");
  await autorizaServando(page, g);
  await expect(page.getByRole("alert").filter({ hasText: "dado de baja" })).toContainText("«Fundidora del Norte» está dado de baja: lo reactiva un responsable en Ajustes, no se da de alta otro igual");
  expect(await conConsola(async (db) => (await db.query("SELECT count(*)::int AS n FROM precio_especial")).rows[0].n)).toBe(0);

  await page.goto("/panel/ajustes");
  await enClientes(page);
  await page.getByRole("button", { name: "Reactivar a Fundidora del Norte" }).click();
  await expect(page.locator(".okmsg")).toHaveText("Fundidora del Norte quedó reactivado.");
  await expect(tarjeta(page, "Dados de baja")).toHaveCount(0);
  await expect(tarjeta(page, "Clientes").locator(".administrado")).toHaveCount(1);

  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Bitácora" }).click();
  const dicho = page.locator(".asiento");
  await expect(dicho.nth(0)).toContainText("Servando reactivó al cliente Fundidora del Norte");
  // Entre una y otra quedó también el intento del mostrador; cada cosa de los clientes, una vez.
  await expect(dicho.filter({ hasText: "Servando dio de baja al cliente Fundidora del Norte" })).toHaveCount(1);
  await expect(dicho.filter({ hasText: "Servando dio de alta al cliente Fundidora del Norte" })).toHaveCount(1);
});

test("los clientes de los ajustes son de cualquier responsable, tenga o no la facultad de autorizar; y los que nacieron en el mostrador salen ahí también", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  const marta = await altaDePersona("Marta", "responsable", "271828");
  await darDeAltaEquipo(page);

  // Luis, en el mostrador, le da su primer precio a un cliente nuevo y cobra.
  await adentro(page, g.luis);
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "40");
  await page.getByRole("button", { name: "Precio especial para Cartón" }).click();
  await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
  await page.getByLabel("Nombre del cliente nuevo").fill("Doña Mari");
  await page.getByRole("button", { name: "Menos que la lista" }).click();
  await teclear(page, "0.3");
  await autorizaServando(page, g);
  await expect(page.getByText("A nombre de Doña Mari")).toBeVisible();
  await salir(page);

  // Marta es responsable, pero no autoriza: los clientes sí son suyos.
  await adentro(page, marta);
  await page.goto("/panel/ajustes");
  await enClientes(page);
  await expect(renglon(page, "Doña Mari").locator("small").first()).toHaveText("todavía sin cuentas con precio especial");
  await page.getByRole("button", { name: "Dar de alta un cliente" }).click();
  await page.getByLabel("Cómo se llama").fill("Aceros Zayha");
  await page.getByRole("button", { name: "Dar de alta a Aceros Zayha" }).click();
  await expect(page.locator(".okmsg")).toContainText("Aceros Zayha quedó dado de alta.");
  // Por nombre, no por orden de llegada.
  await expect(tarjeta(page, "Clientes").locator(".administrado > b")).toHaveText(["Aceros Zayha", "Doña Mari"]);
});

test("los ajustes son de un responsable, y personas y equipos, del que está facultado para autorizar: a quien consulta no se le ofrecen, y al responsable sin la facultad se le dice", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  const ana = await altaDePersona("Ana", "consulta", "3141");
  const marta = await altaDePersona("Marta", "responsable", "271828");
  await darDeAltaEquipo(page);

  await adentro(page, ana);
  await page.goto("/panel");
  await expect(page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Resumen" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Ajustes" })).toHaveCount(0);
  await page.goto("/panel/ajustes");
  await expect(page.getByText("Los ajustes son de un responsable.")).toBeVisible();
  await expect(page.locator(".administrado")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Qué se ajusta" })).toHaveCount(0);
  await salir(page);

  await adentro(page, g.luis);
  await page.goto("/panel/ajustes");
  await expect(page.getByText("Los ajustes son de un responsable.")).toBeVisible();
  await salir(page);

  await adentro(page, marta);
  await page.goto("/panel");
  await page.getByRole("navigation", { name: "Partes del panel" }).getByRole("link", { name: "Ajustes" }).click();
  // Lo suyo son los materiales: ahí empieza. Personas y equipos, no.
  await expect(page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Materiales" })).toHaveAttribute("aria-pressed", "true");
  await expect(tarjeta(page, "Papel").locator(".administrado")).toHaveCount(2);
  await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Personas" }).click();
  await expect(page.getByText("Dar de alta y de baja personas y equipos le toca a un responsable facultado para autorizar.")).toBeVisible();
  await expect(page.locator(".administrado")).toHaveCount(0);
});

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, en los ajustes todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    await altaDePersona("Ana", "consulta", "3141");
    await enAjustes(page, g);
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };
    await expect(renglon(page, "Luis")).toBeVisible();
    await medir("las personas");
    await page.getByRole("button", { name: "Dar de alta a una persona" }).click();
    await page.getByLabel("Cómo se llama").fill("Rosa");
    await medir("la persona nueva");
    await page.getByRole("button", { name: "Dar de alta a Rosa" }).click();
    await expect(hoja(page)).toBeVisible();
    await medir("la hoja de la clave", "dialog");
    await conMiClave(page, g.servando.clave, "Dar de alta");
    await expect(page.locator(".unavez")).toBeVisible();
    await medir("la clave que se ve una vez", "dialog");
    await page.getByRole("button", { name: "Ya la anoté" }).click();
    await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Equipos" }).click();
    await expect(renglon(page, "Mostrador")).toBeVisible();
    await medir("los equipos");
    await page.getByRole("button", { name: "Dar de alta un equipo" }).click();
    await medir("el equipo nuevo");

    await enMateriales(page);
    await expect(renglon(page, "Cartón")).toBeVisible();
    await medir("los materiales");
    await page.getByRole("button", { name: "Dar de baja PET" }).click();
    await medir("un material por dar de baja");
    await page.getByRole("button", { name: "Dar de alta un material" }).click();
    await page.getByRole("group", { name: "Familia" }).getByRole("button", { name: "Otros metales" }).click();
    await page.getByLabel("Cómo se llama").fill("Estaño");
    await medir("el material nuevo");

    await enClientes(page);
    await medir("los clientes, sin ninguno");
    await page.getByRole("button", { name: "Dar de alta un cliente" }).click();
    // El nombre más difícil que la regla deja pasar: ochenta letras anchas y ni un espacio donde partirlo.
    await page.getByLabel("Cómo se llama").fill("W".repeat(80));
    await medir("el cliente nuevo");
    await page.getByRole("button", { name: /^Dar de alta a W+$/ }).click();
    await expect(page.locator(".okmsg")).toBeVisible();
    await medir("los clientes, con uno de nombre largo");
    await page.getByRole("button", { name: /^Dar de baja a W+$/ }).click();
    await medir("un cliente por dar de baja");
    await page.getByRole("button", { name: "Sí, dar de baja" }).click();
    await expect(tarjeta(page, "Dados de baja")).toBeVisible();
    await medir("los clientes dados de baja");
  });
}

// Capturas, para verlas sin levantar nada. Corre solo si se piden:
//   docker compose --profile recorrido run --rm -e CAPTURAS=1 recorrido npx playwright test ajustes -g capturas
test("capturas de los ajustes", async ({ page }) => {
  test.skip(!process.env.CAPTURAS, "solo cuando se piden capturas");
  const g = await gente();
  await altaDePersona("Ana", "consulta", "3141");
  await altaDePersona("Beto", "patio", "2718");
  await enAjustes(page, g);
  for (const [nombre, ancho, alto] of [["", 1180, 820], ["-telefono", 390, 800]] as const) {
    await page.setViewportSize({ width: ancho, height: alto });
    const foto = (que: string) => page.screenshot({ path: `recorrido/capturas/ajustes/${que}${nombre}.png`, fullPage: true });
    await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Personas" }).click();
    await expect(renglon(page, "Luis")).toBeVisible();
    await foto("1-personas");
    await page.getByRole("button", { name: "Cambiar la clave de Luis" }).click();
    await expect(hoja(page)).toBeVisible();
    await page.screenshot({ path: `recorrido/capturas/ajustes/2-con-tu-clave${nombre}.png` });
    await conMiClave(page, g.servando.clave, "Cambiar la clave");
    await expect(page.locator(".unavez")).toBeVisible();
    await foto("3-clave-nueva");
    await page.getByRole("button", { name: "Ya la anoté" }).click();
    await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Equipos" }).click();
    await expect(renglon(page, "Mostrador")).toBeVisible();
    await foto("4-equipos");
    await enMateriales(page);
    await expect(renglon(page, "Cartón")).toBeVisible();
    await foto("5-materiales");
    await page.getByRole("button", { name: "Dar de alta un material" }).click();
    await page.getByRole("group", { name: "Familia" }).getByRole("button", { name: "Otros metales" }).click();
    await page.getByLabel("Cómo se llama").fill("Estaño");
    await page.screenshot({ path: `recorrido/capturas/ajustes/6-material-nuevo${nombre}.png` });
    await page.getByRole("button", { name: "No dar de alta ninguno" }).click();
    await enClientes(page);
    // En la segunda vuelta ya están: se espera a que la lista llegue antes de mirar si hay que darlos de alta.
    await expect(tarjeta(page, "Clientes")).toBeVisible();
    if (await page.locator(".administrado").count() === 0) {
      for (const cliente of ["Fundidora del Norte", "Don Chuy", "Aceros Zayha"]) {
        await page.getByRole("button", { name: "Dar de alta un cliente" }).click();
        await page.getByLabel("Cómo se llama").fill(cliente);
        await page.getByRole("button", { name: `Dar de alta a ${cliente}` }).click();
        await expect(renglon(page, cliente)).toBeVisible();
      }
      await page.getByRole("button", { name: "Dar de baja a Don Chuy" }).click();
      await page.getByRole("button", { name: "Sí, dar de baja" }).click();
      await expect(tarjeta(page, "Dados de baja")).toBeVisible();
    }
    await foto("7-clientes");
    await page.getByRole("button", { name: "Dar de alta un cliente" }).click();
    await page.getByLabel("Cómo se llama").fill("Recicladora del Pacífico");
    await page.screenshot({ path: `recorrido/capturas/ajustes/8-cliente-nuevo${nombre}.png` });
    await page.getByRole("button", { name: "No dar de alta a nadie" }).click();
  }
});
