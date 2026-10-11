// Apoyo de los recorridos: deja la base como recién instalada y hace, por la vía de la consola,
// lo que en la vida real hace quien administra (dar de alta personas y generar códigos de equipo).
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import pg from "pg";

const ADMIN = process.env.PG_ADMIN_URL ?? "postgres://feruga:desarrollo@db_recorrido:5432/postgres";
const PLANTILLA = process.env.PG_PLANTILLA ?? "recorrido_plantilla";

function urlDe(base: string): string {
  const u = new URL(ADMIN);
  u.pathname = "/" + base;
  return u.toString();
}

/** Corre algo con la conexión de administración a la base de la aplicación. */
export async function conConsola<T>(hacer: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: urlDe("feruga") });
  await db.connect();
  try {
    return await hacer(db);
  } finally {
    await db.end();
  }
}

/** Deja la base como recién migrada. La aplicación pierde sus conexiones y abre otras sola. */
export async function baseNueva(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  try {
    await admin.query("DROP DATABASE IF EXISTS feruga WITH (FORCE)");
    await admin.query(`CREATE DATABASE feruga TEMPLATE ${PLANTILLA}`);
  } finally {
    await admin.end();
  }
}

/** Tira la base, para ver qué hace la aplicación cuando no la tiene. El recorrido que sigue la repone. */
export async function baseCaida(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  try {
    await admin.query("DROP DATABASE IF EXISTS feruga WITH (FORCE)");
  } finally {
    await admin.end();
  }
}

export interface Persona {
  id: string;
  nombre: string;
  clave: string;
}

export const altaDePersona = (nombre: string, rol: string, clave: string, autoriza = false): Promise<Persona> =>
  conConsola(async (db) => {
    const { rows } = await db.query("SELECT id FROM alta_persona($1, $2, $3, $4)", [nombre, rol, autoriza, clave]);
    return { id: rows[0].id, nombre, clave };
  });

export const codigoDeEquipo = (nombre = "Mostrador"): Promise<string> =>
  conConsola(async (db) => (await db.query("SELECT crear_codigo_alta($1) AS c", [nombre])).rows[0].c);

// ── lo que una persona hace en la pantalla ─────────────────────────────────

/** El navegador no imprime de verdad: se cuenta cuántas veces se mandó a imprimir. */
export async function contarImpresiones(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).impresiones = 0;
    window.print = () => { (window as any).impresiones += 1; };
  });
}
export const impresiones = (page: Page): Promise<number> => page.evaluate(() => (window as any).impresiones as number);

/** Toca las teclas del teclado en pantalla, una por una. */
export async function teclear(page: Page, texto: string): Promise<void> {
  const teclado = page.locator(".teclado");
  for (const tecla of texto) {
    await teclado.getByRole("button", { name: tecla === "." ? "Punto decimal" : tecla, exact: true }).click();
  }
}

export async function darDeAltaEquipo(page: Page, nombre = "Mostrador"): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Código de alta").fill(await codigoDeEquipo(nombre));
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();
}

export async function entrar(page: Page, persona: Persona): Promise<void> {
  await page.getByRole("button", { name: new RegExp("^" + persona.nombre) }).click();
  await teclear(page, persona.clave);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".barra")).toContainText(persona.nombre);
}

export async function salir(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();
}

/** Elige el material y la báscula y teclea el peso, hasta dejarlo agregado. `familia` vacío: está entre los frecuentes. */
export async function pesar(page: Page, material: string, bascula: string, kg: string, familia?: string): Promise<void> {
  if (familia) await page.getByRole("button", { name: familia, exact: true }).click();
  await page.locator(".grid").getByRole("button", { name: new RegExp("^" + material) }).click();
  await page.getByRole("button", { name: new RegExp("^" + bascula) }).click();
  await teclear(page, kg);
  await page.getByRole("button", { name: /^(Agregar a la cuenta|Guardar peso)/ }).click();
  await expect(page.getByText(/^En esta cuenta/)).toBeVisible();
}

export interface Gente {
  servando: Persona;
  luis: Persona;
}

export const gente = async (): Promise<Gente> => ({
  servando: await altaDePersona("Servando", "responsable", "481516", true),
  luis: await altaDePersona("Luis", "mostrador", "4815"),
});

/** Deja el día listo para atender, por la vía corta: arranque, jornada abierta y precios publicados. */
export async function diaListo(g: Gente, saldos: Array<[string, string]> = []): Promise<void> {
  await conConsola(async (db) => {
    const id = async (nombre: string): Promise<number> => (await db.query("SELECT id FROM material WHERE nombre = $1", [nombre])).rows[0].id;
    const lista = [];
    for (const [nombre, kg] of saldos) lista.push({ material: await id(nombre), kg, origen: "contado" });
    await db.query("SELECT terminar_arranque($1::jsonb, $2)", [JSON.stringify(lista), g.servando.id]);
    await db.query("SELECT abrir_jornada_de_hoy($1)", [g.luis.id]);
    for (const [nombre, compra, venta] of [
      ["Cartón", "2.1", "2.5"], ["Aluminio bote", "28", "33"], ["Fierro pesado", "6.8", "8"], ["Cobre de primera", "150", "177"], ["PET", "7.5", "8.9"],
    ] as const) {
      await db.query("SELECT fijar_precio($1, $2, $3, $4)", [await id(nombre), compra, venta, g.servando.id]);
    }
    await db.query("SELECT publicar_lista_de_hoy($1)", [g.servando.id]);
  });
}

