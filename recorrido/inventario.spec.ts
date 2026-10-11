// El inventario en pantalla: lo que hay, contar, dar merma, separar y corregir, con la clave de
// quien autoriza. Y, como en el mostrador, lo que pasa cuando una respuesta se pierde o se toca dos veces.
import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page, Route } from "@playwright/test";
import { altaDePersona, aviso, baseNueva, conConsola, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";
import type { Gente, Persona } from "./apoyo.ts";

test.beforeEach(baseNueva);

const fila = (page: Page, material: string) => page.locator(".exrow", { hasText: material });
const hecho = (page: Page) => page.locator(".okmsg");

/** Elige un material en la rejilla, pasando por su familia. */
async function elegir(page: Page, familia: string, material: string): Promise<void> {
  await page.getByRole("button", { name: familia, exact: true }).click();
  await page.locator(".grid").getByRole("button", { name: new RegExp("^" + material) }).click();
}

/** Quien autoriza se elige y teclea su clave. */
async function autorizar(page: Page, quien: Persona, clave = quien.clave): Promise<void> {
  if (await page.getByText("¿Quién autoriza?").isVisible()) await page.getByRole("button", { name: new RegExp("^" + quien.nombre) }).click();
  await teclear(page, clave);
  await page.getByRole("button", { name: `Autorizar a nombre de ${quien.nombre}` }).click();
}

const cuantos = (tabla: string): Promise<number> => conConsola(async (db) => (await db.query(`SELECT count(*)::int AS n FROM ${tabla}`)).rows[0].n);

test("existencias, y un conteo con diferencia que autoriza una persona facultada", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Inventario" }).click();
  await expect(page.getByRole("heading", { name: "Lo que hay en el patio" })).toBeVisible();
  await expect(fila(page, "Cartón")).toContainText("500.000 kg");
  await expect(fila(page, "PET")).toContainText("0.000 kg");

  await page.getByRole("button", { name: "Contar", exact: true }).click();
  await page.getByRole("button", { name: "Papel", exact: true }).click();
  await expect(page.locator(".grid").getByRole("button", { name: /^Cartón/ })).toContainText("el libro dice 500.000 kg");
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await teclear(page, "480.5");
  await page.getByRole("button", { name: "Ver la diferencia" }).click();
  await expect(page.locator(".tot", { hasText: "El libro decía" })).toContainText("500.000 kg");
  await expect(page.locator(".tot", { hasText: "Se contó" })).toContainText("480.500 kg");
  await expect(page.locator(".tot.big")).toContainText("−19.500 kg");
  await page.getByRole("button", { name: "Autorizar el conteo" }).click();

  // Con la clave equivocada no se cuenta nada.
  await autorizar(page, g.servando, "000000");
  await expect(aviso(page)).toContainText("La clave no pasó");
  expect(await cuantos("conteo")).toBe(0);
  // Era el primer intento de ese envío: con la clave mal se sabe que no entró, y no queda nada pendiente.
  expect(await guardado(page)).toBeNull();
  await autorizar(page, g.servando);

  await expect(hecho(page)).toContainText("Conteo registrado: Cartón quedó en 480.500 kg (diferencia −19.500 kg).");
  await expect(fila(page, "Cartón")).toContainText("480.500 kg");
  await expect(fila(page, "Cartón")).toContainText("diferencia −19.500 kg");
  // Quedó a nombre de quien atiende, autorizado por quien tecleó su clave.
  const c = await conConsola(async (db) => (await db.query("SELECT creado_por, autorizado_por FROM conteo")).rows[0]);
  expect(c).toEqual({ creado_por: g.luis.id, autorizado_por: g.servando.id });
});

test("merma, y separar un material con lo que se pierde", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"], ["Fierro pesado", "100"]]);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Inventario" }).click();

  await page.getByRole("button", { name: "Merma", exact: true }).click();
  await elegir(page, "Papel", "Cartón");
  await teclear(page, "12.5");
  await page.getByRole("button", { name: "Seguir" }).click();
  await expect(page.getByRole("button", { name: "Registrar la merma" })).toBeDisabled();     // sin motivo no
  await page.getByRole("button", { name: "Mojado" }).click();
  await page.getByRole("button", { name: "Registrar la merma" }).click();
  await expect(hecho(page)).toContainText("Merma registrada: 12.500 kg de Cartón.");
  await expect(fila(page, "Cartón")).toContainText("487.500 kg");

  await page.getByRole("button", { name: "Separar", exact: true }).click();
  await elegir(page, "Fierro", "Pesado");
  await teclear(page, "100");
  await page.getByRole("button", { name: "Seguir" }).click();
  await expect(page.getByRole("button", { name: "Ver lo que se pierde" })).toBeDisabled();    // sin productos no
  await page.getByRole("button", { name: /Agregar lo que salió/ }).click();
  // El material del que se separa no se ofrece como producto.
  await page.getByRole("button", { name: "Fierro", exact: true }).click();
  await expect(page.locator(".grid").getByRole("button", { name: /^Pesado/ })).toHaveCount(0);
  await page.locator(".grid").getByRole("button", { name: /^Lámina/ }).click();
  await teclear(page, "60");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByRole("button", { name: /Agregar otro material que salió/ }).click();
  await elegir(page, "Plástico", "PET");
  await teclear(page, "30.5");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByRole("button", { name: "Ver lo que se pierde" }).click();
  await expect(page.locator(".tot.big")).toHaveText("Se pierde9.500 kg");
  await page.getByRole("button", { name: "Registrar la separación" }).click();
  await expect(hecho(page)).toContainText("salieron 2 materiales y se perdieron 9.500 kg");
  await expect(fila(page, "Fierro pesado")).toContainText("0.000 kg");
  await expect(fila(page, "Fierro lámina")).toContainText("60.000 kg");
  await expect(fila(page, "PET")).toContainText("30.500 kg");
});

test("corregir una compra desde sus movimientos: era otro material, y después el peso", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  // Se compra «cobre» que en realidad era PET.
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cobre de primera", "Báscula 2", "18");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await page.getByRole("button", { name: "Listo" }).click();

  await page.getByRole("link", { name: "Inventario" }).click();
  await fila(page, "Cobre de primera").click();
  await expect(page.getByRole("heading", { name: "Cobre de primera" })).toBeVisible();
  await expect(page.locator(".ren", { hasText: "Compra · folio 1" })).toContainText("+18.000");
  await page.getByRole("button", { name: /^Corregir compra/ }).click();

  await expect(page.getByText("Hoy cuenta como: Cobre de primera, 18.000 kg.")).toBeVisible();
  await expect(page.getByText("El comprobante y lo que se pagó o se cobró no cambian.")).toBeVisible();
  await page.getByRole("button", { name: "Cambiar material" }).click();
  await elegir(page, "Plástico", "PET");
  await page.getByRole("button", { name: "Se eligió otro material" }).click();
  await page.getByRole("button", { name: "Autorizar: quedará PET, 18.000 kg" }).click();
  await autorizar(page, g.servando, "000000");
  await expect(aviso(page)).toContainText("La clave no pasó");
  await autorizar(page, g.servando);

  await expect(hecho(page)).toContainText("Corrección registrada: quedó PET, 18.000 kg.");
  await expect(page.locator(".ren", { hasText: "Compra · folio 1" })).toContainText("Hoy cuenta como: PET, 18.000 kg.");
  // La compra original sigue ahí, intacta, y su corrección también, con quién la autorizó.
  await expect(page.locator(".ren", { hasText: "Corrección" }).first()).toContainText("autorizó Servando");

  // Desde el PET se llega al original, y se corrige otra vez: ahora el peso.
  await page.getByRole("button", { name: "Regresar a existencias" }).click();
  await expect(fila(page, "PET")).toContainText("18.000 kg");
  await expect(fila(page, "Cobre de primera")).toContainText("0.000 kg");
  await fila(page, "PET").click();
  await expect(page.locator(".ren", { hasText: "Corrección" })).toContainText("Corrige compra del folio 1 de Cobre de primera.");
  await page.getByRole("button", { name: "Ver el original" }).click();
  await expect(page.getByRole("heading", { name: "Cobre de primera" })).toBeVisible();
  await page.getByRole("button", { name: /^Corregir compra/ }).click();
  await expect(page.getByText("Hoy cuenta como: PET, 18.000 kg.")).toBeVisible();
  await page.getByRole("button", { name: "Cambiar kilos" }).click();
  await teclear(page, "20");
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.getByRole("button", { name: "Se tecleó mal el peso" }).click();
  await page.getByRole("button", { name: "Autorizar: quedará PET, 20.000 kg" }).click();
  await autorizar(page, g.servando);
  await expect(hecho(page)).toContainText("quedó PET, 20.000 kg");
  await page.getByRole("button", { name: "Regresar a existencias" }).click();
  await expect(fila(page, "PET")).toContainText("20.000 kg");
});

