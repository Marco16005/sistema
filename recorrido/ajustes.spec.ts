// Los ajustes: personas y equipos desde la pantalla. Lo pide un responsable facultado para
// autorizar, con su clave cada vez; lo que se genera —la clave de una persona, el código de un
// equipo— se ve una sola vez. Las reglas se prueban en la base y por las rutas
// (pruebas/45-administracion.test.ts); aquí, lo que ve y hace quien administra.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { altaDePersona, baseNueva, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, salir, teclear } from "./apoyo.ts";
import type { Gente, Persona } from "./apoyo.ts";

test.beforeEach(baseNueva);

/** Entra, y espera a que la aplicación termine de llevar a esa persona a su pantalla antes de pedir otra. */
async function adentro(page: Page, persona: Persona): Promise<void> {
  await entrar(page, persona);
  await page.waitForURL((u) => u.pathname !== "/");
}

/** El día en marcha, este equipo dado de alta, Servando adentro y en los ajustes. */
async function enAjustes(page: Page, g: Gente): Promise<void> {
  await diaListo(g);
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
  await expect(hoja(page)).toHaveCount(0);
  const unaVez = page.locator(".unavez");
  await expect(unaVez).toContainText("Clave de Rosa");
  await expect(unaVez).toContainText("no se vuelve a mostrar");
  const clave = (await unaVez.locator(".secreto").textContent())!;
  expect(clave).toMatch(/^\d{4}$/);
  await expect(renglon(page, "Rosa")).toContainText("patio");
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
    await medir("la clave que se ve una vez");
    await page.getByRole("button", { name: "Ya la anoté" }).click();
    await page.getByRole("group", { name: "Qué se ajusta" }).getByRole("button", { name: "Equipos" }).click();
    await expect(renglon(page, "Mostrador")).toBeVisible();
    await medir("los equipos");
    await page.getByRole("button", { name: "Dar de alta un equipo" }).click();
    await medir("el equipo nuevo");
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
  }
});