/** Cierra por la consola la jornada que está abierta, diciendo lo que ve de ella, como la pantalla del cierre. */
export const cerrarElDia = (db: pg.Client, quien: string) =>
  db.query(
    "SELECT h.* FROM jornada j, LATERAL cerrar_el_dia(gen_random_uuid(), j.id, j.cierres, $1) h WHERE j.sucursal_id = 1 AND j.cerrada_en IS NULL",
    [quien],
  );

/** El aviso de un rechazo en la pantalla. (El papel de «alerta» también lo usa un elemento interno de Next.) */
export const aviso = (page: Page) => page.locator('.flag[role="alert"]');

/**
 * Las medidas de patio, sobre lo que hay a la vista dentro de `raices` (por omisión, toda la
 * página). Devuelve lo que no cumple, con sus números; nada, si todo cumple:
 *  - lo que se toca mide 60 px o más, de alto y de ancho;
 *  - está separado 8 px o más de lo que tiene junto —de lado, de arriba abajo o en diagonal—, y no
 *    se encima con nada;
 *  - el texto va de 17 px para arriba. Los rótulos —el nombre de un control, el renglón chico bajo
 *    un nombre, el encabezado de una columna, las pantallas de la barra en un teléfono— pueden ir
 *    de 15: son la excepción, y es esta lista. Un aviso no es un rótulo. Nada va de menos de 15;
 *  - y la página no se desplaza de lado.
 */
const ROTULOS = 'small, .lbl, .interruptor, nav[aria-label="Pantallas"] a, th, .phead span';

export const loQueNoMide = (page: Page, raices = "body"): Promise<string[]> =>
  page.evaluate(([selector, rotulos]) => {
    const mal: string[] = [];
    const seVe = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const nombre = (e: Element): string =>
      "«" + ((e.getAttribute("aria-label") ?? e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28) || e.tagName.toLowerCase()) + "»";
    const dentro = Array.from(document.querySelectorAll(selector));
    const tocables = dentro.flatMap((d) => [
      ...(d.matches('button, a[href], input, select, textarea, [role="switch"]') ? [d] : []),
      ...Array.from(d.querySelectorAll('button, a[href], input, select, textarea, [role="switch"]')),
    ]).filter((e, k, todos) => todos.indexOf(e) === k).filter(seVe);

    for (const e of tocables) {
      const r = e.getBoundingClientRect();
      if (r.height < 59.5 || r.width < 59.5) mal.push(`${nombre(e)} mide ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    for (let i = 0; i < tocables.length; i++) {
      for (let j = i + 1; j < tocables.length; j++) {
        const [a, b] = [tocables[i]!.getBoundingClientRect(), tocables[j]!.getBoundingClientRect()];
        const lado = Math.max(a.left - b.right, b.left - a.right);      // lo que los separa de lado
        const alto = Math.max(a.top - b.bottom, b.top - a.bottom);      // y de arriba abajo
        if (lado < 0 && alto < 0) mal.push(`${nombre(tocables[i]!)} y ${nombre(tocables[j]!)} se enciman`);
        else if (alto < 0 && lado < 7.5) mal.push(`${nombre(tocables[i]!)} y ${nombre(tocables[j]!)} están a ${Math.round(lado)} px`);
        else if (lado < 0 && alto < 7.5) mal.push(`${nombre(tocables[i]!)} y ${nombre(tocables[j]!)} están a ${Math.round(alto)} px, uno sobre otro`);
        // Ni de lado ni uno sobre otro: de esquina a esquina.
        else if (lado >= 0 && alto >= 0 && Math.hypot(lado, alto) < 7.5) mal.push(`${nombre(tocables[i]!)} y ${nombre(tocables[j]!)} están a ${Math.round(Math.hypot(lado, alto))} px, en diagonal`);
      }
    }
    // La letra: cada elemento que tiene texto propio, no el de sus hijos.
    for (const d of dentro) {
      for (const e of [d, ...Array.from(d.querySelectorAll("*"))]) {
        if (!seVe(e)) continue;
        const propio = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
        if (!propio) continue;
        const s = getComputedStyle(e);
        // Lo que se esconde a la vista y se deja para quien no ve (un rótulo recortado a 1 px) no cuenta.
        if (e.getBoundingClientRect().width <= 1.5) continue;
        if (parseFloat(s.fontSize) < 14.95) mal.push(`${nombre(e)} va en letra de ${s.fontSize}`);
        else if (parseFloat(s.fontSize) < 16.95 && !e.closest(rotulos!)) mal.push(`${nombre(e)} va en letra de ${s.fontSize}, y no es un rótulo`);
      }
    }
    const raiz = document.documentElement;
    if (raiz.scrollWidth > raiz.clientWidth + 0.5) mal.push(`la página se desplaza de lado: mide ${raiz.scrollWidth} px en ${raiz.clientWidth}`);
    return mal;
  }, [raices, ROTULOS]);