test("lo que ya cubrió un conteo no ofrece corregirse", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await conConsola(async (db) => {
    const visto = (await db.query("SELECT contado_en, registrado_kg FROM previa_de_conteo((SELECT id FROM material WHERE nombre = 'Cartón'), 480, NULL)")).rows[0];
    await db.query("SELECT asentar_conteo((SELECT id FROM material WHERE nombre = 'Cartón'), 480, $1, $2, NULL, $3)", [g.servando.id, g.luis.id, visto.contado_en]);
  });
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Inventario" }).click();
  await fila(page, "Cartón").click();
  await expect(page.locator(".ren", { hasText: "Saldo inicial" })).toContainText("Ya se contó después");
  await expect(page.getByRole("button", { name: /^Corregir/ })).toHaveCount(0);
});

test("patio y quien consulta ven lo que hay, y nada más", async ({ page }) => {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  const beto = await altaDePersona("Beto", "patio", "2718");
  await darDeAltaEquipo(page);
  await entrar(page, beto);
  await page.getByRole("link", { name: "Inventario" }).click();
  await expect(fila(page, "Cartón")).toContainText("500.000 kg");
  for (const accion of ["Contar", "Merma", "Separar"]) {
    await expect(page.getByRole("button", { name: accion, exact: true })).toHaveCount(0);
  }
  await fila(page, "Cartón").click();
  await expect(page.locator(".ren", { hasText: "Saldo inicial" })).toContainText("+500.000");
  await expect(page.getByRole("button", { name: /^Corregir/ })).toHaveCount(0);
});

// ── a medio camino ─────────────────────────────────────────────────────────
//
// Las cuatro acciones que escriben, cada una contra lo mismo: la respuesta que tarda, la que se
// pierde después de asentarse, el envío que no llega, y la página que se recarga con el envío en
// el aire. En las cuatro, lo que salió queda fijo —con su identificador y lo que llevaba— hasta
// saber qué pasó: no se edita, se manda ese mismo otra vez, y queda asentado una sola vez.

interface Accion {
  nombre: string;
  camino: RegExp;
  /** Captura todo y deja la pantalla a un toque de mandar. */
  preparar(page: Page, g: Gente): Promise<void>;
  /** El botón de ese toque. */
  boton(page: Page): Locator;
  /** Con el envío en el aire: nada de lo capturado se puede cambiar. */
  enElAire(page: Page): Promise<void>;
  /** Con un envío del que no se supo: se comprueba que nada se puede cambiar, y se manda otra vez. */
  reintentar(page: Page, g: Gente): Promise<void>;
  /** Lo mismo, sin comprobar nada ni salir de la pantalla: solo el toque que lo manda otra vez. */
  otraVez(page: Page, g: Gente): Promise<void>;
  /**
   * Donde se autoriza, la autorización es una hoja que tapa lo demás, la navegación incluida: para
   * irse a otra pantalla primero se sale de la hoja (el envío sigue pendiente), y al volver se entra
   * otra vez a ella. Donde no hay hoja no hace falta.
   */
  salirDeLaHoja?(page: Page): Promise<void>;
  volverALaHoja?(page: Page, g: Gente): Promise<void>;
  /** Ya suelto el envío, y tras recargar: se manda la captura otra vez, que ahora es un envío nuevo. */
  deNuevo(page: Page, g: Gente): Promise<void>;
  hecho: string;
  /** Lo que dice la pantalla cuando, al pedir que autorice otra persona, averigua que el envío sí había entrado. */
  yaEstaba?: string;
  /** Dónde se cuenta lo que quedó asentado. */
  asentadas: string;
  /** Cómo debe quedar el patio. */
  queda: Array<[string, number]>;
}

const autorizaServando = (page: Page) => page.getByRole("button", { name: "Autorizar a nombre de Servando" });

/** Con un envío sin resultado, quien autorizó ya no se elige: se le pide la clave a esa misma persona. */
async function mismaPersona(page: Page, quien: Persona): Promise<void> {
  await expect(page.getByText(`Clave de ${quien.nombre}`)).toBeVisible();
  await expect(page.getByText("¿Quién autoriza?")).toHaveCount(0);
}

const ACCIONES: Accion[] = [
  {
    nombre: "merma",
    camino: /\/api\/inventario\/merma$/,
    async preparar(page) {
      await page.getByRole("button", { name: "Merma", exact: true }).click();
      await elegir(page, "Papel", "Cartón");
      await teclear(page, "10");
      await page.getByRole("button", { name: "Seguir" }).click();
      await page.getByRole("button", { name: "Mojado" }).click();
    },
    boton: (page) => page.getByRole("button", { name: "Registrar la merma" }),
    async enElAire(page) {
      await expect(page.getByRole("button", { name: "Se tiró" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Corregir los kilos" })).toHaveCount(0);
    },
    async reintentar(page, g) {
      await expect(aviso(page).first()).toContainText("No se supo si la merma se guardó");
      await expect(page.locator(".que")).toContainText("Mojado");
      await this.enElAire(page);
      await expect(this.boton(page)).toHaveCount(0);
      await this.otraVez(page, g);
    },
    otraVez: (page) => page.getByRole("button", { name: "Volver a intentar" }).click(),
    deNuevo: (page) => page.getByRole("button", { name: "Registrar la merma" }).click(),
    hecho: "Merma registrada: 10.000 kg de Cartón.",
    asentadas: "movimiento_inventario WHERE tipo = 'merma'",
    queda: [["Cartón", 490]],
  },
  {
    nombre: "separación",
    camino: /\/api\/inventario\/separacion$/,
    async preparar(page) {
      await page.getByRole("button", { name: "Separar", exact: true }).click();
      await elegir(page, "Papel", "Cartón");
      await teclear(page, "100");
      await page.getByRole("button", { name: "Seguir" }).click();
      await page.getByRole("button", { name: /Agregar lo que salió/ }).click();
      await elegir(page, "Plástico", "PET");
      await teclear(page, "60");
      await page.getByRole("button", { name: "Agregar", exact: true }).click();
      await page.getByRole("button", { name: "Ver lo que se pierde" }).click();
      await expect(page.locator(".tot.big")).toContainText("40.000 kg");
    },
    boton: (page) => page.getByRole("button", { name: "Registrar la separación" }),
    async enElAire(page) {
      await expect(page.getByRole("button", { name: "Corregir lo que salió" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Quitar PET" })).toHaveCount(0);
    },
    async reintentar(page, g) {
      await expect(aviso(page).first()).toContainText("No se supo si la separación se guardó");
      await expect(page.locator(".tot.big")).toContainText("40.000 kg");
      await this.enElAire(page);
      await expect(this.boton(page)).toHaveCount(0);
      await this.otraVez(page, g);
    },
    otraVez: (page) => page.getByRole("button", { name: "Volver a intentar" }).click(),
    deNuevo: (page) => page.getByRole("button", { name: "Registrar la separación" }).click(),
    hecho: "Separación registrada: de 100.000 kg de Cartón salieron 1 material y se perdieron 40.000 kg.",
    asentadas: "transformacion",
    queda: [["Cartón", 400], ["PET", 60]],
  },
  {
    nombre: "conteo",
    camino: /\/api\/inventario\/conteo$/,
    async preparar(page, g) {
      await page.getByRole("button", { name: "Contar", exact: true }).click();
      await elegir(page, "Papel", "Cartón");
      await teclear(page, "480");
      await page.getByRole("button", { name: "Ver la diferencia" }).click();
      await page.getByRole("button", { name: "Autorizar el conteo" }).click();
      await page.getByRole("button", { name: new RegExp("^" + g.servando.nombre) }).click();
      await teclear(page, g.servando.clave);
    },
    boton: autorizaServando,
    async enElAire(page) {
      await expect(page.getByRole("button", { name: "Regresar" })).toBeDisabled();
    },
    async reintentar(page, g) {
      await expect(page.getByText("No se supo si el conteo se registró.")).toBeVisible();
      await mismaPersona(page, g.servando);
      // Regresando tampoco hay nada que cambiar: ni lo tecleado ni la nota.
      await page.getByRole("button", { name: "Regresar" }).click();
      await expect(aviso(page)).toContainText("No se supo si este conteo se registró");
      await expect(page.getByRole("button", { name: "Corregir lo tecleado" })).toHaveCount(0);
      await expect(page.getByLabel("Nota (si hace falta)")).toBeDisabled();
      await page.getByRole("button", { name: "Autorizar el conteo" }).click();
      await mismaPersona(page, g.servando);
      await this.otraVez(page, g);
    },
    async otraVez(page, g) {
      await teclear(page, g.servando.clave);
      await this.boton(page).click();
    },
    async salirDeLaHoja(page) {
      await page.getByRole("button", { name: "Regresar" }).click();
    },
    async volverALaHoja(page, g) {
      await page.getByRole("button", { name: "Autorizar el conteo" }).click();
      await mismaPersona(page, g.servando);
    },
    async deNuevo(page, g) {
      await page.getByRole("button", { name: new RegExp("^" + g.servando.nombre) }).click();
      await this.otraVez(page, g);
    },
    hecho: "Conteo registrado: Cartón quedó en 480.000 kg (diferencia −20.000 kg).",
    yaEstaba: "Ese conteo ya había quedado registrado: Cartón quedó en 480.000 kg.",
    asentadas: "conteo",
    queda: [["Cartón", 480]],
  },
  {
    nombre: "corrección",
    camino: /\/api\/inventario\/correccion$/,
    async preparar(page, g) {
      await fila(page, "Cartón").click();
      await page.getByRole("button", { name: /^Corregir saldo inicial/ }).click();
      await page.getByRole("button", { name: "Cambiar kilos" }).click();
      await teclear(page, "480");
      await page.getByRole("button", { name: "Listo", exact: true }).click();
      await page.getByRole("button", { name: "Se tecleó mal el peso" }).click();
      await page.getByRole("button", { name: "Autorizar: quedará Cartón, 480.000 kg" }).click();
      await page.getByRole("button", { name: new RegExp("^" + g.servando.nombre) }).click();
      await teclear(page, g.servando.clave);
    },
    boton: autorizaServando,
    async enElAire(page) {
      await expect(page.getByRole("button", { name: "Regresar" })).toBeDisabled();
    },
    async reintentar(page, g) {
      await expect(page.getByText("No se supo si la corrección se registró.")).toBeVisible();
      await mismaPersona(page, g.servando);
      // Regresando tampoco hay nada que cambiar, ni se puede dejar la corrección a medias.
      await page.getByRole("button", { name: "Regresar" }).click();
      await expect(aviso(page)).toContainText("No se supo si esta corrección se registró");
      for (const boton of ["Cambiar material", "Cambiar kilos", "No debió registrarse"]) {
        await expect(page.getByRole("button", { name: boton })).toBeDisabled();
      }
      await expect(page.getByRole("button", { name: "Se registró dos veces" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "No corregir" })).toHaveCount(0);
      await page.getByRole("button", { name: "Autorizar: quedará Cartón, 480.000 kg" }).click();
      await mismaPersona(page, g.servando);
      await this.otraVez(page, g);
    },
    async otraVez(page, g) {
      await teclear(page, g.servando.clave);
      await this.boton(page).click();
    },
    async salirDeLaHoja(page) {
      await page.getByRole("button", { name: "Regresar" }).click();
    },
    async volverALaHoja(page, g) {
      await page.getByRole("button", { name: "Autorizar: quedará Cartón, 480.000 kg" }).click();
      await mismaPersona(page, g.servando);
    },
    async deNuevo(page, g) {
      await page.getByRole("button", { name: new RegExp("^" + g.servando.nombre) }).click();
      await this.otraVez(page, g);
    },
    hecho: "Corrección registrada: quedó Cartón, 480.000 kg.",
    yaEstaba: "Esa corrección ya había quedado registrada: quedó Cartón, 480.000 kg.",
    asentadas: "movimiento_inventario WHERE referencia_id IS NOT NULL",
    queda: [["Cartón", 480]],
  },
];

/** Un día listo con 500 kg de Cartón, y la acción capturada: a un toque de mandarla. */
async function aUnToque(page: Page, a: Accion): Promise<Gente> {
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Inventario" }).click();
  await a.preparar(page, g);
  return g;
}

/** Anota con qué salió cada envío de la acción, y decide qué pasa con los primeros, en orden; los demás pasan. */
async function interceptar(page: Page, a: Accion, ...primeros: Array<(ruta: Route) => Promise<void>>): Promise<any[]> {
  const cuerpos: any[] = [];
  await page.route(a.camino, async (ruta) => {
    cuerpos.push(ruta.request().postDataJSON());
    const paso = primeros[cuerpos.length - 1];
    if (paso) await paso(ruta);
    else await ruta.fallback();
  });
  return cuerpos;
}

/** El servidor lo recibe y lo asienta, y la respuesta se pierde en el camino. */
const sePierdeLaRespuesta = async (ruta: Route): Promise<void> => {
  await ruta.fetch();
  await ruta.abort("connectionreset");
};

/** Lo que este equipo tiene guardado del envío que salió. */
const guardado = (page: Page): Promise<{ id: string; cuerpo: Record<string, unknown> } | null> =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("feruga.inventario") ?? "null")?.e?.pendiente ?? null);
const todoLoGuardado = (page: Page): Promise<string> => page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));

/** Los envíos que la pantalla le pide cancelar al servidor, en orden. */
function cancelacionesPedidas(page: Page): string[] {
  const pedidas: string[] = [];
  page.on("request", (r) => {
    const m = /\/api\/envios\/([^/]+)\/cancelar$/.exec(r.url());
    if (m && r.method() === "POST") pedidas.push(m[1]!);
  });
  return pedidas;
}

/** En qué quedó un envío en el registro del servidor: su clase, o nada si nunca llegó. */
const claseDelEnvio = (id: string): Promise<string | null> =>
  conConsola(async (db) => (await db.query("SELECT clase FROM envio WHERE id = $1", [id])).rows[0]?.clase ?? null);

async function quedoUnaSola(page: Page, a: Accion, mensaje = a.hecho): Promise<void> {
  await expect(hecho(page)).toContainText(mensaje);
  expect(await cuantos(a.asentadas)).toBe(1);
  for (const [material, kg] of a.queda) {
    expect(await conConsola(async (db) => Number((await db.query("SELECT kg FROM existencia WHERE nombre = $1", [material])).rows[0].kg)), material).toBe(kg);
  }
}

for (const a of ACCIONES) {
  test(`${a.nombre}: mientras la respuesta tarda no se edita nada, y un segundo toque no manda otra`, async ({ page }) => {
    const g = await aUnToque(page, a);
    let abrir!: () => void;
    const abierta = new Promise<void>((listo) => { abrir = listo; });
    const cuerpos = await interceptar(page, a, async (ruta) => {
      await abierta;
      await ruta.fallback();
    });
    await a.boton(page).click();
    await expect.poll(() => cuerpos.length).toBe(1);
    // Antes de que conteste nadie ya quedó guardado en este equipo, con su identificador y lo que llevaba. La clave, no.
    const pendiente = await guardado(page);
    expect(pendiente?.id).toBe(cuerpos[0].id);
    expect(cuerpos[0]).toMatchObject(pendiente!.cuerpo);
    expect(await todoLoGuardado(page)).not.toContain(g.servando.clave);
    await a.enElAire(page);
    await a.boton(page).click({ timeout: 1000 }).catch(() => {});
    abrir();
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(1);
  });

  test(`${a.nombre}: si la respuesta se pierde, se manda esa misma otra vez y queda una sola`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, sePierdeLaRespuesta);
    await a.boton(page).click();
    await a.reintentar(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(2);
    expect(cuerpos[1]).toEqual(cuerpos[0]);
    expect(await todoLoGuardado(page)).not.toContain(g.servando.clave);
  });

  test(`${a.nombre}: si el servidor falla después de asentarla, tampoco se suelta: se manda esa misma`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, async (ruta) => {
      await ruta.fetch();
      await ruta.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" });
    });
    await a.boton(page).click();
    await expect(aviso(page).last()).toContainText("Algo falló de nuestro lado");
    await a.reintentar(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(2);
    expect(cuerpos[1]).toEqual(cuerpos[0]);
  });

  // Un rechazo al reintento habla del reintento, no del primer intento. La pantalla no adivina:
  // le pide al servidor que resuelva ese envío de una vez.
  test(`${a.nombre}: si al reintentar llega un rechazo y el primero sí había entrado, la pantalla lo averigua y no pide capturar de nuevo`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, sePierdeLaRespuesta, (ruta) =>
      ruta.fulfill({ status: 403, json: { error: { codigo: "RC008", mensaje: "Eso no le toca a tu rol" } } }));
    const cancelaciones = cancelacionesPedidas(page);
    await a.boton(page).click();
    await a.reintentar(page, g);
    // El servidor dice que ese identificador ya entró. Que haya sido esta captura lo confirma la
    // acción misma: se manda otra vez, y devuelve lo que hizo. El aviso es el de siempre, con sus datos.
    await quedoUnaSola(page, a);
    expect(cancelaciones).toEqual([cuerpos[0].id]);
    expect(cuerpos.length).toBe(3);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
    expect(await claseDelEnvio(cuerpos[0].id)).not.toBe("cancelado");
  });

  test(`${a.nombre}: si al reintentar llega un rechazo y el primero seguía en camino, ese primero ya no entra`, async ({ page }) => {
    const g = await aUnToque(page, a);
    let entregar!: () => void;
    const orden = new Promise<void>((listo) => { entregar = listo; });
    let contesto!: (estado: number) => void;
    const tardio = new Promise<number>((listo) => { contesto = listo; });
    const cuerpos = await interceptar(page, a,
      async (ruta) => {                         // el primero se queda en el camino, sin llegar al servidor…
        await orden;
        contesto((await ruta.fetch()).status());      // …y llega cuando ya nadie lo espera
      },
      (ruta) => ruta.fulfill({ status: 409, json: { error: { codigo: "RC002", mensaje: "No alcanza: hay 5 kg" } } }),
    );
    await a.boton(page).click();
    await expect.poll(() => cuerpos.length).toBe(1);
    await page.reload();
    await a.reintentar(page, g);
    await expect(aviso(page).last()).toContainText("No alcanza");
    // La pantalla soltó la captura, pero antes dejó cancelado ese envío en el servidor.
    await expect.poll(() => guardado(page)).toBeNull();
    expect(await claseDelEnvio(cuerpos[0].id)).toBe("cancelado");
    entregar();
    expect(await tardio).toBe(409);
    expect(await cuantos(a.asentadas)).toBe(0);
    // Capturar de nuevo es otro envío, y queda uno solo.
    await a.deNuevo(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(3);
    expect(cuerpos[2].id).not.toBe(cuerpos[0].id);
  });

  test(`${a.nombre}: si la sesión vence con un envío del que no se supo, quien entra después manda ese mismo`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, sePierdeLaRespuesta);
    await a.boton(page).click();
    await expect.poll(() => cuantos(a.asentadas)).toBe(1);
    // Irse al mostrador y volver con el botón de atrás no lo pierde. (Donde se autoriza, la hoja
    // tapa la navegación: primero se sale de ella, con el envío todavía pendiente, y al volver se
    // entra de nuevo. Lo que se afirma es lo mismo: irse y volver no pierde el envío.)
    await expect(page.getByText(/No se supo si/).first()).toBeVisible();
    await a.salirDeLaHoja?.(page);
    await page.getByRole("link", { name: "Mostrador", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Cuentas abiertas" })).toBeVisible();
    await page.goBack();
    await expect(page.getByText(/No se supo si/).first()).toBeVisible();
    await a.volverALaHoja?.(page, g);
    // La sesión vence: el reintento no pasa, y tampoco suelta el envío.
    await conConsola((db) => db.query("UPDATE sesion SET vista_en = now() - interval '31 minutes'"));
    await a.otraVez(page, g);
    await expect(page.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();
    expect(await cuantos(a.asentadas)).toBe(1);
    // Entra otra persona en el mismo equipo: encuentra el envío igual, y lo manda.
    await entrar(page, g.servando);
    await page.getByRole("link", { name: "Inventario", exact: true }).click();
    await a.reintentar(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(3);
    expect(cuerpos[1]).toEqual(cuerpos[0]);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
  });

  test(`${a.nombre}: si el envío no llega al servidor, se manda ese mismo otra vez`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, (ruta) => ruta.abort("connectionreset"));
    await a.boton(page).click();
    await expect.poll(() => cuerpos.length).toBe(1);
    expect(await cuantos(a.asentadas)).toBe(0);
    await a.reintentar(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(2);
    expect(cuerpos[1]).toEqual(cuerpos[0]);
  });

  test(`${a.nombre}: si se recarga la página con el envío en el aire, vuelve sin poder editarse y no se asienta dos veces`, async ({ page }) => {
    const g = await aUnToque(page, a);
    let asentada!: () => void;
    const yaAsentada = new Promise<void>((listo) => { asentada = listo; });
    const cuerpos = await interceptar(page, a, async (ruta) => {
      await ruta.fetch();                       // el servidor la asienta…
      asentada();                               // …y la respuesta no alcanza a llegar: la página se recarga antes
    });
    await a.boton(page).click();
    await yaAsentada;
    expect(await cuantos(a.asentadas)).toBe(1);
    await page.reload();
    await a.reintentar(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(2);
    expect(cuerpos[1]).toEqual(cuerpos[0]);
  });
}

test("una merma que el servidor rechaza por una regla sí se suelta: se corrige y sale como otra", async ({ page }) => {
  const a = ACCIONES[0]!;
  const g = await gente();
  await diaListo(g, [["Cartón", "500"]]);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("link", { name: "Inventario" }).click();
  await page.getByRole("button", { name: "Merma", exact: true }).click();
  await elegir(page, "Papel", "Cartón");
  await teclear(page, "600");                 // no hay tanto
  await page.getByRole("button", { name: "Seguir" }).click();
  await page.getByRole("button", { name: "Mojado" }).click();
  const cuerpos = await interceptar(page, a, (ruta) => ruta.fallback());
  await a.boton(page).click();
  await expect(aviso(page)).toContainText("No alcanza");
  // El servidor dijo que esa petición no entró. Antes de soltarla, la pantalla deja cancelado ese
  // envío: si hubiera otro igual en camino —desde otra pestaña—, ya no entra.
  await expect.poll(() => guardado(page)).toBeNull();
  expect(await claseDelEnvio(cuerpos[0].id)).toBe("cancelado");
  await page.getByRole("button", { name: "Corregir los kilos" }).click();
  for (let k = 0; k < 3; k += 1) await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await teclear(page, "10");
  await page.getByRole("button", { name: "Seguir" }).click();
  await a.boton(page).click();
  await quedoUnaSola(page, a);
  expect(cuerpos.map((c) => c.kg)).toEqual(["600", "10"]);
  expect(cuerpos[1].id).not.toBe(cuerpos[0].id);
});

// La secuencia que encontró Codex, con el servidor de verdad contestando: el primer envío se queda
// en el camino, el reintento se rechaza porque ya no alcanza, las condiciones cambian, y el primero
// llega cuando ya nadie lo espera.
test("una merma cuyo primer envío llega tarde, después de un reintento rechazado, no se asienta dos veces", async ({ page }) => {
  const a = ACCIONES[0]!;
  const g = await aUnToque(page, a);
  let entregar!: () => void;
  const orden = new Promise<void>((listo) => { entregar = listo; });
  let contesto!: (estado: number) => void;
  const tardio = new Promise<number>((listo) => { contesto = listo; });
  const cuerpos = await interceptar(page, a, async (ruta) => {
    await orden;
    contesto((await ruta.fetch()).status());
  });
  await a.boton(page).click();
  await expect.poll(() => cuerpos.length).toBe(1);
  await page.reload();
  // Mientras tanto sale casi todo el cartón: quedan 5 kg.
  await conConsola((db) => db.query("SELECT dar_merma(gen_random_uuid(), (SELECT id FROM material WHERE nombre = 'Cartón'), 495, 'Se tiró', $1)", [g.luis.id]));
  await a.reintentar(page, g);
  await expect(aviso(page).last()).toContainText("No alcanza");
  await expect.poll(() => guardado(page)).toBeNull();
  // Un conteo deja 105 kg: ahora sí alcanzaría.
  await conConsola(async (db) => {
    const carton = "(SELECT id FROM material WHERE nombre = 'Cartón')";
    const visto = (await db.query(`SELECT contado_en FROM previa_de_conteo(${carton}, 105, NULL)`)).rows[0];
    await db.query(`SELECT asentar_conteo(${carton}, 105, $1, $2, NULL, $3)`, [g.servando.id, g.luis.id, visto.contado_en]);
  });
  entregar();
  expect(await tardio).toBe(409);
  await a.deNuevo(page, g);
  await expect(hecho(page)).toContainText(a.hecho);
  expect(await cuantos("movimiento_inventario WHERE tipo = 'merma' AND motivo = 'Mojado'")).toBe(1);
  expect(await conConsola(async (db) => Number((await db.query("SELECT kg FROM existencia WHERE nombre = 'Cartón'")).rows[0].kg))).toBe(95);
});

/** Retiene cada envío de la acción, en cualquier pestaña, hasta que se le da paso; entonces llega al servidor y su respuesta vuelve a su pestaña. */
async function retenerEnvios(contexto: BrowserContext, a: Accion) {
  const cuerpos: any[] = [];
  const pasos: Array<() => void> = [];
  const estados: number[] = [];
  await contexto.route(a.camino, async (ruta) => {
    const n = cuerpos.push(ruta.request().postDataJSON()) - 1;
    await new Promise<void>((paso) => { pasos[n] = paso; });
    const respuesta = await ruta.fetch();
    estados[n] = respuesta.status();
    await ruta.fulfill({ response: respuesta }).catch(() => {});
  });
  return { cuerpos, estados, entregar: (n: number) => pasos[n]!() };
}

// La segunda secuencia que encontró Codex: el mismo envío mandado desde dos pestañas. La pestaña A
// lo manda por primera vez; la B, que heredó lo guardado, lo reintenta. A recibe un rechazo: para A
// era su primer intento, pero no era el único envío con ese identificador.
test("una merma mandada desde dos pestañas con el mismo envío no se asienta dos veces", async ({ page, context }) => {
  const a = ACCIONES[0]!;
  const g = await aUnToque(page, a);
  const { cuerpos, estados, entregar } = await retenerEnvios(context, a);
  await a.boton(page).click();
  await expect.poll(() => cuerpos.length).toBe(1);

  // La segunda pestaña nace sin poder coordinarse con la primera, como en un navegador que no lo
  // permite: hereda la captura y su envío. Es el peor caso, y el servidor tiene que aguantarlo solo.
  await context.addInitScript(sinCoordinacionEntrePestanas);
  const otra = await abrirCopia(page, context);
  await otra.getByRole("button", { name: "Volver a intentar" }).click();
  await expect.poll(() => cuerpos.length).toBe(2);
  expect(cuerpos[1]).toEqual(cuerpos[0]);

  // Sale casi todo el cartón: quedan 5 kg. El envío de A llega, y se rechaza porque ya no alcanza.
  await conConsola((db) => db.query("SELECT dar_merma(gen_random_uuid(), (SELECT id FROM material WHERE nombre = 'Cartón'), 495, 'Se tiró', $1)", [g.luis.id]));
  entregar(0);
  await expect(aviso(page)).toContainText("No alcanza");
  await expect.poll(() => guardado(page)).toBeNull();
  expect(estados[0]).toBe(409);
  // Un conteo deja 105 kg: ahora sí alcanzaría. Llega el envío de B, el mismo que A ya soltó.
  await conConsola(async (db) => {
    const carton = "(SELECT id FROM material WHERE nombre = 'Cartón')";
    const visto = (await db.query(`SELECT contado_en FROM previa_de_conteo(${carton}, 105, NULL)`)).rows[0];
    await db.query(`SELECT asentar_conteo(${carton}, 105, $1, $2, NULL, $3)`, [g.servando.id, g.luis.id, visto.contado_en]);
  });
  entregar(1);
  await expect.poll(() => estados[1]).toBe(409);
  // A registra de nuevo: es otro envío, y es el único que queda asentado.
  await a.boton(page).click();
  await expect.poll(() => cuerpos.length).toBe(3);
  entregar(2);
  await expect(hecho(page)).toContainText(a.hecho);
  expect(await cuantos("movimiento_inventario WHERE tipo = 'merma' AND motivo = 'Mojado'")).toBe(1);
  expect(await conConsola(async (db) => Number((await db.query("SELECT kg FROM existencia WHERE nombre = 'Cartón'")).rows[0].kg))).toBe(95);
});

/** Abre desde una pestaña otra que hereda lo que la primera tenía guardado, como al duplicarla. */
async function abrirCopia(page: Page, contexto: BrowserContext, camino = "/inventario"): Promise<Page> {
  const abierta = contexto.waitForEvent("page");
  await page.evaluate((a) => { window.open(a, "_blank"); }, camino);
  return abierta;
}

/** Para sembrar en una pestaña: un navegador sin candados entre pestañas (solo le quedan los avisos). */
function sinCandados(): void {
  Object.defineProperty(Navigator.prototype, "locks", { get: () => undefined, configurable: true });
}
/** Para sembrar en una pestaña: un navegador sin candados ni avisos entre pestañas. */
function sinCoordinacionEntrePestanas(): void {
  Object.defineProperty(Navigator.prototype, "locks", { get: () => undefined, configurable: true });
  (window as unknown as { BroadcastChannel: undefined }).BroadcastChannel = undefined;
}

/** La copia llegó a lo que hay en el patio, con su aviso, y sin nada que registrar ni reintentar. */
async function sinCaptura(copia: Page): Promise<void> {
  await expect(copia.getByRole("heading", { name: "Lo que hay en el patio" })).toBeVisible();
  await expect(aviso(copia)).toContainText("sigue en la otra pestaña");
  await expect(copia.getByRole("button", { name: "Registrar la merma" })).toHaveCount(0);
  await expect(copia.getByRole("button", { name: "Volver a intentar" })).toHaveCount(0);
  expect(await copia.evaluate(() => sessionStorage.getItem("feruga.inventario") ?? "")).not.toContain("Mojado");
}

// Lo normal: una pestaña duplicada, o abierta desde otra, no se queda con la captura a medias.
for (const conEnvio of [false, true]) {
  test(`una pestaña duplicada no hereda la captura a medias${conEnvio ? ", tampoco con un envío del que no se supo" : ""}: sigue donde se empezó`, async ({ page, context }) => {
    const a = ACCIONES[0]!;
    const g = await aUnToque(page, a);
    if (conEnvio) {
      await interceptar(page, a, sePierdeLaRespuesta);
      await a.boton(page).click();
      await expect(aviso(page).first()).toContainText("No se supo si la merma se guardó");
    }
    const otra = await abrirCopia(page, context);
    await sinCaptura(otra);
    // La primera sigue con su captura, y queda asentada una sola vez.
    if (conEnvio) await a.reintentar(page, g);
    else await a.boton(page).click();
    await quedoUnaSola(page, a);
    // Recargar la copia tampoco le devuelve la captura.
    await otra.reload();
    await expect(otra.getByRole("heading", { name: "Lo que hay en el patio" })).toBeVisible();
    await expect(otra.getByRole("button", { name: "Registrar la merma" })).toHaveCount(0);
  });
}

// Lo que encontró Codex: con avisos entre pestañas y una espera, basta que la respuesta de la
// original tarde para que la copia se quede con la captura. Con candados no hay espera que vencer.
test("aunque los avisos entre pestañas tarden, la copia no se queda con la captura", async ({ page, context }) => {
  const a = ACCIONES[0]!;
  await aUnToque(page, a);
  await page.evaluate(() => {
    const mandar = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (this: BroadcastChannel, mensaje: unknown) {
      setTimeout(() => mandar.call(this, mensaje), 800);
    };
  });
  const otra = await abrirCopia(page, context);
  await otra.waitForTimeout(1200);
  await sinCaptura(otra);
  await a.boton(page).click();
  await quedoUnaSola(page, a);
});

test("dos copias abiertas a la vez sueltan las dos la captura, y la original la conserva al recargar", async ({ page, context }) => {
  const a = ACCIONES[0]!;
  await aUnToque(page, a);
  const copias: Page[] = [];
  const alAbrir = (nueva: Page): void => { copias.push(nueva); };
  context.on("page", alAbrir);
  await page.evaluate(() => { window.open("/inventario", "_blank"); window.open("/inventario", "_blank"); });
  await expect.poll(() => copias.length).toBe(2);
  context.off("page", alAbrir);
  const [una, otra] = copias as [Page, Page];
  expect(una).not.toBe(otra);
  expect(context.pages().length).toBe(3);
  await sinCaptura(una);
  await sinCaptura(otra);
  // Cada pestaña quedó con su propio identificador.
  const pestanas = await Promise.all([page, una, otra].map((p) => p.evaluate(() => sessionStorage.getItem("feruga.pestana"))));
  expect(new Set(pestanas).size).toBe(3);
  await page.reload();
  await expect(a.boton(page)).toBeVisible();
  await a.boton(page).click();
  await quedoUnaSola(page, a);
});

/**
 * Para sembrar en una pestaña: hay candados, pero pedirlos falla con ese error mientras
 * `window.candadosRotos` no se apague. «AbortError» es el caso fino: es el mismo error que da el
 * plazo propio, pero aquí llega sin que el plazo haya vencido, y no puede tomarse por «es copia».
 */
function candadosQueFallan(error: string): void {
  const original = LockManager.prototype.request as (...args: unknown[]) => Promise<unknown>;
  const ventana = window as unknown as { candadosRotos: boolean };
  ventana.candadosRotos = true;
  LockManager.prototype.request = function (this: LockManager, ...args: unknown[]) {
    if (ventana.candadosRotos) return Promise.reject(new DOMException("prueba", error));
    return original.apply(this, args);
  } as LockManager["request"];
}
const arreglarCandados = (pagina: Page) => pagina.evaluate(() => { (window as unknown as { candadosRotos: boolean }).candadosRotos = false; });

// Lo que encontró Codex: si pedir el candado falla, la pestaña no sabe si es la original o una
// copia. No saberlo no puede valer como «es mía»: ni se captura ni se suelta nada hasta saberlo.
for (const error of ["SecurityError", "AbortError"]) {
test(`si no se puede saber si la pestaña es copia (${error}), no deja capturar ni suelta nada; al poder saberlo, la copia suelta lo heredado`, async ({ page, context }) => {
  const a = ACCIONES[0]!;
  await aUnToque(page, a);
  await context.addInitScript(candadosQueFallan, error);
  const otra = await abrirCopia(page, context);
  await expect(aviso(otra)).toContainText("No se pudo comprobar");
  await expect(otra.getByRole("button", { name: "Registrar la merma" })).toHaveCount(0);
  expect(await otra.evaluate(() => sessionStorage.getItem("feruga.inventario") ?? "")).toContain("Mojado");
  // Volver a comprobar, con los candados todavía fallando, la deja igual.
  await otra.getByRole("button", { name: "Volver a comprobar" }).click();
  await expect(aviso(otra)).toContainText("No se pudo comprobar");
  await expect(otra.getByRole("button", { name: "Registrar la merma" })).toHaveCount(0);
  // Cuando ya se puede saber, resulta copia: suelta lo heredado.
  await arreglarCandados(otra);
  await otra.getByRole("button", { name: "Volver a comprobar" }).click();
  await sinCaptura(otra);
  await a.boton(page).click();
  await quedoUnaSola(page, a);
});

test(`si al recargar no se puede comprobar el candado (${error}), la pestaña no pierde lo suyo: lo recupera cuando ya se puede`, async ({ page, context }) => {
  const a = ACCIONES[0]!;
  await aUnToque(page, a);
  const pestana = await page.evaluate(() => sessionStorage.getItem("feruga.pestana"));
  await context.addInitScript(candadosQueFallan, error);
  await page.reload();
  await expect(aviso(page)).toContainText("No se pudo comprobar");
  await expect(a.boton(page)).toHaveCount(0);
  // Tampoco el mostrador deja capturar mientras no se sepa.
  await page.getByRole("link", { name: "Mostrador", exact: true }).click();
  await expect(aviso(page)).toContainText("No se pudo comprobar");
  await expect(page.getByRole("button", { name: "+ Compra" })).toHaveCount(0);
  await page.getByRole("link", { name: "Inventario", exact: true }).click();
  await arreglarCandados(page);
  await page.getByRole("button", { name: "Volver a comprobar" }).click();
  await expect(a.boton(page)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("feruga.pestana"))).toBe(pestana);
  await a.boton(page).click();
  await quedoUnaSola(page, a);
});
}

// Lo otro que encontró Codex: un marco del mismo origen comparte lo guardado con su página, pero
// es otro documento. Se tomaba por copia y borraba lo de la original. La aplicación no corre
// dentro de un marco: lo prohíbe la respuesta, y si aun así llegara a cargar, no toca nada.
for (const sinCabeceras of [false, true]) {
  test(`un marco con la aplicación no le borra a la página lo que tenía a medias${sinCabeceras ? ", aunque algo le quite las cabeceras que lo prohíben" : ""}`, async ({ page }) => {
    const a = ACCIONES[0]!;
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, (ruta) => ruta.abort("connectionreset"));
    await a.boton(page).click();
    await expect(aviso(page).first()).toContainText("No se supo si la merma se guardó");
    const loGuardado = () => page.evaluate(() => ({ pestana: sessionStorage.getItem("feruga.pestana"), captura: sessionStorage.getItem("feruga.inventario") }));
    const antes = await loGuardado();

    const respuesta = await page.request.get("/inventario");
    expect(respuesta.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(respuesta.headers()["x-frame-options"]).toBe("DENY");
    if (sinCabeceras) {
      await page.route("**/inventario", async (ruta) => {
        if (ruta.request().frame() === page.mainFrame()) return ruta.fallback();
        const original = await ruta.fetch();
        const cabeceras = { ...original.headers() };
        delete cabeceras["content-security-policy"];
        delete cabeceras["x-frame-options"];
        await ruta.fulfill({ response: original, headers: cabeceras });
      });
    }
    await page.evaluate(() => new Promise<void>((listo) => {
      const marco = document.createElement("iframe");
      marco.id = "marco";
      marco.src = "/inventario";
      marco.onload = () => listo();
      marco.onerror = () => listo();
      document.body.append(marco);
      setTimeout(listo, 3000);
    }));
    const marco = page.frameLocator("#marco");
    if (sinCabeceras) await expect(marco.getByText("no se usa dentro de otra página")).toBeVisible();
    else await page.waitForTimeout(1500);
    await expect(marco.getByRole("button", { name: "Volver a intentar" })).toHaveCount(0);
    expect(await loGuardado()).toEqual(antes);

    await page.evaluate(() => document.getElementById("marco")?.remove());
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const reintento = page.waitForRequest((r) => a.camino.test(r.url()) && r.method() === "POST");
    await page.reload();
    await a.reintentar(page, g);
    expect((await reintento).postDataJSON()).toEqual(cuerpos[0]);
    await quedoUnaSola(page, a);
  });
}

// El riesgo del candado es el contrario: que una pestaña se tome por copia sin serlo, y suelte lo
// suyo. Pasaría si al recargar el candado de la página anterior no quedara libre a tiempo.
test("recargar muchas veces, y salir y volver, no le quita la captura a su propia pestaña", async ({ page }) => {
  const a = ACCIONES[0]!;
  const g = await aUnToque(page, a);
  expect(await page.evaluate(() => ({ seguro: isSecureContext, candados: typeof navigator.locks }))).toEqual({ seguro: true, candados: "object" });
  const pestana = await page.evaluate(() => sessionStorage.getItem("feruga.pestana"));
  for (let k = 0; k < 15; k += 1) {
    await page.reload();
    await expect(a.boton(page)).toBeVisible();
  }
  // Salir a otra página y volver con el botón de atrás; y otra vez hacia adelante y atrás.
  await page.goto("/api/salud");
  await page.goBack();
  await expect(a.boton(page)).toBeVisible();
  await page.goForward();
  await page.goBack();
  await expect(a.boton(page)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("feruga.pestana"))).toBe(pestana);
  // Y lo mismo con un envío del que no se supo: sigue siendo el mismo después de recargar.
  const cuerpos = await interceptar(page, a, sePierdeLaRespuesta);
  await a.boton(page).click();
  await expect(aviso(page).first()).toContainText("No se supo si la merma se guardó");
  for (let k = 0; k < 5; k += 1) {
    await page.reload();
    await expect(aviso(page).first()).toContainText("No se supo si la merma se guardó");
  }
  await a.reintentar(page, g);
  await quedoUnaSola(page, a);
  expect(cuerpos[1]).toEqual(cuerpos[0]);
});

test("la original conserva la captura aunque esté en otra pantalla cuando se abre la copia", async ({ page, context }) => {
  const a = ACCIONES[0]!;
  await aUnToque(page, a);
  await page.getByRole("link", { name: "Mostrador", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Cuentas abiertas" })).toBeVisible();
  const otra = await abrirCopia(page, context);
  await sinCaptura(otra);
  await page.getByRole("link", { name: "Inventario", exact: true }).click();
  await a.boton(page).click();
  await quedoUnaSola(page, a);
});

test("en un navegador sin candados entre pestañas, la copia se entera por aviso y tampoco hereda la captura", async ({ page, context }) => {
  await context.addInitScript(sinCandados);
  const a = ACCIONES[0]!;
  await aUnToque(page, a);
  const otra = await abrirCopia(page, context);
  await sinCaptura(otra);
  await a.boton(page).click();
  await quedoUnaSola(page, a);
});

// El caso que Codex forzó: el identificador que le toca a una captura ya lo ocupa otro envío. No
// pasa con identificadores al azar, pero la pantalla no debe decir que quedó registrada sin que
// la acción misma se lo confirme.
test("si el identificador de una captura ya lo ocupa otro envío, la pantalla no dice que quedó registrada: la suelta y sale con otro", async ({ page }) => {
  const a = ACCIONES[0]!;
  const g = await aUnToque(page, a);
  const ocupado = "11111111-1111-4111-8111-111111111111";
  await conConsola((db) => db.query("SELECT dar_merma($1, (SELECT id FROM material WHERE nombre = 'Cartón'), 20, 'Otra captura', $2)", [ocupado, g.luis.id]));
  await page.evaluate((id) => {
    const azar = crypto as unknown as { randomUUID?: () => string };
    const original = azar.randomUUID;
    azar.randomUUID = () => { azar.randomUUID = original; return id; };      // solo el siguiente
  }, ocupado);
  const cuerpos = await interceptar(page, a);
  const cancelaciones = cancelacionesPedidas(page);
  await a.boton(page).click();
  await expect(aviso(page)).toContainText("ya se había recibido con otros datos");
  await expect(hecho(page)).toHaveCount(0);
  await expect.poll(() => guardado(page)).toBeNull();
  // Ese identificador ya está resuelto en el servidor: no hay nada que cancelar.
  expect(cancelaciones).toEqual([]);
  await a.boton(page).click();
  await expect(hecho(page)).toContainText(a.hecho);
  expect(cuerpos.map((c) => c.id === ocupado)).toEqual([true, false]);
  expect(await cuantos("movimiento_inventario WHERE tipo = 'merma' AND motivo = 'Mojado'")).toBe(1);
  expect(await conConsola(async (db) => Number((await db.query("SELECT kg FROM existencia WHERE nombre = 'Cartón'")).rows[0].kg))).toBe(470);
});

const CANCELAR = /\/api\/envios\/[^/]+\/cancelar$/;

test("si el servidor no confirma la cancelación tal como se espera, el envío no se suelta", async ({ page }) => {
  const a = ACCIONES[0]!;
  const g = await aUnToque(page, a);
  const cuerpos = await interceptar(page, a,
    (ruta) => ruta.abort("connectionreset"),
    (ruta) => ruta.fulfill({ status: 409, json: { error: { codigo: "RC002", mensaje: "No alcanza: hay 5 kg" } } }),
  );
  // Algo en medio contesta que sí, pero sin decir qué pasó.
  await page.route(CANCELAR, (ruta) => ruta.fulfill({ status: 200, json: {} }));
  const cancelaciones = cancelacionesPedidas(page);
  await a.boton(page).click();
  await a.reintentar(page, g);
  await expect(aviso(page).last()).toContainText("No alcanza");
  expect(cancelaciones).toEqual([cuerpos[0].id]);
  // No se sabe si quedó cancelado: sigue siendo el mismo envío, sin poder editarse.
  expect((await guardado(page))?.id).toBe(cuerpos[0].id);
  expect(await claseDelEnvio(cuerpos[0].id)).toBeNull();
  await page.unroute(CANCELAR);
  await a.reintentar(page, g);
  await quedoUnaSola(page, a);
  expect(cuerpos.map((c) => c.id)).toEqual([cuerpos[0].id, cuerpos[0].id, cuerpos[0].id]);
});

// Cuando el servidor dice que el identificador ya había entrado, la acción se manda otra vez para
// que sea ella la que diga qué hizo. Aquí se retienen la cancelación y esa confirmación, para ver
// que la pantalla espera cada respuesta; y se prueba cada cosa que la confirmación puede contestar.
const CONFIRMACIONES: Array<{ que: string; contesta: (ruta: Route) => Promise<void>; queda: "hecha" | "suelta" | "guardada"; dice?: string }> = [
  { que: "contesta lo que hizo", contesta: (ruta) => ruta.fallback(), queda: "hecha" },
  {
    que: "contesta que ese identificador lo ocupa otra cosa", queda: "suelta", dice: "otros datos",
    contesta: (ruta) => ruta.fulfill({ status: 409, json: { error: { codigo: "RC012", mensaje: "Ese envío ya se había recibido con otros datos" } } }),
  },
  {
    que: "contesta otra regla", queda: "guardada", dice: "No alcanza",
    contesta: (ruta) => ruta.fulfill({ status: 409, json: { error: { codigo: "RC002", mensaje: "No alcanza: hay 5 kg" } } }),
  },
  { que: "no llega", contesta: (ruta) => ruta.abort("connectionreset"), queda: "guardada", dice: "No se pudo hablar con el servidor" },
  { que: "falla en el servidor", contesta: (ruta) => ruta.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" }), queda: "guardada", dice: "Algo falló de nuestro lado" },
];

for (const c of CONFIRMACIONES) {
  test(`merma: la confirmación de un envío que ya había entrado ${c.que}: la captura queda ${c.queda}`, async ({ page }) => {
    const a = ACCIONES[0]!;
    const g = await aUnToque(page, a);
    let soltarCancelacion!: () => void;
    const cancelacionRetenida = new Promise<void>((listo) => { soltarCancelacion = listo; });
    let soltarConfirmacion!: () => void;
    const confirmacionRetenida = new Promise<void>((listo) => { soltarConfirmacion = listo; });
    const cuerpos = await interceptar(page, a,
      sePierdeLaRespuesta,
      (ruta) => ruta.fulfill({ status: 403, json: { error: { codigo: "RC008", mensaje: "Eso no le toca a tu rol" } } }),
      async (ruta) => {
        await confirmacionRetenida;
        await c.contesta(ruta);
      },
    );
    await page.route(CANCELAR, async (ruta) => {
      await cancelacionRetenida;
      await ruta.fallback();
    });
    const cancelaciones = cancelacionesPedidas(page);
    await a.boton(page).click();
    await a.reintentar(page, g);

    // Con la cancelación en el aire no se ha soltado nada, ni se ha mandado la confirmación.
    await expect.poll(() => cancelaciones.length).toBe(1);
    expect((await guardado(page))?.id).toBe(cuerpos[0].id);
    expect(cuerpos.length).toBe(2);
    soltarCancelacion();
    // Con la confirmación en el aire tampoco: ni éxito ni captura suelta.
    await expect.poll(() => cuerpos.length).toBe(3);
    expect(cuerpos[2]).toEqual(cuerpos[0]);
    await expect(hecho(page)).toHaveCount(0);
    expect((await guardado(page))?.id).toBe(cuerpos[0].id);
    soltarConfirmacion();

    if (c.queda === "hecha") {
      await quedoUnaSola(page, a);
      return;
    }
    await expect(aviso(page).last()).toContainText(c.dice!);
    await expect(hecho(page)).toHaveCount(0);
    if (c.queda === "suelta") {
      await expect.poll(() => guardado(page)).toBeNull();
      await expect(a.boton(page)).toBeVisible();
    } else {
      expect((await guardado(page))?.id).toBe(cuerpos[0].id);
      await expect(a.boton(page)).toHaveCount(0);
      // Y se puede seguir: el siguiente intento, con el mismo envío, lo resuelve.
      await a.otraVez(page, g);
      await quedoUnaSola(page, a);
    }
    expect(await cuantos(a.asentadas)).toBe(1);
  });
}

// Conteo y corrección llevan la clave de quien autoriza: tienen sus propios cruces.
for (const a of ACCIONES.filter((x) => x.nombre === "conteo" || x.nombre === "corrección")) {
  test(`${a.nombre}: la clave mal al reintentar cancela ese envío y deja autorizar de nuevo, sin asentar dos`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, (ruta) => ruta.abort("connectionreset"));
    await a.boton(page).click();
    await expect(page.getByText(/No se supo si .* se registró\./)).toBeVisible();
    await teclear(page, "000000");
    await a.boton(page).click();
    await expect(aviso(page)).toContainText("La clave no pasó");
    // La clave mal no dice que el primero no entró; el servidor lo resolvió: no había entrado, y ya no entra.
    await expect.poll(() => guardado(page)).toBeNull();
    expect(await claseDelEnvio(cuerpos[0].id)).toBe("cancelado");
    await a.otraVez(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(3);
    expect(cuerpos[2].id).not.toBe(cuerpos[0].id);
  });

  test(`${a.nombre}: si al reintentar lo revisado ya cambió y la cancelación no se puede hacer, el envío sigue pendiente y no se edita`, async ({ page }) => {
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a,
      (ruta) => ruta.abort("connectionreset"),
      (ruta) => ruta.fulfill({ status: 409, json: { error: { codigo: "RC011", mensaje: "Lo revisado cambió: hay que volver a verlo" } } }),
    );
    await page.route(CANCELAR, (ruta) => ruta.abort("connectionreset"));
    const cancelaciones = cancelacionesPedidas(page);
    await a.boton(page).click();
    await expect(page.getByText(/No se supo si .* se registró\./)).toBeVisible();
    await a.otraVez(page, g);
    await expect(aviso(page)).toContainText("Lo revisado cambió");
    expect(cancelaciones).toEqual([cuerpos[0].id]);
    // No se pudo resolver: no regresa a capturar ni sale de la corrección; sigue el mismo envío, con la misma persona.
    expect((await guardado(page))?.id).toBe(cuerpos[0].id);
    await mismaPersona(page, g.servando);
    await page.unroute(CANCELAR);
    await a.otraVez(page, g);
    await quedoUnaSola(page, a);
    expect(cuerpos.map((c) => c.id)).toEqual([cuerpos[0].id, cuerpos[0].id, cuerpos[0].id]);
  });

  test(`${a.nombre}: si dan de baja a quien autorizó un envío del que no se supo, lo autoriza otra persona`, async ({ page }) => {
    const marco = await altaDePersona("Marco", "responsable", "271828", true);
    const g = await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, (ruta) => ruta.abort("connectionreset"));
    await a.boton(page).click();
    await expect(page.getByText(/No se supo si .* se registró\./)).toBeVisible();
    await conConsola((db) => db.query("SELECT baja_persona($1)", [g.servando.id]));
    await a.otraVez(page, g);
    await expect(aviso(page)).toContainText("personas facultadas");
    await expect.poll(() => guardado(page)).toBeNull();
    expect(await claseDelEnvio(cuerpos[0].id)).toBe("cancelado");
    // Ya se puede elegir a otra persona, y la lista es la de ahora.
    await page.getByRole("button", { name: "Autoriza otra persona" }).click();
    await expect(page.getByRole("button", { name: /^Servando/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Marco/ }).click();
    await teclear(page, marco.clave);
    await page.getByRole("button", { name: "Autorizar a nombre de Marco" }).click();
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(3);
    expect(cuerpos[2].id).not.toBe(cuerpos[0].id);
    expect(cuerpos[2].autoriza).toBe(marco.id);
  });

  test(`${a.nombre}: con un envío del que no se supo, pedir que autorice otra persona averigua primero si ya había entrado`, async ({ page }) => {
    await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, sePierdeLaRespuesta);
    await a.boton(page).click();
    await expect(page.getByText(/No se supo si .* se registró\./)).toBeVisible();
    await page.getByRole("button", { name: "Autoriza otra persona" }).click();
    await quedoUnaSola(page, a, a.yaEstaba);
    expect(cuerpos.length).toBe(1);
  });

  test(`${a.nombre}: con un envío del que no se supo y que no llegó, otra persona lo autoriza como un envío nuevo`, async ({ page }) => {
    const marco = await altaDePersona("Marco", "responsable", "271828", true);
    await aUnToque(page, a);
    const cuerpos = await interceptar(page, a, (ruta) => ruta.abort("connectionreset"));
    await a.boton(page).click();
    await expect(page.getByText(/No se supo si .* se registró\./)).toBeVisible();
    await page.getByRole("button", { name: "Autoriza otra persona" }).click();
    await page.getByRole("button", { name: /^Marco/ }).click();
    await teclear(page, marco.clave);
    await page.getByRole("button", { name: "Autorizar a nombre de Marco" }).click();
    await quedoUnaSola(page, a);
    expect(cuerpos.length).toBe(2);
    expect(cuerpos[1].id).not.toBe(cuerpos[0].id);
    expect(cuerpos[1].autoriza).toBe(marco.id);
    expect(await claseDelEnvio(cuerpos[0].id)).toBe("cancelado");
  });
}
